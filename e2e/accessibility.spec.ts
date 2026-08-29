import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoWcagAorAaViolations(page: import('@playwright/test').Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
}

test('la web pública cumple los controles WCAG A/AA automatizados', async ({ page }) => {
  await page.goto('/');
  await expectNoWcagAorAaViolations(page);
});

test('el portal operativo cumple los controles WCAG A/AA automatizados', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174');
  await expectNoWcagAorAaViolations(page);
});
