// Run: node test/portal-url.test.js
// Checks that only real portal hosts count as the portal.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ URL, console });
for (const f of ['constants.js', 'utils.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared', f), 'utf8'), ctx);
}
const isPortalURL = vm.runInContext('isPortalURL', ctx);

const yes = [
  'https://internet.lpu.in/24online/webpages/client.jsp',
  'http://172.16.0.30:8090/httpclient.html',
  'http://phc.lpu.in',
  'http://10.10.0.1:8090/',
];
const no = [
  'https://evil.example/?captiveportal',
  'https://evil.example/24online/login',
  'https://evil.example/?next=internet.lpu.in',
  'https://internet.lpu.in.evil.example/',
  'https://notinternet.lpu.in/',
  'http://172.16.0.301/',
  'javascript:alert(1)//internet.lpu.in',
  '',
  null,
  'not a url',
];
yes.forEach((u) => assert.strictEqual(isPortalURL(u), true, u));
no.forEach((u) => assert.strictEqual(isPortalURL(u), false, String(u)));
console.log('ok:', yes.length + no.length, 'cases');
