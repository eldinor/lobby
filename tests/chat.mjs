import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const server = await preview({ base: '/lobby/', preview: { host: '127.0.0.1', port: 4177, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: { width: 1280, height: 900 } })));
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.wallScreen = { texts: [], draws: 0 };
      const fillRect = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.canvas.id === 'room-chat-texture' && args[0] === 0 && args[1] === 0) {
          window.wallCanvas = this.canvas;
          window.wallScreen.texts = [];
          window.wallScreen.draws++;
        }
        return fillRect.apply(this, args);
      };
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (this.canvas.id === 'room-chat-texture') window.wallScreen.texts.push({ text: args[0], x: args[1], y: args[2], width: this.measureText(args[0]).width });
        return fillText.apply(this, args);
      };
      const Socket = window.WebSocket;
      window.sockets = [];
      window.WebSocket = class extends Socket {
        constructor(...args) { super(...args); window.sockets.push(this); }
      };
    });
    await page.goto('http://127.0.0.1:4177/lobby/');
    await page.locator('#display-name').fill('Same <name>');
    await page.locator('#enter-button').click();
    await page.waitForFunction(() => !document.querySelector('#chat-send').disabled);
  }
  await a.waitForFunction(() => document.querySelectorAll('.remote-label').length === 1);
  const draws = await a.evaluate(() => window.wallScreen.draws);
  await a.waitForTimeout(350);
  assert.equal(await a.evaluate(() => window.wallScreen.draws), draws, 'Wall texture does not redraw every frame');
  async function send(page, text) {
    await page.locator('#chat-input').fill(text);
    await page.locator('#chat-input').press('Enter');
  }
  const unsafe = '<img src=x onerror=alert(1)> hello & welcome';
  await send(a, unsafe);
  await b.waitForFunction(() => document.querySelectorAll('.chat-message').length === 1);
  assert.equal(await b.locator('.chat-message p').textContent(), unsafe);
  assert.equal(await b.locator('.chat-message img').count(), 0);
  assert.equal(await a.locator('.own-message').count(), 1);
  assert.equal(await b.locator('.own-message').count(), 0);
  assert.equal(await b.locator('.chat-meta strong').textContent(), 'Same <name>');
  await b.waitForFunction(text => window.wallScreen.texts.some(line => line.text === text), unsafe);
  assert.deepEqual(await a.evaluate(() => window.wallScreen.texts), await b.evaluate(() => window.wallScreen.texts), 'Local and remote wall display match');
  await send(b, 'WASD and Space stay in chat');
  await a.waitForFunction(() => document.querySelectorAll('.chat-message').length === 2);
  assert.equal(await b.locator('.chat-message').count(), 2, 'No duplicated local echoes');
  // A collapsed panel keeps messages and counts only incoming unread messages.
  await b.locator('#chat-toggle').click();
  await a.waitForTimeout(1100);
  await send(a, 'One more hello');
  await b.waitForFunction(() => document.querySelector('#chat-toggle').textContent.includes('1 new'));
  await b.locator('#chat-toggle').click();
  assert.equal(await b.locator('#chat-toggle').getAttribute('aria-expanded'), 'true');
  assert.ok(!(await b.locator('#chat-toggle').textContent()).includes('new'));
  await a.locator('#scene').focus();
  await a.keyboard.press('Enter');
  assert.equal(await a.locator('#chat-input').evaluate(e => e === document.activeElement), true);
  const before = await a.locator('#position').textContent();
  await a.keyboard.type('wasd ');
  await a.keyboard.down('w');
  await a.waitForTimeout(350);
  await a.keyboard.up('w');
  assert.equal(await a.locator('#position').textContent(), before, 'Typing does not move the avatar');
  assert.ok(Number(await a.locator('#position').getAttribute('data-y')) < 0.9, 'Typing Space does not jump');
  await a.keyboard.press('Escape');
  assert.equal(await a.locator('#scene').evaluate(e => e === document.activeElement), true);
  await a.keyboard.down('w');
  await a.waitForTimeout(250);
  await a.locator('#chat-input').focus();
  const stopped = await a.locator('#position').textContent();
  await a.waitForTimeout(300);
  await a.keyboard.up('w');
  assert.equal(await a.locator('#position').textContent(), stopped, 'Opening chat clears held movement');
  await a.locator('#chat-input').fill('draft survives reconnect');
  await a.evaluate(() => window.sockets.at(-1).close(4000, 'Chat reconnect check'));
  await a.waitForFunction(() => document.querySelector('#chat-send').disabled);
  await a.waitForFunction(() => !document.querySelector('#chat-send').disabled);
  assert.equal(await a.locator('#chat-input').inputValue(), 'draft survives reconnect');
  await a.locator('#chat-input').press('Enter');
  await b.waitForFunction(() => [...document.querySelectorAll('.chat-message p')].some(e => e.textContent === 'draft survives reconnect'), undefined, { timeout: 5000 }).catch(async error => {
    for (const page of [a, b]) console.log('Chat diagnostic:', await page.locator('#chat-hint').textContent(), await page.locator('#chat-input').inputValue(), await page.locator('.chat-message p').allTextContents(), await page.locator('#online-count').textContent());
    throw error;
  });
  await a.waitForTimeout(1100);
  await send(a, 'First in burst');
  await send(a, 'Second in burst');
  await a.waitForFunction(() => document.querySelector('#chat-hint').textContent.includes('wait a moment'));
  assert.equal(await a.locator('#chat-input').inputValue(), 'Second in burst', 'Rate-limited draft remains editable');
  assert.equal(await a.locator('#chat-input').getAttribute('maxlength'), '300');
  await a.waitForTimeout(1100);
  await send(a, 'S'.repeat(300));
  await b.waitForFunction(() => window.wallScreen.texts.some(line => line.text.endsWith('…')));
  await send(b, 'Last screen message 👋');
  await a.waitForFunction(() => window.wallScreen.texts.some(line => line.text === 'Last screen message 👋'));
  const wall = await b.evaluate(() => window.wallScreen.texts);
  assert.equal(wall.filter(line => line.text === 'Same <name>').length, 6, 'Wall retains six recent messages');
  assert.ok(!wall.some(line => line.text.includes('onerror')), 'Oldest message is evicted');
  assert.ok(wall.filter(line => line.text.startsWith('S')).every(line => line.width <= 1448), 'Unbroken message wraps within screen bounds');
  const stableDraws = await b.evaluate(() => window.wallScreen.draws);
  await b.waitForTimeout(350);
  assert.equal(await b.evaluate(() => window.wallScreen.draws), stableDraws);
  await mkdir('test-results', { recursive: true });
  const texture = await b.evaluate(() => window.wallCanvas.toDataURL('image/png').split(',')[1]);
  await writeFile('test-results/chat-screen-texture.png', Buffer.from(texture, 'base64'));
  await b.locator('#scene').focus();
  await b.keyboard.down('w');
  await b.waitForTimeout(2800);
  await b.keyboard.up('w');
  await b.waitForTimeout(150);
  await b.mouse.move(650, 400);
  await b.mouse.down();
  await b.mouse.move(650, 150, { steps: 15 });
  await b.mouse.up();
  await b.waitForTimeout(500);
  const screenshot = await b.screenshot({ path: 'test-results/chat.png' });
  const darkScreenPixels = await b.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(310, 175, 600, 260).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 50 && pixels[i + 1] < 85 && pixels[i + 2] < 60) count++;
    return count;
  }, screenshot.toString('base64'));
  assert.ok(darkScreenPixels > 10000, 'The in-room screen renders the dark chat texture instead of a white material');
  await b.setViewportSize({ width: 390, height: 844 });
  const bounds = await b.locator('#chat').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Chat fits a narrow screen');
  await b.locator('#leave').click();
  assert.equal(await b.locator('#chat').isVisible(), false);
  assert.equal(await b.locator('.chat-message').count(), 0);
  assert.ok(await b.evaluate(() => window.wallScreen.texts.some(line => line.text === 'A little conversation starts here.')), 'Leaving resets the wall screen');
  assert.deepEqual(errors, []);
  console.log('PASS: live chat, matching DynamicTexture content in two sessions, six-message eviction, long-text wrapping, event-only redraw, keyboard isolation, reconnect, unread counts and leave cleanup.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
