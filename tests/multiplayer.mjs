import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const server = await preview({ base: '/lobby/', preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const one = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const two = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const a = await one.newPage();
  const b = await two.newPage();
  await b.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.testSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); window.testSockets.push(this); }
    };
  });
  const errors = [];
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => {
      socket.on('socketerror', error => console.log('WebSocket error:', String(error).replace(/sb_publishable_[\w-]+/g, '[public key]')));
      socket.on('framereceived', frame => {
        try {
          const message = JSON.parse(String(frame.payload));
          if (message.event === 'phx_reply' && message.payload.status === 'error') console.log('Channel rejected:', JSON.stringify(message.payload.response));
        } catch { /* Ignore binary frames. */ }
      });
    });
  }
  async function join(page) {
    await page.goto('http://127.0.0.1:4175/lobby/');
    await page.locator('#display-name').fill('Ada <test>');
    await page.locator('#enter-button').click();
    try {
      await page.waitForFunction(() => document.querySelector('#network-status').textContent === 'Connected', undefined, { timeout: 30000 });
    } catch (error) {
      console.log('Connection status:', await page.locator('#network-status').textContent(), 'Browser errors:', errors);
      throw error;
    }
  }
  async function remoteCount(page, count, timeout = 30000) {
    await page.waitForFunction(n => document.querySelectorAll('.remote-label').length === n, count, { timeout });
  }
  async function matchPosition(observer, player) {
    const expected = (await player.locator('#position').textContent()).match(/-?\d+\.\d+/g).map(Number);
    await observer.waitForFunction(([x, z]) => {
      const remote = document.querySelector('.remote-label');
      return remote && Math.abs(Number(remote.dataset.x) - x) < 0.2 && Math.abs(Number(remote.dataset.z) - z) < 0.2;
    }, expected, { timeout: 10000 });
  }
  await join(a);
  await a.locator('#scene').focus();
  await a.keyboard.down('w');
  await a.waitForTimeout(700);
  await a.keyboard.up('w');
  await a.waitForTimeout(500);
  // B joins after A moves and stops: it must receive the current stationary pose.
  await join(b);
  await remoteCount(a, 1);
  await remoteCount(b, 1);
  await matchPosition(b, a);
  await b.waitForFunction(() => document.querySelector('.remote-label')?.dataset.animation === 'idle');
  assert.equal(await b.locator('.remote-label').textContent(), 'Ada <test>');
  assert.notEqual(await a.locator('.remote-label').getAttribute('data-session'), await b.locator('.remote-label').getAttribute('data-session'), 'Same names have distinct sessions');
  await b.locator('#scene').focus();
  await b.keyboard.down('d');
  await a.waitForFunction(() => document.querySelector('.remote-label')?.dataset.animation === 'walk');
  await b.keyboard.down('Shift');
  await a.waitForFunction(() => document.querySelector('.remote-label')?.dataset.animation === 'run');
  await b.keyboard.up('Shift');
  await b.waitForTimeout(800);
  await b.keyboard.up('d');
  await matchPosition(a, b);
  await b.keyboard.down('Space');
  await a.waitForFunction(() => Number(document.querySelector('.remote-label')?.dataset.y) > 1.25);
  assert.equal(await a.locator('.remote-label').getAttribute('data-animation'), 'jump');
  await b.keyboard.up('Space');
  await a.waitForFunction(() => Number(document.querySelector('.remote-label')?.dataset.y) < 0.9);
  assert.ok(Number(await b.locator('#position').getAttribute('data-y')) < 0.9, 'Both clients see the landing');
  await a.locator('#scene').focus();
  await a.keyboard.down('a');
  await a.waitForTimeout(650);
  await a.keyboard.up('a');
  await matchPosition(b, a);
  await mkdir('test-results', { recursive: true });
  await a.screenshot({ path: 'test-results/multiplayer.png' });
  await b.locator('#leave').click();
  await remoteCount(a, 0);
  await b.locator('#enter-button').click();
  await remoteCount(a, 1);
  await remoteCount(b, 1);
  await matchPosition(a, b);
  // Drop the transport and let the SDK resubscribe without a page reload.
  await b.evaluate(() => window.testSockets.at(-1).close(4000, 'Test interrupted connection'));
  await b.waitForFunction(() => document.querySelector('#network-status').textContent === 'Reconnecting…');
  await b.waitForFunction(() => document.querySelector('#network-status').textContent === 'Connected', undefined, { timeout: 30000 });
  await remoteCount(a, 1);
  await remoteCount(b, 1);
  await matchPosition(a, b);
  await matchPosition(b, a);
  // Abruptly close the independent session without clicking Leave.
  await two.close();
  await remoteCount(a, 0, 45000);
  await a.reload();
  await a.locator('#display-name').fill('After reconnect');
  await a.locator('#enter-button').click();
  await a.waitForFunction(() => document.querySelector('#network-status').textContent === 'Connected');
  assert.deepEqual(errors, []);
  console.log('PASS: live Supabase, isolated sessions, late join, movement and jump/landing synchronization, leave/rejoin, transport reconnect, abrupt close and reload.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
