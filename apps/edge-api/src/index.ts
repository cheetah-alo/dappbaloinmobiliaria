import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  activityTypes,
  approvalKinds,
  canAccessAssignedRecord,
  canApprove,
  canAssign,
  canCreateActivity,
  canCreateProperty,
  canChangePropertyAvailability,
  canEditProperty,
  canPublishProperty,
  canRequestApproval,
  propertyAvailabilityStatuses,
  propertyAvailabilityFreshness,
  propertyImageCategories,
  propertyOperations,
  propertyPublicationStatuses,
  priceVisibilities,
  toCatalogProperty,
  type Activity,
  type ActivityType,
  type Actor,
  type Approval,
  type ApprovalKind,
  type CatalogExport,
  type GatewayResult,
  type Lead,
  type OpsSnapshot,
  type OwnerEnquiry,
  type PersistedEvent,
  type Property,
  type PropertyAvailabilityStatus,
  type PropertyImage,
  type PropertyImageCategory,
  type PropertyOperation,
  type PropertyPublicationStatus,
  type PropertyRevision,
  type PublicationJob,
  type PriceVisibility,
} from '@balo/contracts';

type WorkerEnv = Env;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type GatewayEventType = PersistedEvent['eventType'] | 'ops_snapshot' | 'ops_assignment' | 'ops_activity' | 'ops_approval_request' | 'ops_approval_decision' | 'cms_property_snapshot' | 'cms_publication_job_snapshot' | 'cms_property_create' | 'cms_property_update' | 'cms_media_intent' | 'cms_media_complete' | 'cms_media_update' | 'cms_property_submit' | 'cms_property_publish' | 'cms_property_availability' | 'cms_publication_callback' | 'cms_availability_sweep';
type GatewayEvent = { eventId: string; eventType: GatewayEventType; occurredAt: string; payload: Record<string, unknown> };
type GatewayEnvelope = { timestamp: string; signature: string; event: GatewayEvent };
type GatewaySnapshot = OpsSnapshot & { actor: Actor; users: Actor[] };
type Principal = { subject: string; email?: string; testActor?: Actor };
type CmsPropertySnapshot = { actor: Actor; property: Property; revision: PropertyRevision; images: PropertyImage[]; publicationJobs: PublicationJob[] };
type CmsCatalogEntry = { property: Property; revision: PropertyRevision; images: PropertyImage[]; publicationTarget: 'active' | 'candidate' };
type CmsJobSnapshot = { catalogEntries: CmsCatalogEntry[]; publicationJob: PublicationJob };
type CmsImageIntent = { intentId: string; imageId: string; propertyId: string; revisionId: string; objectKey: string; expiresAt: string; uploadToken: string; sizeBytes: number; sha256: string; uploadUrl?: string | null };
type MediaTokenClaims = { intentId: string; imageId: string; propertyId: string; revisionId: string; expiresAt: string; sizeBytes: number; sha256: string; variant: 'main' | 'thumbnail' };

const maxBodyBytes = 256 * 1024;
const maxPropertyImageBytes = 12 * 1024 * 1024;
const identifierPattern = /^[A-Za-z0-9_-]{1,120}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enquiryOperations = new Set<OwnerEnquiry['operation']>(['sell', 'rent', 'buy', 'invest']);
const attributionSources = new Set<OwnerEnquiry['attribution']['source']>(['website', 'whatsapp', 'instagram', 'portal', 'manual']);
const leadStages = new Set<Lead['stage']>(['new', 'qualified', 'visit_scheduled', 'offer_received', 'closed', 'lost']);
const approvalStatuses = new Set<Approval['status']>(['pending', 'approved', 'rejected']);
const activityTypeSet = new Set<ActivityType>(activityTypes);
const approvalKindSet = new Set<ApprovalKind>(approvalKinds);
const propertyPublicationStatusSet = new Set<PropertyPublicationStatus>(propertyPublicationStatuses);
const propertyAvailabilityStatusSet = new Set<PropertyAvailabilityStatus>(propertyAvailabilityStatuses);
const propertyOperationSet = new Set<PropertyOperation>(propertyOperations);
const priceVisibilitySet = new Set<PriceVisibility>(priceVisibilities);
const imageCategorySet = new Set<PropertyImageCategory>(propertyImageCategories);

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
    headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, OPTIONS');
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
  if (!isRecord(value) || !isIdentifier(value.id) || typeof value.assigneeId !== 'string' || value.assigneeId.length > 120 || typeof value.label !== 'string') return null;
  const publicationStatus = propertyPublicationStatusSet.has(value.publicationStatus as PropertyPublicationStatus) ? value.publicationStatus as PropertyPublicationStatus : 'draft';
  const availabilityStatus = propertyAvailabilityStatusSet.has(value.availabilityStatus as PropertyAvailabilityStatus) ? value.availabilityStatus as PropertyAvailabilityStatus : 'available';
  const version = typeof value.version === 'number' && Number.isInteger(value.version) && value.version > 0 ? value.version : 1;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString();
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
  return {
    id: value.id,
    slug: typeof value.slug === 'string' && value.slug.length > 0 ? value.slug : value.id,
    label: value.label,
    assigneeId: value.assigneeId,
    publicationStatus,
    availabilityStatus,
    version,
    createdAt,
    updatedAt,
    ...(isIdentifier(value.activeRevisionId) ? { activeRevisionId: value.activeRevisionId } : {}),
    ...(isIdentifier(value.draftRevisionId) ? { draftRevisionId: value.draftRevisionId } : {}),
    ...(typeof value.lastVerifiedAt === 'string' ? { lastVerifiedAt: value.lastVerifiedAt } : {}),
  };
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

function propertyIdFromPath(pathname: string, suffix?: string): string | null {
  const expression = suffix
    ? new RegExp(`^/v1/ops/properties/([A-Za-z0-9_-]{1,120})/${suffix}$`)
    : /^\/v1\/ops\/properties\/([A-Za-z0-9_-]{1,120})$/;
  const match = expression.exec(pathname);
  return match?.[1] && isIdentifier(match[1]) ? match[1] : null;
}

function isSafeSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
}

function nonNegativeInteger(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function positiveNumber(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function expectedVersion(input: Record<string, unknown>): number | null {
  return typeof input.expectedVersion === 'number' && Number.isInteger(input.expectedVersion) && input.expectedVersion > 0 ? input.expectedVersion : null;
}

function optionalIdentifier(value: unknown): string | undefined {
  return isIdentifier(value) ? value : undefined;
}

function optionalHttpsUrl(value: unknown): string | undefined {
  const candidate = optionalBoundedText(value, 2_048);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseMoney(value: unknown): PropertyRevision['askingPrice'] | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.currency !== 'PEN' && value.currency !== 'USD')) return null;
  const amount = positiveNumber(value.amount, 100_000_000);
  return amount === null ? null : { currency: value.currency, amount };
}

function parsePrivateDetails(value: unknown): PropertyRevision['privateDetails'] | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const exactAddress = optionalBoundedText(value.exactAddress, 500);
  const ownerReference = optionalBoundedText(value.ownerReference, 240);
  const documentNotes = optionalBoundedText(value.documentNotes, 4_000);
  const negotiationNotes = optionalBoundedText(value.negotiationNotes, 4_000);
  const supplied = ['exactAddress', 'ownerReference', 'documentNotes', 'negotiationNotes'];
  if (supplied.some((key) => value[key] !== undefined && !optionalBoundedText(value[key], key === 'exactAddress' ? 500 : key === 'ownerReference' ? 240 : 4_000))) return null;
  return {
    ...(exactAddress ? { exactAddress } : {}),
    ...(ownerReference ? { ownerReference } : {}),
    ...(documentNotes ? { documentNotes } : {}),
    ...(negotiationNotes ? { negotiationNotes } : {}),
  };
}

function parseRevisionInput(value: unknown, propertyId: string, actorId: string, id: string, revision: number, now: string): PropertyRevision | null {
  if (!isRecord(value)) return null;
  const title = boundedText(value.title, 3, 180);
  const district = boundedText(value.district, 2, 120);
  const summary = boundedText(value.summary, 10, 4_000);
  const operation = propertyOperationSet.has(value.operation as PropertyOperation) ? value.operation as PropertyOperation : null;
  const priceVisibility = priceVisibilitySet.has(value.priceVisibility as PriceVisibility) ? value.priceVisibility as PriceVisibility : null;
  const builtAreaM2 = positiveNumber(value.builtAreaM2, 1_000_000);
  const bedrooms = nonNegativeInteger(value.bedrooms, 100);
  const bathrooms = nonNegativeInteger(value.bathrooms, 100);
  const parking = nonNegativeInteger(value.parking, 100);
  const studies = nonNegativeInteger(value.studies, 100);
  const features = Array.isArray(value.features) && value.features.length <= 60
    ? value.features.map((feature) => boundedText(feature, 1, 160))
    : null;
  const privateDetails = parsePrivateDetails(value.privateDetails);
  const askingPrice = parseMoney(value.askingPrice);
  const totalAreaM2 = value.totalAreaM2 === undefined ? undefined : positiveNumber(value.totalAreaM2, 1_000_000);
  if (!title || !district || !summary || !operation || !priceVisibility || builtAreaM2 === null || bedrooms === null || bathrooms === null || parking === null || studies === null || !features || features.some((feature) => feature === null) || !privateDetails || askingPrice === null || totalAreaM2 === null) return null;
  if (priceVisibility === 'public' && !askingPrice) return null;
  const zone = optionalBoundedText(value.zone, 120);
  const sourceUrl = value.sourceUrl === undefined ? undefined : optionalHttpsUrl(value.sourceUrl);
  const instagramUrl = value.instagramUrl === undefined ? undefined : optionalHttpsUrl(value.instagramUrl);
  if ((value.sourceUrl !== undefined && !sourceUrl) || (value.instagramUrl !== undefined && !instagramUrl)) return null;
  return {
    id, propertyId, revision, title, operation, district,
    ...(zone ? { zone } : {}), builtAreaM2, ...(totalAreaM2 ? { totalAreaM2 } : {}), bedrooms, bathrooms, parking, studies, summary,
    features: features as string[], priceVisibility, ...(askingPrice ? { askingPrice } : {}),
    ...(optionalIdentifier(value.priceApprovalId) ? { priceApprovalId: optionalIdentifier(value.priceApprovalId) } : {}),
    ...(optionalIdentifier(value.photoApprovalId) ? { photoApprovalId: optionalIdentifier(value.photoApprovalId) } : {}),
    ...(optionalIdentifier(value.publicationApprovalId) ? { publicationApprovalId: optionalIdentifier(value.publicationApprovalId) } : {}),
    ...(optionalIdentifier(value.photoAuthorizationConfirmedBy) ? { photoAuthorizationConfirmedBy: optionalIdentifier(value.photoAuthorizationConfirmedBy) } : {}),
    ...(typeof value.photoAuthorizationConfirmedAt === 'string' && Number.isFinite(Date.parse(value.photoAuthorizationConfirmedAt)) ? { photoAuthorizationConfirmedAt: value.photoAuthorizationConfirmedAt } : {}),
    ...(sourceUrl ? { sourceUrl } : {}), ...(instagramUrl ? { instagramUrl } : {}), ...(optionalBoundedText(value.postId, 120) ? { postId: optionalBoundedText(value.postId, 120) } : {}),
    privateDetails, createdBy: actorId, createdAt: now, updatedAt: now,
  };
}

function parseStoredRevision(value: unknown): PropertyRevision | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.propertyId) || typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1) return null;
  return parseRevisionInput(value, value.propertyId, isIdentifier(value.createdBy) ? value.createdBy : 'system', value.id, value.revision, typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString())
    ? {
      ...(parseRevisionInput(value, value.propertyId, isIdentifier(value.createdBy) ? value.createdBy : 'system', value.id, value.revision, typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString())!),
      createdBy: value.createdBy as string,
      createdAt: value.createdAt as string,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : value.createdAt as string,
    }
    : null;
}

function parseImage(value: unknown): PropertyImage | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.propertyId) || !isIdentifier(value.revisionId) || !imageCategorySet.has(value.category as PropertyImageCategory) || typeof value.alt !== 'string' || typeof value.isCover !== 'boolean' || value.mimeType !== 'image/webp' || typeof value.privateObjectKey !== 'string') return null;
  const sortOrder = nonNegativeInteger(value.sortOrder, 10_000);
  const width = nonNegativeInteger(value.width, 20_000);
  const height = nonNegativeInteger(value.height, 20_000);
  const sizeBytes = nonNegativeInteger(value.sizeBytes, maxPropertyImageBytes);
  if (sortOrder === null || width === null || height === null || sizeBytes === null || !['uploading', 'uploaded', 'approved', 'rejected'].includes(String(value.status))) return null;
  return {
    id: value.id, propertyId: value.propertyId, revisionId: value.revisionId, category: value.category as PropertyImageCategory, alt: value.alt, sortOrder, isCover: value.isCover,
    width, height, sizeBytes, mimeType: 'image/webp', privateObjectKey: value.privateObjectKey,
    ...(typeof value.publicObjectKey === 'string' ? { publicObjectKey: value.publicObjectKey } : {}), ...(typeof value.thumbnailObjectKey === 'string' ? { thumbnailObjectKey: value.thumbnailObjectKey } : {}),
    status: value.status as PropertyImage['status'], ...(typeof value.uploadedAt === 'string' ? { uploadedAt: value.uploadedAt } : {}),
  };
}

function parsePublicationJob(value: unknown): PublicationJob | null {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.propertyId) || !isIdentifier(value.revisionId) || !isIdentifier(value.requestedBy) || !['queued', 'running', 'succeeded', 'failed'].includes(String(value.status)) || typeof value.snapshotVersion !== 'number' || !Number.isInteger(value.snapshotVersion) || typeof value.requestedAt !== 'string') return null;
  return { id: value.id, propertyId: value.propertyId, revisionId: value.revisionId, requestedBy: value.requestedBy, status: value.status as PublicationJob['status'], snapshotVersion: value.snapshotVersion, requestedAt: value.requestedAt, ...(typeof value.completedAt === 'string' ? { completedAt: value.completedAt } : {}), ...(typeof value.deploymentUrl === 'string' ? { deploymentUrl: value.deploymentUrl } : {}), ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}) };
}

function parseCmsSnapshot(value: unknown): CmsPropertySnapshot | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const actor = parseActor(value.actor);
  const property = parseProperty(value.property);
  const revision = parseStoredRevision(value.revision);
  const images = Array.isArray(value.images) ? value.images.map(parseImage) : null;
  const publicationJobs = Array.isArray(value.publicationJobs) ? value.publicationJobs.map(parsePublicationJob) : null;
  if (!actor || !property || !revision || !images || !publicationJobs || images.some((image) => image === null) || publicationJobs.some((job) => job === null)) return null;
  return { actor, property, revision, images: images as PropertyImage[], publicationJobs: publicationJobs as PublicationJob[] };
}

async function loadCmsPropertySnapshot(actor: Actor, propertyId: string, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<CmsPropertySnapshot | null> {
  const response = await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_property_snapshot', occurredAt: new Date().toISOString(), payload: { actor, propertyId } }, env, fetchImplementation);
  if (!response?.ok) return null;
  try { return parseCmsSnapshot(await response.json() as unknown); } catch { return null; }
}

function parseCmsJobSnapshot(value: unknown): CmsJobSnapshot | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const catalogEntries = Array.isArray(value.catalogEntries) ? value.catalogEntries.map((entry) => {
    if (!isRecord(entry) || (entry.publicationTarget !== 'active' && entry.publicationTarget !== 'candidate')) return null;
    const property = parseProperty(entry.property);
    const revision = parseStoredRevision(entry.revision);
    const images = Array.isArray(entry.images) ? entry.images.map(parseImage) : null;
    if (!property || !revision || !images || images.some((image) => image === null)) return null;
    return { property, revision, images: images as PropertyImage[], publicationTarget: entry.publicationTarget } satisfies CmsCatalogEntry;
  }) : null;
  const publicationJob = parsePublicationJob(value.publicationJob);
  if (!catalogEntries || !publicationJob || catalogEntries.some((entry) => entry === null)) return null;
  return { catalogEntries: catalogEntries as CmsCatalogEntry[], publicationJob };
}

async function loadCmsJobSnapshot(jobId: string, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<CmsJobSnapshot | null> {
  const response = await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_job_snapshot', occurredAt: new Date().toISOString(), payload: { jobId } }, env, fetchImplementation);
  if (!response?.ok) return null;
  try { return parseCmsJobSnapshot(await response.json() as unknown); } catch { return null; }
}

function gatewayError(result: Record<string, unknown>, request: Request, env: WorkerEnv): Response | null {
  if (result.code === 'VERSION_CONFLICT') return json({ ok: false, code: 'VERSION_CONFLICT', ...(typeof result.currentVersion === 'number' ? { currentVersion: result.currentVersion } : {}) }, 409, request, env);
  if (result.code === 'CATALOG_BUILD_IN_PROGRESS' || result.code === 'PUBLICATION_IN_PROGRESS') return json({ ok: false, code: result.code }, 409, request, env);
  if (result.code === 'MEDIA_LIMIT_EXCEEDED') return json({ ok: false, code: result.code }, 400, request, env);
  return null;
}

async function performCmsMutation(event: GatewayEvent, request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const response = await sendGatewayEvent(event, env, fetchImplementation);
  if (!response?.ok) return gatewayFailure(request, env);
  try {
    const result = await response.json() as unknown;
    if (!isRecord(result) || result.eventId !== event.eventId) return gatewayFailure(request, env);
    const knownError = gatewayError(result, request, env);
    if (knownError) return knownError;
    if (result.ok !== true) return json({ ok: false, code: 'GATEWAY_REJECTED', manualFollowUp: true }, 503, request, env);
    return json({ ok: true, eventId: event.eventId, deduplicated: result.deduplicated === true, data: isRecord(result.data) ? result.data : {} }, 202, request, env);
  } catch { return gatewayFailure(request, env); }
}

function hasExpectedVersion(property: Property, version: number, request: Request, env: WorkerEnv): Response | null {
  return property.version === version ? null : json({ ok: false, code: 'VERSION_CONFLICT', currentVersion: property.version }, 409, request, env);
}

async function cmsProperties(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const state = await authenticatedSnapshot(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  return json({ ok: true, data: { actor: state.actor, properties: state.snapshot.properties } }, 200, request, env);
}

async function cmsProperty(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedSnapshot(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!state.snapshot.properties.some((property) => property.id === propertyId)) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  const cms = await loadCmsPropertySnapshot(state.actor, propertyId, env, fetchImplementation);
  if (!cms) return gatewayFailure(request, env);
  if (!canEditProperty(state.actor, cms.property)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  return json({ ok: true, data: cms }, 200, request, env);
}

async function createProperty(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!canCreateProperty(state.actor)) return forbidden('PROPERTY_CREATE_FORBIDDEN', request, env);
  const input = await readBoundedJson(request);
  if (!isRecord(input) || !isRecord(input.property)) return badRequest('INVALID_PROPERTY', request, env);
  const slug = isSafeSlug(input.property.slug) ? input.property.slug : null;
  const label = boundedText(input.property.label, 3, 180);
  const assigneeId = isIdentifier(input.property.assigneeId) ? input.property.assigneeId : state.actor.id;
  if (!slug || !label || (state.actor.role !== 'admin' && assigneeId !== state.actor.id)) return badRequest('INVALID_PROPERTY', request, env);
  const now = new Date().toISOString();
  const propertyId = crypto.randomUUID();
  const revision = parseRevisionInput(input.revision, propertyId, state.actor.id, crypto.randomUUID(), 1, now);
  if (!revision) return badRequest('INVALID_PROPERTY_REVISION', request, env);
  const property: Property = { id: propertyId, slug, label, assigneeId, publicationStatus: 'draft', availabilityStatus: 'available', version: 1, draftRevisionId: revision.id, createdAt: now, updatedAt: now };
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_property_create', occurredAt: now, payload: { actor: state.actor, property, revision } }, request, env, fetchImplementation);
}

async function updateProperty(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (!canEditProperty(state.actor, current)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  if (current.publicationStatus === 'publishing') return json({ ok: false, code: 'PUBLICATION_IN_PROGRESS' }, 409, request, env);
  const input = await readBoundedJson(request);
  if (!isRecord(input) || !isRecord(input.revision)) return badRequest('INVALID_PROPERTY_UPDATE', request, env);
  const version = expectedVersion(input);
  if (!version) return badRequest('EXPECTED_VERSION_REQUIRED', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const propertyPatch = isRecord(input.property) ? input.property : {};
  const slug = propertyPatch.slug === undefined ? current.slug : isSafeSlug(propertyPatch.slug) ? propertyPatch.slug : null;
  const label = propertyPatch.label === undefined ? current.label : boundedText(propertyPatch.label, 3, 180);
  const assigneeId = propertyPatch.assigneeId === undefined ? current.assigneeId : isIdentifier(propertyPatch.assigneeId) ? propertyPatch.assigneeId : null;
  if (!slug || !label || !assigneeId || (state.actor.role !== 'admin' && assigneeId !== current.assigneeId)) return badRequest('INVALID_PROPERTY_UPDATE', request, env);
  const now = new Date().toISOString();
  const revision = parseRevisionInput(input.revision, propertyId, state.actor.id, crypto.randomUUID(), current.version + 1, now);
  if (!revision) return badRequest('INVALID_PROPERTY_REVISION', request, env);
  const property: Property = { ...current, slug, label, assigneeId, draftRevisionId: revision.id, updatedAt: now };
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_property_update', occurredAt: now, payload: { actor: state.actor, property, revision, expectedVersion: version } }, request, env, fetchImplementation);
}

function parseIntentFiles(value: unknown): Array<{ category: PropertyImageCategory; alt: string; sortOrder: number; isCover: boolean; sizeBytes: number; mimeType: 'image/webp'; sha256: string }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const files = value.map((file) => {
    if (!isRecord(file) || !imageCategorySet.has(file.category as PropertyImageCategory) || file.mimeType !== 'image/webp' || typeof file.isCover !== 'boolean' || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)) return null;
    const alt = boundedText(file.alt, 3, 240);
    const sortOrder = nonNegativeInteger(file.sortOrder, 10_000);
    const sizeBytes = positiveNumber(file.sizeBytes, maxPropertyImageBytes);
    return alt && sortOrder !== null && sizeBytes !== null ? { category: file.category as PropertyImageCategory, alt, sortOrder, isCover: file.isCover, sizeBytes, mimeType: 'image/webp' as const, sha256: file.sha256.toLowerCase() } : null;
  });
  return files.some((file) => file === null) ? null : files as Array<{ category: PropertyImageCategory; alt: string; sortOrder: number; isCover: boolean; sizeBytes: number; mimeType: 'image/webp'; sha256: string }>;
}

function mediaUsesR2(env: WorkerEnv): boolean {
  return mediaBindings(env) !== null;
}

function mediaBindings(env: WorkerEnv): { privateMedia: R2Bucket; publicMedia: R2Bucket } | null {
  const privateMedia = env.PRIVATE_MEDIA;
  const publicMedia = env.PUBLIC_MEDIA;
  return secret(env, 'MEDIA_BACKEND') === 'r2' && privateMedia && publicMedia ? { privateMedia, publicMedia } : null;
}

function privateMediaKey(claims: Pick<MediaTokenClaims, 'propertyId' | 'revisionId' | 'imageId'>, variant: 'main' | 'thumbnail' = 'main'): string {
  return `properties/${claims.propertyId}/${claims.revisionId}/${claims.imageId}${variant === 'thumbnail' ? '-thumb' : ''}.webp`;
}

async function mediaToken(intent: Omit<CmsImageIntent, 'uploadToken' | 'uploadUrl'>, variant: 'main' | 'thumbnail', env: WorkerEnv): Promise<string | null> {
  const mediaSecret = secret(env, 'MEDIA_INTENT_SECRET');
  if (!mediaSecret) return null;
  const signature = await hmacSha256(mediaSecret, `${intent.intentId}.${intent.imageId}.${intent.propertyId}.${intent.revisionId}.${intent.expiresAt}.${intent.sizeBytes}.${intent.sha256}.${variant}`);
  return [intent.intentId, intent.imageId, intent.propertyId, intent.revisionId, intent.expiresAt, intent.sizeBytes, intent.sha256, variant, signature].join('|');
}

async function verifyMediaToken(token: unknown, env: WorkerEnv): Promise<MediaTokenClaims | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('|');
  if (parts.length !== 9) return null;
  const [intentId, imageId, propertyId, revisionId, expiresAt, sizeBytesText, sha256Value, variant, signature] = parts;
  const expiresAtMs = Date.parse(expiresAt ?? '');
  const sizeBytes = Number(sizeBytesText);
  const mediaSecret = secret(env, 'MEDIA_INTENT_SECRET');
  if (!intentId || !imageId || !propertyId || !revisionId || !expiresAt || !sha256Value || !variant || !signature || !uuidPattern.test(intentId) || !uuidPattern.test(imageId) || !isIdentifier(propertyId) || !isIdentifier(revisionId) || !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now() || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxPropertyImageBytes || !/^[a-f0-9]{64}$/i.test(sha256Value) || (variant !== 'main' && variant !== 'thumbnail') || !mediaSecret) return null;
  const expected = await hmacSha256(mediaSecret, `${intentId}.${imageId}.${propertyId}.${revisionId}.${expiresAt}.${sizeBytes}.${sha256Value.toLowerCase()}.${variant}`);
  return await sameValue(signature, expected) ? { intentId, imageId, propertyId, revisionId, expiresAt, sizeBytes, sha256: sha256Value.toLowerCase(), variant } : null;
}

async function createMediaIntents(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (!canEditProperty(state.actor, current)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  if (!isRecord(input) || !isIdentifier(input.revisionId)) return badRequest('INVALID_MEDIA_INTENT', request, env);
  const version = expectedVersion(input);
  const files = parseIntentFiles(input.files);
  if (!version || !files) return badRequest('INVALID_MEDIA_INTENT', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const cms = await loadCmsPropertySnapshot(state.actor, propertyId, env, fetchImplementation);
  if (!cms) return gatewayFailure(request, env);
  if (cms.revision.id !== input.revisionId) return badRequest('REVISION_NOT_CURRENT', request, env);
  const currentImageCount = cms.images.filter((image) => image.revisionId === input.revisionId && image.status !== 'rejected').length;
  if (currentImageCount + files.length > 30) return badRequest('MEDIA_LIMIT_EXCEEDED', request, env);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const intents: CmsImageIntent[] = [];
  for (const file of files) {
    const intentId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    const intent: Omit<CmsImageIntent, 'uploadToken' | 'uploadUrl'> = { intentId, imageId, propertyId, revisionId: input.revisionId, objectKey: mediaUsesR2(env) ? privateMediaKey({ propertyId, revisionId: input.revisionId, imageId }) : `local/properties/${propertyId}/${input.revisionId}/${imageId}.webp`, expiresAt, sizeBytes: file.sizeBytes, sha256: file.sha256 };
    const uploadToken = await mediaToken(intent, 'main', env);
    const thumbnailUploadToken = await mediaToken(intent, 'thumbnail', env);
    if (!uploadToken || !thumbnailUploadToken) return json({ ok: false, code: 'MEDIA_CONFIGURATION_REQUIRED' }, 503, request, env);
    const uploadUrl = mediaUsesR2(env) ? new URL(`/v1/ops/media/intents/${intentId}/upload`, request.url) : null;
    if (uploadUrl) uploadUrl.searchParams.set('token', uploadToken);
    const thumbnailUploadUrl = mediaUsesR2(env) ? new URL(`/v1/ops/media/intents/${intentId}/upload`, request.url) : null;
    if (thumbnailUploadUrl) thumbnailUploadUrl.searchParams.set('token', thumbnailUploadToken);
    intents.push({ ...intent, uploadToken, uploadUrl: uploadUrl?.toString() ?? null, thumbnailUploadToken, thumbnailUploadUrl: thumbnailUploadUrl?.toString() ?? null } as CmsImageIntent);
  }
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_media_intent', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId, revisionId: input.revisionId, expectedVersion: version, intents: intents.map((intent, index) => ({ ...intent, ...files[index] })) } }, request, env, fetchImplementation);
}

async function completeMediaIntent(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, intentId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const input = await readBoundedJson(request);
  if (!isRecord(input)) return badRequest('INVALID_MEDIA_COMPLETION', request, env);
  const token = await verifyMediaToken(input.uploadToken, env);
  const thumbnailToken = await verifyMediaToken(input.thumbnailUploadToken, env);
  if (!token || !thumbnailToken || token.intentId !== intentId || token.variant !== 'main' || thumbnailToken.variant !== 'thumbnail' || thumbnailToken.intentId !== token.intentId || thumbnailToken.imageId !== token.imageId || thumbnailToken.sha256 !== token.sha256 || thumbnailToken.sizeBytes !== token.sizeBytes) return forbidden('INVALID_MEDIA_TOKEN', request, env);
  const current = state.snapshot.properties.find((property) => property.id === token.propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (!canEditProperty(state.actor, current)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const width = positiveNumber(input.width, 20_000);
  const height = positiveNumber(input.height, 20_000);
  const sizeBytes = positiveNumber(input.sizeBytes, maxPropertyImageBytes);
  const sha256Value = typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(input.sha256) ? input.sha256.toLowerCase() : null;
  if (!width || !height || !sizeBytes || !sha256Value || input.mimeType !== 'image/webp' || sizeBytes !== token.sizeBytes || sha256Value !== token.sha256) return badRequest('INVALID_MEDIA_COMPLETION', request, env);
  const bindings = mediaBindings(env);
  if (bindings) {
    const [head, thumbnailHead] = await Promise.all([bindings.privateMedia.head(privateMediaKey(token, 'main')), bindings.privateMedia.head(privateMediaKey(token, 'thumbnail'))]);
    if (!head || !thumbnailHead || head.size !== token.sizeBytes || thumbnailHead.size < 1 || thumbnailHead.size > maxPropertyImageBytes || head.httpMetadata?.contentType !== 'image/webp' || thumbnailHead.httpMetadata?.contentType !== 'image/webp') return badRequest('MEDIA_UPLOAD_NOT_VERIFIED', request, env);
  }
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_media_complete', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId: token.propertyId, revisionId: token.revisionId, intentId, imageId: token.imageId, width, height, sizeBytes, mimeType: 'image/webp', sha256: sha256Value, mode: mediaUsesR2(env) ? 'r2' : 'local-metadata' } }, request, env, fetchImplementation);
}

async function uploadMediaIntent(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, intentId: string): Promise<Response> {
  const bindings = mediaBindings(env);
  if (!bindings) return json({ ok: false, code: 'MEDIA_UPLOAD_DISABLED' }, 503, request, env);
  if (!hasTrustedOpsOrigin(request, env)) return forbidden('OPS_ORIGIN_REQUIRED', request, env);
  const principal = await authenticatePrincipal(request, env);
  if (!principal || !await hasValidCsrfToken(request, principal, env)) return forbidden('ACCESS_OR_CSRF_REQUIRED', request, env);
  const claims = await verifyMediaToken(new URL(request.url).searchParams.get('token'), env);
  if (!claims || claims.intentId !== intentId || request.headers.get('content-type')?.split(';')[0] !== 'image/webp') return forbidden('INVALID_MEDIA_TOKEN', request, env);
  const length = Number(request.headers.get('content-length') ?? 0);
  const hasExpectedLength = claims.variant === 'main'
    ? length === claims.sizeBytes
    : length > 0 && length <= maxPropertyImageBytes;
  if (!Number.isInteger(length) || !hasExpectedLength || !request.body) return badRequest('INVALID_MEDIA_UPLOAD', request, env);
  const state = await authenticatedSnapshot(request, env, fetchImplementation, principal);
  if (isResponse(state)) return state;
  const property = state.snapshot.properties.find((entry) => entry.id === claims.propertyId);
  if (!property || !canEditProperty(state.actor, property)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  await bindings.privateMedia.put(privateMediaKey(claims, claims.variant), request.body, { httpMetadata: { contentType: 'image/webp' }, customMetadata: { intentId: claims.intentId, sha256: claims.sha256, variant: claims.variant } });
  return json({ ok: true, intentId, uploaded: true }, 201, request, env);
}

async function updateMedia(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (!canEditProperty(state.actor, current)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  const version = isRecord(input) ? expectedVersion(input) : null;
  if (!isRecord(input) || !version || !Array.isArray(input.images) || input.images.length > 30) return badRequest('INVALID_MEDIA_UPDATE', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const images = input.images.map((image) => isRecord(image) && isIdentifier(image.id) && imageCategorySet.has(image.category as PropertyImageCategory) && typeof image.isCover === 'boolean'
    ? { id: image.id, category: image.category as PropertyImageCategory, alt: boundedText(image.alt, 3, 240), sortOrder: nonNegativeInteger(image.sortOrder, 10_000), isCover: image.isCover }
    : null);
  if (images.some((image) => !image || image.alt === null || image.sortOrder === null)) return badRequest('INVALID_MEDIA_UPDATE', request, env);
  const normalizedImages = images as Array<{ id: string; category: PropertyImageCategory; alt: string; sortOrder: number; isCover: boolean }>;
  if (normalizedImages.length > 0 && normalizedImages.filter((image) => image.isCover).length !== 1) return badRequest('COVER_IMAGE_REQUIRED', request, env);
  if (new Set(normalizedImages.map((image) => image.id)).size !== normalizedImages.length || new Set(normalizedImages.map((image) => image.sortOrder)).size !== normalizedImages.length) return badRequest('DUPLICATE_MEDIA_ORDER', request, env);
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_media_update', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId, expectedVersion: version, images: normalizedImages } }, request, env, fetchImplementation);
}

async function submitProperty(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (!canEditProperty(state.actor, current)) return forbidden('ASSIGNMENT_REQUIRED', request, env);
  const input = await readBoundedJson(request);
  const version = isRecord(input) ? expectedVersion(input) : null;
  if (!isRecord(input) || !version || input.photoAuthorizationConfirmed !== true) return badRequest('PHOTO_AUTHORIZATION_REQUIRED', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const approvalIds = { publication: crypto.randomUUID(), photographs: crypto.randomUUID(), price: crypto.randomUUID() };
  return performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_property_submit', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId, expectedVersion: version, approvalId: approvalIds.publication, approvalIds, photoAuthorizationConfirmed: true } }, request, env, fetchImplementation);
}

async function publishProperty(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!canPublishProperty(state.actor)) return forbidden('ADMIN_REQUIRED', request, env);
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  if (current.publicationStatus !== 'approved' && current.publicationStatus !== 'publish_failed') return json({ ok: false, code: 'PROPERTY_NOT_APPROVED' }, 409, request, env);
  const input = await readBoundedJson(request);
  const version = isRecord(input) ? expectedVersion(input) : null;
  if (!version) return badRequest('EXPECTED_VERSION_REQUIRED', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const bindings = mediaBindings(env);
  if (env.RUNTIME_ENV !== 'development' && !bindings) return json({ ok: false, code: 'R2_ACTIVATION_REQUIRED' }, 503, request, env);
  const jobId = crypto.randomUUID();
  const result = await performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_property_publish', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId, expectedVersion: version, jobId, mediaBaseUrl: env.MEDIA_PUBLIC_BASE_URL } }, request, env, fetchImplementation);
  if (result.status !== 202) return result;
  if (!bindings) {
    if (await dispatchPublicationBuild(jobId, current.version + 1, env, fetchImplementation)) return result;
    await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: current.version + 1, status: 'failed', errorCode: 'BUILD_DISPATCH_DISABLED' } }, env, fetchImplementation);
    return json({ ok: false, code: 'BUILD_DISPATCH_DISABLED', manualFollowUp: true }, 503, request, env);
  }
  const cms = await loadCmsPropertySnapshot(state.actor, propertyId, env, fetchImplementation);
  if (!cms) {
    await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: current.version + 1, status: 'failed', errorCode: 'PUBLICATION_SNAPSHOT_UNAVAILABLE' } }, env, fetchImplementation);
    return json({ ok: false, code: 'PUBLICATION_SNAPSHOT_UNAVAILABLE', manualFollowUp: true }, 503, request, env);
  }
  try {
    await Promise.all(cms.images.filter((image) => image.revisionId === cms.revision.id && image.status === 'approved').map(async (image) => {
      const object = await bindings.privateMedia.get(image.privateObjectKey);
      if (!object) throw new Error('private_media_missing');
      const publicKey = image.publicObjectKey ?? `public/${image.privateObjectKey}`;
      const thumbnailKey = image.thumbnailObjectKey ?? `thumb/${image.privateObjectKey}`;
      await bindings.publicMedia.put(publicKey, object.body, { httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' } });
      const thumbnail = await bindings.privateMedia.get(image.privateObjectKey.replace(/\.webp$/, '-thumb.webp'));
      if (!thumbnail) throw new Error('private_media_missing');
      await bindings.publicMedia.put(thumbnailKey, thumbnail.body, { httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' } });
    }));
  } catch {
    await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: current.version + 1, status: 'failed', errorCode: 'MEDIA_COPY_FAILED' } }, env, fetchImplementation);
    return json({ ok: false, code: 'MEDIA_COPY_FAILED', manualFollowUp: true }, 503, request, env);
  }
  if (!await dispatchPublicationBuild(jobId, current.version + 1, env, fetchImplementation)) {
    await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: current.version + 1, status: 'failed', errorCode: 'BUILD_DISPATCH_FAILED' } }, env, fetchImplementation);
    return json({ ok: false, code: 'BUILD_DISPATCH_FAILED', manualFollowUp: true }, 503, request, env);
  }
  return result;
}

async function dispatchPublicationBuild(jobId: string, snapshotVersion: number, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<boolean> {
  const token = secret(env, 'GITHUB_DISPATCH_TOKEN');
  const repository = secret(env, 'GITHUB_REPOSITORY');
  const workflow = secret(env, 'GITHUB_WORKFLOW');
  const ref = secret(env, 'GITHUB_REF');
  if (!token || !repository || !workflow || !ref || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9_.-]{1,160}$/.test(workflow)) return false;
  try {
    const response = await fetchImplementation(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'balo-pilot-api' },
      body: JSON.stringify({ ref, inputs: { job_id: jobId, snapshot_version: String(snapshotVersion) } }),
    });
    return response.status === 204;
  } catch { return false; }
}

async function changeAvailability(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedOpsMutation(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!canChangePropertyAvailability(state.actor)) return forbidden('ADMIN_REQUIRED', request, env);
  const current = state.snapshot.properties.find((property) => property.id === propertyId);
  if (!current) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  const input = await readBoundedJson(request);
  const version = isRecord(input) ? expectedVersion(input) : null;
  const availabilityStatus = isRecord(input) && propertyAvailabilityStatusSet.has(input.availabilityStatus as PropertyAvailabilityStatus) ? input.availabilityStatus as PropertyAvailabilityStatus : null;
  const reason = isRecord(input) ? boundedText(input.reason, 3, 500) : null;
  const suppliedVerification = isRecord(input) && typeof input.lastVerifiedAt === 'string' ? Date.parse(input.lastVerifiedAt) : Number.NaN;
  if (isRecord(input) && input.lastVerifiedAt !== undefined && (!Number.isFinite(suppliedVerification) || suppliedVerification > Date.now() + 5 * 60 * 1000)) return badRequest('INVALID_AVAILABILITY', request, env);
  const lastVerifiedAt = Number.isFinite(suppliedVerification) && suppliedVerification <= Date.now() + 5 * 60 * 1000 ? new Date(suppliedVerification).toISOString() : new Date().toISOString();
  if (!version || !availabilityStatus || !reason) return badRequest('INVALID_AVAILABILITY', request, env);
  const mismatch = hasExpectedVersion(current, version, request, env);
  if (mismatch) return mismatch;
  const jobId = current.activeRevisionId ? crypto.randomUUID() : undefined;
  const result = await performCmsMutation({ eventId: crypto.randomUUID(), eventType: 'cms_property_availability', occurredAt: new Date().toISOString(), payload: { actor: state.actor, propertyId, expectedVersion: version, availabilityStatus, lastVerifiedAt, reason, ...(jobId ? { jobId } : {}) } }, request, env, fetchImplementation);
  if (result.status !== 202 || !jobId) return result;
  if (await dispatchPublicationBuild(jobId, current.version + 1, env, fetchImplementation)) return result;
  await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: current.version + 1, status: 'failed', errorCode: 'AVAILABILITY_DISPATCH_FAILED' } }, env, fetchImplementation);
  return json({ ok: false, code: 'AVAILABILITY_DISPATCH_FAILED', manualFollowUp: true }, 503, request, env);
}

async function publicationCallback(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, jobId: string): Promise<Response> {
  const callbackSecret = secret(env, 'BUILD_CALLBACK_SECRET');
  const rawBody = await readBoundedText(request);
  if (!callbackSecret) return json({ ok: false, code: 'CALLBACK_DISABLED' }, 503, request, env);
  if (rawBody === null) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413, request, env);
  const signature = (request.headers.get('x-balo-signature') ?? request.headers.get('x-balo-build-signature'))?.replace(/^sha256=/, '');
  if (!signature || !await sameValue(signature, await hmacSha256(callbackSecret, rawBody))) return json({ ok: false, code: 'INVALID_CALLBACK_SIGNATURE' }, 401, request, env);
  let input: unknown;
  try { input = JSON.parse(rawBody) as unknown; } catch { return badRequest('INVALID_CALLBACK', request, env); }
  if (!isRecord(input) || input.jobId !== jobId || !Number.isInteger(input.snapshotVersion) || (input.status !== 'running' && input.status !== 'succeeded' && input.status !== 'failed')) return badRequest('INVALID_CALLBACK', request, env);
  const deploymentUrl = input.deploymentUrl === undefined ? undefined : optionalHttpsUrl(input.deploymentUrl);
  const errorCode = input.errorCode === undefined ? undefined : boundedText(input.errorCode, 1, 120);
  if ((input.deploymentUrl !== undefined && !deploymentUrl) || (input.errorCode !== undefined && !errorCode)) return badRequest('INVALID_CALLBACK', request, env);
  const eventId = request.headers.get('idempotency-key') && uuidPattern.test(request.headers.get('idempotency-key') ?? '') ? request.headers.get('idempotency-key')! : `build_${await sha256(`${jobId}.${rawBody}`)}`;
  return performCmsMutation({ eventId, eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId, snapshotVersion: input.snapshotVersion, status: input.status, ...(deploymentUrl ? { deploymentUrl } : {}), ...(errorCode ? { errorCode } : {}) } }, request, env, fetchImplementation);
}

async function buildCatalog(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, jobId: string): Promise<Response> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  const exportSecret = secret(env, 'BUILD_EXPORT_SECRET');
  if (!exportSecret || !bearer || !await sameValue(bearer, exportSecret)) return json({ ok: false, code: 'BUILD_AUTH_REQUIRED' }, 401, request, env);
  const snapshot = await loadCmsJobSnapshot(jobId, env, fetchImplementation);
  if (!snapshot || snapshot.publicationJob.status !== 'queued') return json({ ok: false, code: 'PUBLICATION_JOB_NOT_AVAILABLE' }, 404, request, env);
  const properties = snapshot.catalogEntries.flatMap((entry) => {
    const freshness = propertyAvailabilityFreshness(entry.property.lastVerifiedAt);
    if (freshness !== 'fresh' && freshness !== 'warning') return [];
    const catalog = toCatalogProperty(entry.property, entry.revision, entry.images, env.MEDIA_PUBLIC_BASE_URL, entry.publicationTarget);
    return catalog ? [catalog] : [];
  });
  const exportPayload: CatalogExport = { snapshotVersion: snapshot.publicationJob.snapshotVersion, generatedAt: new Date().toISOString(), properties };
  return json({ ok: true, data: exportPayload }, 200, request, env);
}

async function buildSnapshot(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation, propertyId: string): Promise<Response> {
  const state = await authenticatedSnapshot(request, env, fetchImplementation);
  if (isResponse(state)) return state;
  if (!canPublishProperty(state.actor)) return forbidden('ADMIN_REQUIRED', request, env);
  if (!state.snapshot.properties.some((property) => property.id === propertyId)) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404, request, env);
  const cms = await loadCmsPropertySnapshot(state.actor, propertyId, env, fetchImplementation);
  if (!cms) return gatewayFailure(request, env);
  const freshness = propertyAvailabilityFreshness(cms.property.lastVerifiedAt);
  const catalog = freshness === 'fresh' || freshness === 'warning' ? toCatalogProperty(cms.property, cms.revision, cms.images, env.MEDIA_PUBLIC_BASE_URL) : null;
  return json({ ok: true, data: { propertyId, snapshotVersion: cms.property.version, freshness, ...(catalog ? { catalog } : {}) } }, 200, request, env);
}

async function publicMedia(request: Request, env: WorkerEnv, objectKey: string): Promise<Response> {
  const bindings = mediaBindings(env);
  if (!bindings || !objectKey || objectKey.split('/').some((part) => !part || part === '.' || part === '..')) return json({ ok: false, code: 'NOT_FOUND' }, 404, request, env);
  const object = await bindings.publicMedia.get(objectKey);
  if (!object) return json({ ok: false, code: 'NOT_FOUND' }, 404, request, env);
  const headers = new Headers({
    'cache-control': object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
    'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}

async function availabilitySweep(env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<void> {
  const jobId = crypto.randomUUID();
  const response = await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_availability_sweep', occurredAt: new Date().toISOString(), payload: { action: 'daily_availability_sweep', jobId } }, env, fetchImplementation);
  if (!response?.ok) return;
  let result: unknown;
  try { result = await response.json() as unknown; } catch { return; }
  if (!isRecord(result) || !isRecord(result.data)) return;
  const publicationJob = parsePublicationJob(result.data.publicationJob);
  if (!publicationJob) return;
  if (await dispatchPublicationBuild(publicationJob.id, publicationJob.snapshotVersion, env, fetchImplementation)) return;
  await sendGatewayEvent({ eventId: crypto.randomUUID(), eventType: 'cms_publication_callback', occurredAt: new Date().toISOString(), payload: { jobId: publicationJob.id, snapshotVersion: publicationJob.snapshotVersion, status: 'failed', errorCode: 'AVAILABILITY_SWEEP_DISPATCH_FAILED' } }, env, fetchImplementation);
}

export async function handleRequest(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return json({}, 204, request, env);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'balo-pilot-api' }, 200, request, env);
  if (url.pathname === '/v1/public/owner-enquiries' && request.method === 'POST') return publicEnquiry(request, env, fetchImplementation);
  if (url.pathname === '/v1/webhooks/meta' && request.method === 'POST') return metaWebhook(request, env, fetchImplementation);
  const publicMediaPath = /^\/v1\/public\/media\/(.+)$/.exec(url.pathname);
  if (publicMediaPath && request.method === 'GET') return publicMedia(request, env, publicMediaPath[1] ?? '');
  if (url.pathname === '/v1/ops/csrf' && request.method === 'GET') return opsCsrf(request, env);
  if (url.pathname === '/v1/ops/dashboard' && request.method === 'GET') return opsDashboard(request, env, fetchImplementation);
  if (url.pathname === '/v1/ops/leads' && request.method === 'GET') return opsLeads(request, env, fetchImplementation);
  if (url.pathname === '/v1/ops/properties' && request.method === 'GET') return cmsProperties(request, env, fetchImplementation);
  if (url.pathname === '/v1/ops/properties' && request.method === 'POST') return createProperty(request, env, fetchImplementation);
  const leadIdForAssignment = recordIdFromPath(url.pathname, 'assign');
  if (leadIdForAssignment && request.method === 'POST') return assignLead(request, env, fetchImplementation, leadIdForAssignment);
  const leadIdForActivity = recordIdFromPath(url.pathname, 'activities');
  if (leadIdForActivity && request.method === 'POST') return createActivity(request, env, fetchImplementation, leadIdForActivity);
  if (url.pathname === '/v1/ops/approvals' && request.method === 'POST') return requestApproval(request, env, fetchImplementation);
  const decision = /^\/v1\/ops\/approvals\/([A-Za-z0-9_-]{1,120})\/decision$/.exec(url.pathname);
  if (decision && request.method === 'POST') return decideApproval(request, env, fetchImplementation, decision[1] ?? '');
  const mediaComplete = /^\/v1\/ops\/media\/intents\/([0-9a-f-]{36})\/complete$/i.exec(url.pathname);
  if (mediaComplete && request.method === 'POST') return completeMediaIntent(request, env, fetchImplementation, mediaComplete[1] ?? '');
  const mediaUpload = /^\/v1\/ops\/media\/intents\/([0-9a-f-]{36})\/upload$/i.exec(url.pathname);
  if (mediaUpload && request.method === 'PUT') return uploadMediaIntent(request, env, fetchImplementation, mediaUpload[1] ?? '');
  const property = propertyIdFromPath(url.pathname);
  if (property && request.method === 'GET') return cmsProperty(request, env, fetchImplementation, property);
  if (property && request.method === 'PUT') return updateProperty(request, env, fetchImplementation, property);
  const mediaIntentsProperty = propertyIdFromPath(url.pathname, 'media/intents');
  if (mediaIntentsProperty && request.method === 'POST') return createMediaIntents(request, env, fetchImplementation, mediaIntentsProperty);
  const mediaProperty = propertyIdFromPath(url.pathname, 'media');
  if (mediaProperty && request.method === 'PATCH') return updateMedia(request, env, fetchImplementation, mediaProperty);
  if (mediaProperty && request.method === 'PUT') return updateMedia(request, env, fetchImplementation, mediaProperty);
  const submitPropertyId = propertyIdFromPath(url.pathname, 'submit');
  if (submitPropertyId && request.method === 'POST') return submitProperty(request, env, fetchImplementation, submitPropertyId);
  const publishPropertyId = propertyIdFromPath(url.pathname, 'publish');
  if (publishPropertyId && request.method === 'POST') return publishProperty(request, env, fetchImplementation, publishPropertyId);
  const availabilityPropertyId = propertyIdFromPath(url.pathname, 'availability');
  if (availabilityPropertyId && request.method === 'POST') return changeAvailability(request, env, fetchImplementation, availabilityPropertyId);
  const buildPropertyId = propertyIdFromPath(url.pathname, 'build-snapshot');
  if (buildPropertyId && request.method === 'GET') return buildSnapshot(request, env, fetchImplementation, buildPropertyId);
  const buildCatalogRoute = /^\/v1\/build\/catalog\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (buildCatalogRoute && request.method === 'GET') return buildCatalog(request, env, fetchImplementation, buildCatalogRoute[1] ?? '');
  const buildResultRoute = /^\/v1\/build\/catalog\/([0-9a-f-]{36})\/result$/i.exec(url.pathname);
  if (buildResultRoute && request.method === 'POST') return publicationCallback(request, env, fetchImplementation, buildResultRoute[1] ?? '');
  const callback = /^\/v1\/internal\/publication-jobs\/([0-9a-f-]{36})\/callback$/i.exec(url.pathname);
  if (callback && request.method === 'POST') return publicationCallback(request, env, fetchImplementation, callback[1] ?? '');
  return json({ ok: false, code: 'NOT_FOUND' }, 404, request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(availabilitySweep(env, fetch));
  },
} satisfies ExportedHandler<Env>;
