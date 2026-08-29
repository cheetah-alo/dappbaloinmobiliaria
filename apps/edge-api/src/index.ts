import type { GatewayResult, OwnerEnquiry, PersistedEvent } from '@balo/contracts';

type WorkerEnv = Env;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const maxBodyBytes = 16_384;

function secret(env: WorkerEnv, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function json(body: Record<string, unknown>, status: number, request: Request, env: WorkerEnv): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const origin = request.headers.get('origin');
  if (origin && origin === env.ALLOWED_ORIGIN) headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'Origin');
  return new Response(JSON.stringify(body), { status, headers });
}

function badRequest(code: string, request: Request, env: WorkerEnv, details?: string): Response {
  return json({ ok: false, code, ...(details ? { details } : {}) }, 400, request, env);
}

async function hmacSha256(secretValue: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretValue), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameValue(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function parseOwnerEnquiry(input: unknown): OwnerEnquiry | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const attribution = value.attribution;
  if (!attribution || typeof attribution !== 'object') return null;
  const source = (attribution as Record<string, unknown>).source;
  const operation = value.operation;
  if (typeof value.name !== 'string' || value.name.trim().length < 2 || typeof value.phone !== 'string' || value.phone.replace(/\D/g, '').length < 7 || typeof value.district !== 'string' || value.district.trim().length < 2 || value.consent !== true || !['sell', 'rent', 'buy', 'invest'].includes(String(operation)) || !['website', 'whatsapp', 'instagram', 'portal', 'manual'].includes(String(source))) return null;
  return {
    name: value.name.trim(), phone: value.phone.trim(), email: typeof value.email === 'string' ? value.email.trim() || undefined : undefined,
    operation: operation as OwnerEnquiry['operation'], district: value.district.trim(), consent: true,
    attribution: {
      source: source as OwnerEnquiry['attribution']['source'],
      utmSource: typeof (attribution as Record<string, unknown>).utmSource === 'string' ? (attribution as Record<string, string>).utmSource : undefined,
      utmCampaign: typeof (attribution as Record<string, unknown>).utmCampaign === 'string' ? (attribution as Record<string, string>).utmCampaign : undefined,
      qrId: typeof (attribution as Record<string, unknown>).qrId === 'string' ? (attribution as Record<string, string>).qrId : undefined,
      postId: typeof (attribution as Record<string, unknown>).postId === 'string' ? (attribution as Record<string, string>).postId : undefined,
    },
  };
}

async function verifyTurnstile(token: string | undefined, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<boolean> {
  if (secret(env, 'ALLOW_TEST_BYPASS') === 'true') return true;
  const turnstileSecret = secret(env, 'TURNSTILE_SECRET');
  if (!token || !turnstileSecret) return false;
  const form = new FormData();
  form.set('secret', turnstileSecret);
  form.set('response', token);
  const response = await fetchImplementation('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

async function persistEvent(event: PersistedEvent, request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<GatewayResult> {
  const gatewayUrl = secret(env, 'GATEWAY_URL');
  const gatewaySecret = secret(env, 'GATEWAY_HMAC_SECRET');
  if (!gatewayUrl || !gatewaySecret) return { ok: false, eventId: event.eventId, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true };
  const rawBody = JSON.stringify(event);
  const timestamp = new Date().toISOString();
  const signature = await hmacSha256(gatewaySecret, `${timestamp}.${rawBody}`);
  const signedGatewayUrl = new URL(gatewayUrl);
  // Apps Script Web Apps do not expose arbitrary HTTP headers to doPost. The
  // short-lived signed values therefore travel as query parameters; the body is
  // still JSON and the gateway rejects any timestamp outside its five-minute window.
  signedGatewayUrl.searchParams.set('event_id', event.eventId);
  signedGatewayUrl.searchParams.set('timestamp', timestamp);
  signedGatewayUrl.searchParams.set('signature', `sha256=${signature}`);
  try {
    const gatewayResponse = await fetchImplementation(signedGatewayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'idempotency-key': request.headers.get('idempotency-key') ?? event.eventId,
      },
      body: rawBody,
    });
    if (!gatewayResponse.ok) return { ok: false, eventId: event.eventId, code: 'GATEWAY_REJECTED', manualFollowUp: true };
    const result = await gatewayResponse.json() as { eventId?: string; deduplicated?: boolean };
    return { ok: true, eventId: result.eventId ?? event.eventId, deduplicated: result.deduplicated === true };
  } catch {
    return { ok: false, eventId: event.eventId, code: 'GATEWAY_UNAVAILABLE', manualFollowUp: true };
  }
}

function log(event: string, eventId: string, extra: Record<string, string> = {}): void {
  console.log(JSON.stringify({ event, eventId, ...extra }));
}

async function publicEnquiry(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxBodyBytes) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413, request, env);
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('INVALID_JSON', request, env); }
  const payload = parseOwnerEnquiry(input);
  if (!payload) return badRequest('INVALID_ENQUIRY_OR_CONSENT', request, env);
  const token = typeof (input as Record<string, unknown>).turnstileToken === 'string' ? (input as Record<string, string>).turnstileToken : undefined;
  if (!await verifyTurnstile(token, env, fetchImplementation)) return json({ ok: false, code: 'ANTISPAM_NOT_VERIFIED', manualFollowUp: true }, 503, request, env);
  const eventId = request.headers.get('idempotency-key') ?? crypto.randomUUID();
  const result = await persistEvent({ eventId, eventType: 'owner_enquiry', occurredAt: new Date().toISOString(), payload: payload as unknown as Record<string, unknown> }, request, env, fetchImplementation);
  log('owner_enquiry', eventId, { outcome: result.ok ? 'recorded' : result.code });
  return result.ok ? json({ ok: true, eventId: result.eventId, deduplicated: result.deduplicated }, 202, request, env) : json({ ok: false, eventId, code: result.code, manualFollowUp: true }, 503, request, env);
}

async function metaWebhook(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation): Promise<Response> {
  const webhookSecret = secret(env, 'META_APP_SECRET');
  if (!webhookSecret) return json({ ok: false, code: 'CONNECTOR_DISABLED', manualFollowUp: true }, 503, request, env);
  const rawBody = await request.text();
  const supplied = request.headers.get('x-hub-signature-256')?.replace('sha256=', '');
  if (!supplied || !sameValue(supplied, await hmacSha256(webhookSecret, rawBody))) return json({ ok: false, code: 'INVALID_WEBHOOK_SIGNATURE' }, 401, request, env);
  const eventId = request.headers.get('x-balo-event-id') ?? crypto.randomUUID();
  const result = await persistEvent({ eventId, eventType: 'channel_webhook', occurredAt: new Date().toISOString(), payload: { provider: 'meta', rawBody } }, request, env, fetchImplementation);
  log('meta_webhook', eventId, { outcome: result.ok ? 'recorded' : result.code });
  return result.ok ? json({ ok: true, eventId, deduplicated: result.deduplicated }, 202, request, env) : json({ ok: false, eventId, code: result.code, manualFollowUp: true }, 503, request, env);
}

export async function handleRequest(request: Request, env: WorkerEnv, fetchImplementation: FetchImplementation = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return json({}, 204, request, env);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'balo-pilot-api' }, 200, request, env);
  if (url.pathname === '/v1/public/owner-enquiries' && request.method === 'POST') return publicEnquiry(request, env, fetchImplementation);
  if (url.pathname === '/v1/webhooks/meta' && request.method === 'POST') return metaWebhook(request, env, fetchImplementation);
  return json({ ok: false, code: 'NOT_FOUND' }, 404, request, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
