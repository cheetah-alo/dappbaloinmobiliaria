# Gateway de Google Sheets de Orlando

Este directorio contiene el código fuente para un único proyecto de Google Apps
Script, propiedad de Orlando, que recibe eventos **solo** desde el Worker de
Balo. No es una API pública de Sheets ni debe compartir su URL o secreto en la
web comercial.

## Activación manual

1. Orlando crea un Google Sheet en su Drive y mantiene su propiedad.
2. En **Extensiones → Apps Script**, copia `src/Code.js`.
3. En propiedades del proyecto, define `SPREADSHEET_ID` y
   `GATEWAY_HMAC_SECRET` con un valor largo y único.
4. Implementa como Web App ejecutada por Orlando. El acceso se reserva al
   Worker; su URL se guarda en Cloudflare como secreto `GATEWAY_URL`.
5. Ejecuta una prueba con un evento ficticio. Solo después se apunta el Worker
   de *staging* a la URL de Orlando.

El gateway crea tres hojas si faltan: `Leads`, `Auditoria` y `Eventos de canal`.
El Worker envía `event_id`, marca de tiempo y firma HMAC de vida corta como
parámetros de la URL, porque Apps Script no expone cabeceras HTTP arbitrarias a
`doPost`; el cuerpo permanece en JSON. El `event_id` se verifica dentro de un
bloqueo para que un reintento no duplique una fila. Una firma HMAC inválida, una
marca de tiempo caducada o un cuerpo no válido no se registra como éxito.

No se incluye `appsscript.json` desplegable ni un ID de script: estos recursos
deben pertenecer a la cuenta del cliente.
