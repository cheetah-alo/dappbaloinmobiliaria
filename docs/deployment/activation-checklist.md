# Activación manual y propiedad de cuentas

Esta lista se resuelve con Orlando antes de conectar personas reales o publicar
un dominio. Ningún punto se activa desde CI.

## Cuentas y dominio

- [x] Número público de WhatsApp confirmado por Orlando: `+51 936 242 247`.
- [ ] Orlando posee la organización/repositorio GitHub y habilita GitHub Pages
      con **GitHub Actions** como fuente. Configurar el entorno `github-pages`
      con Orlando como revisor requerido: el texto de aprobación del workflow
      es una evidencia operativa, no un control de acceso suficiente por sí solo.
- [ ] Orlando registra y paga el dominio. Se define `www` y la redirección del
      dominio raíz; no usar una cuenta del equipo técnico como titular.
- [ ] Orlando crea la cuenta/zona Cloudflare y concede acceso mínimo al equipo.
- [ ] Orlando activa la suscripción R2 después de revisar el nivel gratuito y
      la facturación por exceso. Crear espacios separados para borradores y
      variantes públicas; no usar una cuenta del equipo técnico.
- [ ] Orlando crea el Google Sheet y Drive del piloto y mantiene la propiedad.
- [ ] Las APIs (Meta/WhatsApp/TikTok u otras) se crean con negocio, permisos y
      credenciales oficiales de Orlando. No se reutilizan tokens de pruebas.

## Seguridad y privacidad

- [ ] Configurar Turnstile en el formulario y guardar `TURNSTILE_SECRET` como
      secreto del Worker.
- [ ] Configurar en la web `VITE_PUBLIC_API_URL`, la clave pública
      `VITE_TURNSTILE_SITE_KEY` y el número oficial `VITE_BALO_WHATSAPP`. No
      introducir secretos en variables `VITE_*`, porque quedan visibles en el
      navegador.
- [ ] Configurar `GATEWAY_URL` y `GATEWAY_HMAC_SECRET` como secretos del
      Worker; poner el mismo HMAC en Apps Script. Verificar que la firma se
      transmite dentro del sobre POST y nunca mediante parámetros de URL.
- [ ] Guardar un `CSRF_SECRET` largo y único en cada entorno del Worker;
      configurar `OPS_ALLOWED_ORIGIN` exactamente como el subdominio `ops`.
      Confirmar que las mutaciones sin `Origin` o token CSRF firmado se rechazan.
- [ ] Crear una aplicación Cloudflare Access para `ops.<dominio>`; añadir a
      Orlando como administrador y a cada gestor como usuario autorizado.
- [ ] Configurar `TEAM_DOMAIN` y `POLICY_AUD` del Worker desde la aplicación
      Access de Orlando; comprobar que una petición sin
      `Cf-Access-Jwt-Assertion` recibe rechazo.
- [ ] Vincular al Worker dos buckets R2 de Orlando: uno privado para cargas y
      otro para variantes publicables. El navegador sube mediante el proxy
      firmado del Worker; los buckets no se hacen públicos ni requieren CORS.
- [ ] Guardar como secreto el token GitHub de Orlando limitado a este
      repositorio y permiso de Actions. No registrar secretos en
      `wrangler.jsonc` ni logs; los tokens de carga deben caducar en cinco
      minutos.
- [ ] Configurar en el entorno `github-pages` el token de exportación y secreto
      de callback; verificar HMAC, trabajo y versión antes de aceptar un
      resultado de despliegue.
- [ ] Configurar `CATALOG_EXPORT_BASE_URL` con la URL del Worker. Compartir el
      mismo valor secreto entre `BUILD_EXPORT_SECRET` del Worker y
      `CATALOG_EXPORT_SECRET` de GitHub, y entre `BUILD_CALLBACK_SECRET` del
      Worker y `CATALOG_CALLBACK_HMAC_SECRET` de GitHub.
- [ ] Confirmar que `catalog-publish.yml` es el único workflow con permiso para
      escribir Pages y que el entorno `github-pages` exige la aprobación de
      Orlando.
- [ ] Deshabilitar o no enrutar cualquier URL alternativa del portal que evite
      Access. Verificar reglas directamente en la cuenta del cliente.
- [ ] Validar texto de consentimiento, retención, derechos de acceso y canal de
      contacto conforme a la revisión legal local de Orlando.

## Operación y despliegue

- [ ] Hacer una prueba ficticia: formulario → `Leads` → `Auditoria`.
- [ ] Repetir el mismo `event_id` y comprobar que no duplica una fila.
- [ ] Rechazar un sobre HMAC caducado o con firma alterada y verificar que no
      genera una fila ni expone una firma en URL o auditoría.
- [ ] Validar que un gestor solo ve sus registros y que Orlando aprueba precio,
      fotografías, publicación, comisión, descuento y cierre.
- [ ] Probar una propiedad ficticia completa: borrador, imágenes WebP sin EXIF,
      revisión, aprobación, estado `publishing`, despliegue y callback. Simular
      un fallo y confirmar que la revisión pública anterior sigue activa.
- [ ] Comprobar que la exportación no contiene dirección exacta, propietario,
      documentos, negociación ni precio interno, y que una ficha sin
      aprobación de precio muestra `Consultar`.
- [ ] Probar el flujo de Orlando: asignar un lead, revisar una actividad,
      resolver una solicitud y confirmar que la decisión y su motivo aparecen
      en `Aprobaciones` y `Auditoria`.
- [ ] Verificar manualmente un webhook firmado de cada proveedor; no activar un
      proveedor sin su verificación y credenciales oficiales.
- [ ] Revisar los límites de uso mensuales. Solo considerar un plan de pago si
      el límite medido, soporte requerido o número de usuarios lo justifica.
- [ ] Orlando aprueba el despliegue manual de GitHub Pages y cada despliegue del
      Worker (`staging` antes de `production`).
