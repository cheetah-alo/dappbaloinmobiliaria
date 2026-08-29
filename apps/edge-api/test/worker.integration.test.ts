import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index';

const eventId = 'c0a8012e-9e56-4f59-8ff9-6ce82ec09230';
const baseEnv = {
  ALLOWED_ORIGIN: 'http://localhost:5173',
  ALLOW_TEST_BYPASS: 'true',
  CSRF_SECRET: 'csrf-demo-secret',
  OPS_ALLOWED_ORIGIN: 'http://localhost:5174',
  RUNTIME_ENV: 'development',
  GATEWAY_URL: 'https://gateway.example/exec',
  GATEWAY_HMAC_SECRET: 'demo-secret',
} as unknown as Env;

const admin = { id: 'orlando', name: 'Orlando', role: 'admin' as const, email: 'orlando@example.test' };
const manager = { id: 'gestor-ana', name: 'Ana', role: 'user' as const, email: 'ana@example.test' };
const otherManager = { id: 'gestor-beto', name: 'Beto', role: 'user' as const, email: 'beto@example.test' };
const snapshot = {
  ok: true,
  actor: admin,
  users: [admin, manager, otherManager],
  leads: [
    { id: 'lead-unassigned', ownerName: 'Propietaria nueva', assigneeId: '', stage: 'new', consentAt: '2026-08-29T12:00:00.000Z', attribution: { source: 'website' } },
    { id: 'lead-ana', ownerName: 'Propietaria A', assigneeId: 'gestor-ana', stage: 'new', consentAt: '2026-08-29T12:00:00.000Z', attribution: { source: 'instagram' } },
    { id: 'lead-beto', ownerName: 'Propietario B', assigneeId: 'gestor-beto', stage: 'qualified', consentAt: '2026-08-29T12:00:00.000Z', attribution: { source: 'website' } },
  ],
  properties: [{ id: 'property-beto', label: 'Inmueble B', assigneeId: 'gestor-beto', publicationStatus: 'published' }],
  activities: [
    { id: 'activity-ana', type: 'lead_created', leadId: 'lead-ana', actorId: 'gestor-ana', occurredAt: '2026-08-29T12:00:00.000Z', metadata: {} },
    { id: 'activity-beto', type: 'lead_created', leadId: 'lead-beto', actorId: 'gestor-beto', occurredAt: '2026-08-29T12:00:00.000Z', metadata: {} },
    { id: 'activity-property-beto', type: 'post_published', propertyId: 'property-beto', actorId: 'gestor-beto', occurredAt: '2026-08-29T12:00:00.000Z', metadata: {} },
    { id: 'activity-orphan', type: 'manual_follow_up', actorId: 'gestor-beto', occurredAt: '2026-08-29T12:00:00.000Z', metadata: {} },
  ],
  approvals: [{ id: 'approval-ana', kind: 'price', recordId: 'lead-ana', requestedBy: 'gestor-ana', status: 'pending', rationale: 'Revisar propuesta' }],
};

function enquiry(consent = true, headers: HeadersInit = {}) {
  return new Request('https://api.example/v1/public/owner-enquiries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', 'idempotency-key': eventId, ...headers },
    body: JSON.stringify({
      name: 'Propietaria demo', phone: '+51 999 111 222', operation: 'sell', district: 'Miraflores', consent,
      attribution: { source: 'instagram', utmSource: 'instagram', postId: 'post-demo' },
    }),
  });
}

function opsRequest(path: string, actor: typeof admin | typeof manager | typeof otherManager, init: RequestInit = {}) {
  return new Request(`https://api.example${path}`, {
    ...init,
    headers: { origin: 'http://localhost:5174', 'x-balo-test-principal': JSON.stringify(actor), ...(init.headers ?? {}) },
  });
}

async function csrfFor(actor: typeof admin | typeof manager | typeof otherManager): Promise<string> {
  const response = await handleRequest(opsRequest('/v1/ops/csrf', actor), baseEnv, gatewayWithSnapshot());
  expect(response.status).toBe(200);
  const payload = await response.json() as { token?: string };
  expect(payload.token).toMatch(/^.+\|[0-9a-f-]{36}\|[0-9a-f]{64}$/i);
  return payload.token!;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function gatewayWithSnapshot(events: Array<Record<string, unknown>> = []) {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const envelope = JSON.parse(String(init?.body)) as { event: Record<string, unknown> };
    events.push(envelope.event);
    if (envelope.event.eventType === 'ops_snapshot') return new Response(JSON.stringify(snapshot), { status: 200 });
    return new Response(JSON.stringify({ ok: true, eventId: envelope.event.eventId }), { status: 200 });
  };
}

describe('integración simulada con el gateway de Sheets', () => {
  it('envía el sobre firmado solo en el cuerpo, sin filtrar firma o secreto por URL/cabeceras', async () => {
    let gatewayUrl: URL | undefined;
    let gatewayHeaders: Headers | undefined;
    let gatewayEnvelope: Record<string, unknown> | undefined;
    const response = await handleRequest(enquiry(), baseEnv, async (input, init) => {
      gatewayUrl = new URL(input.toString());
      gatewayHeaders = new Headers(init?.headers);
      gatewayEnvelope = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const event = gatewayEnvelope.event as { eventId: string };
      return new Response(JSON.stringify({ ok: true, eventId: event.eventId, deduplicated: false }), { status: 200 });
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, eventId });
    expect(gatewayUrl?.search).toBe('');
    expect(gatewayHeaders?.get('signature')).toBeNull();
    expect(gatewayHeaders?.get('timestamp')).toBeNull();
    expect(gatewayEnvelope).toMatchObject({ timestamp: expect.any(String), signature: /^sha256=[a-f0-9]{64}$/, event: { eventId, eventType: 'owner_enquiry' } });
    expect(JSON.stringify(gatewayEnvelope)).not.toContain('demo-secret');
  });

  it('valida consentimiento antes de tocar Turnstile o el gateway', async () => {
    const response = await handleRequest(enquiry(false), baseEnv, async () => { throw new Error('No debe ejecutarse'); });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_ENQUIRY_OR_CONSENT' });
  });

  it('incluye IP de cliente e idempotencia propia en la validación Turnstile', async () => {
    const env = { ...baseEnv, ALLOW_TEST_BYPASS: 'false', TURNSTILE_SECRET: 'turnstile-secret' } as unknown as Env;
    let turnstileBody: FormData | undefined;
    const request = new Request('https://api.example/v1/public/owner-enquiries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.23', 'idempotency-key': eventId },
      body: JSON.stringify({ name: 'Propietaria demo', phone: '+51 999 111 222', operation: 'sell', district: 'Miraflores', consent: true, turnstileToken: 'token-demo', attribution: { source: 'website' } }),
    });
    const response = await handleRequest(request, env, async (input, init) => {
      if (input.toString().includes('siteverify')) {
        turnstileBody = init?.body as FormData;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      const envelope = JSON.parse(String(init?.body)) as { event: { eventId: string } };
      return new Response(JSON.stringify({ ok: true, eventId: envelope.event.eventId }), { status: 200 });
    });
    expect(response.status).toBe(202);
    expect(turnstileBody?.get('remoteip')).toBe('198.51.100.23');
    expect(turnstileBody?.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('no confirma una firma vencida, repetida o respuesta no correlacionada del gateway', async () => {
    const response = await handleRequest(enquiry(), baseEnv, async () => new Response(JSON.stringify({ ok: false, code: 'INVALID_REQUEST_WINDOW' }), { status: 200 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: 'GATEWAY_REJECTED', manualFollowUp: true });

    const mismatched = await handleRequest(enquiry(), baseEnv, async () => new Response(JSON.stringify({ ok: true, eventId: 'c0a8012e-9e56-4f59-8ff9-6ce82ec09231' }), { status: 200 }));
    expect(mismatched.status).toBe(503);
    expect(await mismatched.json()).toMatchObject({ ok: false, code: 'GATEWAY_REJECTED' });
  });

  it('no confirma un registro si el gateway falla', async () => {
    const response = await handleRequest(enquiry(), baseEnv, async () => new Response('error', { status: 502 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: 'GATEWAY_REJECTED', manualFollowUp: true });
  });

  it('mantiene apagado el webhook sin la credencial oficial del canal', async () => {
    const response = await handleRequest(new Request('https://api.example/v1/webhooks/meta', { method: 'POST', body: '{}' }), baseEnv, async () => new Response());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'CONNECTOR_DISABLED' });
  });

  it('deduplica reintentos idénticos de Meta con el cuerpo firmado', async () => {
    const rawBody = JSON.stringify({ object: 'instagram', entry: [{ id: 'entry-demo' }] });
    const signature = `sha256=${await hmacHex('meta-demo-secret', rawBody)}`;
    const env = { ...baseEnv, META_APP_SECRET: 'meta-demo-secret' } as unknown as Env;
    const events: Array<Record<string, unknown>> = [];
    const request = () => new Request('https://api.example/v1/webhooks/meta', {
      method: 'POST', headers: { 'x-hub-signature-256': signature }, body: rawBody,
    });
    const first = await handleRequest(request(), env, gatewayWithSnapshot(events));
    const second = await handleRequest(request(), env, gatewayWithSnapshot(events));
    const firstPayload = await first.json() as { eventId: string };
    const secondPayload = await second.json() as { eventId: string };
    expect(firstPayload.eventId).toMatch(/^meta_[a-f0-9]{64}$/);
    expect(secondPayload.eventId).toBe(firstPayload.eventId);
    expect(events.filter((event) => event.eventType === 'channel_webhook').map((event) => event.eventId)).toEqual([firstPayload.eventId, firstPayload.eventId]);
  });
});

describe('operación interna protegida por Access y asignación', () => {
  it('permite CORS exacto con credenciales únicamente al portal privado', async () => {
    const response = await handleRequest(new Request('https://api.example/health', { headers: { origin: 'http://localhost:5174' } }), baseEnv, gatewayWithSnapshot());
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5174');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('rechaza rutas privadas sin JWT Access ni bypass no productivo', async () => {
    const response = await handleRequest(new Request('https://api.example/v1/ops/dashboard'), { ...baseEnv, ALLOW_TEST_BYPASS: 'false' } as unknown as Env, gatewayWithSnapshot());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ACCESS_AUTH_REQUIRED' });
  });

  it('filtra en el servidor los expedientes, actividades y aprobaciones ajenos al gestor', async () => {
    const response = await handleRequest(opsRequest('/v1/ops/dashboard', manager), baseEnv, gatewayWithSnapshot());
    expect(response.status).toBe(200);
    const payload = await response.json() as { activities: Array<{ id: string }> };
    expect(payload).toMatchObject({
      actor: { id: 'gestor-ana', role: 'user' },
      leads: [{ id: 'lead-ana' }],
      activities: [{ id: 'activity-ana' }],
      approvals: [{ id: 'approval-ana' }],
      users: [],
    });
    expect(payload.activities.map((activity) => activity.id)).toEqual(['activity-ana']);
  });

  it('mantiene los leads nuevos sin asignar visibles para Orlando y ocultos para gestores', async () => {
    const adminResponse = await handleRequest(opsRequest('/v1/ops/leads', admin), baseEnv, gatewayWithSnapshot());
    const adminPayload = await adminResponse.json() as { leads: Array<{ id: string; assigneeId: string }> };
    expect(adminPayload.leads.some((lead) => lead.id === 'lead-unassigned' && lead.assigneeId === '')).toBe(true);
    const managerResponse = await handleRequest(opsRequest('/v1/ops/leads', manager), baseEnv, gatewayWithSnapshot());
    const managerPayload = await managerResponse.json() as { leads: Array<{ id: string }> };
    expect(managerPayload.leads.some((lead) => lead.id === 'lead-unassigned')).toBe(false);
  });

  it('deniega al gestor asignar o decidir una aprobación sensible', async () => {
    const csrf = await csrfFor(manager);
    const assignment = await handleRequest(opsRequest('/v1/ops/leads/lead-ana/assign', manager, { method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ assigneeId: 'gestor-beto' }) }), baseEnv, gatewayWithSnapshot());
    expect(assignment.status).toBe(403);
    expect(await assignment.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });

    const decision = await handleRequest(opsRequest('/v1/ops/approvals/approval-ana/decision', manager, { method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ decision: 'approved', rationale: 'No autorizado' }) }), baseEnv, gatewayWithSnapshot());
    expect(decision.status).toBe(403);
    expect(await decision.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('envía una acción de asignación firmada y auditable solo para Orlando', async () => {
    const events: Array<Record<string, unknown>> = [];
    const csrf = await csrfFor(admin);
    const response = await handleRequest(opsRequest('/v1/ops/leads/lead-ana/assign', admin, { method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ assigneeId: 'gestor-beto' }) }), baseEnv, gatewayWithSnapshot(events));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, eventId: expect.any(String) });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'ops_assignment', payload: expect.objectContaining({ leadId: 'lead-ana', assigneeId: 'gestor-beto', actor: expect.objectContaining({ id: 'orlando', role: 'admin' }) }) })]));
  });

  it('exige un origen y token CSRF válidos antes de una mutación', async () => {
    const missingOrigin = await handleRequest(new Request('https://api.example/v1/ops/leads/lead-ana/assign', {
      method: 'POST', headers: { 'x-balo-test-principal': JSON.stringify(admin) }, body: JSON.stringify({ assigneeId: 'gestor-beto' }),
    }), baseEnv, gatewayWithSnapshot());
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toMatchObject({ code: 'OPS_ORIGIN_REQUIRED' });

    const missingToken = await handleRequest(opsRequest('/v1/ops/leads/lead-ana/assign', admin, { method: 'POST', body: JSON.stringify({ assigneeId: 'gestor-beto' }) }), baseEnv, gatewayWithSnapshot());
    expect(missingToken.status).toBe(403);
    expect(await missingToken.json()).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });
});

describe('protección de la escritura en Google Sheets', () => {
  it('neutraliza valores de hoja que podrían convertirse en fórmulas', async () => {
    const source = await readFile(new URL('../../sheets-gateway/src/Code.js', import.meta.url), 'utf8');
    const context: Record<string, unknown> = { console: { error: () => undefined } };
    runInNewContext(source, context);
    const safeCell = context.safeCell_ as (value: unknown) => string;
    expect(['=1+1', '+SUM(A1:A2)', '-1+1', '@HYPERLINK("https://bad.example")'].map(safeCell)).toEqual([
      "'=1+1", "'+SUM(A1:A2)", "'-1+1", "'@HYPERLINK(\"https://bad.example\")",
    ]);
    expect(safeCell('Miraflores')).toBe('Miraflores');
    expect(source).not.toContain('!activity.leadId ||');
  });
});
