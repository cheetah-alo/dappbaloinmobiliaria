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
  });

  test('permite a Orlando asignar y resolver una decisión con motivo', async ({ page }) => {
    await page.getByRole('button', { name: /propietario demo · san isidro/i }).click();
    await page.getByLabel('Responsable').selectOption('luis');
    await page.getByRole('button', { name: /asignar caso/i }).click();
    await expect(page.getByRole('status')).toContainText('Asignación actualizada');

    await page.getByPlaceholder(/deja el criterio/i).first().fill('Materiales revisados y canal validado.');
    await page.getByRole('button', { name: 'Aprobar', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText('Decisión aprobada');
  });
});
