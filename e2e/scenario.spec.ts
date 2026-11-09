import { expect, test, type Page } from '@playwright/test';

/** Sélectionne un passage dans l'éditeur (blocs séparés par un retour à la ligne). */
async function selectText(page: Page, needle: string) {
  await page.getByTestId('script-editor').evaluate((root, n) => {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-bid]')).filter((b) => b.dataset.type !== 'title');
    let full = '';
    const starts: number[] = [];
    for (const b of blocks) {
      starts.push(full.length);
      full += (b.textContent ?? '') + '\n';
    }
    const i = full.indexOf(n);
    if (i < 0) throw new Error(`introuvable : ${n}`);
    const at = (pos: number): [Node, number] => {
      let k = blocks.length - 1;
      while (k > 0 && starts[k] > pos) k--;
      const off = pos - starts[k];
      const w = document.createTreeWalker(blocks[k], NodeFilter.SHOW_TEXT);
      let acc = 0;
      let node: Node | null;
      while ((node = w.nextNode())) {
        const len = node.nodeValue?.length ?? 0;
        if (off <= acc + len) return [node, off - acc];
        acc += len;
      }
      return [blocks[k], blocks[k].childNodes.length];
    };
    const [sn, so] = at(i);
    const [en, eo] = at(i + n.length);
    (root as HTMLElement).focus();
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }, needle);
  await expect(page.getByTestId('create-shot-from-selection')).toBeEnabled();
}

test.describe('scénario et liaison', () => {
  test('clic droit → créer un plan avec cette action, ou la commenter', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    // L'onglet Plans ne sert qu'en vue Découpage (ailleurs, il garde sa place sans se montrer).
    await expect(page.getByTestId('scenario-tab-shots')).toBeHidden();
    const count = () => page.evaluate(() => Object.values((window as unknown as { __ds: { doc: () => { shots: Record<string, { subject: string }> } } }).__ds.doc().shots).length);
    const before = await count();
    await selectText(page, 'Marc attend sous la pluie');
    await page.getByTestId('script-editor').dispatchEvent('contextmenu', { clientX: 500, clientY: 400, button: 2 });
    await page.getByRole('menuitem', { name: 'Créer un plan' }).click();
    // Mode lié (par défaut) : le plan va directement dans la séquence de la scène.
    await expect.poll(count).toBe(before + 1);
    await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Découpage' }).click();
    await page.getByTestId('scenario-tab-shots').click();
    await expect(page.getByTestId('scenario-shot').filter({ hasText: 'Marc attend sous la pluie' }).first()).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Scénario' }).click();
    // Même geste : commenter le passage (l'auteur aussi).
    await selectText(page, 'Marc attend sous la pluie');
    await page.getByTestId('script-editor').dispatchEvent('contextmenu', { clientX: 500, clientY: 400, button: 2 });
    await page.getByRole('menuitem', { name: 'Commenter' }).click();
    await page.getByTestId('comment-text').fill('Plus de pluie.');
    await page.getByTestId('comment-send').click();
    await expect(page.getByTestId('comment-popover').getByTestId('comment')).toContainText('Plus de pluie.');
  });

  test('les répliques sélectionnées vont dans le dialogue', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Découpage' }).click();
    await page.getByTestId('scenario-tab-shots').click();
    // Mode libre : la séquence se choisit, celle de la scène est suggérée en premier.
    await page.getByTestId('scenario-link-mode').uncheck();
    await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Scénario' }).click();
    await selectText(page, "GUICHETIER\nC'est pour combien de temps ?");
    await page.getByTestId('create-shot-from-selection').click();
    await expect(page.getByRole('menuitem').first()).toContainText('(suggérée)');
    await page.getByRole('menuitem').first().click();
    const doc = await page.evaluate(() => (window as unknown as { __ds: { doc: () => { shots: Record<string, { subject: string; actionBlockId: string }>; blocks: Record<string, { dialogue?: string }> } } }).__ds.doc());
    const shot = Object.values(doc.shots).find((s) => doc.blocks[s.actionBlockId].dialogue === "GUICHETIER : C'est pour combien de temps ?");
    expect(shot?.subject).toBe('Guichetier');
  });

  test('écrire au clavier : en-tête, personnage et réplique reconnus ; le découpage ne bouge que sur demande', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const editor = page.getByTestId('script-editor');
    await editor.locator('[data-bid]').last().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nINT. CAFÉ DE LA GARE - NUIT\n');
    // Personnage : Tab (Entrée sur une ligne en capitales reste un retour à la ligne, sauf nom déjà connu).
    await page.keyboard.press('Tab');
    await page.keyboard.type('NINA\nBonsoir.');
    await expect(editor.locator('[data-type="heading"]').last()).toHaveText('INT. CAFÉ DE LA GARE - NUIT');
    await expect(editor.locator('[data-type="character"]').last()).toHaveText('NINA');
    await expect(editor.locator('[data-type="dialogue"]').last()).toHaveText('Bonsoir.');
    await expect(page.getByTestId('scenario-outline')).toContainText('CAFÉ DE LA GARE');
    await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Découpage' }).click();
    await page.getByTestId('scenario-tab-shots').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario)).toContain('NINA\nBonsoir.');
    await expect(page.locator('aside').getByText('4, CAFÉ DE LA GARE')).toHaveCount(0);
    await page.getByTestId('import-scenes').click();
    await expect(page.locator('aside').getByText('4, CAFÉ DE LA GARE')).toBeVisible();
    await page.getByRole('button', { name: /Découpage technique/ }).click();
    await expect(page.locator('tbody[data-seq]').nth(3)).toContainText('CAFÉ DE LA GARE');
    await page.locator('tbody[data-seq]').nth(3).getByRole('button', { name: 'Ajouter un plan' }).click();
    await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(12);
    await page.goto('/#/registry?tab=characters');
    await expect(page.getByTestId('character-row').filter({ has: page.locator('td:nth-child(2)', { hasText: 'Nina' }) })).toHaveCount(1);
  });

  test('pages A4, page de titre, vue découpage, import et export .fountain', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    // Page de titre mise en forme, modifiable par ses champs.
    await expect(page.getByTestId('title-page')).toContainText('La Consigne');
    await page.getByTestId('title-page').click();
    await page.getByRole('dialog', { name: 'Page de garde' }).getByLabel('Auteur').fill('Nina Roy');
    await page.getByTestId('title-save').click();
    await expect(page.getByTestId('title-page')).toContainText('Nina Roy');
    // Page A4 au gabarit du modèle (une ligne de 12,1 pt = 16 px).
    await expect(page.getByTestId('script-stack')).toHaveCSS('width', /^78\d/);
    await page.getByRole('radio', { name: 'Découpage' }).click();
    await expect(page.getByTestId('scenario-cut')).toContainText('GARE');
    await page.getByRole('radio', { name: 'Scénario' }).click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('tab-export').click();
    await page.getByTestId('tab-export-panel').getByText('Fountain', { exact: true }).click();
    await page.getByTestId('tab-export-go').click();
    expect((await dl).suggestedFilename()).toBe('La Consigne.fountain');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Importer/ }).click();
    await (await chooser).setFiles({ name: 'court.fountain', mimeType: 'text/plain', buffer: Buffer.from('EXT. TOIT - AUBE\n\nLe soleil se lève.\n') });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
    await expect(page.getByTestId('script-editor')).toContainText('Le soleil se lève.');
    await expect(page.getByTestId('title-page')).toHaveCount(0);
  });

  test('Final Draft : import fidèle, puis exports PDF, Word et Final Draft au gabarit du modèle', async ({ page }) => {
    const { readFileSync } = await import('node:fs');
    const { default: JSZip } = await import('jszip');
    const fixture = (n: string) => readFileSync(new URL(`../src/domain/__fixtures__/kit/${n}`, import.meta.url));
    await page.goto('/#/scenario?seed=fiction');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Importer/ }).click();
    await (await chooser).setFiles({ name: 'modele.fdx', mimeType: 'application/xml', buffer: fixture('modele-complet.fdx') });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
    // Les 17 pages du modèle, à l'écran comme à l'export.
    await expect(page.getByText('22 séquences · 17 pages')).toBeVisible();
    // Chronomètre : 1 page ≈ 1 minute ; la dernière page est entamée.
    await expect(page.getByTestId('scenario-chrono')).toContainText('/ 16:');
    await expect(page.getByTestId('script-editor')).toContainText('Sed rhoncus convallis mollis.');
    const exportAs = async (format: string) => {
      const dl = page.waitForEvent('download', { timeout: 30_000 });
      await page.getByTestId('tab-export').click();
      await page.getByTestId('tab-export-panel').getByText(format, { exact: true }).click();
      await page.getByTestId('tab-export-go').click();
      const d = await dl;
      return { name: d.suggestedFilename(), buf: readFileSync(await d.path()) };
    };
    const pdf = await exportAs('PDF');
    expect(pdf.name).toBe('La Consigne.pdf');
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(pdf.buf);
    expect(parsed.getPageCount()).toBe(17);
    expect(parsed.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    const word = await exportAs('Word');
    expect(word.name).toBe('La Consigne.docx');
    const zip = await JSZip.loadAsync(word.buf);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('LOR. LOREM IPSUM DOLOR - ELIT');
    expect(zip.file('word/fonts/font1.odttf')).toBeTruthy();
    const fdx = await exportAs('Final Draft');
    expect(fdx.name).toBe('La Consigne.fdx');
    expect(fdx.buf.toString('utf8')).toContain('<Paragraph Number="1" Type="Scene Heading"><Text>LOR. LOREM IPSUM DOLOR - ELIT</Text></Paragraph>');
  });

  test('l’inspecteur montre le passage lié', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByRole('button', { name: 'Inspecteur' }).click();
    await page.locator('[data-cell="4:subject"]').click();
    await expect(page.getByTestId('inspector-passage')).toContainText('Léa pose la valise sur le comptoir.');
  });
});

test('scénario dans le découpage : un seul panneau à droite, + par phrase et sur sélection', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.getByTestId('toggle-scenario').click();
  const panel = page.getByTestId('scenario-panel');
  await expect(panel).toBeVisible();
  // Un seul panneau : l'inspecteur s'est refermé.
  await expect(page.getByRole('button', { name: 'Inspecteur' })).toHaveAttribute('aria-pressed', 'false');
  // Survol d'une phrase : le « + » apparaît à sa fin et ajoute la phrase au découpage.
  const sentence = panel.getByTestId('script-sentence').first();
  await sentence.hover();
  await sentence.getByTestId('script-plus').click();
  await expect(rows).toHaveCount(n + 1);
  // Sélection libre : un « + » apparaît au-dessus de la fin de la sélection.
  const target = panel.getByTestId('script-sentence').nth(2).locator('span').first();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await panel.getByTestId('script-selection-plus').click();
  await expect(rows).toHaveCount(n + 2);
  // Un clic ailleurs efface la sélection, et le « + » avec elle.
  const box2 = (await panel.getByTestId('script-sentence').nth(4).locator('span').first().boundingBox())!;
  await page.mouse.move(box2.x + 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width - 2, box2.y + box2.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(panel.getByTestId('script-selection-plus')).toBeVisible();
  await page.mouse.click(box2.x + box2.width / 2, box2.y + 160);
  await expect(panel.getByTestId('script-selection-plus')).toHaveCount(0);
});

test('scénario : personnages (présence, fiche, répliques), décors et recherche', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await page.getByTestId('scenario-tab-characters').click();
  const lea = page.getByTestId('character-row').filter({ hasText: 'LÉA' });
  await expect(lea).toContainText('2 répl. · 3 séq. (1 muette) · dès la séq. 1');
  await lea.click();
  await page.getByLabel('Interprète').fill('Alice Martin');
  await page.getByLabel('Costume').click();
  await expect(page.getByTestId('scenario-characters')).toContainText('Je ne sais pas encore');
  // Renommer : partout dans le scénario et le projet.
  await page.getByLabel('Nom', { exact: true }).fill('Flora');
  await page.getByLabel('Costume').click();
  await expect(page.getByTestId('script-editor')).toContainText('FLORA');
  await expect(page.getByTestId('script-editor')).not.toContainText('LÉA');
  await page.getByTestId('scenario-tab-decors').click();
  await expect(page.getByTestId('decor-row').first()).toContainText('GARE — HALL');
  await page.getByTestId('decor-row').first().click();
  await page.getByLabel('Nom du décor').fill('Gare du Nord — Hall');
  await page.getByLabel('Adresse de tournage').click();
  await expect(page.getByTestId('script-editor')).toContainText('INT. GARE DU NORD — HALL');
  // Statistiques : une vue à part entière, le panneau latéral s'efface.
  const views = page.getByRole('radiogroup', { name: 'Affichage du scénario' });
  await views.getByRole('radio', { name: 'Statistiques' }).click();
  const reports = page.getByTestId('script-reports');
  await expect(page.getByLabel('Navigation du scénario')).toHaveCount(0);
  await page.getByTestId('report-summary').click();
  await expect(reports).toContainText('Signes avec / sans espaces');
  await expect(reports).toContainText('Personnages qui parlent');
  await page.getByTestId('report-characters').click();
  await expect(reports).toContainText('Séq. muettes');
  await page.getByTestId('report-structure').click();
  await expect(reports.getByRole('img', { name: 'Structure de l’histoire' })).toBeVisible();
  // Une séquence du rapport rouvre le texte à sa place.
  await page.getByTestId('report-scenes').click();
  await reports.getByRole('button', { name: /GARE DU NORD — HALL/ }).first().click();
  await expect(views.getByRole('radio', { name: 'Scénario' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await page.getByTestId('scenario-tab-research').click();
  await page.getByLabel('Logline').fill('Une valise, une décision.');
  await page.getByTestId('research-add-doc').click();
  await page.goto('/#/registry?tab=characters');
  await expect(page.getByText('Alice Martin')).toBeVisible();
  // Panneau latéral masqué (bouton ou ⌘\), et retenu au rechargement.
  await page.goto('/#/scenario');
  await page.getByTestId('scenario-side-toggle').click();
  await expect(page.getByLabel('Navigation du scénario')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await expect(page.getByLabel('Navigation du scénario')).toHaveCount(0);
  await page.keyboard.press('Control+Backslash');
  await expect(page.getByLabel('Navigation du scénario')).toBeVisible();
});

test('scénario : aucune ligne ne sort de sa feuille (sauts de page, blocs variés, page réduite)', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Pages');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('create-first')).toBeVisible();
  await page.getByRole('button', { name: 'Écrire ou importer un scénario' }).click();
  await expect(page.getByTestId('script-editor')).toBeVisible();
  page.on('filechooser', (fc) => fc.setFiles('e2e/fixtures-pages.fountain'));
  await page.getByRole('button', { name: 'Importer', exact: true }).first().click();
  await expect(page.getByText(/Scénario importé/)).toBeVisible();
  await page.waitForTimeout(800);
  const bad = await page.evaluate(() => {
    const stack = document.querySelector<HTMLElement>('[data-testid="script-stack"]')!;
    const editor = document.querySelector<HTMLElement>('[data-testid="script-editor"]')!;
    const sr = stack.getBoundingClientRect();
    const k = sr.width / stack.offsetWidth;
    const sheets = Array.from(stack.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')).map((d) => ({ top: d.offsetTop, bottom: d.offsetTop + d.offsetHeight }));
    const cs = getComputedStyle(editor);
    const top = parseFloat(cs.paddingTop);
    const bottom = parseFloat(cs.paddingBottom);
    let n = 0;
    for (const b of Array.from(editor.querySelectorAll<HTMLElement>('[data-bid]'))) {
      if (b.dataset.type === 'title') continue;
      const range = document.createRange();
      range.selectNodeContents(b);
      for (const r of Array.from(range.getClientRects())) {
        if (r.height < 1) continue;
        const cy = (r.top + r.height / 2 - sr.top) / k;
        const s = sheets.find((x) => cy >= x.top && cy <= x.bottom);
        if (!s || cy < s.top + top || cy > s.bottom - bottom) n++;
      }
    }
    return n;
  });
  expect(bad).toBe(0);
});

test('scénario : gras, italique, souligné (boutons et raccourcis), affichés en place, gardés en Fountain', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const ed = page.getByTestId('script-editor');
  const word = ed.getByText('valise', { exact: false }).first();
  await word.dblclick();
  await page.getByTestId('emphasis-b').click();
  await expect(ed.locator('span[style*="font-weight: 700"]').first()).toBeVisible();
  // Les marques ne prennent pas de place à l'écran.
  const mk = ed.locator('span').filter({ hasText: /^\*\*$/ }).first();
  expect((await mk.boundingBox())?.width ?? 0).toBeLessThan(1);
  await ed.getByText('hall', { exact: false }).first().dblclick();
  await page.keyboard.press('ControlOrMeta+i');
  await expect(ed.locator('span[style*="italic"]').first()).toBeVisible();
  // Enregistré dans le Fountain : toujours là après rechargement.
  await page.waitForTimeout(1500);
  await page.goto('/#/scenario');
  await page.reload();
  await expect(page.getByTestId('script-editor').locator('span[style*="font-weight: 700"]').first()).toBeVisible();
  await expect(page.getByTestId('script-editor').locator('span[style*="italic"]').first()).toBeVisible();
});

test('scénario : surlignage de révision en couleur, retiré à volonté', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const ed = page.getByTestId('script-editor');
  await ed.getByText('valise', { exact: false }).first().dblclick();
  await page.getByTestId('highlight').click();
  await page.getByTestId('highlight-jaune').click();
  const hl = ed.locator('span[class*="hl_jaune"]').first();
  await expect(hl).toBeVisible();
  await hl.dblclick();
  await page.getByTestId('highlight').click();
  await page.getByTestId('highlight-none').click();
  await expect(ed.locator('span[class*="hl_"]')).toHaveCount(0);
});

test('scénario : minutage par pages, caractères ou type (réglages) ; graphique exporté en PNG', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const chrono = page.getByTestId('scenario-chrono');
  await expect(chrono).toContainText(/\/ 0:\d\d/);
  const before = (await chrono.textContent()) ?? '';
  await page.goto('/#/settings?seed=fiction&section=scenario');
  await page.getByRole('radiogroup', { name: 'Minutage du scénario' }).getByText('Par type de paragraphe').click();
  await expect(page.getByLabel('Action : par 50 caractères (s)')).toHaveValue('1.5');
  await page.getByTestId('settings-save').click();
  await page.getByRole('button', { name: /Scénario/ }).first().click();
  await expect(chrono).toBeVisible();
  await expect(chrono).not.toHaveText(before);
  await expect(chrono).toHaveAttribute('title', /par type de paragraphe/);
  await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Statistiques' }).click();
  await page.getByTestId('report-structure').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('report-png').click();
  expect((await dl).suggestedFilename()).toBe('la-consigne-structure-de-l-histoire.png');
  // Rapport en PDF : les contrôles de l'écran ne sont pas imprimés.
  await page.getByTestId('report-scenes').click();
  await page.getByTestId('script-reports').locator('select').selectOption({ index: 1 });
  const pdf = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Exporter ce rapport en PDF' }).click();
  // (Le nom accentué n'est pas rendu par Chromium sans interface : seul le contenu est vérifié.)
  const { readFileSync } = await import('node:fs');
  expect(readFileSync((await (await pdf).path())!).subarray(0, 5).toString()).toBe('%PDF-');
});

test('scénario : la page de garde restée dans le texte est reconnue et en sort à la validation', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Vox');
  await page.getByTestId('wizard-next').click();
  await page.getByRole('button', { name: 'Écrire ou importer un scénario' }).click();
  const ed = page.getByTestId('script-editor');
  await ed.locator('[data-bid]').first().click();
  // Tab : de l'en-tête vide à l'action (une fois fermées les suggestions d'en-tête, que Tab accepterait).
  await expect(page.getByRole('listbox', { name: 'Suggestions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.keyboard.type('VOX\nÉcrit par Jean-Marie Jean-Baptiste\nFADE IN:\nINT. ENTREPRISE - JOUR\nFlora entre.');
  await page.getByTestId('edit-title-page').click();
  await expect(page.getByLabel('Titre', { exact: true })).toHaveValue('VOX');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(ed.locator('[data-type="action"]').filter({ hasText: 'Écrit par' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario)).toMatch(/^Title: VOX/);
});

test('versions : la V2 part de la V1 ; on passe de l’une à l’autre, le découpage et les marques suivent', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const switcher = page.getByTestId('version-switcher');
  await expect(switcher).toHaveText('V1');
  await switcher.click();
  await page.getByTestId('version-new').click();
  await expect(switcher).toHaveText('V2');
  // En V2 : une scène ajoutée à la fin.
  const ed = page.getByTestId('script-editor');
  await ed.locator('[data-bid]').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nEXT. QUAI - NUIT\nUn train passe sans s’arrêter.');
  await expect(page.getByTestId('scenario-outline')).toContainText('QUAI');
  // Marque de révision : la seule scène nouvelle (les autres n'ont pas changé).
  await expect(page.getByTestId('scenario-outline').getByTestId('revision-mark')).toHaveCount(1);
  await expect(page.getByTestId('scenario-outline').locator('li').filter({ has: page.getByTestId('revision-mark') })).toContainText('QUAI');
  // Retour en V1 : la scène n'y est pas ; le découpage montre la même version.
  await switcher.click();
  await page.getByTestId('version-item').filter({ hasText: 'V1' }).getByRole('menuitemradio').click();
  await expect(switcher).toHaveText('V1');
  await expect(page.getByTestId('scenario-outline')).not.toContainText('QUAI');
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.getByTestId('version-switcher')).toHaveText('V1');
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-item').filter({ hasText: 'V2' }).getByRole('menuitemradio').click();
  await page.getByRole('button', { name: /^Scénario$/ }).first().click();
  await expect(page.getByTestId('scenario-outline')).toContainText('QUAI');
});

test('recherche : ce qui est tapé reste, même panneau masqué au clavier ou page quittée sans clic', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const research = () => page.evaluate(() => (window as unknown as { __ds: { doc: () => { research?: Record<string, string> } } }).__ds.doc().research ?? {});
  await page.getByTestId('scenario-tab-research').click();
  await page.getByLabel('Logline').fill('Une valise, une décision.');
  await page.keyboard.press('Control+Backslash');
  await expect(page.getByLabel('Navigation du scénario')).toHaveCount(0);
  await expect.poll(async () => (await research()).logline).toBe('Une valise, une décision.');
  await page.keyboard.press('Control+Backslash');
  await expect(page.getByLabel('Logline')).toHaveValue('Une valise, une décision.');
  await page.getByLabel('Genre').fill('Drame');
  await page.evaluate(() => (location.hash = '#/grid'));
  await expect(page.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await expect.poll(async () => (await research()).genre).toBe('Drame');
});

test('vue Découpage : le panneau suit la version choisie ; les onglets ne bougent pas d’une vue à l’autre', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const tabX = async () => (await page.getByTestId('scenario-tab-research').boundingBox())!.x;
  const x0 = await tabX();
  const switcher = page.getByTestId('version-switcher');
  await switcher.click();
  await page.getByTestId('version-new').click();
  await expect(switcher).toHaveText('V2');
  await page.getByTestId('script-editor').locator('[data-bid]').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nINT. CAFÉ DU PORT - NUIT\nUn café fume.');
  const outline = page.getByTestId('scenario-outline');
  await expect(outline).toContainText('CAFÉ DU PORT');
  const views = page.getByRole('radiogroup', { name: 'Affichage du scénario' });
  await views.getByRole('radio', { name: 'Découpage' }).click();
  expect(await tabX()).toBe(x0);
  await expect(outline).toContainText('CAFÉ DU PORT');
  await switcher.click();
  await page.getByTestId('version-item').filter({ hasText: 'V1' }).getByRole('menuitemradio').click();
  await expect(switcher).toHaveText('V1');
  await expect(outline).not.toContainText('CAFÉ DU PORT');
  await expect(outline.locator('li')).toHaveCount(3);
  await page.getByTestId('scenario-tab-characters').click();
  await expect(page.getByTestId('scenario-characters')).toBeVisible();
  // Sans texte, la vue Découpage liste les séquences du découpage, et non « aucune séquence ».
  await page.goto('/#/scenario?seed=rav3');
  await views.getByRole('radio', { name: 'Découpage' }).click();
  await page.getByTestId('scenario-tab-scenes').click();
  await expect(page.getByText('Aucune séquence pour l’instant.')).toHaveCount(0);
  const n = await page.locator('[data-cut-seq]').count();
  expect(n).toBeGreaterThan(0);
  await expect(outline.locator('li')).toHaveCount(n);
});

test('versions : un nouveau texte importé devient la V2, chaque scène retrouve sa séquence', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  // Préparation en V1 : un accessoire sur le parvis.
  await page.getByTestId('breakdown-scene').filter({ hasText: 'PARVIS' }).click();
  await page.getByLabel('Ajouter (Accessoires)').fill('Parapluie');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^Scénario$/ }).first().click();
  page.on('filechooser', (fc) => fc.setFiles('e2e/fixtures-v2.fountain'));
  await page.getByRole('button', { name: 'Importer', exact: true }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Créer la V2' }).click();
  await expect(page.getByTestId('toast')).toContainText('V2 : 3 séquences reprises dont 1 modifiée · 1 nouvelle, ajoutée au découpage');
  await expect(page.getByTestId('version-switcher')).toHaveText('V2');
  // Le découpage suit : la nouvelle scène à sa place, le parvis devenu la 4 garde son dépouillement.
  await page.getByRole('button', { name: /Dépouillement/ }).first().click();
  const parvis = page.getByTestId('breakdown-scene').filter({ hasText: 'PARVIS' });
  await expect(parvis).toContainText('4');
  await parvis.click();
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Parapluie');
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.locator('tbody[data-seq]')).toHaveCount(4);
  // La V1 est intacte.
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-item').filter({ hasText: 'V1' }).getByRole('menuitemradio').click();
  await expect(page.locator('tbody[data-seq]')).toHaveCount(3);
});

test('versions : effacer le scénario de la version courante, puis le rétablir', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const switcher = page.getByTestId('version-switcher');
  await switcher.click();
  await page.getByTestId('version-new').click();
  await switcher.click();
  await page.getByTestId('scenario-clear').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Le découpage, ses plans et la préparation restent');
  await dialog.getByRole('button', { name: 'Effacer V2' }).click();
  await expect(page.getByTestId('scenario-outline')).toHaveCount(0);
  // V1 garde son texte.
  await switcher.click();
  await page.getByTestId('version-item').filter({ hasText: 'V1' }).getByRole('menuitemradio').click();
  await expect(page.getByTestId('scenario-outline')).toContainText('GARE — HALL');
  // Retour en V2 : le texte effacé se rétablit.
  await switcher.click();
  await page.getByTestId('version-item').filter({ hasText: 'V2' }).getByRole('menuitemradio').click();
  await switcher.click();
  await page.getByTestId('scenario-restore').click();
  await expect(page.getByTestId('scenario-outline')).toContainText('PARVIS DE LA GARE');
});

test('scénario : effacer une réplique entière ne touche ni aux blocs voisins ni à la page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/scenario?seed=fiction');
  const editor = page.getByTestId('script-editor');
  const dialogue = editor.locator('[data-type="dialogue"]:has(+ [data-type="action"])').first();
  const after = editor.locator('[data-type="dialogue"] + [data-type="action"]').first();
  const next = (await after.textContent())!;
  const said = (await dialogue.textContent())!;
  const scenario = () => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario);
  const select = (toNext: boolean) =>
    dialogue.evaluate((el, next) => {
      const r = document.createRange();
      r.setStart(el, 0);
      if (next) r.setStart(el.firstChild ?? el, 0);
      if (next) r.setEnd(el.nextElementSibling!, 0);
      else r.selectNodeContents(el);
      (el.closest('[data-testid="script-editor"]') as HTMLElement).focus();
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    }, toNext);
  // Toute la réplique sélectionnée, effacée : le bloc reste, vide ; le paragraphe suivant ne bouge pas.
  await select(false);
  await page.keyboard.press('Backspace');
  await expect(after).toHaveText(next);
  await expect(editor.getByText(said)).toHaveCount(0);
  await page.keyboard.type('Merci.');
  await expect(editor.getByText('Merci.', { exact: true })).toHaveCount(1);
  // Sélection qui court jusqu'au début du bloc suivant (triple clic) : seule la réplique part.
  await select(true);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Merci beaucoup.');
  await expect(dialogue).toHaveText('Merci beaucoup.');
  await expect(after).toHaveText(next);
  // Le navigateur retire un bloc de lui-même : tout est remis en place, rien ne tombe.
  await editor.evaluate((root) => {
    root.querySelector('[data-type="dialogue"]:has(+ [data-type="action"])')!.remove();
    root.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(dialogue).toHaveText('Merci beaucoup.');
  await after.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Elle sourit.');
  await expect.poll(scenario).toContain(`Merci beaucoup.\n\n${next.split('\n').pop()} Elle sourit.`);
  expect(errors).toEqual([]);
  await expect(page.getByText('Cette page n’a pas pu s’afficher')).toHaveCount(0);
});

test('scénario : les notes ne comptent ni dans les pages ni dans la durée ; barre, sommaire et statistiques concordent', async ({ page }) => {
  const scene = (k: number) =>
    `INT. LIEU ${k} - JOUR\n\n[[${'Note de travail assez longue pour tenir plusieurs lignes à l’écran. '.repeat(4)}]]\n\n${'Une action qui occupe quelques lignes de la page imprimée. '.repeat(4)}\n\nLÉA\nUne réplique.\n\n`;
  const src = `Title: Notes\n\n> FONDU D’OUVERTURE :\n\nUne ouverture.\n\n${Array.from({ length: 30 }, (_, k) => scene(k + 1)).join('')}`;
  await page.goto('/#/scenario?seed=fiction');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Importer/ }).click();
  await (await chooser).setFiles({ name: 'notes.fountain', mimeType: 'text/plain', buffer: Buffer.from(src) });
  await page.getByRole('alertdialog').getByRole('button', { name: /^Remplacer/ }).click();
  const count = page.getByText(/^30 séquences · \d+ pages$/);
  await expect(count).toBeVisible();
  const pages = Number(/· (\d+) pages/.exec((await count.textContent()) ?? '')![1]);
  // La dernière séquence est sur la dernière page imprimée.
  await expect(page.getByTestId('scenario-outline').locator('li').last().locator('span').last()).toHaveText(String(pages));
  const total = /\/ (\d+:\d\d)/.exec((await page.getByTestId('scenario-chrono').textContent()) ?? '')![1];
  await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Statistiques' }).click();
  await page.getByTestId('report-summary').click();
  const kpi = (label: string) => page.getByTestId('script-reports').getByText(label, { exact: true }).locator('xpath=preceding-sibling::b');
  await expect(kpi('Durée')).toHaveText(total);
  await expect(kpi('Pages')).toHaveText(String(pages));
});
