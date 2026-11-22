// Checks that only real portal hosts count as the portal.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const loadShared = require('./load-shared');

const get = loadShared();
const isPortalURL = get('isPortalURL');

test('known portal URLs are accepted', () => {
  for (const u of [
    'https://internet.lpu.in/24online/webpages/client.jsp',
    'http://172.16.0.30:8090/httpclient.html',
    'http://phc.lpu.in',
    'http://10.10.0.1:8090/',
  ]) assert.strictEqual(isPortalURL(u), true, u);
});

test('look-alike and malformed URLs are rejected', () => {
  for (const u of [
    'https://evil.example/?captiveportal',
    'https://evil.example/24online/login',
    'https://evil.example/?next=internet.lpu.in',
    'https://internet.lpu.in.evil.example/',
    'https://notinternet.lpu.in/',
    'http://172.16.0.301/',
    'javascript:alert(1)//internet.lpu.in',
    'ftp://internet.lpu.in/',
    '',
    null,
    undefined,
    'not a url',
  ]) assert.strictEqual(isPortalURL(u), false, String(u));
});

test('every PORTAL_URLS entry passes isPortalURL', () => {
  for (const u of get('PORTAL_URLS')) assert.strictEqual(isPortalURL(u), true, u);
});

test('content script matches in both manifests equal PORTAL_HOSTS', () => {
  const hosts = [...get('PORTAL_HOSTS')].sort();
  for (const m of ['manifest_chrome.json', 'manifest_firefox.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', m), 'utf8'));
    const matched = new Set();
    for (const cs of manifest.content_scripts) {
      for (const pattern of cs.matches) matched.add(new URL(pattern.replace('/*', '/')).hostname);
    }
    assert.deepStrictEqual([...matched].sort(), hosts, m);
  }
});
