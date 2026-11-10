import { expect, test, type Page } from '@playwright/test';

const rows = (page: Page) => page.getByTestId('outline-row');

/** Lieux des séquences du découpage technique, dans son ordre (et la séquence rapprochée du texte). */
const cutOrder = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { project: { sequenceIds: string[] }; sequences: Record<string, { label: string; decorId?: string }>; decors: Record<string, { name: string }> } } }).__ds.doc();
    return d.project.sequenceIds.map((id) => {
      const s = d.sequences[id];
      return (s.decorId ? d.decors[s.decorId]?.name : '') || s.label;
    });
  });
const scenario = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario?: string } } }).__ds.doc().scenario ?? '');

test('séquencier : trois séquences saisies deviennent trois en-têtes du texte, phrases hors de la feuille', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Tissage');
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(/#\/grid/);
  await page.evaluate(() => void (location.hash = '#/scenario?view=outline'));
  // Séquencier vide : pas de barre d'ajout, un seul « + Séquence » qui ouvre la saisie.
  await expect(page.getByTestId('outline-quick-add')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await page.getByTestId('outline-add-first').click();
  await expect(page.getByTestId('quick-location')).toBeFocused();

  const add = async (loc: string, effect: string, phrase: string) => {
    await page.getByTestId('quick-location').fill(loc);
    await page.getByTestId('quick-effect').fill(effect);
    await page.getByTestId('quick-phrase').fill(phrase);
    await page.getByTestId('quick-phrase').press('Enter');
  };
  await add('gare', 'jour', 'Léa arrive en gare.');
  // Saisie en rafale : le lieu reprend le focus, la phrase est vidée, le moment gardé.
  await expect(page.getByTestId('quick-location')).toBeFocused();
  await expect(page.getByTestId('quick-phrase')).toHaveValue('');
  await expect(page.getByTestId('quick-effect')).toHaveValue('jour');
  // Lieu vide : rien n'est ajouté.
  await page.getByTestId('quick-location').fill('');
  await page.getByTestId('quick-location').press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await add('quai', 'nuit', 'Un homme attend sous l’horloge.');
  await add('café', 'soir', 'Marc rend la clé.');
  await expect(rows(page)).toHaveCount(3);
  // Échap referme la saisie : plus de barre au-dessus de la liste.
  await page.getByTestId('quick-location').press('Escape');
  await expect(page.getByTestId('outline-quick-add')).toHaveCount(0);
  await expect(page.getByTestId('outline-add-first')).toHaveCount(0);
  await expect(rows(page).nth(1)).toContainText('INT. QUAI - NUIT');
  await expect(rows(page).nth(1)).toContainText('Un homme attend sous l’horloge.');

  // La phrase s'édite sur place ; Entrée valide et passe à la suivante.
  await rows(page).nth(0).getByTestId('outline-phrase').click();
  await page.getByTestId('outline-phrase-input').fill('Léa arrive en gare, une valise à la main.');
  await page.getByTestId('outline-phrase-input').press('Enter');
  await expect(rows(page).nth(1).getByTestId('outline-phrase-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(rows(page).nth(0)).toContainText('une valise à la main');

  const src = await scenario(page);
  expect(src).toContain('INT. GARE - JOUR\n\n= Léa arrive en gare, une valise à la main.');
  expect(src).toContain('INT. CAFÉ - SOIR\n\n= Marc rend la clé.');

  // Texte : trois en-têtes, aucune phrase sur la feuille.
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Continuité dialoguée' }).click();
  const editor = page.getByTestId('script-editor');
  await expect(editor).toContainText('INT. GARE - JOUR');
  await expect(editor).toContainText('INT. QUAI - NUIT');
  await expect(editor).toContainText('INT. CAFÉ - SOIR');
  // Les phrases ne comptent pas : une page, comme sans elles.
  await expect(page.getByTestId('scenario-status')).toContainText('3 séquences · 1 page');
  // Les phrases ne sont pas sur la feuille : au plus des résumés « = », jamais imprimés.
  const printed = await editor.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-bid]'))
      .filter((b) => /Marc rend la clé|une valise à la main|horloge/.test(b.textContent ?? ''))
      .filter((b) => b.dataset.type !== 'synopsis' && b.offsetParent !== null).length,
  );
  expect(printed).toBe(0);
});

test('séquencier : ⌥↓ réordonne le texte, les numéros et le découpage ; ⌘Z rétablit', async ({ page }) => {
  await page.goto('/#/scenario?view=outline&seed=fiction');
  await expect(rows(page)).toHaveCount(3);
  const before = await cutOrder(page);
  const src0 = await scenario(page);
  await expect(rows(page).nth(0)).toContainText('GARE — HALL');

  await rows(page).nth(0).click({ position: { x: 600, y: 6 } });
  await expect(rows(page).nth(0)).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(rows(page).nth(0)).toContainText('GARE — CONSIGNE');
  await expect(rows(page).nth(1)).toContainText('GARE — HALL');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  const src1 = await scenario(page);
  expect(src1.indexOf('INT. GARE — CONSIGNE')).toBeLessThan(src1.indexOf('INT. GARE — HALL'));
  const after = await cutOrder(page);
  expect(after).not.toEqual(before);
  expect(after.indexOf(before[0])).toBe(1);

  // ↑ / ↓ passent d'une ligne à l'autre ; ⌘Z (hors champ) annule tout d'un coup.
  await page.keyboard.press('ArrowUp');
  await expect(rows(page).nth(0)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows(page).nth(0)).toContainText('GARE — HALL');
  expect(await scenario(page)).toBe(src0);
  expect(await cutOrder(page)).toEqual(before);

  // Le texte suit l'ordre : la séquence 1 du Texte est bien la première.
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Continuité dialoguée' }).click();
  await expect(page.getByTestId('script-editor').locator('[data-type="heading"]').first()).toContainText('GARE — CONSIGNE');
});
