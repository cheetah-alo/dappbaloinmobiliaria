# Balo · piloto de captación y operación

> **Tu propiedad, bien representada. Tu decisión, siempre clara.**

Este repositorio convierte la landing de Balo en un piloto mantenible: una web
pública para iniciar conversaciones con propietarios y un portal de operación
privado para el equipo. Los prototipos históricos se conservan en
[`outputs/`](outputs/) para no romper las URLs publicadas en GitHub Pages.

## Estructura

| Área | Ubicación | Propósito |
| --- | --- | --- |
| Web comercial | `apps/marketing` | Landing estática, formulario consentido y WhatsApp de respaldo. |
| Portal interno | `apps/ops` | Operación por asignación; demo ficticia local y API protegida por Access al activarse. |
| API perimetral | `apps/edge-api` | Cloudflare Worker: valida entradas, Access JWT, gateway firmado y fallos honestos. |
| Gateway Sheets | `apps/sheets-gateway` | Proyecto de Google Apps Script para la cuenta de Orlando. No se despliega desde aquí. |
| Contratos | `packages/contracts` | Tipos, permisos, aprobaciones, eventos y pruebas compartidas. |
| Sistema visual | `packages/design-system` | Tokens compartidos de marca, tipografía, espaciado y estados visuales. |
| Decisiones y despliegue | `docs/` | Guías de cuentas, límites, privacidad y activación manual. |

La guía de adaptación visual y de copy está en [`docs/design-system.md`](docs/design-system.md).
La propuesta de catálogo verificable está en [`docs/property-catalog.md`](docs/property-catalog.md).
El flujo editorial y la publicación automática se documentan en
[`docs/property-publishing.md`](docs/property-publishing.md).

## Principios no negociables

- Orlando es la cuenta administradora y propietaria de GitHub, Google,
  Cloudflare, dominio y credenciales de canal.
- Un gestor (`user`) solo ve y actualiza registros que tenga asignados. Orlando
  (`admin`) puede asignar y aprobar las decisiones sensibles. La regla se aplica
  en el Worker, no solo en la interfaz.
- Precio, fotografías, publicación, comisión, descuento y cierre no cambian sin
  una aprobación de Orlando registrada.
- Ningún formulario, webhook o publicación se confirma como exitoso si el
  gateway o el conector falla. Se entrega una alternativa manual/WhatsApp con
  identificador trazable.
- Los datos de prueba están marcados como ficticios y nunca se presentan como
  propiedades reales. Los borradores reales y sus medios permanecen en
  `.local/`, fuera del historial Git y de la web pública.

## Arranque local

Requiere Node 20.19 o superior.

```bash
npm install
npm run dev:marketing
npm run dev:ops
npm run verify
```

Sin variables públicas, el servidor de desarrollo muestra un modo de prueba:
permite validar el formulario, pero deja claro que no envió ni guardó datos.
Para activar un entorno real, copiar `apps/marketing/.env.example` a un archivo
local ignorado y completar la URL pública del Worker, la clave pública de
Turnstile y el WhatsApp oficial de Orlando. Ninguna variable `VITE_*` puede
contener secretos.

El número público confirmado `+51 936 242 247` queda como respaldo seguro del
frontend y puede sobrescribirse por entorno con `VITE_BALO_WHATSAPP`.

El Worker se valida con `npm run check:worker`. No se despliega automáticamente
ni se comunica con Google, WhatsApp, Meta o TikTok hasta que Orlando proporcione
sus credenciales oficiales y valide la configuración descrita en
[`docs/deployment/activation-checklist.md`](docs/deployment/activation-checklist.md).

## Publicación

GitHub Pages sigue siendo solo la superficie comercial temporal. El workflow
construye `apps/marketing` y copia los archivos legados de `outputs/` y
`public/`, preservando la URL ya compartida:

`/dappbaloinmobiliaria/outputs/prototipo_orlando_barraza_balo_inmobiliaria.html`

Los cambios de código llegan a `main` únicamente por PR desde `dev`. Una vez
activado el CMS, Orlando podrá aprobar una revisión desde el portal; esa acción
iniciará el único workflow autorizado de GitHub Pages y no confirmará la
publicación hasta recibir su resultado firmado.

## Estado de infraestructura

El piloto está diseñado para empezar en USD 0/mes con GitHub Pages, Cloudflare
Workers Free, Cloudflare Access Free y el Google Sheets/Drive de Orlando. No es
una certificación de producción: dominio, acceso Cloudflare, hoja de cálculo,
secreto de firma y credenciales oficiales siguen siendo decisiones de Orlando.
