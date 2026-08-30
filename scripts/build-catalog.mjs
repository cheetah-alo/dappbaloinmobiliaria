import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(scriptDirectory);
const fixturePath = process.env.CATALOG_SNAPSHOT_PATH || join(rootDirectory, 'apps/marketing/catalog/properties.fixture.json');
const outputDirectory = join(rootDirectory, 'apps/marketing/dist');
const catalogDirectory = join(outputDirectory, 'propiedades');
const availabilityStatuses = new Set(['available', 'reserved', 'sold', 'rented']);
const exportKeys = new Set(['snapshotVersion', 'generatedAt', 'properties']);
const propertyKeys = new Set(['id', 'slug', 'title', 'operation', 'district', 'zone', 'builtAreaM2', 'totalAreaM2', 'bedrooms', 'bathrooms', 'parking', 'studies', 'summary', 'features', 'priceVisibility', 'price', 'availabilityStatus', 'lastVerifiedAt', 'images', 'instagramUrl', 'postId', 'publicationApprovalId']);
const imageKeys = new Set(['id', 'url', 'thumbnailUrl', 'alt', 'category', 'width', 'height', 'sortOrder', 'isCover']);
const siteUrl = (process.env.CATALOG_SITE_URL || 'https://cheetah-alo.github.io/dappbaloinmobiliaria').replace(/\/$/, '');
const whatsappNumber = '51936242247';
const demoMode = !process.env.CATALOG_SNAPSHOT_PATH;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function requiredText(value, label, maximum = 240) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maximum) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function optionalText(value, label, maximum = 240) {
  return value === undefined ? undefined : requiredText(value, label, maximum);
}

function requiredNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function requiredHttpsUrl(value, label) {
  const url = requiredText(value, label, 500);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid ${label}`); }
  if (parsed.protocol !== 'https:') throw new Error(`Invalid ${label}`);
  return url;
}

function assertOnlyKeys(input, allowedKeys, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Invalid ${label}`);
  for (const key of Object.keys(input)) if (!allowedKeys.has(key)) throw new Error(`Unexpected ${label} field: ${key}`);
}

// This is only a CatalogExport consumer. Publishing eligibility, approval and
// redaction are decided upstream by toCatalogProperty, never recomputed here.
function validateSnapshot(input) {
  assertOnlyKeys(input, exportKeys, 'CatalogExport');
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1 || !Array.isArray(input.properties)) throw new Error('CatalogExport must include a positive snapshotVersion and properties');
  const generatedAt = requiredText(input.generatedAt, 'generated date', 32);
  const ids = new Set();
  const slugs = new Set();
  const properties = input.properties.map((property) => {
    assertOnlyKeys(property, propertyKeys, 'CatalogProperty');
    const id = requiredText(property.id, 'property id', 120);
    const slug = requiredText(property.slug, 'property slug', 120);
    const availabilityStatus = requiredText(property.availabilityStatus, 'availability status', 32);
    const operation = requiredText(property.operation, 'operation', 32);
    const priceVisibility = requiredText(property.priceVisibility, 'price visibility', 32);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !availabilityStatuses.has(availabilityStatus) || ids.has(id) || slugs.has(slug)) throw new Error(`Invalid or duplicate property ${id}`);
    if (!['sale', 'rent'].includes(operation) || !['consult', 'public'].includes(priceVisibility)) throw new Error(`Invalid public status for ${id}`);
    if (priceVisibility === 'consult' && property.price !== undefined) throw new Error(`CatalogProperty ${id} cannot include price when priceVisibility is consult`);
    if (priceVisibility === 'public' && (!property.price || typeof property.price !== 'object' || !['PEN', 'USD'].includes(property.price.currency) || !Number.isFinite(property.price.amount) || property.price.amount <= 0)) throw new Error(`Invalid public price for ${id}`);
    requiredText(property.publicationApprovalId, 'publication approval id', 120);
    if (!Array.isArray(property.features) || property.features.length > 30 || !Array.isArray(property.images) || !property.images.length || property.images.length > 30) throw new Error(`Invalid public content for ${id}`);
    const images = property.images.map((image) => {
      assertOnlyKeys(image, imageKeys, 'CatalogImage');
      const width = requiredNumber(image.width, 'image width');
      const height = requiredNumber(image.height, 'image height');
      const sortOrder = requiredNumber(image.sortOrder, 'image sort order');
      if (width === 0 || height === 0 || !Number.isInteger(sortOrder)) throw new Error(`Invalid public image dimensions or order for ${id}`);
      return {
        id: requiredText(image.id, 'image id'),
        url: requiredHttpsUrl(image.url, 'public image url'),
        thumbnailUrl: requiredHttpsUrl(image.thumbnailUrl, 'public image thumbnail url'),
        alt: requiredText(image.alt, 'image alt'),
        width,
        height,
        sortOrder,
        isCover: image.isCover === true,
      };
    });
    const coverImages = images.filter((image) => image.isCover);
    if (coverImages.length !== 1 || new Set(images.map((image) => image.sortOrder)).size !== images.length) throw new Error(`CatalogProperty ${id} needs one cover and unique image order`);
    const [coverImage] = coverImages;
    ids.add(id);
    slugs.add(slug);
    return {
      id, slug, postId: optionalText(property.postId, 'post id', 120), status: availabilityStatus,
      title: requiredText(property.title, 'title'), district: requiredText(property.district, 'district', 120),
      operation, summary: requiredText(property.summary, 'summary', 500),
      details: [`${requiredNumber(property.bedrooms, 'bedrooms')} dormitorios`, `${requiredNumber(property.bathrooms, 'bathrooms')} baños`, `${requiredNumber(property.builtAreaM2, 'built area')} m² construidos`, ...property.features.map((feature) => requiredText(feature, 'feature', 120))].slice(0, 6),
      updatedAt: requiredText(property.lastVerifiedAt, 'last verified date', 32), coverImage, images,
      price: priceVisibility === 'public' ? property.price : undefined,
    };
  });
  return { snapshotVersion: input.snapshotVersion, generatedAt, properties };
}

function statusLabel(status) {
  return ({ available: 'Disponible', reserved: 'Reservada', sold: 'Vendida', rented: 'Alquilada' })[status];
}

function whatsappHref(property, alternatives = false) {
  const parameters = new URLSearchParams({ property_id: property.id, ...(property.postId ? { post_id: property.postId } : {}), utm_source: 'balo_catalog', utm_medium: 'property_page', utm_campaign: property.slug });
  const request = alternatives ? `Hola Orlando, vi ${property.title} y quiero conocer alternativas disponibles.` : `Hola Orlando, quiero conversar sobre ${property.title}.`;
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`${request} ${parameters.toString()}`)}`;
}

function jsonLdFor(property, canonical) {
  const availability = { available: 'https://schema.org/InStock', reserved: 'https://schema.org/PreOrder', sold: 'https://schema.org/SoldOut', rented: 'https://schema.org/SoldOut' }[property.status];
  const listing = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: property.title,
    description: property.summary,
    url: canonical,
    dateModified: property.updatedAt,
    image: property.images.map((image) => image.url),
    address: { '@type': 'PostalAddress', addressLocality: property.district, addressCountry: 'PE' },
    provider: { '@type': 'RealEstateAgent', name: 'Balo Inmobiliaria', employee: { '@type': 'Person', name: 'Orlando Barraza' } },
    offers: { '@type': 'Offer', availability, ...(property.price ? { price: property.price.amount, priceCurrency: property.price.currency } : {}) },
  };
  return JSON.stringify(listing).replace(/</g, '\\u003c');
}

function pageShell({ title, description, canonicalPath, coverImage, jsonLd, body }) {
  const canonical = `${siteUrl}${canonicalPath}`;
  const imageMetadata = coverImage ? `<meta property="og:image" content="${escapeHtml(coverImage.url)}"><meta property="og:image:alt" content="${escapeHtml(coverImage.alt)}"><meta name="twitter:image" content="${escapeHtml(coverImage.url)}">` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Balo Inmobiliaria</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:locale" content="es_PE"><meta property="og:site_name" content="Balo Inmobiliaria"><meta property="og:title" content="${escapeHtml(title)} · Balo Inmobiliaria"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">${imageMetadata}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)} · Balo Inmobiliaria"><meta name="twitter:description" content="${escapeHtml(description)}">${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}<style>:root{--ink:#13383e;--paper:#faf8f4;--accent:#a96338;--line:#d9d0c3;--muted:#627177}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Arial,sans-serif}.shell{max-width:1120px;margin:auto;padding:0 24px}.top{border-bottom:1px solid var(--line);padding:22px 0}.brand{color:var(--ink);font-weight:800;letter-spacing:.12em;text-decoration:none}.brand small{color:var(--muted);font-size:.65rem;letter-spacing:.08em;margin-left:9px}.hero{padding:72px 0 36px}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.hero h1{font:600 clamp(2.7rem,7vw,5.4rem)/.95 Georgia,serif;letter-spacing:-.05em;margin:13px 0}.intro{color:var(--muted);max-width:650px}.note{border-left:4px solid var(--accent);background:#fff;padding:14px 16px;font-size:.83rem;color:var(--muted)}.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));padding:20px 0 72px}.card{background:#fff;border:1px solid var(--line);padding:24px;display:flex;flex-direction:column;gap:16px}.status{font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}.card h2,.detail h1{font:600 2.1rem/1 Georgia,serif;margin:0}.card p{color:var(--muted);margin:0}.facts{display:flex;flex-wrap:wrap;gap:7px;list-style:none;padding:0;margin:0}.facts li{border:1px solid var(--line);font-size:.75rem;padding:5px 8px}.gallery{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));list-style:none;padding:0}.gallery figure{margin:0}.gallery img{aspect-ratio:4/3;width:100%;object-fit:cover}.gallery figcaption{color:var(--muted);font-size:.78rem}.button{align-self:start;background:var(--ink);color:#fff;text-decoration:none;font-weight:700;padding:12px 15px}.detail{background:#fff;border:1px solid var(--line);margin:0 0 72px;padding:clamp(26px,6vw,68px)}.detail h1{font-size:clamp(3rem,8vw,6rem)}.detail .summary{font-size:1.08rem;max-width:670px;color:var(--muted)}.back{color:var(--accent);font-weight:700}.footer{background:#0e2d32;color:#d7e6e6;padding:26px 0;font-size:.77rem}@media(max-width:600px){.hero{padding-top:48px}.detail{padding:28px 22px}}</style></head><body><header class="top"><div class="shell"><a class="brand" href="${canonicalPath.startsWith('/propiedades/') && canonicalPath !== '/propiedades/' ? '../../' : '../'}">BALO <small>INMOBILIARIA</small></a></div></header><main>${body}</main><footer class="footer"><div class="shell">Balo Inmobiliaria · ${demoMode ? 'Catálogo de demostración · ' : ''}La disponibilidad se confirma de forma personal.</div></footer></body></html>`;
}

function catalogPage(properties) {
  const available = properties.filter((property) => property.status === 'available');
  const cards = available.map((property) => `<article class="card"><span class="status">${escapeHtml(statusLabel(property.status))}</span><div><p class="eyebrow">${escapeHtml(property.operation === 'rent' ? 'Alquiler' : 'Venta')} · ${escapeHtml(property.district)}</p><h2>${escapeHtml(property.title)}</h2></div><p>${escapeHtml(property.summary)}</p><ul class="facts">${property.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul><a class="button" href="${escapeHtml(`${property.slug}/`)}" aria-label="Ver ficha de ${escapeHtml(property.title)}">Ver ficha</a></article>`).join('');
  const intro = demoMode ? 'Una selección ficticia para validar el catálogo y su trazabilidad. No representa inmuebles, precios ni disponibilidad reales.' : 'Una selección cuidada de propiedades disponibles, con información validada y atención directa de Orlando.';
  const note = demoMode ? 'El catálogo muestra solo propiedades ficticias disponibles. Las fichas cerradas se preservan en sus URL mínimas, pero no se promocionan aquí.' : 'Aquí aparecen únicamente propiedades disponibles. Antes de tomar una decisión, Orlando confirma contigo la vigencia y el contexto de cada ficha.';
  return pageShell({ title: 'Propiedades con contexto', description: 'Propiedades disponibles de Balo Inmobiliaria, con información validada y conversación directa.', canonicalPath: '/propiedades/', body: `<section class="hero"><div class="shell"><p class="eyebrow">Catálogo Balo</p><h1>Propiedades con contexto.</h1><p class="intro">${escapeHtml(intro)}</p><p class="note">${escapeHtml(note)}</p></div></section><section class="shell"><div class="grid">${cards || '<p>No hay propiedades disponibles en este momento. Orlando puede ayudarte con una búsqueda a medida.</p>'}</div></section>` });
}

function detailPage(property) {
  const isAvailable = property.status === 'available';
  const isHistorical = property.status === 'sold' || property.status === 'rented';
  const action = isAvailable
    ? `<p><a class="button" href="${escapeHtml(whatsappHref(property))}" target="_blank" rel="noreferrer">Consultar por WhatsApp</a></p>`
    : isHistorical
      ? `<p><a class="button" href="${escapeHtml(whatsappHref(property, true))}" target="_blank" rel="noreferrer">Buscar alternativas por WhatsApp</a></p>`
      : '<p class="note">Esta propiedad está reservada y no se ofrece como disponible.</p>';
  const canonicalPath = `/propiedades/${property.slug}/`;
  const gallery = isHistorical ? '' : `<ul class="gallery">${property.images.map((image) => `<li><figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy"><figcaption>${escapeHtml(image.alt)}</figcaption></figure></li>`).join('')}</ul>`;
  const facts = isHistorical ? '' : `<ul class="facts">${property.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>`;
  const price = isHistorical ? '' : property.price ? `<p><strong>Precio publicado:</strong> ${escapeHtml(new Intl.NumberFormat('es-PE', { style: 'currency', currency: property.price.currency, maximumFractionDigits: 0 }).format(property.price.amount))}</p>` : '<p class="note">Precio a consultar directamente con Balo.</p>';
  const verifiedAt = new Date(property.updatedAt);
  const verification = Number.isNaN(verifiedAt.valueOf()) ? escapeHtml(property.updatedAt) : new Intl.DateTimeFormat('es-PE', { dateStyle: 'long' }).format(verifiedAt);
  return pageShell({ title: property.title, description: `${property.operation === 'rent' ? 'Alquiler' : 'Venta'} en ${property.district}. ${property.summary}`, canonicalPath, coverImage: property.coverImage, jsonLd: jsonLdFor(property, `${siteUrl}${canonicalPath}`), body: `<section class="hero"><div class="shell"><a class="back" href="../">← Volver al catálogo</a></div></section><article class="shell detail"><span class="status">${escapeHtml(statusLabel(property.status))}</span><p class="eyebrow">${escapeHtml(property.operation === 'rent' ? 'Alquiler' : 'Venta')} · ${escapeHtml(property.district)}</p><h1>${escapeHtml(property.title)}</h1><p class="summary">${escapeHtml(isHistorical ? `Esta propiedad figura como ${statusLabel(property.status).toLowerCase()}. Orlando puede ayudarte a encontrar una alternativa disponible.` : property.summary)}</p>${gallery}${facts}${price}<p><strong>Disponibilidad:</strong> ${escapeHtml(statusLabel(property.status))}</p><p><strong>Última validación:</strong> <time datetime="${escapeHtml(property.updatedAt)}">${escapeHtml(verification)}</time></p><p><strong>Tu asesor:</strong> Orlando Barraza, Balo Inmobiliaria.</p>${action}<p class="note">Referencia trazable: <strong>${escapeHtml(property.id)}</strong>${property.postId ? ` · Publicación: <strong>${escapeHtml(property.postId)}</strong>` : ''}. La conversación se confirma de forma personal.</p></article>` });
}

const catalogExport = validateSnapshot(JSON.parse(await readFile(fixturePath, 'utf8')));
const properties = catalogExport.properties;
await mkdir(catalogDirectory, { recursive: true });
await writeFile(join(catalogDirectory, 'index.html'), catalogPage(properties), 'utf8');
for (const property of properties) {
  const propertyDirectory = join(catalogDirectory, property.slug);
  await mkdir(propertyDirectory, { recursive: true });
  await writeFile(join(propertyDirectory, 'index.html'), detailPage(property), 'utf8');
}
const sitemapEntries = [{ path: '/', updatedAt: catalogExport.generatedAt }, { path: '/propiedades/', updatedAt: catalogExport.generatedAt }, ...properties.map((property) => ({ path: `/propiedades/${property.slug}/`, updatedAt: property.updatedAt }))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.map((entry) => `  <url><loc>${siteUrl}${entry.path}</loc><lastmod>${entry.updatedAt.slice(0, 10)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(outputDirectory, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(join(outputDirectory, 'catalog-snapshot.json'), JSON.stringify({ snapshotVersion: catalogExport.snapshotVersion, generatedAt: catalogExport.generatedAt, count: properties.length, source: relative(outputDirectory, fixturePath) }, null, 2), 'utf8');
console.log(`Catalog generated from validated CatalogExport snapshot ${catalogExport.snapshotVersion}: ${properties.length} properties`);
