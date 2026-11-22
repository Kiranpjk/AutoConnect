// Loads src/shared/*.js (plain browser scripts, no exports) into a sandbox
// and returns the globals they define.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function loadShared(extra = {}) {
  const ctx = vm.createContext({ URL, AbortController, console, setTimeout, clearTimeout, ...extra });
  for (const f of ['constants.js', 'utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared', f), 'utf8'), ctx, { filename: f });
  }
  return (name) => vm.runInContext(name, ctx);
};
