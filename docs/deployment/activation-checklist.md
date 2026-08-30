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
      publicación, comisión, descuento y cierre.
- [ ] Probar el flujo de Orlando: asignar un lead, revisar una actividad,
      resolver una solicitud y confirmar que la decisión y su motivo aparecen
      en `Aprobaciones` y `Auditoria`.
- [ ] Verificar manualmente un webhook firmado de cada proveedor; no activar un
      proveedor sin su verificación y credenciales oficiales.
- [ ] Revisar los límites de uso mensuales. Solo considerar un plan de pago si
      el límite medido, soporte requerido o número de usuarios lo justifica.
- [ ] Orlando aprueba el despliegue manual de GitHub Pages y cada despliegue del
      Worker (`staging` antes de `production`).
