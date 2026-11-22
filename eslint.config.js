const js = require('@eslint/js');
const globals = require('globals');

// Extension scripts are classic (non-module) scripts that share globals:
// constants.js and utils.js define top-level names used by the other files.
const constantNames = [
  'PORTAL_URLS', 'PORTAL_HOSTS', 'POST_LOGIN_URL_PATTERNS', 'CONNECTIVITY_CHECK_URLS',
  'FORM_FIELDS', 'CHECK_INTERVAL_MS', 'ALARM_NAME', 'ALARM_PERIOD_MINUTES', 'RETRY_CONFIG',
  'PORTAL_LOAD_TIMEOUT_MS', 'TAB_CLOSE_DELAY_MS', 'LOGIN_COOLDOWN_MS', 'STORAGE_KEYS',
  'CONNECTION_STATUS', 'MSG', 'NOTIFICATION_IDS',
];
const utilNames = [
  'sanitizeUsername', 'isPortalURL', 'isPostLoginURL', 'checkConnectivity', 'getBackoffDelay',
  'formatTimestamp', 'storageGet', 'storageSet', 'debounce', 'log', 'logError',
];
const readonly = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

module.exports = [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker },
    },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    // The shared files define these globals, so only the other scripts get them.
    files: ['src/**/*.js'],
    ignores: ['src/shared/*.js'],
    languageOptions: { globals: readonly([...constantNames, ...utilNames]) },
  },
  {
    files: ['src/shared/utils.js'],
    languageOptions: { globals: readonly(constantNames) },
  },
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
  },
];
