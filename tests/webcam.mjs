import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const target = process.env.LOBBY_TEST_URL || process.argv[2];
const server = target ? undefined : await preview({ base: '/lobby/', preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.captures = [];
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await capture(constraints);
        window.captures.push(stream);
        return stream;
      };
    });
  }
  const [a, b] = pages;
  async function join(page, name) {
    await page.goto(target || 'http://127.0.0.1:4176/lobby/');
    await page.locator('#display-name').fill(name);
    await page.locator('#enter-button').click();
    await page.waitForFunction(() => document.querySelector('#network-status').textContent === 'Connected');
    if (await page.locator('#voice-controls').isVisible()) {
      await page.locator('#voice-join').click();
      await page.waitForFunction(() => document.querySelector('#voice-join').dataset.connected === 'true', undefined, { timeout: 45000 });
    }
  }
  async function video(page, selector) {
    await page.waitForFunction(selector => {
      const video = document.querySelector(selector);
      return video && video.videoWidth > 0 && video.currentTime > 0.1;
    }, selector, { timeout: 30000 });
  }
  await join(a, 'Camera One');
  await join(b, 'Camera Two');
  await a.waitForFunction(() => document.querySelectorAll('.remote-label').length === 1);
  for (const page of pages) {
    assert.equal(await page.locator('.video-disc').count(), 0);
    assert.equal(await page.evaluate(() => window.captures.length), 0, 'No camera access before an explicit toggle');
  }
  await a.locator('#camera-toggle').click();
  await video(a, '.local-video video');
  await video(b, '.video-disc:not(.local-video) video');
  // Receiving video must not request access to the viewer's own camera.
  assert.equal(await b.evaluate(() => window.captures.length), 0);
  await b.locator('#camera-toggle').click();
  await video(b, '.local-video video');
  await video(a, '.video-disc:not(.local-video) video');
  for (const page of pages) assert.equal(await page.evaluate(() => window.captures.every(stream => stream.getAudioTracks().length === 0)), true, 'Never capture microphone audio');
  if (await a.locator('#voice-controls').isVisible()) {
    await a.locator('#microphone-toggle').click();
    await a.waitForFunction(() => document.querySelector('#microphone-toggle').getAttribute('aria-pressed') === 'true');
    await b.waitForFunction(() => {
      const audio = document.querySelector('#room-audio audio');
      return audio && audio.readyState >= 2 && audio.currentTime > 0.1;
    }, undefined, { timeout: 20000 });
    await a.locator('#microphone-toggle').click();
    await a.waitForFunction(() => document.querySelector('#microphone-toggle').getAttribute('aria-pressed') === 'false');
    assert.equal(await a.evaluate(() => window.captures.flatMap(stream => stream.getAudioTracks()).every(track => track.readyState === 'ended')), true, 'Muting releases microphone capture');
  }
  await mkdir('test-results', { recursive: true });
  await b.screenshot({ path: 'test-results/webcams.png' });
  await a.locator('#camera-toggle').click();
  await b.waitForFunction(() => document.querySelectorAll('.video-disc:not(.local-video)').length === 0);
  assert.equal(await a.evaluate(() => window.captures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  await a.locator('#camera-toggle').click();
  await video(b, '.video-disc:not(.local-video) video');
  await a.locator('#leave').click();
  await b.waitForFunction(() => document.querySelectorAll('.video-disc:not(.local-video)').length === 0);
  assert.equal(await a.locator('.video-disc').count(), 0);
  assert.equal(await a.evaluate(() => window.captures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  // Test the denied-permission branch without opening a real camera prompt.
  await a.locator('#enter-button').click();
  await a.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await a.locator('#camera-toggle').click();
  await a.waitForFunction(() => [document.querySelector('#camera-status'), document.querySelector('#voice-status')].some(element => element?.textContent.includes('permission denied')));
  assert.equal(await a.locator('#camera-toggle').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  console.log('PASS: live two-session media, no automatic capture, receive-only viewer, microphone only after unmute, decoded video/audio, capture release on mute/leave, permission-denied UI.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
