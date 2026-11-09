import { expect, test, type Page } from '@playwright/test';

async function setBackground(page: Page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeRect(40, 40, 320, 220);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('fp-bg-input').setInputFiles({ name: 'locaux.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByTestId('fp-background')).toHaveCount(1);
}

test('plan au sol : le réglage du fond s’arrête en changeant de vue ou en retirant l’image', async ({ page }) => {
  await page.goto('/#/floorplan?seed=rav3');
  await setBackground(page);
  await page.getByTestId('fp-plan-menu').click();
  await page.getByTestId('fp-bg-edit').click();
  const done = page.getByRole('button', { name: 'Terminer' });
  await expect(done).toBeVisible();
  // Nouvelle vue : le réglage appartient à la vue quittée.
  await page.getByTestId('add-plan').click();
  await expect(done).toHaveCount(0);
  const canvas = page.getByTestId('floorplan');
  const box = (await canvas.boundingBox())!;
  await page.getByTestId('tool-camera').click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.getByTestId('tool-select').click();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await expect(page.getByTestId('fp-properties')).toHaveCount(0);
  const cam = (await page.getByTestId('fp-camera-body').boundingBox())!;
  await page.mouse.click(cam.x + cam.width / 2, cam.y + cam.height / 2);
  await expect(page.getByTestId('fp-properties')).toContainText('Caméra');
  // Retour à la vue au fond, réglage, puis « Retirer » : plus rien ne reste bloqué.
  await page.getByRole('tab', { name: 'Vue 1' }).click();
  await page.getByTestId('fp-plan-menu').click();
  await page.getByTestId('fp-bg-edit').click();
  await expect(done).toBeVisible();
  await page.getByTestId('fp-plan-menu').click();
  await page.getByRole('dialog', { name: 'Plan des locaux' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByTestId('fp-background')).toHaveCount(0);
  await expect(done).toHaveCount(0);
});

test('plan au sol : la pièce et le projecteur suivent l’annulation ; un passage dans un champ ne change rien', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  const panel = page.getByTestId('fp-panel');
  await panel.getByRole('button', { name: 'Petite pièce' }).click();
  await expect(page.getByTestId('fp-room-size')).toContainText('Superficie 30 m²');
  // Entrer puis sortir d'un champ sans rien taper : aucune étape d'annulation.
  await page.getByLabel('Largeur de la pièce (m)').focus();
  await page.getByLabel('Longueur de la pièce (m)').focus();
  await page.getByTestId('floorplan').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fp-wall')).toHaveCount(0);
  await expect(page.getByTestId('fp-room-size')).toHaveCount(0);
  await expect(page.getByLabel('Largeur de la pièce (m)')).toHaveValue('');
  // Projecteur : la température annulée quitte aussi le champ.
  await page.getByTestId('tool-light').click();
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('fp-properties').getByRole('button', { name: '3 200 K' }).click();
  await expect(page.getByTestId('fp-kelvin')).toHaveValue('3200');
  await page.getByTestId('floorplan').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fp-kelvin')).toHaveValue('');
});
