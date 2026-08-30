# Catálogo público de propiedades Balo

## Objetivo

Crear una superficie pública en `/propiedades/` donde una persona pueda revisar
inmuebles realmente disponibles, abrir una ficha clara y conversar con Orlando
por WhatsApp conservando la referencia del inmueble y de la publicación que
originó la visita.

Instagram seguirá siendo un canal de descubrimiento. El catálogo Balo será la
fuente pública de disponibilidad: una publicación social puede permanecer
visible aunque el inmueble ya se haya reservado, vendido o alquilado.

## Experiencia recomendada

1. Catálogo con filtros por operación, distrito y rango de precio.
2. Ficha individual con galería, distribución, área, características, estado de
   disponibilidad y fecha de última verificación.
3. CTA `Consultar por WhatsApp` con `property_id`, `post_id` y UTM incorporados
   en el mensaje y en la atribución del lead.
4. Alternativa para pedir una búsqueda a medida cuando no haya coincidencias.
5. Enlaces a la publicación original de Instagram cuando corresponda, sin
   depender de Instagram para renderizar la ficha.

## Contrato público mínimo

| Campo | Uso público |
| --- | --- |
| `id` y `slug` | Referencia estable y URL de la ficha |
| `title` | Nombre corto aprobado del inmueble |
| `operation` | Venta o alquiler |
| `district` y `zone` | Ubicación aproximada; no dirección exacta |
| `price` y `currency` | Precio aprobado o modo `consultar` |
| `bedrooms`, `bathrooms`, `parking` | Datos comparables |
| `built_area_m2` | Área construida declarada |
| `summary` y `features` | Presentación revisada por Orlando |
| `cover_image` y `gallery` | Fotografías autorizadas para publicación |
| `instagram_url` y `post_id` | Origen social y atribución |
| `availability_status` | Disponible, reservado, vendido o alquilado |
| `last_verified_at` | Fecha de revisión de disponibilidad |
| `publication_approval_id` | Evidencia interna de aprobación |

## Reglas de publicación

- Mostrar únicamente inmuebles con publicación aprobada por Orlando y estado
  `available`.
- Ocultar dirección exacta, datos del propietario, documentos y notas internas.
- Publicar precio solo cuando la aprobación de precio esté vigente; en otro caso
  mostrar `Consultar`.
- No reutilizar fotografías sin autorización registrada.
- Revisar disponibilidad al menos una vez por semana. Recomendación: ocultar
  automáticamente una ficha tras 14 días sin verificación, hasta que Orlando o
  el gestor responsable la confirme.
- Al reservar, vender o alquilar, retirar la ficha del catálogo sin borrar su
  historial, métricas ni relación con leads anteriores.

## Fuente de datos por etapas

### Piloto

Google Sheets de Orlando mantiene los datos y aprobaciones. El build público
consume una exportación validada que contiene solo los campos permitidos. Esto
evita publicar el Sheet, su URL o información interna.

### Operación

El Worker expone un endpoint público de solo lectura, con caché, límites y un
contrato reducido. El portal interno actualiza Sheets y el Worker devuelve solo
inmuebles aprobados y disponibles.

### Canales

La carga manual con enlace de Instagram es el respaldo inicial. Una integración
con Meta puede añadirse más adelante con credenciales oficiales, pero nunca
decide por sí sola que un inmueble está disponible ni lo publica sin aprobación.

## Datos necesarios para la primera versión

Para cada propiedad inicial, Orlando debe entregar o validar: operación,
distrito/zona, precio público o `consultar`, dormitorios, baños, estacionamientos,
área, descripción, características, fotografías con permiso, enlace de
Instagram y estado actual. No se crearán fichas con datos inferidos de una foto
o de un reel.
