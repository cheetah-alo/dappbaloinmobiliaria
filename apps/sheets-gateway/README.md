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

El gateway crea las hojas operativas si faltan: `Usuarios`, `Leads`,
`Inmuebles`, `Versiones Inmueble`, `Imagenes`, `Publicaciones`,
`Trabajos Publicacion`, `Actividades`, `Aprobaciones`, `Auditoria` y
`Eventos de canal`.
El Worker envía un único sobre JSON con `{ timestamp, signature, event }`; la
firma HMAC cubre una serialización determinista de la marca y del evento. No se
aceptan firma, identificador ni marca de tiempo por URL o cabecera. El
`event_id` se verifica dentro de un bloqueo para que un reintento no duplique
una fila. Una firma HMAC inválida, una marca de tiempo caducada o un cuerpo no
válido no se registra como éxito.

Antes de operar, Orlando crea las filas activas de `Usuarios` con `id`, nombre,
correo, rol (`admin` o `user`) y estado `active`. El identificador debe
corresponder al sujeto de Cloudflare Access o el correo al correo autenticado.
Las fórmulas introducidas como datos se neutralizan antes de guardarse en Sheets.

Las imágenes no se guardan en Sheets: solo se registran metadatos, claves de
objeto aleatorias, estado y orden. El gateway vuelve a comprobar el máximo de
30 imágenes por revisión, 12 MB por variante principal y la caducidad de cinco
minutos aunque el portal ya los haya validado.

No se incluye `appsscript.json` desplegable ni un ID de script: estos recursos
deben pertenecer a la cuenta del cliente.
