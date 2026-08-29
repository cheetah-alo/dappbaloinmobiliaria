import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  activityTypes,
  approvalKinds,
  canAccessAssignedRecord,
  canApprove,
  canAssign,
  canCreateActivity,
  canRequestApproval,
  type Activity,
  type ActivityType,
  type Actor,
  type Approval,
  type ApprovalKind,
  type GatewayResult,
  type Lead,
  type OpsSnapshot,
  type OwnerEnquiry,
  type PersistedEvent,
  type Property,
} from '@balo/contracts';

type WorkerEnv = Env;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type GatewayEventType = PersistedEvent['eventType'] | 'ops_snapshot' | 'ops_assignment' | 'ops_activity' | 'ops_approval_request' | 'ops_approval_decision';
type GatewayEvent = { eventId: string; eventType: GatewayEventType; occurredAt: string; payload: Record<string, unknown> };
type GatewayEnvelope = { timestamp: string; signature: string; event: GatewayEvent };
type GatewaySnapshot = OpsSnapshot & { actor: Actor; users: Actor[] };
type Principal = { subject: string; email?: string; testActor?: Actor };

const maxBodyBytes = 16_384;
const identifierPattern = /^[A-Za-z0-9_-]{1,120}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enquiryOperations = new Set<OwnerEnquiry['operation']>(['sell', 'rent', 'buy', 'invest']);
const attributionSources = new Set<OwnerEnquiry['attribution']['source']>(['website', 'whatsapp', 'instagram', 'portal', 'manual']);
const leadStages = new Set<Lead['stage']>(['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost']);
const approvalStatuses = new Set<Approval['status']>(['pending', 'approved', 'rejected']);
const activityTypeSet = new Set<ActivityType>(activityTypes);
const approvalKindSet = new Set<ApprovalKind>(approvalKinds);

function secret(env: WorkerEnv, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value);
}

function isRole(value: unknown): value is Actor['role'] {
  return value === 'admin' || value === 'user';
}

function json(body: Record<string, unknown>, status: number, request: Request, env: WorkerEnv): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  const origin = request.headers.get('origin');
  const isMarketingOrigin = origin === env.ALLOWED_ORIGIN;
  const isOpsOrigin = origin === env.OPS_ALLOWED_ORIGIN;
  if (origin && (isMarketingOrigin || isOpsOrigin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    headers.set('access-control-allow-headers', 'content-type, idempotency-key, cf-access-jwt-assertion, x-balo-csrf');
    if (isOpsOrigin) headers.set('access-control-allow-credentials', 'true');
  }
  headers.set('vary', 'Origin');
  return new Response(JSON.stringify(body), { status, headers });
}

function badRequest(code: string, request: Request, env: WorkerEnv): Response {
  return json({ ok: false, code }, 400, request, env);
}

function forbidden(code: string, request: Request, env: WorkerEnv): Response {
  return json({ ok: false, code }, 403, request, env);
}

function gatewayFailure(request: Request, env: WorkerEnv): Response {
  return json({ ok: false, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true }, 503, request, env);
}

function hasTrustedOpsOrigin(request: Request, env: WorkerEnv): boolean {
  return request.headers.get('origin') === env.OPS_ALLOWED_ORIGIN;
}

async function readBoundedText(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteLength += part.value.byteLength;
      if (byteLength > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const body = await readBoundedText(request);
  if (body === null || body.length === 0) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function hmacSha256(secretValue: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretValue), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sameValue(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (first: ArrayBuffer | ArrayBufferView, second: ArrayBuffer | ArrayBufferView) => boolean;
  };

  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(leftHash, rightHash);
  }

  // Vitest's Node runtime does not yet implement the Workers helper above.
  // Both operands are SHA-256 digests, so the fallback always compares a
  // fixed-size value without an early return.
  const first = new Uint8Array(leftHash);
  const second = new Uint8Array(rightHash);
  let difference = first.length ^ second.length;
  const length = Math.max(first.length, second.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (first[index] ?? 0) ^ (second[index] ?? 0);
  }

  return difference === 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite values cannot be signed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new TypeError('Unsupported signed gateway value');
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function optionalBoundedText(value: unknown, max: number): string | undefined {
  const text = boundedText(value, 1, max);
  return text || undefined;
}

function parseAttribution(value: unknown): OwnerEnquiry['attribution'] | null {
  if (!isRecord(value) || !attributionSources.has(value.source as OwnerEnquiry['attribution']['source'])) return null;
  return {
    source: value.source as OwnerEnquiry['attribution']['source'],
    ...(optionalBoundedText(value.utmSource, 120) ? { utmSource: optionalBoundedText(value.utmSource, 120) } : {}),
    ...(optionalBoundedText(value.utmCampaign, 120) ? { utmCampaign: optionalBoundedText(value.utmCampaign, 120) } : {}),
    ...(optionalBoundedText(value.qrId, 120) ? { qrId: optionalBoundedText(value.qrId, 120) } : {}),
    ...(optionalBoundedText(value.postId, 120) ? { postId: optionalBoundedText(value.postId, 120) } : {}),
  };
}

function parseOwnerEnquiry(input: unknown): OwnerEnquiry | null {
  if (!isRecord(input)) return null;
  const name = boundedText(input.name, 2, 120);
  const phone = boundedText(input.phone, 7, 40);
  const district = boundedText(input.district, 2, 120);
  const attribution = parseAttribution(input.attribution);
  const email = optionalBoundedText(input.email, 254);
  if (!name || !phone || phone.replace(/\D/g, '').length < 7 || !district || !attribution || input.consent !== true || !enquiryOperations.has(input.operation as OwnerEnquiry['operation'])) return null;
  return {
    name,
    phone,
    ...(email ? { email } : {}),
    operation: input.operation as OwnerEnquiry['operation'],
    district,
    consent: true,
    attribution,
  };
}

function clientIp(request: Request): string | undefined {
  const direct = request.headers.get('cf-connecting-ip');
  if (direct) return direct;
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0]?.trim() : undefined;
}

function testBypassEnabled(env: WorkerEnv): boolean {
  return secret(env, 'ALLOW_TEST_BYPASS') === 'true' && secret(env, 'RUNTIME_ENV') !== 'production';
}

async function verifyTurnstile(token: string | undefined, request: Request, turnstileIdempotencyKey: string, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<boolean> {
  if (testBypassEnabled(env)) return true;
  const turnstileSecret = secret(env, 'TURNSTILE_SECRET');
  if (!token || token.length > 2_048 || !turnstileSecret) return false;
  const form = new FormData();
  form.set('secret', turnstileSecret);
  form.set('response', token);
  form.set('idempotency_key', turnstileIdempotencyKey);
  const ip = clientIp(request);
  if (ip) form.set('remoteip', ip);
  try {
    const response = await fetchImplementation('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    if (!response.ok) return false;
    const result = await response.json() as unknown;
    return isRecord(result) && result.success === true;
  } catch {
    return false;
  }
}

function eventIdFromRequest(request: Request): string {
  const supplied = request.headers.get('idempotency-key');
  return typeof supplied === 'string' && uuidPattern.test(supplied) ? supplied : crypto.randomUUID();
}

function csrfConfig(env: WorkerEnv): string | null {
  return secret(env, 'CSRF_SECRET') ?? null;
}

async function csrfToken(principal: Principal, env: WorkerEnv): Promise<string | null> {
  const csrfSecret = csrfConfig(env);
  if (!csrfSecret) return null;
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const signature = await hmacSha256(csrfSecret, `${principal.subject}.${timestamp}.${nonce}`);
  return `${timestamp}|${nonce}|${signature}`;
}

async function hasValidCsrfToken(request: Request, principal: Principal, env: WorkerEnv): Promise<boolean> {
  const csrfSecret = csrfConfig(env);
  const supplied = request.headers.get('x-balo-csrf');
  if (!csrfSecret || !supplied) return false;
  const parts = supplied.split('|');
  if (parts.length !== 3) return false;
  const [timestamp, nonce, signature] = parts;
  const timestampMs = Date.parse(timestamp ?? '');
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 15 * 60 * 1000 || !uuidPattern.test(nonce ?? '') || !/^[a-f0-9]{64}$/i.test(signature ?? '')) return false;
  return sameValue(signature ?? '', await hmacSha256(csrfSecret, `${principal.subject}.${timestamp}.${nonce}`));
}

async function signedGatewayEnvelope(event: GatewayEvent, gatewaySecret: string): Promise<GatewayEnvelope> {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    signature: `sha256=${await hmacSha256(gatewaySecret, `${timestamp}.${canonicalJson(event)}`)}`,
    event,
  };
}

async function sendGatewayEvent(event: GatewayEvent, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response | null> {
  const gatewayUrl = secret(env, 'GATEWAY_URL');
  const gatewaySecret = secret(env, 'GATEWAY_HMAC_SECRET');
  if (!gatewayUrl || !gatewaySecret) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(gatewayUrl);
    if (endpoint.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const envelope = await signedGatewayEnvelope(event, gatewaySecret);
  try {
    return await fetchImplementation(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  } catch {
    return null;
  }
}

async function persistEvent(event: PersistedEvent, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<GatewayResult> {
  const response = await sendGatewayEvent(event, env, fetchImplementation);
  if (!response) return { ok: false, eventId: event.eventId, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true };
  if (!response.ok) return { ok: false, eventId: event.eventId, code: 'GATEWAY_REJECTED', manualFollowUp: true };
  try {
    const result = await response.json() as unknown;
    if (!isRecord(result) || result.ok !== true || result.eventId !== event.eventId) return { ok: false, eventId: event.eventId, code: 'GATEWAY_REJECTED', manualFollowUp: true };
    return { ok: true, eventId: event.eventId, deduplicated: result.deduplicated === true };
  } catch {
    return { ok: false, eventId: event.eventId, code: 'GATEWAY_REJECTED', manualFollowUp: true };
  }
}

function log(event: string, eventId: string, outcome: string): void {
  console.log(JSON.stringify({ event, eventId, outcome }));
}

async function publicEnquiry(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const input = await readBoundedJson(request);
  if (input === null) return badRequest('INVALID_JSON_OR_PAYLOAD_TOO_LARGE', request, env);
  const payload = parseOwnerEnquiry(input);
  if (!payload) return badRequest('INVALID_ENQUIRY_OR_CONSENT', request, env);
  const token = isRecord(input) && typeof input.turnstileToken === 'string' ? input.turnstileToken : undefined;
  const eventId = eventIdFromRequest(request);
  if (!await verifyTurnstile(token, request, crypto.randomUUID(), env, fetchImplementation)) return json({ ok: false, code: 'ANTISPAM_NOT_VERIFIED', manualFollowUp: true }, 503, request, env);
  const result = await persistEvent({ eventId, eventType: 'owner_enquiry', occurredAt: new Date().toISOString(), payload }, env, fetchImplementation);
  log('owner_enquiry', eventId, result.ok ? 'recorded' : result.code);
  return result.ok
    ? json({ ok: true, eventId: result.eventId, deduplicated: result.deduplicated }, 202, request, env)
    : json({ ok: false, eventId, code: result.code, manualFollowUp: true }, 503, request, env);
}

async function metaWebhook(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const webhookSecret = secret(env, 'META_APP_SECRET');
  if (!webhookSecret) return json({ ok: false, code: 'CONNECTOR_DISABLED', manualFollowUp: true }, 503, request, env);
  const rawBody = await readBoundedText(request);
  if (rawBody === null) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413, request, env);
  const supplied = request.headers.get('x-hub-signature-256')?.replace('sha256=', '');
  if (!supplied || !await sameValue(supplied, await hmacSha256(webhookSecret, rawBody))) return json({ ok: false, code: 'INVALID_WEBHOOK_SIGNATURE' }, 401, request, env);
  const eventId = `meta_${await sha256(rawBody)}`;
  const result = await persistEvent({ eventId, eventType: 'channel_webhook', occurredAt: new Date().toISOString(), payload: { provider: 'meta', rawBody } }, env, fetchImplementation);
  log('meta_webhook', eventId, result.ok ? 'recorded' : result.code);
  return result.ok
    ? json({ ok: true, eventId: result.eventId, deduplicated: result.deduplicated }, 202, request, env)
    : json({ ok: false, eventId, code: result.code, manualFollowUp: true }, 503, request, env);
}

function parseActor(value: unknown): Actor | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isRole(value.role)) return null;
  const name = boundedText(value.name, 1, 120);
  if (!name) return null;
  const email = optionalBoundedText(value.email, 254);
  return { id: value.id, name, role: value.role, ...(email ? { email } : {}) };
}

function parseLead(value: unknown): Lead | null {
  if (!isRecord(value) || !isIdentifier(value.id) || typeof value.assigneeId !== 'string' || value.assigneeId.length > 120 || !leadStages.has(value.stage as Lead['stage']) || typeof value.ownerName !== 'string' || typeof value.consentAt !== 'string') return null;
  const attribution = parseAttribution(value.attribution);
  if (!attribution) return null;
  const contact = isRecord(value.contact) && typeof value.contact.phone === 'string'
    ? { phone: value.contact.phone, ...(typeof value.contact.email === 'string' ? { email: value.contact.email } : {}) }
    : undefined;
  return {
    id: value.id, ownerName: value.ownerName, assigneeId: value.assigneeId, stage: value.stage as Lead['stage'], consentAt: value.consentAt, attribution,
    ...(typeof value.operation === 'string' && enquiryOperations.has(value.operation as OwnerEnquiry['operation']) ? { operation: value.operation as OwnerEnquiry['operation'] } : {}),
    ...(typeof value.district === 'string' ? { district: value.district } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(contact ? { contact } : {}),
  };
}

function parseProperty(value: unknown): Property | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.assigneeId) || typeof value.label !== 'string' || !['draft', 'approved', 'published', 'paused'].includes(String(value.publicationStatus))) return null;
  return { id: value.id, label: value.label, assigneeId: value.assigneeId, publicationStatus: value.publicationStatus as Property['publicationStatus'] };
}

function parseActivity(value: unknown): Activity | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.actorId) || typeof value.occurredAt !== 'string' || !activityTypeSet.has(value.type as ActivityType) || !isRecord(value.metadata)) return null;
  const entries = Object.entries(value.metadata);
  if (!entries.every(([key, item]) => key.length <= 120 && typeof item === 'string' && item.length <= 1_000)) return null;
  return {
    id: value.id, type: value.type as ActivityType, actorId: value.actorId, occurredAt: value.occurredAt, metadata: Object.fromEntries(entries as [string, string][]),
    ...(isIdentifier(value.leadId) ? { leadId: value.leadId } : {}), ...(isIdentifier(value.propertyId) ? { propertyId: value.propertyId } : {}),
  };
}

function parseApproval(value: unknown): Approval | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.recordId) || !isIdentifier(value.requestedBy) || !approvalKindSet.has(value.kind as ApprovalKind) || !approvalStatuses.has(value.status as Approval['status']) || typeof value.rationale !== 'string') return null;
  return {
    id: value.id, kind: value.kind as ApprovalKind, recordId: value.recordId, requestedBy: value.requestedBy, status: value.status as Approval['status'], rationale: value.rationale,
    ...(isIdentifier(value.approvedBy) ? { approvedBy: value.approvedBy } : {}), ...(typeof value.approvedAt === 'string' ? { approvedAt: value.approvedAt } : {}), ...(typeof value.decisionReason === 'string' ? { decisionReason: value.decisionReason } : {}),
  };
}

function parseGatewaySnapshot(value: unknown): GatewaySnapshot | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const actor = parseActor(value.actor);
  if (!actor) return null;
  const parseList = <T>(input: unknown, parser: (entry: unknown) => T | null): T[] | null => {
    if (!Array.isArray(input)) return null;
    const values = input.map(parser);
    return values.every((entry): entry is T => entry !== null) ? values : null;
  };
  const leads = parseList(value.leads, parseLead);
  const properties = parseList(value.properties, parseProperty);
  const activities = parseList(value.activities, parseActivity);
  const approvals = parseList(value.approvals, parseApproval);
  const users = parseList(value.users, parseActor);
  return leads && properties && activities && approvals && users ? { actor, leads, properties, activities, approvals, users } : null;
}

function parseTestPrincipal(request: Request, env: WorkerEnv): Principal | null {
  if (!testBypassEnabled(env)) return null;
  const header = request.headers.get('x-balo-test-principal');
  if (!header) return null;
  try {
    const actor = parseActor(JSON.parse(header) as unknown);
    return actor ? { subject: actor.id, ...(actor.email ? { email: actor.email } : {}), testActor: actor } : null;
  } catch {
    return null;
  }
}

function accessConfig(env: WorkerEnv): { audience: string; teamDomain: string } | null {
  const teamDomain = secret(env, 'TEAM_DOMAIN');
  const audience = secret(env, 'POLICY_AUD');
  if (!teamDomain || !audience) return null;
  try {
    const url = new URL(teamDomain);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null;
    return { audience, teamDomain: url.toString().replace(/\/$/, '') };
  } catch {
    return null;
  }
}

async function authenticatePrincipal(request: Request, env: WorkerEnv): Promise<Principal | null> {
  const testPrincipal = parseTestPrincipal(request, env);
  if (testPrincipal) return testPrincipal;
  const config = accessConfig(env);
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!config || !token) return null;
  try {
    const jwks = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { audience: config.audience, issuer: config.teamDomain });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return { subject: payload.sub, ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
  } catch {
    return null;
  }
}

async function loadOpsSnapshot(principal: Principal, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<GatewaySnapshot | null> {
  const event: GatewayEvent = {
    eventId: crypto.randomUUID(), eventType: 'ops_snapshot', occurredAt: new Date().toISOString(),
    payload: { action: 'snapshot', actor: principal.testActor ?? { id: principal.subject, ...(principal.email ? { email: principal.email } : {}) } },
  };
  const response = await sendGatewayEvent(event, env, fetchImplementation);
  if (!response?.ok) return null;
  try {
    return parseGatewaySnapshot(await response.json() as unknown);
  } catch {
    return null;
  }
}

function accessibleSnapshot(snapshot: GatewaySnapshot, actor: Actor): GatewaySnapshot {
  const leads = snapshot.leads.filter((lead) => canAccessAssignedRecord(actor, lead));
  const properties = snapshot.properties.filter((property) => canAccessAssignedRecord(actor, property));
  const leadIds = new Set(leads.map((lead) => lead.id));
  const propertyIds = new Set(properties.map((property) => property.id));
  return {
    ...snapshot, actor, leads, properties,
    activities: snapshot.activities.filter((activity) => actor.role === 'admin' || (Boolean(activity.leadId) && leadIds.has(activity.leadId!)) || (Boolean(activity.propertyId) && propertyIds.has(activity.propertyId!))),
    approvals: snapshot.approvals.filter((approval) => actor.role === 'admin' || leadIds.has(approval.recordId) || propertyIds.has(approval.recordId)),
    users: actor.role === 'admin' ? snapshot.users : [],
  };
}

async function authenticatedSnapshot(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, verifiedPrincipal?: Principal): Promise<{ actor: Actor; snapshot: GatewaySnapshot } | Response> {
  const principal = verifiedPrincipal ?? await authenticatePrincipal(request, env);
  if (!principal) return forbidden('ACCESS_AUTH_REQUIRED', request, env);
  const snapshot = await loadOpsSnapshot(principal, env, fetchImplementation);
  if (!snapshot) return gatewayFailure(request, env);
  const actor = principal.testActor ?? snapshot.actor;
  return { actor, snapshot: accessibleSnapshot(snapshot, actor) };
}

async function authenticatedOpsMutation(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<{ actor: Actor; snapshot: GatewaySnapshot } | Response> {
  if (!hasTrustedOpsOrigin(request, env)) return forbidden('OPS_ORIGIN_REQUIRED', request, env);
  const principal = await authenticatePrincipal(request, env);
  if (!principal) return forbidden('ACCESS_AUTH_REQUIRED', request, env);
  if (!await hasValidCsrfToken(request, principal, env)) return forbidden('CSRF_VALIDATION_FAILED', request, env);
  return authenticatedSnapshot(request, env, fetchImplementation, principal);
}

async function opsCsrf(request: Request, env: WorkerEnv): Promise<Response> {
  const principal = await authenticatePrincipal(request, env);
  if (!principal) return forbidden('ACCESS_AUTH_REQUIRED', request, env);
  const token = await csrfToken(principal, env);
  return token ? json({ ok: true, token }, 200, request, env) : json({ ok: false, code: 'CSRF_CONFIGURATION_REQUIRED' }, 503, request, env);
}

function isResponse(value: { actor: Actor; snapshot: GatewaySnapshot } | Response): value is Response {
  return value instanceof Response;
}

function recordIdFromPath(pathname: string, suffix: 'assign' | 'activities'): string | null {
  const parts = pathname.split('/');
  if (parts.length !== 6 || parts[1] !== 'v1' || parts[2] !== 'ops' || parts[3] !== 'leads' || parts[5] !== suffix) return null;
  try {
    const id = decodeURIComponent(parts[4] ?? '');
    return isIdentifier(id) ? id : null;
  } catch {
    return null;
  }
}

function requestedRecord(snapshot: GatewaySnapshot, recordId: string): Lead | Property | null {
  return snapshot.leads.find((lead) => lead.id === recordId) ?? snapshot.properties.find((property) => property.id === recordId) ?? null;
}

function parseMetadata(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 10) return null;
  const entries = Object.entries(value);
  if (!entries.every(([key, entry]) => key.length > 0 && key.length <= 120 && typeof entry === 'string' && entry.trim().length <= 1_000)) return null;
  return Object.fromEntries(entries.map(([key, entry]) => [key, (entry as string).trim()]));
}

async function performOpsMutation(event: GatewayEvent, request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const response = await sendGatewayEvent(event, env, fetchImplementation);
  if (!response?.ok) return gatewayFailure(request, env);
  try {
    const result = await response.json() as unknown;
    if (!isRecord(result) || result.ok !== true || result.eventId !== event.eventId) return gatewayFailure(request, env);
    return json({ ok: true, eventId: event.eventId, ...(typeof result.approvalId === 'string' ? { approvalId: result.approvalId } : {}) }, 202, request, env);
  } catch {
    return gatewayFailure(request, env);
  }
}

async function assignLead(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, leadId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!canAssign(state.actor)) return forbidden('ADMIN_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  if (!isRecord(input) || !isIdentifier(input.assigneeId)) return badRequest('INVALID_ASSIGNMENT', request, env);
  if (!state.snapshot.leads.some((lead) => lead.id === leadId)) return json({ ok: false, code: 'LEAD_NOT_FOUND' }, 404, request, env);
  return performOpsMutation({ eventId: crypto.randomUUID(), eventType: 'ops_assignment', occurredAt: new Date().toISOString(), payload: { actor: state.actor, leadId, assigneeId: input.assigneeId } }, request, env, fetchImplementation);
}

async function createActivity(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, leadId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const lead = state.snapshot.leads.find((item) => item.id === leadId);
  if (!lead) return json({ ok: false, code: 'LEAD_NOT_FOUND' }, 404, request, env);
  if (!canCreateActivity(state.actor, lead)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  const metadata = isRecord(input) ? parseMetadata(input.metadata) : null;
  if (!isRecord(input) || !activityTypeSet.has(input.type as ActivityType) || !metadata) return badRequest('INVALID_ACTIVITY', request, env);
  return performOpsMutation({ eventId: crypto.randomUUID(), eventType: 'ops_activity', occurredAt: new Date().toISOString(), payload: { actor: state.actor, leadId, activityType: input.type, metadata } }, request, env, fetchImplementation);
}

async function requestApproval(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const input = await readBoundedJson(request);
  if (!isRecord(input) || !isIdentifier(input.recordId) || !approvalKindSet.has(input.kind as ApprovalKind)) return badRequest('INVALID_APPROVAL_REQUEST', request, env);
  const rationale = boundedText(input.rationale, 3, 1_000);
  const record = requestedRecord(state.snapshot, input.recordId);
  if (!rationale || !record) return badRequest('INVALID_APPROVAL_REQUEST', request, env);
  if (!canRequestApproval(state.actor, record)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const approvalId = crypto.randomUUID();
  return performOpsMutation({ eventId: crypto.randomUUID(), eventType: 'ops_approval_request', occurredAt: new Date().toISOString(), payload: { actor: state.actor, approvalId, recordId: input.recordId, kind: input.kind, rationale } }, request, env, fetchImplementation);
}

async function decideApproval(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, approvalId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const approval = state.snapshot.approvals.find((item) => item.id === approvalId);
  if (!approval) return json({ ok: false, code: 'APPROVAL_NOT_FOUND' }, 404, request, env);
  if (!canApprove(state.actor, approval.kind)) return forbidden('ADMIN_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  const reason = isRecord(input) ? boundedText(input.rationale ?? input.reason, 3, 1_000) : null;
  if (!isRecord(input) || (input.decision !== 'approved' && input.decision !== 'rejected') || !reason) return badRequest('INVALID_APPROVAL_DECISION', request, env);
  return performOpsMutation({ eventId: crypto.randomUUID(), eventType: 'ops_approval_decision', occurredAt: new Date().toISOString(), payload: { actor: state.actor, approvalId, decision: input.decision, reason } }, request, env, fetchImplementation);
}

async function opsDashboard(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const state = await authenticatedSnapshot(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const { snapshot, actor } = state;
  return json({
    ok: true, actor,
    dashboard: {
      totalLeads: snapshot.leads.length,
      pendingApprovals: snapshot.approvals.filter((approval) => approval.status === 'pending').length,
      scheduledVisits: snapshot.activities.filter((activity) => activity.type === 'visit_scheduled').length,
    },
    leads: snapshot.leads, approvals: snapshot.approvals, activities: snapshot.activities, users: snapshot.users,
  }, 200, request, env);
}

async function opsLeads(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const state = await authenticatedSnapshot(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  return json({ ok: true, actor: state.actor, leads: state.snapshot.leads }, 200, request, env);
}

export async function handleRequest(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return json({}, 204, request, env);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'balo-pilot-api' }, 200, request, env);
  if (url.pathname === '/v1/public/owner-enquiries' && request.method === 'POST') return publicEnquiry(request, env, fetchImplementation);
  if (url.pathname === '/v1/webhooks/meta' && request.method === 'POST') return metaWebhook(request, env, fetchImplementation);
  if (url.pathname === '/v1/ops/csrf' && request.method === 'GET') return opsCsrf(request, env);
  if (url.pathname === '/v1/ops/dashboard' && request.method === 'GET') return opsDashboard(request, env, fetchImplementation);
  if (url.pathname === '/v1/ops/leads' && request.method === 'GET') return opsLeads(request, env, fetchImplementation);
  const leadIdForAssignment = recordIdFromPath(url.pathname, 'assign');
  if (leadIdForAssignment && request.method === 'POST') return assignLead(request, env, fetchImplementation, leadIdForAssignment);
  const leadIdForActivity = recordIdFromPath(url.pathname, 'activities');
  if (leadIdForActivity && request.method === 'POST') return createActivity(request, env, fetchImplementation, leadIdForActivity);
  if (url.pathname === '/v1/ops/approvals' && request.method === 'POST') return requestApproval(request, env, fetchImplementation);
  const decision = /^\/v1\/ops\/approvals\/([A-Za-z0-9_-]{1,120})\/decision$/.exec(url.pathname);
  if (decision && request.method === 'POST') return decideApproval(request, env, fetchImplementation, decision[1] ?? '');
  return json({ ok: false, code: 'NOT_FOUND' }, 404, request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
