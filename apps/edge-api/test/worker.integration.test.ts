import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index';

const eventId = 'c0a8012e-9e56-4f59-8ff9-6ce82ec09230';
const baseEnv = {
  ALLOWED_ORIGIN: 'http://localhost:5173',
  ALLOW_TEST_BYPASS: 'true',
  BUILD_CALLBACK_SECRET: 'build-demo-secret',
  BUILD_EXPORT_SECRET: 'export-demo-secret',
  CSRF_SECRET: 'csrf-demo-secret',
  OPS_ALLOWED_ORIGIN: 'http://localhost:5174',
  RUNTIME_ENV: 'development',
  GATEWAY_URL: 'https://gateway.example/exec',
  GATEWAY_HMAC_SECRET: 'demo-secret',
  MEDIA_BACKEND: 'local',
  MEDIA_INTENT_SECRET: 'media-demo-secret',
  MEDIA_PUBLIC_BASE_URL: 'http://localhost:8787/v1/public/media',
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
  properties: [{ id: 'property-beto', slug: 'inmueble-b', label: 'Inmueble B', assigneeId: 'gestor-beto', publicationStatus: 'draft', availabilityStatus: 'available', version: 1, draftRevisionId: 'revision-beto', createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z' }],
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
    if (envelope.event.eventType === 'cms_property_snapshot') return new Response(JSON.stringify({
      ok: true, actor: admin, property: snapshot.properties[0],
      revision: { id: 'revision-beto', propertyId: 'property-beto', revision: 1, ...propertyRevisionInput(), createdBy: 'gestor-beto', createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z' },
      images: [], publicationJobs: [],
    }), { status: 200 });
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

function propertyRevisionInput() {
  return {
    title: 'Departamento de prueba', operation: 'sale', district: 'Miraflores', builtAreaM2: 86,
    bedrooms: 2, bathrooms: 2, parking: 1, studies: 0, summary: 'Inmueble ficticio para validar el flujo seguro.',
    features: ['Luz natural'], priceVisibility: 'consult', privateDetails: {},
  };
}

describe('CMS de propiedades: seguridad y trazabilidad', () => {
  it('crea una propiedad mediante evento firmado, sin aceptar una asignación ajena de un gestor', async () => {
    const events: Array<Record<string, unknown>> = [];
    const csrf = await csrfFor(admin);
    const response = await handleRequest(opsRequest('/v1/ops/properties', admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf },
      body: JSON.stringify({ property: { slug: 'departamento-demo', label: 'Departamento demo', assigneeId: 'gestor-ana' }, revision: propertyRevisionInput() }),
    }), baseEnv, gatewayWithSnapshot(events));
    expect(response.status).toBe(202);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'cms_property_create', payload: expect.objectContaining({ actor: expect.objectContaining({ id: 'orlando' }), property: expect.objectContaining({ slug: 'departamento-demo', assigneeId: 'gestor-ana', version: 1 }) }) })]));

    const managerCsrf = await csrfFor(manager);
    const denied = await handleRequest(opsRequest('/v1/ops/properties', manager, {
      method: 'POST', headers: { 'x-balo-csrf': managerCsrf },
      body: JSON.stringify({ property: { slug: 'ajeno-demo', label: 'Expediente ajeno', assigneeId: 'gestor-beto' }, revision: propertyRevisionInput() }),
    }), baseEnv, gatewayWithSnapshot());
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ code: 'INVALID_PROPERTY' });
  });

  it('responde 409 antes de sobrescribir una versión de inmueble obsoleta', async () => {
    const csrf = await csrfFor(admin);
    const response = await handleRequest(opsRequest('/v1/ops/properties/property-beto', admin, {
      method: 'PUT', headers: { 'x-balo-csrf': csrf },
      body: JSON.stringify({ expectedVersion: 2, revision: propertyRevisionInput() }),
    }), baseEnv, gatewayWithSnapshot());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });
  });

  it('niega al gestor publicar o cambiar disponibilidad, incluso con CSRF válido', async () => {
    const csrf = await csrfFor(manager);
    const publish = await handleRequest(opsRequest('/v1/ops/properties/property-beto/publish', manager, {
      method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ expectedVersion: 1 }),
    }), baseEnv, gatewayWithSnapshot());
    expect(publish.status).toBe(403);
    expect(await publish.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
    const availability = await handleRequest(opsRequest('/v1/ops/properties/property-beto/availability', manager, {
      method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ expectedVersion: 1, availabilityStatus: 'sold' }),
    }), baseEnv, gatewayWithSnapshot());
    expect(availability.status).toBe(403);
    expect(await availability.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('marca el trabajo como fallido si no puede recuperar la instantánea que debe publicar', async () => {
    const approvedSnapshot = {
      ...snapshot,
      properties: [{ ...snapshot.properties[0], publicationStatus: 'approved' }],
    };
    const events: Array<Record<string, unknown>> = [];
    const fetchWithoutPublicationSnapshot = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const envelope = JSON.parse(String(init?.body)) as { event: Record<string, unknown> };
      events.push(envelope.event);
      if (envelope.event.eventType === 'ops_snapshot') return new Response(JSON.stringify(approvedSnapshot));
      if (envelope.event.eventType === 'cms_property_snapshot') return new Response(JSON.stringify({ ok: false, code: 'SNAPSHOT_UNAVAILABLE' }), { status: 503 });
      return new Response(JSON.stringify({ ok: true, eventId: envelope.event.eventId }), { status: 200 });
    };
    const r2Env = {
      ...baseEnv,
      MEDIA_BACKEND: 'r2',
      PRIVATE_MEDIA: { get: async () => null },
      PUBLIC_MEDIA: { put: async () => undefined },
    } as unknown as Env;
    const csrf = await csrfFor(admin);
    const response = await handleRequest(opsRequest('/v1/ops/properties/property-beto/publish', admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ expectedVersion: 1 }),
    }), r2Env, fetchWithoutPublicationSnapshot);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'PUBLICATION_SNAPSHOT_UNAVAILABLE', manualFollowUp: true });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
      eventType: 'cms_publication_callback',
      payload: expect.objectContaining({ status: 'failed', errorCode: 'PUBLICATION_SNAPSHOT_UNAVAILABLE' }),
    })]));
  });

  it('emite intents locales trazables sin URL de carga falsa y conserva la metadata de la imagen', async () => {
    const events: Array<Record<string, unknown>> = [];
    const csrf = await csrfFor(admin);
    const response = await handleRequest(opsRequest('/v1/ops/properties/property-beto/media/intents', admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf },
      body: JSON.stringify({ expectedVersion: 1, revisionId: 'revision-beto', files: [{ category: 'cover', alt: 'Fachada de prueba', sortOrder: 0, isCover: true, sizeBytes: 1234, mimeType: 'image/webp', sha256: 'a'.repeat(64) }] }),
    }), baseEnv, gatewayWithSnapshot(events));
    expect(response.status).toBe(202);
    const intentEvent = events.find((event) => event.eventType === 'cms_media_intent');
    expect(intentEvent).toMatchObject({ payload: { intents: [expect.objectContaining({ objectKey: expect.stringMatching(/^local\/properties\//), uploadUrl: null, uploadToken: expect.stringContaining('|') })] } });
    expect(JSON.stringify(intentEvent)).not.toContain('media-demo-secret');
  });

  it('exige callback firmado e idempotente antes de actualizar un trabajo de publicación', async () => {
    const raw = JSON.stringify({ jobId: 'c0a8012e-9e56-4f59-8ff9-6ce82ec09230', snapshotVersion: 2, status: 'succeeded', deploymentUrl: 'https://build.example.test/catalog.json' });
    const signature = `sha256=${await hmacHex('build-demo-secret', raw)}`;
    const events: Array<Record<string, unknown>> = [];
    const response = await handleRequest(new Request('https://api.example/v1/internal/publication-jobs/c0a8012e-9e56-4f59-8ff9-6ce82ec09230/callback', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-balo-signature': signature }, body: raw,
    }), baseEnv, gatewayWithSnapshot(events));
    expect(response.status).toBe(202);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'cms_publication_callback', payload: expect.objectContaining({ status: 'succeeded' }) })]));
    const rejected = await handleRequest(new Request('https://api.example/v1/internal/publication-jobs/c0a8012e-9e56-4f59-8ff9-6ce82ec09230/callback', { method: 'POST', body: raw }), baseEnv, gatewayWithSnapshot());
    expect(rejected.status).toBe(401);
  });

  it('filtra propiedades ajenas al gestor, pero permite al gestor guardar solo su expediente asignado', async () => {
    const managerSnapshot = {
      ...snapshot,
      properties: [...snapshot.properties, { id: 'property-ana', slug: 'ana-demo', label: 'Inmueble Ana', assigneeId: 'gestor-ana', publicationStatus: 'draft', availabilityStatus: 'available', version: 1, createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z' }],
    };
    const events: Array<Record<string, unknown>> = [];
    const fetchForManager = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const envelope = JSON.parse(String(init?.body)) as { event: Record<string, unknown> };
      events.push(envelope.event);
      return new Response(JSON.stringify(envelope.event.eventType === 'ops_snapshot' ? managerSnapshot : { ok: true, eventId: envelope.event.eventId, data: {} }), { status: 200 });
    };
    const csrf = await csrfFor(manager);
    const foreign = await handleRequest(opsRequest('/v1/ops/properties/property-beto', manager, { method: 'PUT', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ expectedVersion: 1, revision: propertyRevisionInput() }) }), baseEnv, fetchForManager);
    expect(foreign.status).toBe(404);
    const own = await handleRequest(opsRequest('/v1/ops/properties/property-ana', manager, { method: 'PUT', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ expectedVersion: 1, revision: propertyRevisionInput() }) }), baseEnv, fetchForManager);
    expect(own.status).toBe(202);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'cms_property_update', payload: expect.objectContaining({ actor: expect.objectContaining({ id: 'gestor-ana' }) }) })]));
  });

  it('firma un intent R2 de cinco minutos y rechaza token manipulado o carga no verificada', async () => {
    const r2Env = {
      ...baseEnv, MEDIA_BACKEND: 'r2',
      PRIVATE_MEDIA: { head: async () => null },
      PUBLIC_MEDIA: { get: async () => null },
    } as unknown as Env;
    const events: Array<Record<string, unknown>> = [];
    const csrf = await csrfFor(admin);
    const intentResponse = await handleRequest(opsRequest('/v1/ops/properties/property-beto/media/intents', admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf },
      body: JSON.stringify({ expectedVersion: 1, revisionId: 'revision-beto', files: [{ category: 'cover', alt: 'Fachada de prueba', sortOrder: 0, isCover: true, sizeBytes: 1234, mimeType: 'image/webp', sha256: 'b'.repeat(64) }] }),
    }), r2Env, gatewayWithSnapshot(events));
    expect(intentResponse.status).toBe(202);
    const intentEvent = events.find((event) => event.eventType === 'cms_media_intent');
    expect(intentEvent).toBeDefined();
    const intentPayload = intentEvent?.payload as { intents: Array<{ uploadToken: string; thumbnailUploadToken: string; uploadUrl: string }> };
    const intent = intentPayload.intents[0];
    expect(intent).toBeDefined();
    expect(intent.uploadUrl).toContain('/upload?token=');
    const uploadMatch = intent.uploadUrl.match(/intents\/([0-9a-f-]{36})\/upload/);
    expect(uploadMatch?.[1]).toBeDefined();
    const intentId = uploadMatch?.[1] ?? '';
    const lastCharacter = intent.uploadToken.at(-1);
    const manipulated = `${intent.uploadToken.slice(0, -1)}${lastCharacter === '0' ? '1' : '0'}`;
    const denied = await handleRequest(opsRequest(`/v1/ops/media/intents/${intentId}/complete`, admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ uploadToken: manipulated, thumbnailUploadToken: intent.thumbnailUploadToken, width: 1200, height: 800, sizeBytes: 1234, mimeType: 'image/webp', sha256: 'b'.repeat(64) }),
    }), r2Env, gatewayWithSnapshot());
    expect(denied.status).toBe(403);
    const unverified = await handleRequest(opsRequest(`/v1/ops/media/intents/${intentId}/complete`, admin, {
      method: 'POST', headers: { 'x-balo-csrf': csrf }, body: JSON.stringify({ uploadToken: intent.uploadToken, thumbnailUploadToken: intent.thumbnailUploadToken, width: 1200, height: 800, sizeBytes: 1234, mimeType: 'image/webp', sha256: 'b'.repeat(64) }),
    }), r2Env, gatewayWithSnapshot());
    expect(unverified.status).toBe(400);
    expect(await unverified.json()).toMatchObject({ code: 'MEDIA_UPLOAD_NOT_VERIFIED' });
  });

  it('genera el export público sin filtrar detalles privados ni precio no aprobado', async () => {
    const catalogProperty = { id: 'property-catalog', slug: 'catalogo-demo', label: 'Catalogo', assigneeId: 'orlando', publicationStatus: 'published', availabilityStatus: 'available', version: 3, activeRevisionId: 'revision-catalog', draftRevisionId: 'revision-catalog', lastVerifiedAt: new Date().toISOString(), createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z' };
    const revision = { id: 'revision-catalog', propertyId: 'property-catalog', revision: 3, ...propertyRevisionInput(), askingPrice: { currency: 'USD', amount: 250000 }, priceApprovalId: 'price-approved', photoApprovalId: 'photos-approved', publicationApprovalId: 'publication-approved', photoAuthorizationConfirmedBy: 'orlando', photoAuthorizationConfirmedAt: new Date().toISOString(), privateDetails: { exactAddress: 'Dato privado' }, createdBy: 'orlando', createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z' };
    const image = { id: 'image-catalog', propertyId: 'property-catalog', revisionId: 'revision-catalog', category: 'cover', alt: 'Vista exterior', sortOrder: 0, isCover: true, width: 1200, height: 800, sizeBytes: 1234, mimeType: 'image/webp', privateObjectKey: 'private/catalog.webp', publicObjectKey: 'public/catalog.webp', thumbnailObjectKey: 'thumb/catalog.webp', status: 'approved', uploadedAt: new Date().toISOString() };
    const catalogSnapshot = { ...snapshot, properties: [catalogProperty] };
    const fetchCatalog = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const event = (JSON.parse(String(init?.body)) as { event: { eventType: string } }).event;
      if (event.eventType === 'ops_snapshot') return new Response(JSON.stringify(catalogSnapshot));
      if (event.eventType === 'cms_property_snapshot') return new Response(JSON.stringify({ ok: true, actor: admin, property: catalogProperty, revision, images: [image], publicationJobs: [] }));
      return new Response(JSON.stringify({ ok: true, eventId: (event as unknown as { eventId: string }).eventId }));
    };
    const response = await handleRequest(opsRequest('/v1/ops/properties/property-catalog/build-snapshot', admin), baseEnv, fetchCatalog);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { catalog?: Record<string, unknown> } };
    expect(payload.data.catalog).toMatchObject({ id: 'property-catalog', priceVisibility: 'consult' });
    expect(JSON.stringify(payload.data.catalog)).not.toContain('Dato privado');
    expect(JSON.stringify(payload.data.catalog)).not.toContain('askingPrice');
  });

  it('exporta el catálogo completo para que una publicación no elimine fichas vigentes', async () => {
    const jobId = 'c0a8012e-9e56-4f59-8ff9-6ce82ec09230';
    const now = new Date().toISOString();
    const makeEntry = (id: string, target: 'active' | 'candidate') => {
      const revisionId = `revision-${id}`;
      return {
        publicationTarget: target,
        property: { id, slug: id, label: id, assigneeId: 'orlando', publicationStatus: target === 'candidate' ? 'publishing' : 'published', availabilityStatus: 'available', version: 2, ...(target === 'candidate' ? { draftRevisionId: revisionId } : { activeRevisionId: revisionId }), lastVerifiedAt: now, createdAt: now, updatedAt: now },
        revision: { id: revisionId, propertyId: id, revision: 2, ...propertyRevisionInput(), privateDetails: { exactAddress: `Privada ${id}` }, publicationApprovalId: `publication-${id}`, photoApprovalId: `photos-${id}`, photoAuthorizationConfirmedBy: 'orlando', photoAuthorizationConfirmedAt: now, createdBy: 'orlando', createdAt: now, updatedAt: now },
        images: [{ id: `image-${id}`, propertyId: id, revisionId, category: 'cover', alt: `Portada ${id}`, sortOrder: 0, isCover: true, width: 1200, height: 800, sizeBytes: 1234, mimeType: 'image/webp', privateObjectKey: `private/${id}.webp`, publicObjectKey: `public/${id}.webp`, thumbnailObjectKey: `thumb/${id}.webp`, status: 'approved', uploadedAt: now }],
      };
    };
    const fetchCatalog = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const event = (JSON.parse(String(init?.body)) as { event: { eventType: string } }).event;
      if (event.eventType === 'cms_publication_job_snapshot') return new Response(JSON.stringify({
        ok: true,
        catalogEntries: [makeEntry('propiedad-nueva', 'candidate'), makeEntry('propiedad-vigente', 'active')],
        publicationJob: { id: jobId, propertyId: 'propiedad-nueva', revisionId: 'revision-propiedad-nueva', requestedBy: 'orlando', status: 'queued', snapshotVersion: 2, requestedAt: now },
      }));
      throw new Error('Evento inesperado');
    };
    const response = await handleRequest(new Request(`https://api.example/v1/build/catalog/${jobId}`, { headers: { authorization: 'Bearer export-demo-secret' } }), baseEnv, fetchCatalog);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { properties: Array<{ id: string }> } };
    expect(payload.data.properties.map((property) => property.id)).toEqual(['propiedad-nueva', 'propiedad-vigente']);
    expect(JSON.stringify(payload)).not.toContain('Privada');
    expect(JSON.stringify(payload)).not.toContain('privateDetails');
  });

  it('mantiene las hojas CMS y el barrido de 7/14 días en el gateway sin registrar secretos', async () => {
    const source = await readFile(new URL('../../sheets-gateway/src/Code.js', import.meta.url), 'utf8');
    expect(source).toContain("'Inmuebles'");
    expect(source).toContain("'Versiones Inmueble'");
    expect(source).toContain("'Imagenes'");
    expect(source).toContain("'Publicaciones'");
    expect(source).toContain("'Trabajos Publicacion'");
    expect(source).toContain('cms_availability_sweep');
    expect(source).toContain('availability_auto_hidden_14d');
    expect(source).not.toContain('console.error(rawBody)');
  });
});
