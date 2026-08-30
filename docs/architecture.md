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
                                                     │ sobre HMAC en cuerpo POST + bloqueo de reintentos
                                                     ▼
                                      Google Sheets / Drive de Orlando
                                                     │
 Portal interno (Cloudflare Access) ─ JWT validado en Worker ───────────────┘
                         │ permisos por asignación y aprobaciones de Orlando
                         ▼
                   lead → visita → oferta → decisión
```

La presentación visual se desacopla de las aplicaciones mediante
`packages/design-system`; el copy público se mantiene en un único archivo de
contenido para poder iterar sin alterar el formulario ni los controles de
seguridad. Véase [`docs/design-system.md`](design-system.md).

El catálogo público se incorporará como páginas estáticas indexables en
`/propiedades/` y `/propiedades/<slug>/`. Durante el piloto se genera desde una
exportación pública validada de Sheets; después podrá consultar un endpoint de
solo lectura del Worker. En ambos casos, únicamente expone inmuebles con
publicación aprobada y disponibilidad vigente, según
[`property-catalog.md`](property-catalog.md).

## Límites de confianza

- La web comercial solo consume `POST /v1/public/owner-enquiries`. El portal
  consume endpoints `/v1/ops/*` exclusivamente detrás de una aplicación
  Cloudflare Access propiedad de Orlando. El Worker valida
  `Cf-Access-Jwt-Assertion`, emisor y audiencia; Access no sustituye la
  autorización de servidor por rol y asignación. Las mutaciones requieren el
  `Origin` exacto del portal y un token CSRF de sesión firmado por el Worker.
- El Worker no contiene secretos. `GATEWAY_URL`, `GATEWAY_HMAC_SECRET`,
  `TURNSTILE_SECRET`, `CSRF_SECRET` y, cuando proceda, `META_APP_SECRET` se instalan con
  `wrangler secret put` en la cuenta de Orlando.
- Google Sheets es el registro inicial, no un CRM de alto volumen. El gateway
  recibe un sobre JSON `{ timestamp, signature, event }`, valida HMAC y guarda
  el `event_id` para que un reintento no cree duplicados. La firma no viaja en
  URL, logs ni historial del navegador.
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
| Aprobación | Hoja `Aprobaciones` | decisión, motivo y responsable |
| Usuario | Hoja `Usuarios` | correo, rol y estado de acceso |
| Auditoría | Hoja `Auditoria` | evento, actor, fecha y decisión |

Los contratos TypeScript expresan estas reglas para ambas superficies. El
gateway crea sus hojas con encabezados conocidos y registra una auditoría por
captación, asignación, actividad, solicitud o decisión. Las cuentas y los
correos reales solo se cargan desde la cuenta de Orlando durante la activación.

## Interfaz del piloto

| Ruta | Quién puede usarla | Resultado |
| --- | --- | --- |
| `POST /v1/public/owner-enquiries` | Propietario | Lead consentido o alternativa manual honesta |
| `GET /v1/ops/dashboard` | Orlando o gestor autorizado | Métricas y pendientes filtrados por asignación |
| `GET /v1/ops/leads` | Orlando o gestor autorizado | Expedientes visibles para el rol |
| `GET /v1/ops/csrf` | Orlando o gestor autorizado | Token CSRF para mutaciones del portal |
| `POST /v1/ops/leads/:id/assign` | Orlando | Asignación y auditoría |
| `POST /v1/ops/leads/:id/activities` | Responsable o Orlando | Actividad, visita u oferta trazable |
| `POST /v1/ops/approvals` | Responsable o Orlando | Solicitud pendiente de decisión |
| `POST /v1/ops/approvals/:id/decision` | Orlando | Aprobación o rechazo con motivo y auditoría |
