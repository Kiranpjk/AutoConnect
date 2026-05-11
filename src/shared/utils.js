/**
 * LPU AutoConnect — Shared Utilities
 * 
 * Helper functions used across background, content, and UI scripts.
 * 
 * NOTE: No ES module syntax (export/import) — this file is loaded via
 * importScripts() in MV3 service workers and via background.scripts in MV2.
 * All functions are defined as plain globals. Constants from constants.js
 * are expected to already be in scope when this file loads.
 */

/**
 * Sanitize username input:
 * - Remove @lpu.in, @lpu.com suffixes
 * - Strip all non-numeric characters
 * - Returns only the numeric registration number
 * 
 * @param {string} raw - Raw username input
 * @returns {string} Sanitized numeric registration number
 */
function sanitizeUsername(raw) {
  if (!raw || typeof raw !== 'string') return '';
  
  let cleaned = raw.trim();
  
  // Remove common email suffixes (case-insensitive)
  cleaned = cleaned.replace(/@lpu\.in$/i, '');
  cleaned = cleaned.replace(/@lpu\.com$/i, '');
  cleaned = cleaned.replace(/@.*$/i, ''); // Remove any other domain suffix
  
  // Extract only numeric characters (registration number)
  cleaned = cleaned.replace(/\D/g, '');
  
  return cleaned;
}

/**
 * Check if a URL belongs to a known captive portal
 * 
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isPortalURL(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return PORTAL_URL_PATTERNS.some(function(pattern) { return lower.includes(pattern); });
}

/**
 * Check if a URL is a post-login page (success/status/servlet redirect).
 * These pages still match portal URL patterns but should NOT trigger re-login.
 * 
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isPostLoginURL(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return POST_LOGIN_URL_PATTERNS.some(function(pattern) { return lower.includes(pattern.toLowerCase()); });
}

/**
 * Check internet connectivity by hitting known check endpoints.
 * Uses a race pattern: first successful response wins.
 * 
 * Returns { connected, redirected, redirectUrl }
 * - connected: true if internet is working
 * - redirected: true if response was a redirect (portal detected)
 * - redirectUrl: the URL we were redirected to (if any)
 * 
 * @returns {Promise<{connected: boolean, redirected: boolean, redirectUrl: string|null}>}
 */
async function checkConnectivity() {
  // Try multiple endpoints, first valid response wins
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // Pick 2 random endpoints to reduce server load
    const shuffled = [...CONNECTIVITY_CHECK_URLS].sort(() => Math.random() - 0.5);
    const endpoints = shuffled.slice(0, 2);
    
    const results = await Promise.allSettled(
      endpoints.map(async ({ url, expectedStatus }) => {
        const response = await fetch(url, {
          method: 'HEAD',
          cache: 'no-store',
          redirect: 'manual', // Don't follow redirects — we want to detect them
          signal: controller.signal,
        });

        // Status 0 with opaqueredirect type means redirect happened
        if (response.type === 'opaqueredirect') {
          return { connected: false, redirected: true, redirectUrl: response.url || url };
        }

        // 3xx redirect = captive portal intercepting
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location');
          return { connected: false, redirected: true, redirectUrl: location || url };
        }

        // Expected status = internet is working
        if (response.status === expectedStatus || response.ok) {
          return { connected: true, redirected: false, redirectUrl: null };
        }

        throw new Error(`Unexpected status: ${response.status}`);
      })
    );

    // Check results: any fulfilled response is authoritative
    for (const result of results) {
      if (result.status === 'fulfilled') {
        clearTimeout(timeout);
        return result.value;
      }
    }

    // All failed — likely no internet
    clearTimeout(timeout);
    return { connected: false, redirected: false, redirectUrl: null };
  } catch (err) {
    clearTimeout(timeout);
    // Network error = no connectivity
    return { connected: false, redirected: false, redirectUrl: null };
  }
}

/**
 * Calculate exponential backoff delay
 * 
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Initial delay in ms
 * @param {number} maxDelay - Maximum delay cap in ms
 * @param {number} multiplier - Backoff multiplier
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt, baseDelay, maxDelay, multiplier) {
  baseDelay = baseDelay || 2000;
  maxDelay = maxDelay || 30000;
  multiplier = multiplier || 1.5;
  // Add jitter (±20%) to prevent thundering herd
  const jitter = 0.8 + Math.random() * 0.4;
  const delay = Math.min(baseDelay * Math.pow(multiplier, attempt) * jitter, maxDelay);
  return Math.round(delay);
}

/**
 * Format a timestamp for display
 * 
 * @param {number|string|null} timestamp - Unix timestamp or ISO string
 * @returns {string} Human-readable time string
 */
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

/**
 * Safe wrapper for chrome.storage.local.get
 * Uses browser.storage on Firefox, chrome.storage on Chrome/Edge
 * 
 * @param {string|string[]|object} keys - Keys to retrieve
 * @returns {Promise<object>}
 */
function storageGet(keys) {
  var api = (typeof browser !== 'undefined' && browser.storage) ? browser : chrome;
  return new Promise(function(resolve, reject) {
    try {
      api.storage.local.get(keys, function(result) {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Safe wrapper for chrome.storage.local.set
 * Uses browser.storage on Firefox, chrome.storage on Chrome/Edge
 * 
 * @param {object} data - Key-value pairs to store
 * @returns {Promise<void>}
 */
function storageSet(data) {
  var api = (typeof browser !== 'undefined' && browser.storage) ? browser : chrome;
  return new Promise(function(resolve, reject) {
    try {
      api.storage.local.set(data, function() {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Debounce function — prevents rapid-fire execution
 * 
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {Function}
 */
function debounce(fn, delay) {
  var timer = null;
  return function () {
    var args = arguments;
    var context = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(context, args); }, delay);
  };
}

/**
 * Log with prefix for easy filtering in console
 * 
 * @param {string} module - Module name
 * @param  {...any} args - Log arguments
 */
function log(module) {
  var args = Array.prototype.slice.call(arguments, 1);
  args.unshift('[LPU AutoConnect][' + module + ']');
  console.log.apply(console, args);
}

/**
 * Error log with prefix
 * 
 * @param {string} module - Module name
 * @param  {...any} args - Log arguments
 */
function logError(module) {
  var args = Array.prototype.slice.call(arguments, 1);
  args.unshift('[LPU AutoConnect][' + module + ']');
  console.error.apply(console, args);
}
