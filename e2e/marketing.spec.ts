import { expect, test } from '@playwright/test';

test('el flujo público exige consentimiento y comunica respaldo manual', async ({ page }) => {
  await page.goto('/');
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
