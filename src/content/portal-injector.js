/**
 * LPU AutoConnect — Content Script (Portal Injector)
 * 
 * Injected into captive portal pages. Handles:
 * 1. Detecting the login form on the portal page
 * 2. Requesting credentials from the background service worker
 * 3. Auto-filling username, password, and terms checkbox
 * 4. Submitting the form
 * 5. Detecting login success or failure
 * 6. Reporting result back to background
 * 
 * This script runs in the page context via content_scripts manifest entry
 * or via chrome.scripting.executeScript from the background.
 * 
 * NOTE: This file does NOT use ES module imports since content scripts
 *       cannot use module syntax. Constants are inlined.
 */

(function () {
  'use strict';

  // ─── Inline Constants (no module imports in content scripts) ─────────────
  const FORM_FIELDS = {
    USERNAME: 'username',
    PASSWORD: 'password',
    TERMS_CHECKBOX: 'agreepolicy',
    LOGIN_BUTTON: 'loginbtn',
  };

  const MSG = {
    LOGIN_REQUEST: 'LOGIN_REQUEST',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PORTAL_DETECTED: 'PORTAL_DETECTED',
    PORTAL_READY: 'PORTAL_READY',
  };

  // Prevent double-injection
  if (window.__lpuAutoConnectInjected) return;
  window.__lpuAutoConnectInjected = true;

  const PREFIX = '[LPU AutoConnect][Content]';

  // ─── Portal Detection ──────────────────────────────────────────────────────

  /**
   * Check if the current page has a login form that matches
   * the LPU 24Online/Cyberoam portal.
   */
  function detectPortalForm() {
    // Look for the username field (most reliable indicator)
    const usernameField = findField(FORM_FIELDS.USERNAME);
    const passwordField = findField(FORM_FIELDS.PASSWORD);

    if (usernameField && passwordField) {
      console.log(PREFIX, 'Portal login form detected');
      return true;
    }

    // Fallback: look for common portal indicators in page content
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    const indicators = [
      '24online',
      'cyberoam',
      'captive portal',
      'internet login',
      'network login',
      'web authentication',
      'hotspot login',
      'lpu wifi',
    ];

    if (indicators.some(ind => bodyText.includes(ind))) {
      console.log(PREFIX, 'Portal page detected via content indicators');
      return true;
    }

    return false;
  }

  /**
   * Find a form field by name, id, or common selectors
   */
  function findField(fieldName) {
    // Try by name attribute first (most reliable for 24Online)
    let el = document.querySelector(`input[name="${fieldName}"]`);
    if (el) return el;

    // Try by ID
    el = document.getElementById(fieldName);
    if (el) return el;

    // Try by name pattern (case-insensitive)
    el = document.querySelector(`input[name*="${fieldName}" i]`);
    if (el) return el;

    // For checkbox, also try by type
    if (fieldName === FORM_FIELDS.TERMS_CHECKBOX) {
      el = document.querySelector('input[type="checkbox"][name*="cond" i]') ||
           document.querySelector('input[type="checkbox"][name*="agree" i]') ||
           document.querySelector('input[type="checkbox"][name*="term" i]') ||
           document.querySelector('input[type="checkbox"][id*="cond" i]');
      if (el) return el;
    }

    return null;
  }

  /**
   * Find the submit button
   */
  function findSubmitButton() {
    // Try common patterns
    const selectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[name="btnSubmit"]',
      'input[name="login"]',
      'button[name="login"]',
      'input[value="Login" i]',
      'input[value="Sign In" i]',
      'input[value="Log In" i]',
      'input[value="Submit" i]',
      'button:not([type="reset"])',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return null;
  }

  // ─── Login Logic ───────────────────────────────────────────────────────────

  /**
   * Fill the login form and submit it
   * 
   * @param {string} username - Sanitized registration number
   * @param {string} password - User's password
   */
  function performLogin(username, password) {
    console.log(PREFIX, 'Performing auto-login...');

    const usernameField = findField(FORM_FIELDS.USERNAME);
    const passwordField = findField(FORM_FIELDS.PASSWORD);
    const termsCheckbox = findField(FORM_FIELDS.TERMS_CHECKBOX);
    const submitButton = findSubmitButton();

    if (!usernameField || !passwordField) {
      console.error(PREFIX, 'Cannot find login form fields');
      reportFailure('Login form fields not found');
      return;
    }

    try {
      // Clear and fill username
      usernameField.focus();
      usernameField.value = '';
      setNativeValue(usernameField, username);
      triggerInputEvents(usernameField);

      // Clear and fill password
      passwordField.focus();
      passwordField.value = '';
      setNativeValue(passwordField, password);
      triggerInputEvents(passwordField);

      // Check terms checkbox
      if (termsCheckbox) {
        if (!termsCheckbox.checked) {
          termsCheckbox.click(); // Using click() is better than .checked = true for triggering listeners
          console.log(PREFIX, 'Terms checkbox clicked');
        }
      } else {
        console.warn(PREFIX, 'Terms checkbox not found, attempting login anyway');
      }

      console.log(PREFIX, 'Form filled, submitting...');

      // Submit the form after a brief delay
      setTimeout(() => {
        const loginBtn = document.getElementById(FORM_FIELDS.LOGIN_BUTTON) || submitButton;
        
        if (loginBtn) {
          loginBtn.focus();
          loginBtn.click();
          console.log(PREFIX, 'Login button clicked');
        } else {
          // Fallback: submit the form directly
          const form = usernameField.closest('form');
          if (form) {
            form.submit();
            console.log(PREFIX, 'Form submitted directly');
          } else {
            console.error(PREFIX, 'No submit button or form found');
            reportFailure('No submit button or form found');
            return;
          }
        }

        // Monitor for success/failure after submission
        monitorLoginResult();
      }, 800);

    } catch (err) {
      console.error(PREFIX, 'Login error:', err.message);
      reportFailure(err.message);
    }
  }

  /**
   * Set value using native setter to bypass React/framework protections
   * (Some portals use frameworks that don't detect .value = assignment)
   */
  function setNativeValue(element, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  /**
   * Trigger realistic input events so form validators detect the change
   */
  function triggerInputEvents(element) {
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ─── Result Monitoring ─────────────────────────────────────────────────────

  /**
   * After form submission, monitor the page for success/failure indicators.
   * 
   * Success indicators: redirect to success page, "logged in" text, etc.
   * Failure indicators: "invalid", "wrong", error messages, etc.
   */
  function monitorLoginResult() {
    let checkCount = 0;
    const maxChecks = 20; // Check for 10 seconds (20 × 500ms)

    const checker = setInterval(() => {
      checkCount++;

      const bodyText = (document.body?.innerText || '').toLowerCase();
      const currentUrl = window.location.href.toLowerCase();

      // ─── Success Indicators ──────────────────────────────
      const successPatterns = [
        'you have successfully logged in',
        'successfully authenticated',
        'login successful',
        'you are logged in',
        'welcome',
        'already logged in',
        'internet access granted',
        'you have signed in',
        'session is active',
        'logout',  // If logout button appears, login was successful
      ];

      // Check URL for success indicators
      const urlSuccessPatterns = [
        'logon=done',
        'status=success',
        'login=success',
        'authenticated',
      ];

      if (successPatterns.some(p => bodyText.includes(p)) ||
          urlSuccessPatterns.some(p => currentUrl.includes(p))) {
        clearInterval(checker);
        console.log(PREFIX, '✓ Login SUCCESS detected');
        reportSuccess();
        return;
      }

      // Special check: if the URL has changed significantly and contains success-like indicators
      if (!currentUrl.includes('client.jsp') && 
          (currentUrl.includes('servlet') || currentUrl.includes('HTTPClient'))) {
        clearInterval(checker);
        console.log(PREFIX, '✓ Login SUCCESS inferred from URL change');
        reportSuccess();
        return;
      }

      // ─── Failure Indicators ──────────────────────────────
      const failurePatterns = [
        'invalid username',
        'invalid password',
        'wrong password',
        'authentication failed',
        'login failed',
        'incorrect credentials',
        'account locked',
        'account disabled',
        'maximum login limit',
        'user does not exist',
        'invalid credentials',
        'please tick that you agree',
      ];

      if (failurePatterns.some(p => bodyText.includes(p))) {
        clearInterval(checker);
        const matchedPattern = failurePatterns.find(p => bodyText.includes(p));
        console.error(PREFIX, '✗ Login FAILED:', matchedPattern);
        reportFailure(matchedPattern || 'Authentication failed');
        return;
      }

      // Timeout after max checks
      if (checkCount >= maxChecks) {
        clearInterval(checker);
        // Do NOT automatically report success here to avoid false positives.
        // Instead, let the background script's own connectivity check decide.
        console.log(PREFIX, 'Monitoring timeout - no clear result');
      }
    }, 500);
  }

  // ─── Communication with Background ─────────────────────────────────────────

  function reportSuccess() {
    try {
      chrome.runtime.sendMessage({ type: MSG.LOGIN_SUCCESS });
    } catch (e) {
      console.error(PREFIX, 'Failed to send success message:', e.message);
    }
  }

  function reportFailure(reason) {
    try {
      chrome.runtime.sendMessage({
        type: MSG.LOGIN_FAILED,
        data: { reason: reason },
      });
    } catch (e) {
      console.error(PREFIX, 'Failed to send failure message:', e.message);
    }
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────────

  function init() {
    console.log(PREFIX, 'Content script loaded on:', window.location.href);

    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  function onReady() {
    // Small delay to let portal JS initialize
    setTimeout(function() {
      var currentUrl = window.location.href.toLowerCase();

      // Skip post-login pages (servlet responses, status pages, keepalive, etc.)
      // These pages match portal URL patterns but have no login form.
      var postLoginPatterns = [
        'e24onlinehttpclient',
        'servlet/',
        'keepalive',
        'statusmsg',
        'logout',
      ];
      if (postLoginPatterns.some(function(p) { return currentUrl.includes(p); })) {
        console.log(PREFIX, 'Post-login page detected, skipping:', currentUrl);
        // Check if this is actually a success page
        var bodyText = (document.body && document.body.innerText || '').toLowerCase();
        if (bodyText.includes('successfully') || bodyText.includes('logged in') ||
            bodyText.includes('welcome') || bodyText.includes('logout')) {
          console.log(PREFIX, 'Success page detected on post-login URL');
          reportSuccess();
        }
        return;
      }

      // Check if already logged in (page shows logout button or success text)
      var bodyText = (document.body && document.body.innerText || '').toLowerCase();
      if (bodyText.includes('you are already logged in') || bodyText.includes('already logged')) {
        console.log(PREFIX, 'Already logged in detected');
        reportSuccess();
        return;
      }

      if (detectPortalForm()) {
        console.log(PREFIX, 'Portal form found — requesting credentials');

        // Tell background we found a portal and need credentials
        chrome.runtime.sendMessage(
          { type: MSG.PORTAL_READY },
          function(response) {
            if (chrome.runtime.lastError) {
              console.error(PREFIX, 'Error getting credentials:', chrome.runtime.lastError.message);
              return;
            }

            if (response && response.type === MSG.LOGIN_REQUEST && response.username && response.password) {
              performLogin(response.username, response.password);
            } else {
              console.log(PREFIX, 'No valid credentials received');
              reportFailure('No credentials available');
            }
          }
        );
      } else {
        console.log(PREFIX, 'No portal form detected on this page');
      }
    }, 1000); // 1s delay for portal JS to initialize
  }

  // Run!
  init();
})();
