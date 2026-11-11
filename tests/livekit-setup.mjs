import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const server = await preview({ base: '/lobby/', preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.captureRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.captureRequests++; throw new DOMException('Denied', 'NotAllowedError'); };
  });
  let tokenRequests = 0;
  await page.route('**/functions/v1/livekit-token', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });
    tokenRequests++;
    assert.ok(request.headers().authorization?.startsWith('Bearer ey'), 'A real guest JWT is sent to the endpoint');
    const payload = request.postDataJSON();
    assert.match(payload.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(payload.name, 'LiveKit setup test');
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Function not deployed' }) });
  });
  await page.goto('http://127.0.0.1:4176/lobby/');
  await page.locator('#display-name').fill('LiveKit setup test');
  await page.locator('#enter-button').click();
  await page.waitForFunction(() => document.querySelector('#network-status').textContent === 'Connected');
  assert.equal(tokenRequests, 0, 'No media connection or quota usage until Join is clicked');
  assert.equal(await page.evaluate(() => window.captureRequests), 0);
  assert.equal(await page.locator('#microphone-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#camera-toggle').getAttribute('aria-pressed'), 'false');
  await page.locator('#voice-join').click();
  await page.waitForFunction(() => document.querySelector('#voice-status').textContent.includes('Deploy the livekit-token'));
  assert.equal(tokenRequests, 1);
  assert.equal(await page.evaluate(() => window.captureRequests), 0, 'Joining voice never auto-enables a microphone');
  assert.equal(await page.locator('#network-status').textContent(), 'Connected');
  await page.locator('#chat-input').fill('Chat still works without a media endpoint');
  await page.locator('#chat-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 1);
  await page.locator('#leave').click();
  assert.equal(await page.locator('#room-audio audio').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: live anonymous guest auth, correct token request, explicit media join, mic/camera off, actionable undeployed-endpoint error, independent chat/movement, leave cleanup.');
} finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
