/**
 * LPU AutoConnect — Shared Constants
 * 
 * Central configuration for portal URLs, timing, and behavior.
 * 
 * NOTE: No ES module syntax (export/import) — this file is loaded via
 * importScripts() in MV3 service workers and via background.scripts in MV2.
 * All constants are defined as plain globals on the worker/window scope.
 */

// ─── Portal Detection URLs ───────────────────────────────────────────────────
// Known LPU 24Online/Cyberoam captive portal endpoints
// internet.lpu.in is the primary HTTPS portal the IPs redirect to
const PORTAL_URLS = [
  'https://internet.lpu.in/24online/webpages/client.jsp',
  'http://172.16.0.30:8090',
  'http://172.16.0.30',
  'http://172.16.68.6:8090',
  'http://172.16.68.6',
  'http://172.16.68.46:8090',
  'http://172.16.68.46',
  'http://phc.lpu.in:8090',
  'http://phc.lpu.in',
  'http://10.10.0.1:8090',
  'http://10.10.0.1',
];

// URL patterns used to identify if a page is a captive portal login
const PORTAL_URL_PATTERNS = [
  'internet.lpu.in',
  '172.16.0.30',
  '172.16.68.6',
  '172.16.68.46',
  'phc.lpu.in',
  '10.10.0.1',
  '24online',
  'cyberoam',
  'httpdClient',
  'userportal',
  'captiveportal',
];

// URL patterns that indicate a POST-LOGIN page (success/status page).
// We should NOT re-trigger login when we see these.
const POST_LOGIN_URL_PATTERNS = [
  'E24onlineHTTPClient',
  'servlet/',
  'keepalive',
  'logout',
  'statusmsg',
  'logged',
];

// ─── Connectivity Check Endpoints ────────────────────────────────────────────
// These return predictable responses when internet is working
const CONNECTIVITY_CHECK_URLS = [
  { url: 'http://connectivitycheck.gstatic.com/generate_204', expectedStatus: 204 },
  { url: 'http://clients3.google.com/generate_204', expectedStatus: 204 },
  { url: 'http://www.msftconnecttest.com/connecttest.txt', expectedStatus: 200 },
  { url: 'http://detectportal.firefox.com/success.txt', expectedStatus: 200 },
  { url: 'http://captive.apple.com/hotspot-detect.html', expectedStatus: 200 },
];

// ─── Portal Form Field Names ─────────────────────────────────────────────────
const FORM_FIELDS = {
  USERNAME: 'username',
  PASSWORD: 'password',
  TERMS_CHECKBOX: 'agreepolicy',
  LOGIN_BUTTON: 'loginbtn',
};

// ─── Timing Configuration (in milliseconds) ─────────────────────────────────

// Periodic connectivity check interval (every 45 seconds)
const CHECK_INTERVAL_MS = 45 * 1000;

// Alarm name for periodic checks (Chrome alarms API, minimum 1 min)
const ALARM_NAME = 'lpu-connectivity-check';
const ALARM_PERIOD_MINUTES = 1;

// Retry backoff configuration
const RETRY_CONFIG = {
  MAX_SILENT_RETRIES: 5,          // Retries before showing notification
  MAX_TOTAL_RETRIES: 10,          // Retries before opening visible portal tab
  INITIAL_DELAY_MS: 2000,         // First retry delay
  MAX_DELAY_MS: 30000,            // Maximum backoff delay
  BACKOFF_MULTIPLIER: 1.5,        // Exponential backoff factor
};

// Time to wait for portal page to load before injecting (ms)
const PORTAL_LOAD_TIMEOUT_MS = 8000;

// Time to keep the login tab open after successful login (ms)
const TAB_CLOSE_DELAY_MS = 3000;

// Cooldown after a successful login — don't re-trigger login for this period (ms)
// Prevents re-injection on post-login redirect pages
const LOGIN_COOLDOWN_MS = 20 * 1000;

// ─── Storage Keys ────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  USERNAME: 'lpu_username',
  PASSWORD: 'lpu_password',
  CREDENTIALS_SAVED: 'lpu_credentials_saved',
  LAST_LOGIN_TIME: 'lpu_last_login_time',
  LAST_LOGIN_STATUS: 'lpu_last_login_status',
  CONNECTION_STATUS: 'lpu_connection_status',
  LOGIN_ATTEMPTS: 'lpu_login_attempts',
  EXTENSION_ENABLED: 'lpu_extension_enabled',
  AUTO_LOGIN_ENABLED: 'lpu_auto_login',
  NOTIFICATIONS_ENABLED: 'lpu_notifications',
  RETRY_COUNT: 'lpu_retry_count',
};

// ─── Connection States ───────────────────────────────────────────────────────
const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  PORTAL_DETECTED: 'portal_detected',
  LOGIN_FAILED: 'login_failed',
  UNKNOWN: 'unknown',
};

// ─── Message Types (inter-component communication) ───────────────────────────
const MSG = {
  // Background → Content / Popup
  LOGIN_REQUEST: 'LOGIN_REQUEST',
  STATUS_UPDATE: 'STATUS_UPDATE',
  
  // Content → Background
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PORTAL_DETECTED: 'PORTAL_DETECTED',
  PORTAL_READY: 'PORTAL_READY',
  
  // Popup → Background
  GET_STATUS: 'GET_STATUS',
  FORCE_RECONNECT: 'FORCE_RECONNECT',
  GET_CREDENTIALS: 'GET_CREDENTIALS',
  SAVE_CREDENTIALS: 'SAVE_CREDENTIALS',
  OPEN_SETTINGS: 'OPEN_SETTINGS',
  
  // Options → Background
  CREDENTIALS_UPDATED: 'CREDENTIALS_UPDATED',
  TEST_CONNECTION: 'TEST_CONNECTION',
};

// ─── Notification IDs ────────────────────────────────────────────────────────
const NOTIFICATION_IDS = {
  LOGIN_SUCCESS: 'lpu-login-success',
  LOGIN_FAILED: 'lpu-login-failed',
  RECONNECTING: 'lpu-reconnecting',
  SETUP_REQUIRED: 'lpu-setup-required',
};
