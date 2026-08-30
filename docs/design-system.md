# Sistema de diseño Balo

El sistema visual se deriva del ZIP de referencia entregado para Balo y de la dirección editorial del landing histórico. El ZIP permanece como material fuente; el código mantenible vive en el repositorio y no depende del archivo comprimido durante build o despliegue.

Esta revisión también gobierna el catálogo público y el CMS de propiedades. La validación ejecutiva está en [Balo_taller_decisiones_Orlando_v2.pptx](../documents/Balo_taller_decisiones_Orlando_v2.pptx) y [su PDF compartible](../documents/Balo_taller_decisiones_Orlando_v2.pdf).

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
| Plantilla de fichas públicas | `scripts/build-catalog.mjs` | Exportación estática, slug, metadatos, Open Graph y sitemap |
| CMS de propiedades | `apps/ops/src/features/properties` | Borrador, fotos, vista previa, revisión y publicación |

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

## Catálogo y publicación

- La web pública usa una sola plantilla de ficha; el generador crea el catálogo y las rutas `/propiedades/<slug>/` a partir de una exportación validada.
- Orlando edita datos, galería, portada y visibilidad del precio desde el portal. No se mantiene HTML de cada inmueble a mano.
- Una ficha publicada no se modifica en sitio: cada cambio abre una nueva revisión y conserva la versión pública anterior hasta que el despliegue termina correctamente.
- La dirección exacta, propietario, documentos, negociación y precio interno quedan fuera de la exportación pública. El precio se muestra como «consultar» salvo aprobación vigente.
- Las imágenes públicas son variantes aprobadas; los originales procesados permanecen privados. El catálogo no incorpora fotos de prueba ni datos ficticios.
- Los estados públicos son deliberados: disponible aparece en catálogo; reservado informa y sale del índice; vendido/alquilado conserva una ficha histórica mínima; retirado deja de servirse.

## Reglas de mantenimiento

1. Cambiar primero tokens o `content.ts` antes de modificar estilos o JSX repetidamente.
2. No duplicar copy dentro de los componentes.
3. Mantener los estados de formulario honestos: solo confirmar cuando la API y el gateway confirmen el registro.
4. Ejecutar `npm run verify` y `npm run test:e2e` tras cualquier cambio visual o de contenido.
5. El archivo raíz `index.html` se conserva como referencia histórica; las superficies mantenibles son `apps/marketing`, `apps/ops` y el generador `scripts/build-catalog.mjs`.
6. Toda modificación de copy, tokens o plantilla debe pasar por preview local, `npm run verify` y `npm run test:e2e` antes de solicitar publicación.
