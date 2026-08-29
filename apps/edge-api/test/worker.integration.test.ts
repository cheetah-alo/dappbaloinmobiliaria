import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index';

const env = { ALLOWED_ORIGIN: 'http://localhost:5173', ALLOW_TEST_BYPASS: 'true', GATEWAY_URL: 'https://gateway.example/exec', GATEWAY_HMAC_SECRET: 'demo-secret' } as unknown as Env;

function enquiry(consent = true) {
  return new Request('https://api.example/v1/public/owner-enquiries', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', 'idempotency-key': 'evt-demo-1' }, body: JSON.stringify({ name: 'Propietaria demo', phone: '+51 999 111 222', operation: 'sell', district: 'Miraflores', consent, attribution: { source: 'instagram', utmSource: 'instagram', postId: 'post-demo' } }) });
}

describe('integración simulada con el gateway de Sheets', () => {
  it('valida consentimiento, firma el evento y retorna el idempotency key del gateway', async () => {
    let gatewayUrl: URL | undefined;
    let gatewayHeaders: Headers | undefined;
    const response = await handleRequest(enquiry(), env, async (input, init) => {
      gatewayUrl = new URL(input.toString());
      gatewayHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ eventId: 'evt-demo-1', deduplicated: false }), { status: 200 });
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, eventId: 'evt-demo-1' });
    expect(gatewayUrl?.searchParams.get('signature')).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(gatewayUrl?.searchParams.get('event_id')).toBe('evt-demo-1');
    expect(gatewayHeaders?.get('idempotency-key')).toBe('evt-demo-1');
  });

  it('rechaza un formulario sin consentimiento antes de tocar el gateway', async () => {
    const response = await handleRequest(enquiry(false), env, async () => { throw new Error('No debe ejecutarse'); });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_ENQUIRY_OR_CONSENT' });
  });

  it('no confirma un registro si el gateway devuelve un error', async () => {
    const response = await handleRequest(enquiry(), env, async () => new Response('error', { status: 502 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: 'GATEWAY_REJECTED', manualFollowUp: true });
  });

  it('mantiene apagado el webhook sin la credencial oficial del canal', async () => {
    const response = await handleRequest(new Request('https://api.example/v1/webhooks/meta', { method: 'POST', body: '{}' }), env, async () => new Response());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'CONNECTOR_DISABLED' });
  });
});
