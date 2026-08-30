import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OwnerEnquiry } from '@balo/contracts';
import { apiUrl, attributionFromPage, enquiryTimeoutMs, turnstileScriptUrl, turnstileSiteKey, whatsappHref } from './runtime';

type SubmissionState = 'idle' | 'sending' | 'recorded' | 'manual' | 'preview';
type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function LeadForm() {
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const [hasConsent, setHasConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileState, setTurnstileState] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const attribution = useMemo(attributionFromPage, []);
  const whatsapp = whatsappHref();
  const requiresTurnstile = Boolean(apiUrl);
  const isLocalPreview = import.meta.env.DEV && !apiUrl;

  useEffect(() => {
    const siteKey = turnstileSiteKey;
    if (!siteKey || !turnstileContainerRef.current) return;
    let widgetId: string | undefined;
    let disposed = false;
    const render = () => {
      if (disposed || !turnstileContainerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: siteKey,
        callback: (token) => {
          if (!disposed && token) {
            setTurnstileToken(token);
            setTurnstileState('ready');
          }
        },
        'expired-callback': () => {
          if (!disposed) {
            setTurnstileToken(undefined);
            setTurnstileState('idle');
          }
        },
        'error-callback': () => {
          if (!disposed) {
            setTurnstileToken(undefined);
            setTurnstileState('unavailable');
          }
        },
      });
    };
    const script = document.createElement('script');
    script.src = turnstileScriptUrl;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', render);
    script.addEventListener('error', () => {
      if (!disposed) setTurnstileState('unavailable');
    });
    document.head.append(script);
    return () => {
      disposed = true;
      script.remove();
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  useEffect(() => {
    if (submission === 'recorded' || submission === 'manual' || submission === 'preview') statusRef.current?.focus();
  }, [submission]);

  function prepareAnotherSubmission(): void {
    if (submission === 'sending') return;
    submissionIdRef.current = undefined;
    if (submission !== 'idle') setSubmission('idle');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!formElement.reportValidity()) return;
    const form = new FormData(formElement);
    if (form.get('consent') !== 'on') return;
    const payload: OwnerEnquiry = {
      name: String(form.get('name') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim(),
      email: String(form.get('email') ?? '').trim() || undefined,
      operation: String(form.get('operation')) as OwnerEnquiry['operation'],
      district: String(form.get('district') ?? '').trim(),
      consent: true,
      attribution,
    };
    if (!apiUrl || !turnstileSiteKey || !turnstileToken) {
      setSubmission(isLocalPreview ? 'preview' : 'manual');
      return;
    }
    setSubmission('sending');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), enquiryTimeoutMs);
    try {
      const idempotencyKey = submissionIdRef.current ?? crypto.randomUUID();
      submissionIdRef.current = idempotencyKey;
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/public/owner-enquiries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ ...payload, turnstileToken }),
        signal: controller.signal,
      });
      const result = await response.json() as { ok?: boolean };
      setSubmission(response.ok && result.ok === true ? 'recorded' : 'manual');
    } catch {
      setSubmission('manual');
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  return (
    <form className="lead-form" onChange={prepareAnotherSubmission} onSubmit={submit} aria-describedby="privacy-note form-status" aria-busy={submission === 'sending'}>
      <h3>Solicita una conversación</h3>
      {isLocalPreview && <p className="form-mode">Vista de prueba local: puedes completar el flujo sin enviar ni guardar datos.</p>}
      <div className="form-grid">
        <label>Nombre<input name="name" autoComplete="name" minLength={2} required /></label>
        <label>Teléfono<input name="phone" autoComplete="tel" inputMode="tel" minLength={7} required /></label>
      </div>
      <label>Correo (opcional)<input name="email" autoComplete="email" type="email" /></label>
      <div className="form-grid">
        <label>¿Qué necesitas?
          <select name="operation" required defaultValue=""><option value="" disabled>Selecciona una opción</option><option value="sell">Vender una propiedad</option><option value="rent">Alquilar una propiedad</option><option value="buy">Comprar</option><option value="invest">Invertir</option></select>
        </label>
        <label>Distrito o zona<input name="district" minLength={2} required /></label>
      </div>
      <label className="consent"><input name="consent" type="checkbox" required checked={hasConsent} onChange={(event) => setHasConsent(event.target.checked)} /> <span>Autorizo a Balo a usar estos datos para responder mi solicitud y registrar el seguimiento.</span></label>
      {!hasConsent && <p className="consent-hint">Completa los campos y marca la autorización para continuar.</p>}
      {turnstileSiteKey && <div className="turnstile-wrap" aria-describedby="turnstile-note"><div ref={turnstileContainerRef} /></div>}
      {requiresTurnstile && <p id="turnstile-note" className="privacy">{turnstileState === 'unavailable' ? 'No pudimos completar la verificación. Puedes continuar por el canal directo.' : 'Esta verificación protege el formulario frente a envíos automáticos.'}</p>}
      <button className="button button-accent form-submit" disabled={submission === 'sending'} type="submit">{submission === 'sending' ? 'Enviando…' : 'Solicitar una conversación'}</button>
      <p id="privacy-note" className="privacy">Usaremos la información únicamente para atender esta solicitud.</p>
      <p ref={statusRef} id="form-status" className="form-status" data-state={submission} role="status" aria-live="polite" tabIndex={-1}>
        {submission === 'recorded' && 'Solicitud registrada. Orlando o la persona asignada te contactará.'}
        {submission === 'preview' && 'Prueba completada: el formulario respondió correctamente. No se enviaron ni guardaron datos; la conexión real se activará con las cuentas de Orlando.'}
        {submission === 'manual' && <>{requiresTurnstile && !turnstileToken ? 'No enviamos tus datos porque la verificación no se completó. ' : 'No pudimos registrar tu solicitud. '}{whatsapp ? <a href={whatsapp} target="_blank" rel="noreferrer">Continúa por WhatsApp.</a> : 'El canal directo de Balo todavía no está configurado.'}</>}
      </p>
    </form>
  );
}
