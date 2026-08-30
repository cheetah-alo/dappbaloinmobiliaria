export const MAX_PROPERTY_IMAGES = 30;
export const MAX_PROPERTY_IMAGE_BYTES = 12 * 1024 * 1024;
export const ACCEPTED_PROPERTY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ProcessedPropertyImage = {
  main: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  previewUrl: string;
};

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('El navegador no pudo convertir la fotografía a WebP.'));
    }, 'image/webp', quality);
  });
}

function targetDimensions(width: number, height: number, maximum: number): { width: number; height: number } {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No pudimos leer esta fotografía. Comprueba que el archivo no esté dañado.');
  }
}

async function renderWebp(bitmap: ImageBitmap, maximum: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const dimensions = targetDimensions(bitmap.width, bitmap.height, maximum);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no pudo preparar la fotografía.');
  context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
  return { blob: await canvasBlob(canvas, quality), ...dimensions };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function processPropertyImage(file: File): Promise<ProcessedPropertyImage> {
  if (!ACCEPTED_PROPERTY_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_PROPERTY_IMAGE_TYPES)[number])) {
    throw new Error('Usa fotografías JPEG, PNG o WebP.');
  }
  if (file.size > MAX_PROPERTY_IMAGE_BYTES) {
    throw new Error('Cada fotografía debe pesar 12 MB o menos.');
  }

  const bitmap = await loadBitmap(file);
  try {
    if (bitmap.width < 320 || bitmap.height < 240) {
      throw new Error('La fotografía debe medir al menos 320 × 240 píxeles.');
    }
    const main = await renderWebp(bitmap, 2_400, 0.86);
    const thumbnail = await renderWebp(bitmap, 800, 0.8);
    return {
      main: main.blob,
      thumbnail: thumbnail.blob,
      width: main.width,
      height: main.height,
      sizeBytes: main.blob.size,
      sha256: await sha256(main.blob),
      previewUrl: URL.createObjectURL(main.blob),
    };
  } finally {
    bitmap.close();
  }
}
