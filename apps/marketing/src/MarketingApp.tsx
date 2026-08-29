import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Attribution, OwnerEnquiry } from '@balo/contracts';

type SubmissionState = 'idle' | 'sending' | 'recorded' | 'manual';
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

const manualWhatsapp = import.meta.env.VITE_BALO_WHATSAPP as string | undefined;
const apiUrl = import.meta.env.VITE_PUBLIC_API_URL as string | undefined;
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function attributionFromPage(): Attribution {
  const query = new URLSearchParams(window.location.search);
  return {
    source: query.get('utm_source') === 'instagram' ? 'instagram' : query.get('post_id') ? 'portal' : 'website',
    utmSource: query.get('utm_source') ?? undefined,
    utmCampaign: query.get('utm_campaign') ?? undefined,
    qrId: query.get('qr') ?? undefined,
    postId: query.get('post_id') ?? undefined,
  };
}

function whatsappHref(): string | undefined {
  if (!manualWhatsapp) return undefined;
  const text = encodeURIComponent('Hola Orlando, quiero conversar sobre una propiedad con Balo.');
  return `https://wa.me/${manualWhatsapp.replace(/\D/g, '')}?text=${text}`;
}

export function MarketingApp() {
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

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileContainerRef.current) return;

    let widgetId: string | undefined;
    let disposed = false;
    const render = () => {
      if (disposed || !turnstileContainerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
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
    if (submission === 'recorded' || submission === 'manual') statusRef.current?.focus();
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

    if (!apiUrl) {
      setSubmission('manual');
      return;
    }

    if (!turnstileSiteKey || !turnstileToken) {
      setSubmission('manual');
      return;
    }

    setSubmission('sending');
    try {
      const idempotencyKey = submissionIdRef.current ?? crypto.randomUUID();
      submissionIdRef.current = idempotencyKey;
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/public/owner-enquiries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ ...payload, turnstileToken }),
      });
      const result = await response.json() as { ok?: boolean };
      setSubmission(response.ok && result.ok === true ? 'recorded' : 'manual');
    } catch {
      setSubmission('manual');
    }
  }

  return (
    <div className="site-shell">
      <header className="nav-wrap">
        <a className="brand" href="#inicio" aria-label="Balo Inmobiliaria, inicio">BALO<span>INMOBILIARIA</span></a>
        <nav aria-label="Navegación principal">
          <a href="#metodo">Método</a>
          <a href="#seguimiento">Seguimiento</a>
          <a href="#contacto">Contacto</a>
        </nav>
        <a className="button button-dark nav-cta" href="#contacto">Hablemos</a>
      </header>

      <main>
        <section className="hero" id="inicio">
          <div className="eyebrow">Lima · atención inmobiliaria directa</div>
          <div className="hero-grid">
            <div>
              <h1>Tu propiedad,<br /><em>bien representada.</em><br />Tu decisión, siempre clara.</h1>
              <p className="lead">Una conversación honesta, una presentación cuidada y seguimiento visible para que cada paso tenga sentido.</p>
              <div className="actions">
                <a className="button button-terracotta" href="#contacto">Quiero conversar sobre mi propiedad</a>
                <a className="text-link" href="#metodo">Conocer el método <span aria-hidden="true">↓</span></a>
              </div>
              <p className="quiet-note">Atención personal. Sin precios públicos ni respuestas genéricas.</p>
            </div>
            <aside className="hero-card" aria-label="Compromiso de atención Balo">
              <span>EL COMPROMISO BALO</span>
              <strong>Presencia<br />con criterio.</strong>
              <p>Conocemos el inmueble antes de proponer una estrategia. Y explicamos cada decisión antes de ejecutarla.</p>
              <div className="card-rule" />
              <small>Orlando Barraza · atención directa</small>
            </aside>
          </div>
        </section>

        <section className="proof-strip" aria-label="Principios de trabajo Balo">
          <div><span>01</span><strong>Escuchamos antes de proponer.</strong></div>
          <div><span>02</span><strong>Publicamos con aprobación.</strong></div>
          <div><span>03</span><strong>Reportamos con contexto.</strong></div>
          <div><span>04</span><strong>Acompañamos la decisión.</strong></div>
        </section>

        <section className="method" id="metodo">
          <div className="section-head"><span className="eyebrow">MÉTODO BALO</span><h2>Un proceso pensado para que no tengas que perseguir respuestas.</h2></div>
          <ol className="steps">
            <li><span>01</span><div><h3>Conversamos con contexto</h3><p>Objetivo, tiempos, documentación y condiciones. Sin una promesa de precio antes de entender el caso.</p></div><b>Escucha</b></li>
            <li><span>02</span><div><h3>Definimos una salida a medida</h3><p>Presentación, narrativa y canales adecuados. Precio y publicación se aprueban contigo antes de salir.</p></div><b>Criterio</b></li>
            <li><span>03</span><div><h3>Seguimos cada señal</h3><p>Post, consulta, visita, feedback y oferta quedan conectados para tomar decisiones con información.</p></div><b>Claridad</b></li>
            <li><span>04</span><div><h3>Acompañamos el cierre</h3><p>La recomendación es de Balo; la decisión siempre es tuya.</p></div><b>Confianza</b></li>
          </ol>
        </section>

        <section className="follow-up" id="seguimiento">
          <div>
            <span className="eyebrow">SEGUIMIENTO VISIBLE</span>
            <h2>La operación se ordena para cuidar la conversación.</h2>
            <p>El portal interno ayuda al equipo a trabajar por asignación. Para cada caso: quién lo atiende, qué ocurrió y qué necesita aprobación de Orlando.</p>
          </div>
          <div className="timeline" aria-label="Ejemplo ficticio de trazabilidad">
            <p><time>POST</time><span>Publicación aprobada</span><i>post_id</i></p>
            <p><time>LEAD</time><span>Interés registrado con consentimiento</span><i>UTM / QR</i></p>
            <p><time>VISITA</time><span>Visita y feedback en la bitácora</span><i>actividad</i></p>
            <p><time>OFERTA</time><span>Decisión pendiente de Orlando</span><i>aprobación</i></p>
          </div>
        </section>

        <section className="contact" id="contacto">
          <div className="contact-copy">
            <span className="eyebrow">UNA CONVERSACIÓN DIRECTA</span>
            <h2>Hablemos de lo que estás por decidir.</h2>
            <p>Cuéntanos el punto de partida. Si el sistema no está disponible, no fingiremos haber recibido tu solicitud: te mostraremos un canal directo de seguimiento.</p>
            {whatsapp && <a className="text-link" href={whatsapp} target="_blank" rel="noreferrer">Escribir por WhatsApp <span aria-hidden="true">↗</span></a>}
          </div>
          <form onChange={prepareAnotherSubmission} onSubmit={submit} aria-describedby="privacy-note form-status">
            <label>Nombre<input name="name" autoComplete="name" minLength={2} required /></label>
            <label>Teléfono<input name="phone" autoComplete="tel" inputMode="tel" minLength={7} required /></label>
            <label>Correo (opcional)<input name="email" autoComplete="email" type="email" /></label>
            <label>¿Qué necesitas?
              <select name="operation" required defaultValue=""><option value="" disabled>Selecciona una opción</option><option value="sell">Vender una propiedad</option><option value="rent">Alquilar una propiedad</option><option value="buy">Comprar</option><option value="invest">Invertir</option></select>
            </label>
            <label>Distrito o zona<input name="district" minLength={2} required /></label>
            <label className="consent"><input name="consent" type="checkbox" required checked={hasConsent} onChange={(event) => setHasConsent(event.target.checked)} /> <span>Autorizo a Balo a usar estos datos para responder mi solicitud y registrar el seguimiento.</span></label>
            {turnstileSiteKey && <div className="turnstile-wrap" aria-describedby="turnstile-note"><div ref={turnstileContainerRef} /></div>}
            {requiresTurnstile && <p id="turnstile-note" className="privacy">{turnstileState === 'unavailable' ? 'No pudimos verificar que eres una persona. Usa el canal directo para continuar.' : 'La verificación protege este formulario frente a envíos automáticos.'}</p>}
            <button className="button button-terracotta" disabled={submission === 'sending' || !hasConsent} type="submit">{submission === 'sending' ? 'Enviando…' : 'Solicitar una conversación'}</button>
            <p id="privacy-note" className="privacy">Usaremos la información solo para atender esta solicitud. No publicamos precios ni datos de tu propiedad desde este formulario.</p>
            <p ref={statusRef} id="form-status" className="form-status" role="status" aria-live="polite" tabIndex={-1}>
              {submission === 'recorded' && 'Solicitud registrada. Orlando o el equipo asignado te contactará.'}
              {submission === 'manual' && <>{requiresTurnstile && !turnstileToken ? 'No enviamos tus datos porque no pudimos completar la verificación antispam. ' : 'Aún no confirmamos el registro. '}{whatsapp ? <a href={whatsapp} target="_blank" rel="noreferrer">Continúa por WhatsApp con este mismo contexto.</a> : 'Contacta directamente con Balo para continuar.'}</>}
            </p>
          </form>
        </section>
      </main>
      <footer><span>BALO INMOBILIARIA</span><small>Piloto de captación y operación · información demostrativa, no resultados de mercado.</small></footer>
    </div>
  );
}
