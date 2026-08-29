# Arquitectura del piloto Balo

```text
Propietario
  │ formulario con consentimiento + Turnstile / WhatsApp manual
  ▼
Web comercial (GitHub Pages) ── UTM, QR, post_id ──► Worker de Cloudflare
                                                     │ valida origen, forma, consentimiento,
                                                     │ antispam, firma e idempotencia
                                                     ▼
                                              Gateway Apps Script de Orlando
                                                     │ HMAC + bloqueo de reintentos
                                                     ▼
                                      Google Sheets / Drive de Orlando
                                                     │
                 Portal interno (Cloudflare Access) ─┘
                         │ permisos por asignación y aprobaciones de Orlando
                         ▼
                   lead → visita → oferta → decisión
```

## Límites de confianza

- La web comercial solo consume un endpoint público de captación. El portal
  debe estar detrás de una aplicación Cloudflare Access propiedad de Orlando.
- El Worker no contiene secretos. `GATEWAY_URL`, `GATEWAY_HMAC_SECRET`,
  `TURNSTILE_SECRET` y, cuando proceda, `META_APP_SECRET` se instalan con
  `wrangler secret put` en la cuenta de Orlando.
- Google Sheets es el registro inicial, no un CRM de alto volumen. El gateway
  valida HMAC y guarda el `event_id` para que un reintento no cree duplicados.
- Un conector está *desactivado* hasta tener credenciales oficiales. El endpoint
  devuelve un error trazable y ofrece seguimiento manual, no una confirmación
  simulada.

## Entidades iniciales

| Entidad | Registro inicial | Decisión controlada |
| --- | --- | --- |
| Lead | Hoja `Leads` | consentimiento, asignación y siguiente acción |
| Inmueble | Hoja `Inmuebles` (a crear por Orlando) | precio y publicación |
| Publicación | Hoja `Publicaciones` | canal, `post_id` y aprobación |
| Actividad/visita | Hoja `Actividades` | responsable y resultado |
| Oferta | Hoja `Ofertas` | recomendación y cierre |
| Auditoría | Hoja `Auditoria` | evento, actor, fecha y decisión |

Los contratos TypeScript expresan estas reglas para ambas superficies. El
gateway del piloto registra primero los leads y la auditoría; las otras hojas
se habilitan tras validar el flujo con Orlando.
