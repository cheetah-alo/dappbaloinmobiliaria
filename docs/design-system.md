# Sistema de diseño Balo

El sistema visual se deriva del ZIP de referencia entregado para Balo y de la dirección editorial del landing histórico. El ZIP permanece como material fuente; el código mantenible vive en el repositorio y no depende del archivo comprimido durante build o despliegue.

## Puntos de cambio

| Necesidad | Archivo | Alcance |
| --- | --- | --- |
| Color, tipografía, espaciado, radios y sombras | `packages/design-system/src/tokens.css` | Web pública y portal interno |
| Copy completo del landing | `apps/marketing/src/content.ts` | Textos, navegación y orden narrativo |
| Composición de secciones | `apps/marketing/src/MarketingApp.tsx` | Estructura del landing |
| Formulario y canales | `apps/marketing/src/LeadForm.tsx` | Consentimiento, Turnstile, API y WhatsApp |
| Variables de integración | `apps/marketing/src/runtime.ts` | API, atribución y canal directo |
| Presentación responsive | `apps/marketing/src/styles.css` | Layout, estados y adaptación móvil |
| Fotografía principal | `public/images/familia-en-casa-pexels-andrea-piacquadio.jpg` | Imagen emocional del hero |

## Dirección visual

- Petrol, terracota y neutros cálidos como paleta base.
- Tipografía editorial únicamente en titulares; tipografía sans para lectura e interacción.
- Bordes discretos, espacio generoso y pocas superficies elevadas.
- Fotografía humana y cotidiana, sin imágenes generadas, gradientes decorativos, íconos innecesarios ni métricas inventadas.
- La tecnología y la terminología interna no se presentan al cliente; solo se explica el beneficio observable.

## Fotografía y licencia

La imagen principal muestra una escena familiar de ambiente; no representa clientes ni testimonios de Balo. Es una fotografía de Andrea Piacquadio publicada en [Pexels](https://www.pexels.com/photo/multiethnic-family-spending-time-together-at-home-3820132/) y se usa bajo la [licencia de Pexels](https://www.pexels.com/license/). La copia local evita una dependencia de red durante la carga.

Al sustituirla, conservar una escena real, luminosa y espontánea en horizontal, documentar autor, fuente y licencia, y actualizar el texto alternativo. No usar retratos generados ni imágenes con marcas visibles.

## Dirección de copy

La voz es directa, serena y concreta. Habla de lo que Orlando hace y de lo que el cliente puede esperar. Evita superlativos, frases grandilocuentes, afirmaciones de mercado no verificadas y textos que suenen a una plantilla genérica.

La promesa principal permanece estable:

> Tu propiedad, bien representada. Tu decisión, siempre clara.

## Reglas de mantenimiento

1. Cambiar primero tokens o `content.ts` antes de modificar estilos o JSX repetidamente.
2. No duplicar copy dentro de los componentes.
3. Mantener los estados de formulario honestos: solo confirmar cuando la API y el gateway confirmen el registro.
4. Ejecutar `npm run verify` y `npm run test:e2e` tras cualquier cambio visual o de contenido.
5. El archivo raíz `index.html` se conserva como referencia histórica; la superficie desplegable es `apps/marketing`.
