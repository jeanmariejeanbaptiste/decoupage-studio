import { expect, test } from '@playwright/test';

// Barres de défilement réelles (Playwright les masque d'ordinaire) : celles d'un Mac réglé pour les
// afficher toujours, ou de Windows.
test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('semaine : en-tête, rangée « journée » et grille horaire tombent en face', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto('/#/calendar?seed=fiction');
  await page.getByRole('tab', { name: 'Semaine' }).click();
  const edges = await page.getByTestId('calendar-week').evaluate((g) => {
    const xs = (sel: string) => Array.from(g.querySelectorAll<HTMLElement>(sel)).map((e) => Math.round(e.getBoundingClientRect().right));
    const scroll = g.querySelector<HTMLElement>('[class*="tgScroll"]')!;
    return { head: xs('[class*="colHead"]'), day: xs('[class*="allDayCell"]'), body: xs('[class*="tgBody"] > [class*="col"]'), bar: scroll.offsetWidth - scroll.clientWidth };
  });
  expect(edges.bar).toBeGreaterThan(0);
  expect(edges.body).toHaveLength(7);
  expect(edges.head).toEqual(edges.body);
  expect(edges.day).toEqual(edges.body);
});
