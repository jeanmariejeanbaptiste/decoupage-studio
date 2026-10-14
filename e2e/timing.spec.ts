import { expect, test } from '@playwright/test';

function wav(seconds: number, rate = 8000): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 12000 * (i / n)), 44 + i * 2);
  return buf;
}

test('réglages : coefficients et aperçu', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction');
  const preview = page.getByTestId('timing-preview');
  await expect(preview).toContainText('ce texte de 11 mots = 0:06');
  await page.getByLabel('Action (mots / s)').fill('1');
  await expect(preview).toContainText('ce texte de 11 mots = 0:11');
});

test('override manuel ✎ puis retour au calcul automatique', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const tc = page.locator('[data-cell="0:tc"]');
  const auto = await tc.textContent();
  await tc.click();
  await page.keyboard.type('2:00');
  await page.keyboard.press('Enter');
  await expect(tc).toContainText('0:00 - 2:00✎');
  await tc.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Revenir au calcul automatique' }).click();
  await expect(tc).toHaveText(auto ?? '');
});

test('mode piste : caler une action par glisser sur la piste', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.getByTestId('track-bar')).toContainText('3:01');
  await expect(page.getByTestId('grid-footer')).toContainText('couverture 100 %');
  await page.locator('[data-cell="3:subject"]').click();
  const area = page.getByTestId('waveform');
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-cell="3:tc"]')).toHaveText('0:18 - 0:36');
});

test('mode piste : import audio, forme d’onde et extrait', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importer la piste' }).click();
  await (await chooser).setFiles({ name: 'maquette.wav', mimeType: 'audio/wav', buffer: wav(4) });
  await expect(page.getByTestId('toast')).toContainText('maquette.wav');
  await expect(page.getByTestId('track-bar')).toContainText('0:04');
  await page.locator('[data-cell="0:subject"]').click();
  await expect(page.getByRole('button', { name: 'Extrait' })).toBeEnabled();
});
