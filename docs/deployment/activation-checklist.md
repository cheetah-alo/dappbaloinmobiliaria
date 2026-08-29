# Activación manual y propiedad de cuentas

Esta lista se resuelve con Orlando antes de conectar personas reales o publicar
un dominio. Ningún punto se activa desde CI.

## Cuentas y dominio

- [ ] Orlando posee la organización/repositorio GitHub y habilita GitHub Pages
      con **GitHub Actions** como fuente.
- [ ] Orlando registra y paga el dominio. Se define `www` y la redirección del
      dominio raíz; no usar una cuenta del equipo técnico como titular.
- [ ] Orlando crea la cuenta/zona Cloudflare y concede acceso mínimo al equipo.
- [ ] Orlando crea el Google Sheet y Drive del piloto y mantiene la propiedad.
- [ ] Las APIs (Meta/WhatsApp/TikTok u otras) se crean con negocio, permisos y
      credenciales oficiales de Orlando. No se reutilizan tokens de pruebas.

## Seguridad y privacidad

- [ ] Configurar Turnstile en el formulario y guardar `TURNSTILE_SECRET` como
      secreto del Worker.
- [ ] Configurar `GATEWAY_URL` y `GATEWAY_HMAC_SECRET` como secretos del
      Worker; poner el mismo HMAC en Apps Script.
- [ ] Crear una aplicación Cloudflare Access para `ops.<dominio>`; añadir a
      Orlando como administrador y a cada gestor como usuario autorizado.
- [ ] Deshabilitar o no enrutar cualquier URL alternativa del portal que evite
      Access. Verificar reglas directamente en la cuenta del cliente.
- [ ] Validar texto de consentimiento, retención, derechos de acceso y canal de
      contacto conforme a la revisión legal local de Orlando.

## Operación y despliegue

- [ ] Hacer una prueba ficticia: formulario → `Leads` → `Auditoria`.
- [ ] Repetir el mismo `event_id` y comprobar que no duplica una fila.
- [ ] Validar que un gestor solo ve sus registros y que Orlando aprueba precio,
      publicación, comisión, descuento y cierre.
- [ ] Verificar manualmente un webhook firmado de cada proveedor; no activar un
      proveedor sin su verificación y credenciales oficiales.
- [ ] Revisar los límites de uso mensuales. Solo considerar un plan de pago si
      el límite medido, soporte requerido o número de usuarios lo justifica.
- [ ] Orlando aprueba el despliegue manual de GitHub Pages y cada despliegue del
      Worker (`staging` antes de `production`).
