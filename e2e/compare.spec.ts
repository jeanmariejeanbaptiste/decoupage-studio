import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Projet de démonstration avec une V2 importée (une séquence ajoutée, une réplique et un en-tête retouchés). */
async function withV2(page: Page, from = '/#/scenario?seed=fiction') {
  await page.goto(from);
  await expect(page.getByTestId('script-editor')).toBeVisible();
  page.on('filechooser', (fc) => fc.setFiles('e2e/fixtures-v2.fountain'));
  await page.getByTestId('version-import').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Créer la V2' }).click();
  await expect(page.getByTestId('version-switcher')).toHaveText('V2');
}

test('comparer les versions : texte entier marqué, résumé, seulement les changements, J / K, ouvrir dans l’éditeur', async ({ page }) => {
  await withV2(page);
  // Le menu ne montre plus de différences en abrégé : une seule entrée mène à la comparaison.
  await page.getByTestId('version-switcher').click();
  await expect(page.getByTestId('version-item').filter({ hasText: 'V1' })).not.toContainText('modif');
  await page.getByTestId('version-compare').click();
  await expect(page).toHaveURL(/#\/scenario\?compare=[\w-]+~[\w-]+$/);
  await expect(page.getByTestId('compare-a').locator('option:checked')).toHaveText('V2');
  await expect(page.getByTestId('compare-b').locator('option:checked')).toHaveText('V1');
  const summary = page.getByTestId('compare-summary');
  await expect(summary).toContainText('1 ajoutée · 1 modifiée');
  await expect(summary).toContainText('1 → 1');
  const sheet = page.getByTestId('compare-sheet');
  // Séquence ajoutée : ses blocs marqués ; mots changés : soulignés ou barrés.
  const train = page.getByTestId('compare-scene').filter({ hasText: 'TRAIN' });
  await expect(train).toHaveAttribute('data-status', 'added');
  await expect(train.locator('[data-op="add"]')).toHaveCount(2);
  await expect(sheet.locator('ins').filter({ hasText: 'longtemps' })).toHaveCount(1);
  await expect(sheet.locator('del').filter({ hasText: 'combien' })).toHaveCount(1);
  await expect(sheet.locator('ins').filter({ hasText: 'AUTOMATIQUE' })).toHaveCount(1);
  // Aucune couleur : marques en noir, gris (ceux de la charte) et blanc seulement.
  const colors = await sheet.evaluate((root) => {
    const out = new Set<string>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      const cs = getComputedStyle(el);
      for (const c of [cs.color, cs.backgroundColor, cs.textDecorationColor]) out.add(c);
    }
    return [...out];
  });
  for (const c of colors) {
    const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    expect(Math.max(r, g, b) - Math.min(r, g, b), c).toBeLessThanOrEqual(16);
  }
  // Seulement les changements : les séquences identiques repliées, une ligne chacune ici.
  await page.getByTestId('compare-only').click();
  await expect(page.getByTestId('compare-fold')).toHaveText(['Séquence 1 : identique', 'Séquence 4 : identique']);
  await expect(page.getByTestId('compare-scene')).toHaveCount(2);
  // Le choix reste d'une visite à l'autre ; une ligne repliée se rouvre au clic.
  await page.getByTestId('compare-fold').first().click();
  await expect(page.getByTestId('compare-scene')).toHaveCount(3);
  // Changement suivant / précédent, au clavier et aux boutons (position stable).
  const next = page.getByTestId('compare-next');
  const x0 = (await next.boundingBox())!.x;
  await page.keyboard.press('j');
  await expect(sheet.locator('[data-current]')).toContainText('TRAIN');
  await page.keyboard.press('j');
  await expect(sheet.locator('[data-current]')).toContainText('AUTOMATIQUE');
  await page.getByTestId('compare-prev').click();
  await expect(sheet.locator('[data-current]')).toContainText('TRAIN');
  expect((await next.boundingBox())!.x).toBe(x0);
  // Un clic sur une séquence de la version courante l'ouvre dans l'éditeur.
  await sheet.getByRole('button', { name: /CONSIGNE AUTOMATIQUE/ }).click();
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await expect(page).toHaveURL(/#\/scenario\?view=script$/);
  await expect(page.getByTestId('scenario-outline').locator('[aria-current]')).toContainText('CONSIGNE AUTOMATIQUE');
});

test('comparer : changer de versions, retour à la page d’origine, export PDF, rien n’est modifié', async ({ page }) => {
  await withV2(page);
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { __ds: { doc: () => unknown } }).__ds.doc()));
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-compare').click();
  await expect(page.getByTestId('compare-page')).toBeVisible();
  // V1 avec V2 : la séquence du train est retirée ; choisir la même version des deux côtés échange les listes.
  await page.getByTestId('compare-a').selectOption({ label: 'V1' });
  await expect(page.getByTestId('compare-a').locator('option:checked')).toHaveText('V1');
  await expect(page.getByTestId('compare-b').locator('option:checked')).toHaveText('V2');
  await expect(page.getByTestId('compare-summary')).toContainText('1 retirée');
  await expect(page.getByTestId('compare-scene').filter({ hasText: 'TRAIN' })).toHaveAttribute('data-status', 'removed');
  // V1 n'est pas la version courante : ses séquences ne s'ouvrent pas dans l'éditeur.
  await expect(page.getByTestId('compare-sheet').getByRole('button', { name: /CONSIGNE/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByTestId('compare-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/V1-V2\.pdf$/);
  const pdf = readFileSync(await file.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(2000);
  // Flèche de retour : la page d'où l'on venait, sans laisser la comparaison dans l'historique.
  await page.getByTestId('compare-back').click();
  await expect(page).toHaveURL(/#\/grid/);
  await page.goBack();
  await expect(page.getByTestId('compare-page')).toHaveCount(0);
  // Après un rechargement, la flèche ramène encore à la page d'origine.
  await page.goto('/#/grid');
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-compare').click();
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await page.getByTestId('compare-back').click();
  await expect(page).toHaveURL(/#\/grid/);
  const after = await page.evaluate(() => JSON.stringify((window as unknown as { __ds: { doc: () => unknown } }).__ds.doc()));
  expect(after).toBe(before);
});

test('comparer : une seule version, pas d’entrée ; adresse inconnue, la paire par défaut', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await page.getByTestId('version-switcher').click();
  await expect(page.getByTestId('version-compare')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-new').click();
  await page.evaluate(() => void (window.location.hash = '#/scenario?compare=x~y'));
  await expect(page.getByTestId('compare-a').locator('option:checked')).toHaveText('V2');
  await expect(page.getByTestId('compare-summary')).toContainText('aucun changement');
  await expect(page.getByTestId('compare-next')).toBeDisabled();
});

/** Long scénario : `n` séquences d'environ une demi-page à une page. */
function longScript(n: number, twist = (_k: number, s: string) => s): string {
  const lieux = ['GARE', 'QUAI', 'TRAIN', 'BUREAU', 'PARVIS', 'CAFÉ', 'HÔTEL', 'RUE'];
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const body = [
      `INT. ${lieux[k % lieux.length]} ${k} - ${k % 2 ? 'NUIT' : 'JOUR'}`,
      'Léa marche le long du quai, regarde les trains partir un à un et compte les wagons. '.repeat(3).trim(),
      'MARC',
      `Il faut qu'on parle de la valise numéro ${k}, celle de la consigne automatique.`,
      'LÉA',
      'Elle est en sécurité pour l’instant, je te le promets. '.repeat(2).trim(),
      'Un temps. La pluie redouble sur la verrière, les annonces se succèdent sans relâche. '.repeat(4).trim(),
    ].join('\n\n');
    out.push(twist(k, body));
  }
  return out.join('\n\n') + '\n';
}

test('comparer : un scénario de plus de 120 pages s’affiche vite et se parcourt au clavier', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/#/scenario?seed=fiction');
  await expect(page.getByTestId('script-editor')).toBeVisible();
  let file = { name: 'long.fountain', mimeType: 'text/plain', buffer: Buffer.from(longScript(280)) };
  page.on('filechooser', (fc) => fc.setFiles(file));
  await page.getByTestId('version-import').click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Remplacer/ }).click();
  await expect(page.getByTestId('scenario-outline').locator('li')).toHaveCount(280, { timeout: 30_000 });
  const v2 = longScript(280, (k, s) => (k % 9 === 0 ? s.replace('regarde les trains', 'observe les trains') : s));
  file = { name: 'long-v2.fountain', mimeType: 'text/plain', buffer: Buffer.from(v2) };
  await page.getByTestId('version-import').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Créer la V2' }).click();
  await expect(page.getByTestId('version-switcher')).toHaveText('V2', { timeout: 30_000 });
  await page.getByTestId('version-switcher').click();
  const t0 = Date.now();
  await page.getByTestId('version-compare').click();
  await expect(page.getByTestId('compare-scene')).toHaveCount(280);
  const ms = Date.now() - t0;
  const pagesText = await page.getByTestId('compare-summary').locator('div').filter({ hasText: 'Pages' }).locator('dd').textContent();
  expect(Number(pagesText!.split('→')[0])).toBeGreaterThanOrEqual(120);
  expect(ms).toBeLessThan(4000);
  await expect(page.getByTestId('compare-summary')).toContainText('32 modifiées');
  // Seulement les changements, puis le dernier changement atteint au clavier.
  await page.getByTestId('compare-only').click();
  await expect(page.getByTestId('compare-scene')).toHaveCount(32);
  for (let k = 0; k < 32; k++) await page.keyboard.press('j');
  const last = page.getByTestId('compare-sheet').locator('[data-current]');
  await expect(last).toContainText('observe');
  await expect(last).toBeInViewport();
  await expect(page.getByTestId('compare-scene').last()).toContainText('INT. RUE 279');
});
