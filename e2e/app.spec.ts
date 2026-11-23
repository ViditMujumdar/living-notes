import { test, expect, type Page } from '@playwright/test';
import { makePng } from '../tests/helpers';

const UNCONFIGURED = 'http://127.0.0.1:8831';
const setFail = (fail: 'gemini' | 'brave' | null) => fetch('http://127.0.0.1:8899/__fail', { method: 'POST', body: JSON.stringify({ fail }) });
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const typeNumber = async (page: Page, id: string, v: string) => { const el = page.locator(`#${id}`); await el.fill(v); await el.press('Enter'); };

test.afterEach(async () => { await setFail(null); });

test('example opens and controls drive the physics engine', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try an example' }).click();
  await expect(page.locator('#ws-title')).toHaveValue('Battery and three resistors');
  await expect(page.locator('.readout').filter({ hasText: 'Total current' })).toContainText('1.5');
  // topology edit changes the calculation, not just the drawing
  await page.getByRole('group', { name: 'Circuit arrangement' }).getByRole('button', { name: 'Series' }).click();
  await expect(page.locator('.readout').filter({ hasText: 'Total resistance' })).toContainText('22');
  await expect(page.locator('.readout').filter({ hasText: 'Total current' })).toContainText('0.545');
  await typeNumber(page, 'param-r1-n', '10');
  await expect(page.locator('.readout').filter({ hasText: 'Total resistance' })).toContainText('28');
  // invalid input is rejected without crashing
  await typeNumber(page, 'param-r2-n', '0');
  await expect(page.getByRole('alert').first()).toContainText('greater than 0');
  await expect(page.locator('.readout').filter({ hasText: 'Total resistance' })).toContainText('28');
});

test('lens: focal-point singularity and virtual images render without NaN', async ({ page }) => {
  await page.goto('/lab?example=lens-2f');
  await typeNumber(page, 'param-objectDistance-n', '10');
  await expect(page.locator('.sim-foot')).toContainText('image forms at infinity');
  await expect(page.locator('svg#sim-export')).toContainText('image at infinity');
  await typeNumber(page, 'param-objectDistance-n', '5');
  await expect(page.locator('.readout').filter({ hasText: 'Image distance' })).toContainText('-10');
  await expect(page.locator('body')).not.toContainText('NaN');
});

test('projectile animates to landing and the scrubber is analytical', async ({ page }) => {
  await page.goto('/lab?example=projectile-45');
  await expect(page.locator('.readout').filter({ hasText: 'Range' })).toContainText('40.8');
  await page.getByRole('button', { name: 'Reset' }).nth(1).click();
  await page.getByLabel('Time scrubber').evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, '1.4416'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.getByText(/t = 1\.44 \/ 2\.88 s/)).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText(/t = 2\.88 \/ 2\.88 s/)).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Play' })).toContainText('Replay');
});

async function uploadAndReview(page: Page) {
  await page.goto('/new');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: makePng(900, 700) });
  await page.getByRole('button', { name: 'Analyse diagram' }).click();
  await expect(page).toHaveURL(/\/review$/);
}

test('upload → review → correct missing value → simulation (mocked provider HTTP)', async ({ page }) => {
  await uploadAndReview(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('We found a battery and three resistors');
  await expect(page.locator('.bbox')).toHaveCount(4);
  const r2 = page.locator('#rv-r2');
  await expect(r2).toHaveValue('');
  await expect(page.locator('.rfield').filter({ has: r2 })).toContainText('Missing');
  await page.getByRole('button', { name: 'Launch experiment →' }).click();
  await expect(page.getByRole('alert')).toContainText('missing');
  await r2.fill('6');
  await page.getByRole('button', { name: 'Launch experiment →' }).click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByText('From your upload')).toBeVisible();
  await expect(page.locator('.readout').filter({ hasText: 'Total current' })).toContainText('1.5');
  await expect(page.locator('dl.kv')).toContainText('Edited by you');
});

test('tutor answers about the current experiment; suggestions only apply when chosen', async ({ page }) => {
  await page.goto('/lab?example=circuit-mixed');
  await page.getByRole('button', { name: 'Why did the current decrease?' }).click();
  const answer = page.locator('.msg.a').last();
  await expect(answer).toContainText('total resistance');
  await expect(answer.locator('.katex').first()).toBeVisible();
  const sugg = answer.getByRole('button', { name: /Set R2 to 12 Ω/ });
  await expect(sugg).toContainText('I: 1.5 → 1.2 A'); // preview computed by the physics engine
  await expect(page.locator('#param-r2-n')).toHaveValue('6'); // not applied yet
  await sugg.click();
  await expect(page.locator('#param-r2-n')).toHaveValue('12');
});

test('finds real-shaped sources from the search adapter', async ({ page }) => {
  await page.goto('/lab?example=circuit-mixed');
  await page.locator('summary').filter({ hasText: 'Supporting sources' }).click();
  await page.getByRole('button', { name: 'Find supporting sources' }).click();
  const link = page.getByRole('link', { name: 'Resistors in Series and Parallel' });
  await expect(link).toHaveAttribute('href', /openstax\.org/);
  await expect(page.locator('.src-item').first()).toContainText('retrieved');
  await expect(page.locator('.src-item').first()).toContainText('educational source');
});

test('save, reopen, share and open the share in a fresh session', async ({ page, browser }) => {
  await page.goto('/lab?example=lens-2f');
  await page.locator('#ws-title').fill('My lens test');
  await typeNumber(page, 'param-objectDistance-n', '30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/saved');
  await expect(page.getByRole('heading', { name: 'My lens test' })).toBeVisible();
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('#param-objectDistance-n')).toHaveValue('30');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Create share link' }).click();
  const url = await page.getByLabel('Share link').inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{24}$/);
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto(url);
  await expect(p2.getByRole('heading', { name: 'My lens test' })).toBeVisible();
  await expect(p2.getByText('read-only')).toBeVisible();
  await expect(p2.locator('.readout').filter({ hasText: 'Image distance' })).toContainText('15');
  await fresh.close();
});

test('poster export renders', async ({ page }) => {
  await page.goto('/lab?example=projectile-45');
  await page.getByRole('button', { name: 'Poster' }).click();
  await expect(page.getByRole('img', { name: 'Poster summary of this experiment' })).toBeVisible();
});

test('recovers from provider errors and offline state without losing work', async ({ page, context }) => {
  await page.goto('/lab?example=circuit-mixed');
  await typeNumber(page, 'param-r1-n', '8');
  await setFail('gemini');
  await page.getByRole('button', { name: 'Why did the current decrease?' }).click();
  await expect(page.locator('.alert.coral').last()).toContainText(/overloaded|AI provider/);
  await expect(page.getByRole('button', { name: /AI unavailable/ })).toBeVisible();
  await setFail(null);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.msg.a').last()).toContainText('total resistance');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Offline' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask about this experiment' }).fill('Why?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.alert.coral').last()).toContainText('offline');
  await typeNumber(page, 'param-r1-n', '2'); // simulation still works offline
  await expect(page.locator('.readout').filter({ hasText: 'Total resistance' })).toContainText('6');
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#param-r1-n')).toHaveValue('2'); // work preserved across reload
});

test('without credentials: honest setup-required states, manual path still works', async ({ page }) => {
  await page.goto(`${UNCONFIGURED}/new`);
  await expect(page.getByText('AI diagram reading: setup required')).toBeVisible();
  await expect(page.getByRole('button', { name: /setup needed/ })).toBeVisible();
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'd.png', mimeType: 'image/png', buffer: makePng(800, 600) });
  await expect(page.getByRole('button', { name: 'Analyse diagram' })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue without AI' }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole('group', { name: 'Experiment type' }).getByRole('button', { name: 'Projectile motion' }).click();
  await page.locator('#rv-speed').fill('10'); await page.locator('#rv-angleDeg').fill('30'); await page.locator('#rv-gravity').fill('9.8');
  await page.getByRole('button', { name: 'Launch experiment →' }).click();
  await expect(page.getByText('Manual setup')).toBeVisible();
  await page.getByRole('button', { name: 'Why is the horizontal velocity constant?' }).click();
  await expect(page.locator('.alert.coral').last()).toContainText('not set up');
});

test('@mobile phone layouts: no horizontal scroll, thumb-sized tabs', async ({ page }) => {
  for (const path of ['/', '/new', '/lab?example=circuit-mixed', '/saved']) {
    await page.goto(path);
    await noHorizontalScroll(page);
  }
  await page.goto('/lab?example=lens-2f');
  const tab = page.getByRole('tab', { name: 'Explain' });
  const box = await tab.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await tab.click();
  await expect(page.getByRole('textbox', { name: 'Ask about this experiment' })).toBeVisible();
  await page.getByRole('tab', { name: 'Diagram' }).click();
  await expect(page.getByText('Original diagram')).toBeVisible();
});

test('solver: any science question, app-computed answer that follows the sliders', async ({ page }) => {
  await page.goto('/solve');
  await page.getByLabel('Science question').fill('A simple pendulum is 1.2 m long. Find its period.');
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect(page.getByText('AI-generated solution: check it')).toBeVisible();
  await expect(page.locator('.panel').filter({ hasText: 'Answer' }).first()).toContainText('T = 2.199'); // 2π√(1.2/9.8) computed by the app
  await page.locator('#g-L').fill('4.8');
  await expect(page.locator('.panel').filter({ hasText: 'Answer' }).first()).toContainText('T = 4.397'); // 2π√(4.8/9.8) = 4.3975: 4× length → 2× period
  await expect(page.getByRole('img', { name: /Graph of T against L/ })).toBeVisible();
  // explanatory diagram drawn by the app from AI shape data; the malformed polyline was dropped by the server
  const diag = page.getByRole('img', { name: /Pendulum/ });
  await expect(diag).toBeVisible();
  await expect(diag.locator('polyline')).toHaveCount(0);
  await page.getByRole('group', { name: 'Diagram step' }).getByRole('button', { name: 'Start' }).click();
  await expect(diag.locator('g').filter({ has: page.locator('text', { hasText: 'mg' }) })).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'show on diagram' }).first().click();
  await expect(diag.locator('g').filter({ has: page.locator('text', { hasText: 'mg' }) })).toHaveCSS('opacity', '1');
});

test('solver: a question with an attached photo is actually sent and solved', async ({ page }) => {
  await page.goto('/solve');
  await page.getByLabel('Science question').fill('what to do with it?');
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'pendulum.png', mimeType: 'image/png', buffer: makePng(600, 500) });
  await expect(page.getByAltText('Attached question')).toBeVisible();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect(page.getByText('AI-generated solution: check it')).toBeVisible();
  // the photo really reached the AI provider (checked on the mock provider's side)
  expect((await (await fetch('http://127.0.0.1:8899/__last')).json()).lastHadImage).toBe(true);
  await expect(page.getByRole('button', { name: 'Solve', exact: true })).toBeEnabled();
});
