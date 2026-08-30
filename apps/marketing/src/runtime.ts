import type { Attribution } from '@balo/contracts';

export const apiUrl = import.meta.env.VITE_PUBLIC_API_URL as string | undefined;
export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
export const turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const enquiryTimeoutMs = 12_000;

const officialWhatsapp = '51936242247';
const manualWhatsapp = (import.meta.env.VITE_BALO_WHATSAPP as string | undefined) || officialWhatsapp;

export function attributionFromPage(): Attribution {
  const query = new URLSearchParams(window.location.search);
  return {
    source: query.get('utm_source') === 'instagram' ? 'instagram' : query.get('post_id') ? 'portal' : 'website',
    utmSource: query.get('utm_source') ?? undefined,
    utmCampaign: query.get('utm_campaign') ?? undefined,
    qrId: query.get('qr') ?? undefined,
    postId: query.get('post_id') ?? undefined,
  };
}

export function whatsappHref(message = 'Hola Orlando, quiero conversar sobre una propiedad con Balo.'): string {
  const query = new URLSearchParams(window.location.search);
  const reference = query.get('post_id') ?? query.get('property_id');
  const text = encodeURIComponent(`${message}${reference ? ` Referencia: ${reference}.` : ''}`);
  return `https://wa.me/${manualWhatsapp.replace(/\D/g, '')}?text=${text}`;
}
