const test = require('node:test');
const assert = require('node:assert');
const loadShared = require('./load-shared');

const get = loadShared();

test('sanitizeUsername keeps only the registration number', () => {
  const sanitize = get('sanitizeUsername');
  assert.strictEqual(sanitize('12345678'), '12345678');
  assert.strictEqual(sanitize('  12345678  '), '12345678');
  assert.strictEqual(sanitize('12345678@lpu.in'), '12345678');
  assert.strictEqual(sanitize('12345678@LPU.COM'), '12345678');
  assert.strictEqual(sanitize('12345678@gmail.com'), '12345678');
  assert.strictEqual(sanitize('12-345 678'), '12345678');
  assert.strictEqual(sanitize(''), '');
  assert.strictEqual(sanitize(null), '');
  assert.strictEqual(sanitize(12345678), '');
});

test('isPostLoginURL matches status pages case-insensitively', () => {
  const isPostLogin = get('isPostLoginURL');
  assert.strictEqual(isPostLogin('http://172.16.0.30:8090/24online/servlet/E24onlineHTTPClient'), true);
  assert.strictEqual(isPostLogin('https://internet.lpu.in/24online/webpages/LOGOUT.jsp'), true);
  assert.strictEqual(isPostLogin('https://internet.lpu.in/24online/webpages/client.jsp'), false);
  assert.strictEqual(isPostLogin(''), false);
  assert.strictEqual(isPostLogin(null), false);
});

test('getBackoffDelay grows exponentially within +-20% jitter and is capped', () => {
  const backoff = get('getBackoffDelay');
  for (let attempt = 0; attempt < 5; attempt++) {
    const base = 2000 * Math.pow(1.5, attempt);
    for (let i = 0; i < 50; i++) {
      const d = backoff(attempt, 2000, 30000, 1.5);
      assert.ok(d >= Math.round(base * 0.8) && d <= Math.round(Math.min(base * 1.2, 30000)), `attempt ${attempt}: ${d}`);
    }
  }
  for (let i = 0; i < 50; i++) assert.ok(backoff(20, 2000, 30000, 1.5) <= 30000);
});

test('getBackoffDelay uses defaults when arguments are missing', () => {
  const d = get('getBackoffDelay')(0);
  assert.ok(d >= 1600 && d <= 2400, String(d));
});

test('formatTimestamp gives relative times', () => {
  const fmt = get('formatTimestamp');
  const now = Date.now();
  assert.strictEqual(fmt(null), 'Never');
  assert.strictEqual(fmt('garbage'), 'Never');
  assert.strictEqual(fmt(now - 10 * 1000), 'Just now');
  assert.strictEqual(fmt(now - 5 * 60 * 1000), '5m ago');
  assert.strictEqual(fmt(now - 3 * 60 * 60 * 1000), '3h ago');
  assert.notStrictEqual(fmt(now - 3 * 24 * 60 * 60 * 1000), 'Never');
});

test('debounce runs only the last call', async () => {
  const calls = [];
  const fn = get('debounce')((x) => calls.push(x), 20);
  fn(1); fn(2); fn(3);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepStrictEqual(calls, [3]);
});

function fakeFetch(handler) {
  return async (url, opts) => handler(url, opts);
}

test('checkConnectivity reports connected on expected status', async () => {
  const get2 = loadShared({ fetch: fakeFetch(() => ({ type: 'basic', status: 204, ok: true, headers: new Map() })) });
  const r = await get2('checkConnectivity')();
  assert.deepStrictEqual({ ...r }, { connected: true, redirected: false, redirectUrl: null });
});

test('checkConnectivity detects a portal redirect and only sends HEAD requests', async () => {
  const seen = [];
  const get2 = loadShared({
    fetch: fakeFetch((url, opts) => {
      seen.push(opts);
      return { type: 'basic', status: 302, ok: false, headers: new Map([['Location', 'http://172.16.0.30:8090/']]) };
    }),
  });
  const r = await get2('checkConnectivity')();
  assert.strictEqual(r.connected, false);
  assert.strictEqual(r.redirected, true);
  assert.strictEqual(r.redirectUrl, 'http://172.16.0.30:8090/');
  for (const opts of seen) {
    assert.strictEqual(opts.method, 'HEAD');
    assert.strictEqual(opts.body, undefined);
  }
});

test('checkConnectivity reports disconnected when every request fails', async () => {
  const get2 = loadShared({ fetch: fakeFetch(() => { throw new TypeError('network down'); }) });
  const r = await get2('checkConnectivity')();
  assert.deepStrictEqual({ ...r }, { connected: false, redirected: false, redirectUrl: null });
});
