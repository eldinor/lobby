import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { TokenVerifier } from 'livekit-server-sdk';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createTokenHandler } = await vite.ssrLoadModule('/supabase/functions/livekit-token/handler.ts');
  const secrets = {
    SUPABASE_URL: 'https://test-project.supabase.co',
    LIVEKIT_URL: 'wss://test-project.livekit.cloud',
    LIVEKIT_API_KEY: 'test-api-key',
    LIVEKIT_API_SECRET: 'test-secret-only-for-unit-tests-at-least-32-characters',
    LOBBY_ALLOWED_ORIGINS: 'https://demo.example.com',
  };
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const handler = createTokenHandler(key => secrets[key], async (url, options) => {
    assert.equal(url, `${secrets.SUPABASE_URL}/auth/v1/user`);
    return options.headers.authorization === 'Bearer valid-guest-jwt'
      ? Response.json({ id: userId }) : Response.json({ error: 'Invalid session' }, { status: 401 });
  });
  function request(body = { sessionId, name: 'Guest', room: 'attacker-room' }, overrides = {}) {
    return new Request('https://test-project.supabase.co/functions/v1/livekit-token', {
      method: 'POST', headers: { origin: 'https://demo.example.com', 'content-type': 'application/json', apikey: 'public-test-key', authorization: 'Bearer valid-guest-jwt', ...overrides }, body: JSON.stringify(body),
    });
  }
  assert.equal((await handler(request(undefined, { origin: 'https://wrong.example' }))).status, 403);
  assert.equal((await handler(request(undefined, { authorization: '' }))).status, 401);
  assert.equal((await handler(request(undefined, { authorization: 'Bearer forged-jwt' }))).status, 401);
  assert.equal((await handler(request({ sessionId: 'not-a-uuid', name: 'Guest' }))).status, 400);
  assert.equal((await handler(request({ sessionId, name: 'x'.repeat(3000) }))).status, 413);
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://demo.example.com');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.equal(body.serverUrl, secrets.LIVEKIT_URL);
  const claims = await new TokenVerifier(secrets.LIVEKIT_API_KEY, secrets.LIVEKIT_API_SECRET).verify(body.participantToken);
  assert.equal(claims.sub, `${userId}:${sessionId}`);
  assert.equal(claims.attributes.avatarId, sessionId);
  assert.equal(claims.video.room, 'lobby-001');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublishData, false);
  assert.deepEqual(claims.video.canPublishSources, ['camera', 'microphone']);
  const remaining = claims.exp - Math.floor(Date.now() / 1000);
  assert.ok(remaining > 590 && remaining <= 600);
  assert.ok(!JSON.stringify(body).includes(secrets.LIVEKIT_API_SECRET));
  for (let i = 0; i < 5; i++) assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 429);
  console.log('PASS: token signing/verification, guest authentication, CORS, room restriction, limited grants, expiry, input bounds, throttling and secret exclusion.');
} finally { await vite.close(); }
