import { expect, test } from '@playwright/test';

const marketingBasePath = process.env.GITHUB_ACTIONS ? '/dappbaloinmobiliaria' : '';

test('el flujo público exige consentimiento y comunica respaldo manual', async ({ page }) => {
  await page.goto(`${marketingBasePath}/`);
  await expect(page.getByRole('heading', { name: /tu propiedad/i })).toBeVisible();
  await page.getByLabel('Nombre').fill('Propietaria ficticia');
  await page.getByLabel('Teléfono').fill('+51 999 111 222');
  await page.getByLabel('¿Qué necesitas?').selectOption('sell');
  await page.getByLabel('Distrito o zona').fill('Miraflores');
  await expect(page.getByRole('button', { name: /solicitar una conversación/i })).toBeEnabled();
  await expect(page.getByText(/marca la autorización/i)).toBeVisible();
  await page.getByLabel(/autorizo a balo/i).check();
  await page.getByRole('button', { name: /solicitar una conversación/i }).click();
  await expect(page.getByText(/no pudimos registrar tu solicitud/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /continúa por whatsapp/i })).toHaveAttribute('href', /wa\.me\/51936242247/);
});

test('el catálogo estático expone una ficha indexable y una CTA trazable', async ({ page }) => {
  await page.goto(`${marketingBasePath}/propiedades/`);
  await expect(page.getByRole('heading', { name: /propiedades con contexto/i })).toBeVisible();
  await page.getByRole('link', { name: /ver ficha de casa arce/i }).click();
  await expect(page).toHaveTitle(/Casa Arce/i);
  await expect(page.getByRole('heading', { name: /casa arce/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /consultar por whatsapp/i })).toHaveAttribute('href', /property_id%3Dprop-demo-001/);
});
