/**
 * LPU AutoConnect — Options Page Script
 * 
 * Handles credential management, preference toggles, and connection testing.
 */

(function () {
  'use strict';

  const MSG = {
    SAVE_CREDENTIALS: 'SAVE_CREDENTIALS',
    GET_CREDENTIALS: 'GET_CREDENTIALS',
    CREDENTIALS_UPDATED: 'CREDENTIALS_UPDATED',
    TEST_CONNECTION: 'TEST_CONNECTION',
  };

  const STORAGE_KEYS = {
    EXTENSION_ENABLED: 'lpu_extension_enabled',
    AUTO_LOGIN_ENABLED: 'lpu_auto_login',
    NOTIFICATIONS_ENABLED: 'lpu_notifications',
    CREDENTIALS_SAVED: 'lpu_credentials_saved',
  };

  // ─── DOM ────────────────────────────────────────────────────────────────
  const inputUsername = document.getElementById('input-username');
  const inputPassword = document.getElementById('input-password');
  const btnSave = document.getElementById('btn-save');
  const saveFeedback = document.getElementById('save-feedback');
  const togglePassword = document.getElementById('toggle-password');
  const eyeIcon = document.getElementById('eye-icon');
  const eyeOffIcon = document.getElementById('eye-off-icon');
  const setupHero = document.getElementById('setup-hero');
  const toggleAutoLogin = document.getElementById('toggle-autologin');
  const toggleNotifications = document.getElementById('toggle-notifications');
  const toggleEnabled = document.getElementById('toggle-enabled');
  const btnTest = document.getElementById('btn-test');
  const testResult = document.getElementById('test-result');

  // ─── Init ───────────────────────────────────────────────────────────────

  async function init() {
    // Show setup hero if ?setup=true
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') === 'true') {
      setupHero.style.display = 'flex';
    }

    // Load existing credentials
    try {
      const creds = await sendMessage({ type: MSG.GET_CREDENTIALS });
      if (creds.username) inputUsername.value = creds.username;
      if (creds.password) inputPassword.value = creds.password;
    } catch (e) {
      console.error('Failed to load credentials:', e);
    }

    // Load toggle states
    chrome.storage.local.get([
      STORAGE_KEYS.EXTENSION_ENABLED,
      STORAGE_KEYS.AUTO_LOGIN_ENABLED,
      STORAGE_KEYS.NOTIFICATIONS_ENABLED,
    ], (result) => {
      toggleEnabled.checked = result[STORAGE_KEYS.EXTENSION_ENABLED] !== false;
      toggleAutoLogin.checked = result[STORAGE_KEYS.AUTO_LOGIN_ENABLED] !== false;
      toggleNotifications.checked = result[STORAGE_KEYS.NOTIFICATIONS_ENABLED] !== false;
    });

    // Event listeners
    btnSave.addEventListener('click', handleSave);
    togglePassword.addEventListener('click', handleTogglePassword);
    btnTest.addEventListener('click', handleTest);

    toggleEnabled.addEventListener('change', () => {
      chrome.storage.local.set({ [STORAGE_KEYS.EXTENSION_ENABLED]: toggleEnabled.checked });
    });
    toggleAutoLogin.addEventListener('change', () => {
      chrome.storage.local.set({ [STORAGE_KEYS.AUTO_LOGIN_ENABLED]: toggleAutoLogin.checked });
    });
    toggleNotifications.addEventListener('change', () => {
      chrome.storage.local.set({ [STORAGE_KEYS.NOTIFICATIONS_ENABLED]: toggleNotifications.checked });
    });

    // Enter key saves
    inputPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSave();
    });
  }

  // ─── Save Credentials ───────────────────────────────────────────────────

  async function handleSave() {
    const username = inputUsername.value.trim();
    const password = inputPassword.value;

    if (!username) {
      showFeedback('Please enter your registration number', 'error');
      inputUsername.classList.add('error');
      inputUsername.focus();
      return;
    }
    if (!password) {
      showFeedback('Please enter your password', 'error');
      inputPassword.classList.add('error');
      inputPassword.focus();
      return;
    }

    inputUsername.classList.remove('error');
    inputPassword.classList.remove('error');
    btnSave.disabled = true;

    try {
      const result = await sendMessage({
        type: MSG.SAVE_CREDENTIALS,
        data: { username, password },
      });

      if (result.ok) {
        // Update username field with sanitized value
        if (result.sanitizedUsername) {
          inputUsername.value = result.sanitizedUsername;
        }
        showFeedback('✓ Credentials saved successfully', 'success');
        setupHero.style.display = 'none';
        // Notify background to re-check
        sendMessage({ type: MSG.CREDENTIALS_UPDATED });
      } else {
        showFeedback(result.error || 'Failed to save', 'error');
      }
    } catch (e) {
      showFeedback('Error: ' + e.message, 'error');
    } finally {
      btnSave.disabled = false;
    }
  }

  // ─── Password Toggle ────────────────────────────────────────────────────

  function handleTogglePassword() {
    const isPassword = inputPassword.type === 'password';
    inputPassword.type = isPassword ? 'text' : 'password';
    eyeIcon.style.display = isPassword ? 'none' : 'block';
    eyeOffIcon.style.display = isPassword ? 'block' : 'none';
  }

  // ─── Connection Test ─────────────────────────────────────────────────────

  async function handleTest() {
    btnTest.disabled = true;
    testResult.textContent = 'Checking...';
    testResult.className = 'test-result checking';

    try {
      const result = await sendMessage({ type: MSG.TEST_CONNECTION });
      if (result.connected) {
        testResult.textContent = '✓ Internet is connected';
        testResult.className = 'test-result success';
      } else if (result.redirected) {
        testResult.textContent = '⚠ Captive portal detected';
        testResult.className = 'test-result failure';
      } else {
        testResult.textContent = '✗ No internet connection';
        testResult.className = 'test-result failure';
      }
    } catch (e) {
      testResult.textContent = '✗ Check failed: ' + e.message;
      testResult.className = 'test-result failure';
    } finally {
      btnTest.disabled = false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function showFeedback(msg, type) {
    saveFeedback.textContent = msg;
    saveFeedback.className = 'save-feedback ' + type;
    setTimeout(() => {
      saveFeedback.textContent = '';
      saveFeedback.className = 'save-feedback';
    }, 4000);
  }

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

  document.addEventListener('DOMContentLoaded', init);
})();
