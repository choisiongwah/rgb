import { test, expect } from '@playwright/test';

test('level switching preserves shared and individual rendering', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('requestfailed', request => errors.push('REQUEST FAILED ' + request.url() + ': ' + request.failure()?.errorText));
  page.on('response', response => { if (response.url().includes('/ufo-') && response.status() >= 400) errors.push('UFO ASSET HTTP ' + response.status() + ' ' + response.url()); });
  await page.goto('/');
  await page.locator('input[name="username"]').fill('playwright-admin');
  await page.locator('input[name="password"]').fill('playwright-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#create').click();
  await expect(page.locator('.player-join-link')).toHaveCount(3);
  const players = [];
  for (let i = 0; i < 3; i++) {
    const p = await browser.newPage(); players.push(p);
    await p.goto(await page.locator('.player-join-link').nth(i).getAttribute('href'));
    await p.locator('input[name="name"]').fill(['Red Test','Green Test','Blue Test'][i]);
    await p.getByRole('button', { name: 'Join game' }).click();
    await expect(p.locator('#player-name')).toBeVisible();
  }
  for (const color of ['RED', 'GREEN', 'BLUE']) {
    await expect(page.locator('#slot-status-' + color)).toContainText('CONNECTED');
  }

  async function check(stage) {
    await page.locator('#level-select').selectOption(String(stage));
    await page.locator('#start-level').click();
    const individual = [3,4,5,7,8,9].includes(stage);
    await expect(page.locator('#room')).toHaveClass(individual ? /individual-mode/ : /shared-mode/);
    if (individual) {
      await expect(page.locator('#race-display')).toBeVisible();
      await expect(page.locator('#game-root')).toHaveAttribute('aria-label', 'Shared game screen');
      await expect.poll(async () => { const b = await page.locator('#game-root').boundingBox(); return !!b && b.width > 200 && b.height > 120; }).toBe(true);
      const cols = page.locator('.race-column'); await expect(cols).toHaveCount(3);
      for (let i=0;i<3;i++) {
        const col=cols.nth(i); await expect(col).toBeVisible();
        await expect.poll(async()=>{const b=await col.boundingBox();return !!b&&b.width>80&&b.height>120;}).toBe(true);
        if(stage===3) await expect(col.locator('.host-race-road')).toBeVisible();
        else { await expect(col.locator('.host-individual-scene'), 'Level ' + stage + ' scene should be rendered for ' + (await col.getAttribute('data-color'))).toBeVisible(); await expect(col.locator('.individual-board')).toBeVisible(); }
      }
    } else {
      await expect(page.locator('#race-display')).toBeHidden();
      const canvas=page.locator('#game-root canvas'); await expect(canvas).toBeVisible();
      await expect.poll(async()=>{const b=await canvas.boundingBox();return !!b&&b.width>200&&b.height>120;}).toBe(true);
    }
  }
  for (const stage of [1,2,3,4,5,7,8,9,6,10,2,6,10,9,3,2]) await check(stage);
  expect(errors).toEqual([]);
  await Promise.all(players.map(p=>p.close()));
});
