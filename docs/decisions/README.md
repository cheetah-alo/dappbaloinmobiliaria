# Decisiones de Orlando

Este registro acompaña la presentación [editable](../../documents/Balo_taller_decisiones_Orlando_v2.pptx) y el [PDF para compartir](../../documents/Balo_taller_decisiones_Orlando_v2.pdf), revisados el 30 de agosto de 2026. Las decisiones pendientes se mantienen como preguntas de validación; no se convierten en configuraciones asumidas.

## Decisiones ya adoptadas para el piloto

| Tema | Decisión vigente | Implicación |
| --- | --- | --- |
| Producto | Web pública para captar y catálogo de propiedades + portal interno para operar | Una conversación trazable desde la ficha hasta la oferta |
| Promesa | «Tu propiedad, bien representada. Tu decisión, siempre clara.» | Cercanía, presentación cuidada y seguimiento visible |
| Roles | Orlando es `admin`; gestores son `user` y solo ven registros asignados | Orlando conserva precio, fotos, publicación, comisión, descuento y cierre |
| Publicación | Borrador → revisión → aprobación → publicación; cada edición crea una revisión | La versión pública anterior permanece si falla el despliegue |
| Precio | `consult` por defecto; mostrar importe exige aprobación vigente de Orlando | No se publican precios internos por accidente |
| Datos y medios | Sheets/Drive como registro inicial; originales de fotos privados; exportación pública redactada | No se exponen dirección exacta, propietario, documentos ni negociación |
| Coste | Empezar en USD 0/mes y medir antes de pagar | R2, dominio y cuentas operativas pertenecen a Orlando y requieren su aprobación |
| Canales | WhatsApp y registro manual de respaldo; APIs solo con credenciales oficiales | No se confirma una acción si no queda registrada |

## Validar con Orlando antes de activar

1. dominio, registrador, DNS y titularidad;
2. cuentas de GitHub, Google, Cloudflare, Access y R2, con recuperación del cliente;
3. texto de consentimiento, WhatsApp oficial y responsable de respuesta;
4. gestores iniciales, asignaciones y SLA de revisión/aprobación;
5. autorización de fotografías, criterios de portada y campos visibles de cada ficha;
6. frecuencia de validación de disponibilidad y tratamiento de reservados/vendidos;
7. primer canal de adquisición y convención de UTM/QR/`post_id`;
8. casos y materiales que pueden mostrarse de forma anónima.

## Posponer hasta que exista una necesidad medida

- APIs externas y automatizaciones de terceros sin credenciales oficiales.
- Planes pagos, soporte formal o migración fuera de Sheets mientras el piloto no alcance sus límites.
- Publicación directa en `main`: primero se prueba staging y Orlando aprueba.

No se han activado cuentas, secretos, dominio, R2 ni APIs externas desde el entorno técnico.
