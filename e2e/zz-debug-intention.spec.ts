import { test } from '@playwright/test';
test('debug', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  await page.getByTestId('note-editor').locator('h1').waitFor();
  for (const k of [33, 34, 35]) {
    const r = await page.evaluate((k) => {
      const ed = document.querySelector<HTMLElement>('[data-testid="note-editor"]')!;
      ed.innerHTML = Array.from({ length: k }, (_, i) => `<p>Ligne ${i + 1}</p>`).join('') + '<h2>Titre de partie</h2><p>Premier paragraphe de la partie.</p>';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      const r0 = document.querySelector('[data-testid="note-stack"] [aria-hidden="true"] > div')!.getBoundingClientRect();
      const t = (e: Element) => Math.round(e.getBoundingClientRect().top - r0.top) + '/' + Math.round(e.getBoundingClientRect().bottom - r0.top);
      return { h: t(ed.querySelector('h2')!), p: t(ed.querySelector('h2 + p')!), last: t(ed.querySelector('h2')!.previousElementSibling!), css: document.querySelector('[data-testid="note-stack"] style')!.textContent };
    }, k);
    console.log(k, JSON.stringify(r));
  }
});
