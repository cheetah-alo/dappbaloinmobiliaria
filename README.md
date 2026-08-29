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
| Decisiones y despliegue | `docs/` | Guías de cuentas, límites, privacidad y activación manual. |

## Principios no negociables

- Orlando es la cuenta administradora y propietaria de GitHub, Google,
  Cloudflare, dominio y credenciales de canal.
- Un gestor (`user`) solo ve y actualiza registros que tenga asignados. Orlando
  (`admin`) puede asignar y aprobar las decisiones sensibles. La regla se aplica
  en el Worker, no solo en la interfaz.
- Precio, publicación, comisión, descuento y cierre no cambian sin una
  aprobación de Orlando registrada.
- Ningún formulario, webhook o publicación se confirma como exitoso si el
  gateway o el conector falla. Se entrega una alternativa manual/WhatsApp con
  identificador trazable.
- No se usan resultados, inmuebles ni integraciones inventadas. Todo ejemplo en
  el código es ficticio.

## Arranque local

Requiere Node 20.19 o superior.

```bash
npm install
npm run dev:marketing
npm run dev:ops
npm run verify
```

El Worker se valida con `npm run check:worker`. No se despliega automáticamente
ni se comunica con Google, WhatsApp, Meta o TikTok hasta que Orlando proporcione
sus credenciales oficiales y valide la configuración descrita en
[`docs/deployment/activation-checklist.md`](docs/deployment/activation-checklist.md).

## Publicación

GitHub Pages sigue siendo solo la superficie comercial temporal. El workflow
construye `apps/marketing` y copia los archivos legados de `outputs/` y
`public/`, preservando la URL ya compartida:

`/dappbaloinmobiliaria/outputs/prototipo_orlando_barraza_balo_inmobiliaria.html`

El despliegue sigue siendo manual y requiere la aprobación de Orlando.

## Estado de infraestructura

El piloto está diseñado para empezar en USD 0/mes con GitHub Pages, Cloudflare
Workers Free, Cloudflare Access Free y el Google Sheets/Drive de Orlando. No es
una certificación de producción: dominio, acceso Cloudflare, hoja de cálculo,
secreto de firma y credenciales oficiales siguen siendo decisiones de Orlando.
