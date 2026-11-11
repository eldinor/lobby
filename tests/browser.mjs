import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const server = await preview({ base: '/lobby/', preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('http://127.0.0.1:4174/lobby/');
  await page.waitForFunction(() => !document.querySelector('#enter-button').disabled);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/join.png' });
  await page.locator('#display-name').fill('<b>Ada</b>');
  await page.locator('#enter-button').click();
  await page.locator('#session-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#name-label').textContent(), '<b>Ada</b>');
  assert.equal(await page.locator('#name-label b').count(), 0, 'Name must be rendered as text');
  async function coords() {
    return (await page.locator('#position').textContent()).match(/-?\d+\.\d+/g).map(Number);
  }
  async function walk(keys, ms) {
    await page.locator('#scene').focus();
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(100);
    return coords();
  }
  async function reset() {
    await page.locator('#reset').click();
    await page.waitForTimeout(250);
    const [x, z] = await coords();
    assert.ok(Math.abs(x) < 0.1 && Math.abs(z - 5) < 0.1, 'Reset returns to spawn within collision tolerance');
  }
  const start = await coords();
  const forward = await walk(['w'], 650);
  assert.ok(forward[1] < start[1] - 0.5, 'W follows the initial camera toward -Z');
  await reset();
  const right = await walk(['d'], 650);
  assert.ok(right[0] < -0.5, 'D moves right relative to the camera');
  const straightDistance = Math.hypot(right[0], right[1] - 5);
  await reset();
  const diagonal = await walk(['w', 'd'], 650);
  assert.ok(Math.hypot(diagonal[0], diagonal[1] - 5) < straightDistance * 1.3, 'Diagonal movement is normalized');
  await reset();
  const running = await walk(['Shift', 'd'], 650);
  assert.ok(Math.hypot(running[0], running[1] - 5) > straightDistance * 1.45, 'Shift runs faster than walking');
  await reset();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => Number(document.querySelector('#position').dataset.y) > 1.5, undefined, { timeout: 3000 }).catch(async error => {
    console.log('Jump diagnostic:', await page.locator('#position').evaluate(e => ({ y: e.dataset.y, grounded: e.dataset.grounded })), await page.locator('#motion-status').textContent(), errors);
    throw error;
  });
  // Repeated keydown while held must not create another jump on landing.
  await page.keyboard.down('Space');
  await page.waitForTimeout(950);
  assert.ok(Number(await page.locator('#position').getAttribute('data-y')) < 0.9, 'Jump lands back on floor');
  assert.equal(await page.locator('#position').getAttribute('data-grounded'), 'true');
  await page.waitForTimeout(400);
  assert.ok(Number(await page.locator('#position').getAttribute('data-y')) < 0.9, 'Holding jump does not bunny-hop');
  await page.keyboard.up('Space');
  await reset();
  await walk(['s'], 2200);
  const wall = await coords();
  assert.ok(wall[1] <= 9.5 && wall[1] > 7, 'Room boundary holds');
  await reset();
  // Move beside the west bench, then walk north into it.
  await page.locator('#scene').focus();
  await page.keyboard.down('d');
  await page.waitForFunction(() => Number(document.querySelector('#position').textContent.match(/-?\d+\.\d+/)[0]) <= -7.2);
  await page.keyboard.up('d');
  await walk(['w'], 2600);
  const bench = await coords();
  assert.ok(bench[1] > -0.8, `Bench blocks movement: ${bench}`);
  // Jump forward onto the bench and land on its top rather than falling through.
  await page.keyboard.down('w');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => Number(document.querySelector('#position').textContent.match(/-?\d+\.\d+/g)[1]) < -1.3);
  await page.keyboard.up('w');
  await page.waitForTimeout(1000);
  const benchHeight = Number(await page.locator('#position').getAttribute('data-y'));
  assert.ok(benchHeight > 1.6 && benchHeight < 1.9, `Land on bench: ${benchHeight}`);
  await reset();
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  const blurred = await coords();
  await page.waitForTimeout(400);
  assert.deepEqual(await coords(), blurred, 'Blur clears held movement');
  await page.keyboard.up('d');
  await reset();
  await page.mouse.move(950, 500);
  await page.mouse.down();
  await page.mouse.move(1200, 500, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const orbited = await walk(['w'], 650);
  assert.ok(Math.abs(orbited[0]) > 0.4, 'Orbit changes camera-relative walking direction');
  await page.mouse.wheel(0, -350);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/walking.png' });
  await reset();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.ok(await page.locator('#reset').isVisible());
  await page.screenshot({ path: 'test-results/narrow.png' });
  assert.deepEqual(errors, [], 'No browser errors or failed requests');
  console.log('PASS: subpath assets, join, safe name, walk/run, normalized diagonals, jump/landing, held-jump guard, bench landing, collisions, blur, orbit, zoom, reset, resize.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
