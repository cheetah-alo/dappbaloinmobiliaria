# Publicación de propiedades administrada por Orlando

## Flujo editorial

1. Orlando o un gestor crea un borrador asignado.
2. El portal guarda una revisión con control de versión; una edición publicada
   nunca sustituye la revisión activa hasta completar un nuevo despliegue.
3. Las fotografías se procesan en el navegador, se cargan al espacio privado y
   requieren una declaración de autorización.
4. Un gestor envía la revisión a Orlando. Fotografías, precio público y
   publicación generan aprobaciones independientes.
5. Orlando publica. El estado cambia a `publishing` y se crea un trabajo
   idempotente.
6. GitHub Actions solicita al Worker una exportación autenticada del catálogo
   completo para ese trabajo, genera todas las fichas estáticas y despliega un
   único artefacto de GitHub Pages.
7. Un callback firmado marca el trabajo como `succeeded` o `failed`. Solo el
   éxito activa la revisión y muestra `published` en el portal.

Un fallo conserva la versión pública anterior y deja una acción de reintento.
El portal nunca interpreta la aceptación de GitHub como despliegue terminado.
Solo puede existir un trabajo de catálogo en curso; así dos publicaciones no
compiten ni reemplazan fichas entre sí.

## Límites de datos

- Google Sheets mantiene metadatos, revisiones, aprobaciones, trabajos y
  auditoría; nunca recibe archivos binarios.
- R2 mantiene objetos privados y variantes públicas con claves aleatorias y
  versionadas. Una ficha solo referencia el espacio público.
- La exportación de catálogo contiene `CatalogProperty`; dirección exacta,
  contacto del propietario, documentos, negociación y precio interno no forman
  parte de ese contrato.
- `consult` es la visibilidad de precio predeterminada. `public` requiere un
  importe y una aprobación de precio asociada a la misma revisión.
- La autorización de uso de las fotografías no sustituye la aprobación de
  Orlando: ambas quedan vinculadas a la misma revisión antes de publicar.
- Una propiedad `available` aparece en el catálogo; `reserved`, `sold` y
  `rented` conservan una ficha de estado; `withdrawn` no se exporta.

## Publicación de GitHub Pages

El workflow de catálogo se ejecuta con `workflow_dispatch` sobre código ya
aprobado: `dev` en staging y `main` en producción. Recibe únicamente el
identificador del trabajo y la versión del snapshot. Los secretos de lectura y
callback viven en el entorno `github-pages`; el token que inicia el workflow
pertenece a Orlando, queda limitado a este repositorio y solo tiene permiso de
Actions.

La compilación genera `/propiedades/`, una ruta por `slug`, metadatos Open Graph,
datos estructurados y `sitemap.xml`, preservando las URLs existentes de
`outputs/`. La tarea diaria solo puede ocultar disponibilidad vencida; nunca
puede publicar una revisión nueva.

Las fichas son estáticas, pero no se mantienen a mano: Orlando trabaja solo en
el CMS y un único generador reutilizable transforma el snapshot aprobado en
HTML. Así se obtiene buen SEO, velocidad, coste bajo y una superficie de ataque
pequeña sin duplicar código por inmueble. Si el volumen o la necesidad de tiempo
real crecen, el mismo `CatalogExport` permite sustituir el renderizador sin
cambiar el modelo editorial ni volver a cargar los datos.

El workflow `catalog-publish.yml` es el único autorizado para escribir GitHub
Pages. Esto evita que un despliegue paralelo de la landing sustituya el catálogo
por datos de demostración.

## Activación controlada

El repositorio incluye adaptadores locales y pruebas, no recursos externos. La
activación requiere aprobación expresa de Orlando para:

- crear los espacios R2 privado y público; ambos permanecen privados y las
  cargas pasan por el proxy autenticado del Worker, sin CORS directo de R2;
- instalar las vinculaciones y secretos del Worker en staging y producción;
- crear el token de GitHub de alcance mínimo y los secretos del entorno Pages;
- ampliar el Sheet de Orlando con las hojas y columnas documentadas;
- registrar Access y los orígenes exactos del portal y la web pública.

Los medios reales de las primeras propiedades permanecen en `.local/` y fuera
del historial Git hasta que Orlando los cargue y autorice desde el portal.
Sus precios internos, fuentes y dirección exacta también se conservan en el
archivo local ignorado `.local/property-media/catalog-drafts.json`; el bundle
del portal no incorpora esos valores.
