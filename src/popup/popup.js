/**
 * LPU AutoConnect — Popup Script
 * 
 * Controls the popup UI:
 * - Fetches current status from background
 * - Updates status display, last login time, attempt count
 * - Handles reconnect and settings button clicks
 * - Shows setup banner if no credentials saved
 */

(function () {
  'use strict';

  // ─── Message Types (inline, no module imports in popup) ──────────────────
  const MSG = {
    GET_STATUS: 'GET_STATUS',
    FORCE_RECONNECT: 'FORCE_RECONNECT',
    OPEN_SETTINGS: 'OPEN_SETTINGS',
  };

  const STORAGE_KEYS = {
    CONNECTION_STATUS: 'lpu_connection_status',
    LAST_LOGIN_TIME: 'lpu_last_login_time',
    LAST_LOGIN_STATUS: 'lpu_last_login_status',
    RETRY_COUNT: 'lpu_retry_count',
    LOGIN_ATTEMPTS: 'lpu_login_attempts',
    CREDENTIALS_SAVED: 'lpu_credentials_saved',
    EXTENSION_ENABLED: 'lpu_extension_enabled',
    AUTO_LOGIN_ENABLED: 'lpu_auto_login',
  };

  const STATUS_LABELS = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    portal_detected: 'Portal Detected',
    login_failed: 'Login Failed',
    unknown: 'Checking...',
  };

  // ─── DOM References ──────────────────────────────────────────────────────
  const statusCard = document.getElementById('status-card');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const lastLoginEl = document.getElementById('last-login');
  const loginAttemptsEl = document.getElementById('login-attempts');
  const btnReconnect = document.getElementById('btn-reconnect');
  const btnSettings = document.getElementById('btn-settings');
  const setupBanner = document.getElementById('setup-banner');
  const setupLink = document.getElementById('setup-link');

  // ─── Initialization ──────────────────────────────────────────────────────

  async function init() {
    // Fetch status from background
    await refreshStatus();

    // Set up event listeners
    btnReconnect.addEventListener('click', handleReconnect);
    btnSettings.addEventListener('click', handleSettings);
    setupLink.addEventListener('click', handleSettings);

    // Auto-refresh status every 3 seconds while popup is open
    setInterval(refreshStatus, 3000);
  }

  // ─── Status Refresh ──────────────────────────────────────────────────────

  async function refreshStatus() {
    try {
      const status = await sendMessage({ type: MSG.GET_STATUS });
      updateUI(status);
    } catch (err) {
      console.error('[Popup] Failed to get status:', err);
      statusText.textContent = 'Error';
    }
  }

  function updateUI(status) {
    const connStatus = status[STORAGE_KEYS.CONNECTION_STATUS] || 'unknown';
    const lastLogin = status[STORAGE_KEYS.LAST_LOGIN_TIME];
    const attempts = status[STORAGE_KEYS.LOGIN_ATTEMPTS] || 0;
    const credsSaved = status[STORAGE_KEYS.CREDENTIALS_SAVED] || false;

    // Update status indicator
    const label = STATUS_LABELS[connStatus] || 'Unknown';
    statusText.textContent = label;
    statusText.className = `status-text ${connStatus}`;
    statusDot.className = `status-dot ${connStatus}`;

    // Update status card border
    statusCard.className = 'status-card';
    if (connStatus === 'connected') statusCard.classList.add('connected');
    else if (connStatus === 'disconnected' || connStatus === 'login_failed') statusCard.classList.add('disconnected');
    else if (connStatus === 'connecting' || connStatus === 'portal_detected') statusCard.classList.add('connecting');

    // Update last login time
    lastLoginEl.textContent = formatTimestamp(lastLogin);

    // Update attempt count
    loginAttemptsEl.textContent = attempts.toString();

    // Show/hide setup banner
    setupBanner.style.display = credsSaved ? 'none' : 'flex';

    // Disable reconnect if already connecting
    btnReconnect.disabled = connStatus === 'connecting';
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  async function handleReconnect(e) {
    e.preventDefault();
    btnReconnect.disabled = true;
    btnReconnect.classList.add('loading');

    try {
      await sendMessage({ type: MSG.FORCE_RECONNECT });
      // Wait a moment then refresh
      setTimeout(async () => {
        await refreshStatus();
        btnReconnect.disabled = false;
        btnReconnect.classList.remove('loading');
      }, 2000);
    } catch (err) {
      console.error('[Popup] Reconnect failed:', err);
      btnReconnect.disabled = false;
      btnReconnect.classList.remove('loading');
    }
  }

  function handleSettings(e) {
    e.preventDefault();
    sendMessage({ type: MSG.OPEN_SETTINGS });
    window.close(); // Close popup
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Never';

    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;

    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
