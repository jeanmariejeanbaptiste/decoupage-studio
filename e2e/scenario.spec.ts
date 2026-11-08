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
  test('clic droit → créer un plan avec cette action', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    await page.getByTestId('scenario-tab-shots').click();
    const marc = page.getByTestId('scenario-shot').filter({ hasText: 'Marc attend sous la pluie' });
    await expect(page.getByTestId('scenario-shot').first()).toBeVisible();
    const before = await marc.count();
    await selectText(page, 'Marc attend sous la pluie');
    await page.getByTestId('script-editor').dispatchEvent('contextmenu', { clientX: 500, clientY: 400, button: 2 });
    // Mode lié (par défaut) : le plan va directement dans la séquence de la scène.
    await expect(marc).toHaveCount(before + 1);
  });

  test('les répliques sélectionnées vont dans le dialogue', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    await page.getByTestId('scenario-tab-shots').click();
    // Mode libre : la séquence se choisit, celle de la scène est suggérée en premier.
    await page.getByTestId('scenario-link-mode').uncheck();
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
    await page.keyboard.type('\nINT. CAFÉ DE LA GARE - NUIT\n\nNINA\nBonsoir.');
    await expect(editor.locator('[data-type="heading"]').last()).toHaveText('INT. CAFÉ DE LA GARE - NUIT');
    await expect(editor.locator('[data-type="character"]').last()).toHaveText('NINA');
    await expect(editor.locator('[data-type="dialogue"]').last()).toHaveText('Bonsoir.');
    await expect(page.getByTestId('scenario-outline')).toContainText('CAFÉ DE LA GARE');
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
    await expect(page.getByTestId('character-row').filter({ has: page.locator('td:first-child', { hasText: 'Nina' }) })).toHaveCount(1);
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
  await page.getByLabel('Comédien·ne').fill('Alice Martin');
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
  await page.getByTestId('scenario-tab-stats').click();
  const reports = page.getByTestId('script-reports');
  await expect(reports).toContainText('Signes avec / sans espaces');
  await reports.getByLabel('Rapport', { exact: true }).selectOption('characters');
  await expect(reports).toContainText('Séq. muettes');
  await reports.getByLabel('Rapport', { exact: true }).selectOption('structure');
  await expect(reports.getByRole('img', { name: 'Structure de l’histoire' })).toBeVisible();
  await page.getByTestId('scenario-tab-research').click();
  await page.getByLabel('Logline').fill('Une valise, une décision.');
  await page.getByTestId('research-add-doc').click();
  await page.goto('/#/registry?tab=characters');
  await expect(page.getByText('Alice Martin')).toBeVisible();
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
