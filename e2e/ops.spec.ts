import { expect, test } from '@playwright/test';

test.describe('portal de operación en modo demostración', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://127.0.0.1:4174');
  });

  test('restringe al gestor a los expedientes asignados y no muestra controles de decisión', async ({ page }) => {
    await page.getByLabel('Perfil de demostración').selectOption('ana');

    await expect(page.getByRole('heading', { name: /buenos días, ana/i })).toBeVisible();
    const visibleCases = page.locator('#casos .lead-card');
    await expect(visibleCases).toHaveCount(1);
    await expect(visibleCases.first()).toContainText('Propietaria demo · Miraflores');
    await expect(page.getByRole('button', { name: 'Aprobar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /solicitar aprobación/i })).toBeVisible();

    const visibleProperties = page.locator('#propiedades .property-card');
    await expect(visibleProperties).toHaveCount(1);
    await expect(visibleProperties.first()).toContainText('JM 112');
    await expect(page.getByText('Los gestores no pueden reasignar propiedades.')).toBeVisible();
    await expect(page.getByLabel('Precio en la web').locator('option[value="public"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('#propiedades').getByRole('button', { name: 'Publicar', exact: true })).toHaveCount(0);
  });

  test('permite a Orlando asignar y resolver una decisión con motivo', async ({ page }) => {
    await page.getByRole('button', { name: /propietario demo · san isidro/i }).click();
    await page.locator('#casos').getByLabel('Responsable').selectOption('luis');
    await page.getByRole('button', { name: /asignar caso/i }).click();
    await expect(page.getByRole('status')).toContainText('Asignación actualizada');

    await page.getByPlaceholder(/deja el criterio/i).first().fill('Materiales revisados y canal validado.');
    await page.getByRole('button', { name: 'Aprobar', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText('Decisión aprobada');
  });

  test('prepara fotografías localmente y mantiene la publicación honesta hasta la confirmación', async ({ page }) => {
    await page.locator('#propiedades .property-card').first().click();
    await page.getByLabel('Dirección exacta · privada').fill('Dirección privada de prueba 123');
    await page.locator('#propiedades').getByRole('button', { name: /guardar y continuar/i }).click();
    await expect(page.locator('#propiedades').getByRole('status')).toContainText('Borrador guardado');

    const imageDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      context.fillStyle = '#d8c59b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#243f45';
      context.fillRect(80, 80, 480, 320);
      return canvas.toDataURL('image/png');
    });
    await page.getByLabel('Elegir fotografías').setInputFiles({
      name: 'ambiente-ficticio.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageDataUrl.split(',')[1] ?? '', 'base64'),
    });

    await expect(page.locator('#propiedades').getByRole('status')).toContainText('WebP sin metadatos');
    await page.getByLabel('Descripción accesible').fill('Sala ficticia iluminada para prueba de la ficha');
    await page.getByLabel('Categoría').selectOption('living');
    await page.getByLabel(/confirmo que balo tiene autorización/i).check();
    await page.getByRole('button', { name: /guardar galería/i }).click();
    await expect(page.locator('#propiedades').getByRole('status')).toContainText('Galería guardada');
    await expect(page.locator('.image-thumb')).toContainText('Guardada');

    await page.getByRole('button', { name: 'Revisar ficha' }).click();
    await expect(page.locator('.public-preview')).not.toContainText('Dirección privada de prueba 123');
    await expect(page.locator('.public-preview')).toContainText('Precio a consultar');
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('#propiedades').getByRole('status')).toContainText('aún no está publicada');
    await page.getByRole('button', { name: 'Aprobar publicación' }).click();
    await expect(page.locator('.publication-readiness')).toContainText('Fotografías aprobadas por Orlando');

    await page.locator('#propiedades .availability-form').getByLabel('Motivo', { exact: true }).fill('Disponibilidad confirmada con Orlando hoy.');
    await page.getByRole('button', { name: 'Actualizar estado' }).click();
    await expect(page.locator('.freshness-note')).toContainText('Disponibilidad validada');
    await page.locator('#propiedades').getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.locator('#propiedades .property-message[role="status"]')).toContainText('No se desplegó nada en Internet');
    await expect(page.locator('.publishing-note')).toContainText('aún no se considera publicada');
  });
});
