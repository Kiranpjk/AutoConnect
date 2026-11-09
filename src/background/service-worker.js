/**
 * LPU AutoConnect — Background Service Worker / Background Script
 * 
 * The brain of the extension. Handles:
 * 1. Periodic connectivity checks via alarms
 * 2. Captive portal detection (passive + active)
 * 3. Login orchestration (open tab → inject → verify → close)
 * 4. Retry/backoff logic with failure escalation
 * 5. Inter-component messaging (popup, options, content scripts)
 * 6. Browser lifecycle events (install, startup, wake)
 * 
 * COMPATIBILITY:
 * - Chrome/Edge MV3: Loaded as service_worker, uses importScripts()
 * - Firefox MV2: Loaded via background.scripts array (constants + utils already in scope)
 */

// ─── Load shared modules ─────────────────────────────────────────────────────
// importScripts works in MV3 service workers (non-module mode).
// In Firefox MV2, these files are loaded via background.scripts in manifest,
// so they're already in scope. We guard with try-catch for safety.
try {
  importScripts('../shared/constants.js', '../shared/utils.js');
} catch (e) {
  // Firefox MV2: scripts already loaded via manifest background.scripts
  // Or running in a context where importScripts isn't available
  console.log('[LPU AutoConnect][BG] importScripts skipped (likely Firefox MV2)');
}

// ─── State ───────────────────────────────────────────────────────────────────
var isLoginInProgress = false;
var retryCount = 0;
var checkTimer = null;

// Track pending login tabs and their timeouts
var pendingLogins = new Map();

// Cooldown: timestamp of last successful login.
// Prevents re-triggering login on post-login redirect pages.
var lastLoginSuccessTime = 0;

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Called on extension install or update.
 * Sets default storage values and opens setup page if first install.
 */
chrome.runtime.onInstalled.addListener(function(details) {
  log('BG', 'Extension ' + details.reason + ': v' + chrome.runtime.getManifest().version);
  
  // Set defaults on first install
  if (details.reason === 'install') {
    storageSet({
      [STORAGE_KEYS.EXTENSION_ENABLED]: true,
      [STORAGE_KEYS.AUTO_LOGIN_ENABLED]: true,
      [STORAGE_KEYS.NOTIFICATIONS_ENABLED]: true,
      [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.UNKNOWN,
      [STORAGE_KEYS.RETRY_COUNT]: 0,
      [STORAGE_KEYS.LOGIN_ATTEMPTS]: 0,
    });

    // Open setup page for first-time credential input
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html?setup=true'),
      active: true,
    });
  }

  // Always (re)start the alarm on install/update
  setupAlarms();
});

/**
 * Called when browser starts with extension already installed.
 * Re-initializes alarms and runs an immediate connectivity check.
 */
chrome.runtime.onStartup.addListener(function() {
  log('BG', 'Browser startup detected');
  setupAlarms();
  
  // Slight delay to let network interfaces come up
  setTimeout(function() { runConnectivityCheck(); }, 5000);
});

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

/**
 * Configure periodic alarm for connectivity checks.
 * Chrome alarms API has a minimum of 1 minute for periodInMinutes.
 * We supplement with a faster setInterval for sub-minute checks.
 */
function setupAlarms() {
  // Clear any existing alarm
  chrome.alarms.clear(ALARM_NAME, function() {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0.5,  // First check after 30s
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
    log('BG', 'Alarm "' + ALARM_NAME + '" created (every ' + ALARM_PERIOD_MINUTES + 'min)');
  });
  
  // Supplement with faster interval checks (every 45s)
  // Service worker may be killed, but alarm will revive it
  clearInterval(checkTimer);
  checkTimer = setInterval(function() { runConnectivityCheck(); }, CHECK_INTERVAL_MS);
}

/**
 * Alarm listener — runs connectivity check on each alarm tick.
 */
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === ALARM_NAME) {
    runConnectivityCheck();
  }
});

// ─── Connectivity Check ──────────────────────────────────────────────────────

/**
 * Core connectivity check routine.
 * Determines if internet is available or if portal login is needed.
 */
async function runConnectivityCheck() {
  // Don't check if login is already in progress
  if (isLoginInProgress) {
    log('BG', 'Login in progress, skipping check');
    return;
  }

  // Don't check if we just logged in successfully (cooldown)
  if (Date.now() - lastLoginSuccessTime < LOGIN_COOLDOWN_MS) {
    log('BG', 'Within login cooldown, skipping check');
    return;
  }

  // Don't check if extension is disabled
  var settings = await storageGet({
    [STORAGE_KEYS.EXTENSION_ENABLED]: true,
  });
  if (!settings[STORAGE_KEYS.EXTENSION_ENABLED]) return;

  try {
    var result = await checkConnectivity();

    if (result.connected) {
      // Internet is working — reset retry state
      await handleConnected();
    } else if (result.redirected) {
      // Captive portal detected via redirect
      log('BG', 'Portal redirect detected:', result.redirectUrl);
      await handlePortalDetected(result.redirectUrl);
    } else {
      // No internet, no redirect — could be portal or actual outage
      log('BG', 'No connectivity detected');
      await handleDisconnected();
    }
  } catch (err) {
    logError('BG', 'Connectivity check error:', err.message);
    await handleDisconnected();
  }
}

/**
 * Handle confirmed internet connectivity
 */
async function handleConnected() {
  var prev = await storageGet({ [STORAGE_KEYS.CONNECTION_STATUS]: '' });
  var wasDisconnected = prev[STORAGE_KEYS.CONNECTION_STATUS] !== CONNECTION_STATUS.CONNECTED;
  
  retryCount = 0;
  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.CONNECTED,
    [STORAGE_KEYS.RETRY_COUNT]: 0,
  });

  if (wasDisconnected) {
    log('BG', '✓ Internet connected');
  }
}

/**
 * Handle captive portal detection
 */
async function handlePortalDetected(redirectUrl) {
  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.PORTAL_DETECTED,
  });
  
  await initiateLogin(redirectUrl);
}

/**
 * Handle no connectivity (no redirect detected)
 */
async function handleDisconnected() {
  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.DISCONNECTED,
  });
  
  // Attempt login — could be a portal that doesn't redirect cleanly
  await initiateLogin();
}

// ─── Login Orchestration ─────────────────────────────────────────────────────

/**
 * Main login flow:
 * 1. Check if credentials are saved
 * 2. Open portal URL in a background tab
 * 3. Wait for content script to detect and fill the form
 * 4. Handle success/failure
 * 
 * @param {string|null} portalUrl - Specific portal URL if known
 */
async function initiateLogin(portalUrl) {
  portalUrl = portalUrl || null;

  if (isLoginInProgress) {
    log('BG', 'Login already in progress, skipping');
    return;
  }

  // Check if auto-login is enabled
  var settings = await storageGet({
    [STORAGE_KEYS.AUTO_LOGIN_ENABLED]: true,
    [STORAGE_KEYS.CREDENTIALS_SAVED]: false,
  });

  if (!settings[STORAGE_KEYS.AUTO_LOGIN_ENABLED]) {
    log('BG', 'Auto-login disabled');
    return;
  }

  if (!settings[STORAGE_KEYS.CREDENTIALS_SAVED]) {
    log('BG', 'No credentials saved — prompting setup');
    showSetupNotification();
    return;
  }

  // Check retry limits
  if (retryCount >= RETRY_CONFIG.MAX_TOTAL_RETRIES) {
    log('BG', 'Max retries exceeded — opening visible portal');
    await openVisiblePortal(portalUrl);
    retryCount = 0;
    await storageSet({ [STORAGE_KEYS.RETRY_COUNT]: 0 });
    return;
  }

  isLoginInProgress = true;
  retryCount++;
  
  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.CONNECTING,
    [STORAGE_KEYS.RETRY_COUNT]: retryCount,
  });

  log('BG', 'Login attempt #' + retryCount);

  try {
    // Determine portal URL to use
    var targetUrl = portalUrl || PORTAL_URLS[0];

    // Open portal in a background tab (not active)
    var tab = await chrome.tabs.create({
      url: targetUrl,
      active: false,  // Background tab — user won't see it
      pinned: false,
    });

    log('BG', 'Opened portal tab ' + tab.id + ': ' + targetUrl);

    // Wait for content script to handle the login
    // Set a timeout in case the content script never responds
    var loginTimeout = setTimeout(async function() {
      log('BG', 'Login timeout — content script did not respond');
      await handleLoginFailure(tab.id, 'Timeout waiting for portal response');
    }, PORTAL_LOAD_TIMEOUT_MS + 10000);

    // Store the tab ID and timeout so message handler can clear it
    pendingLogins.set(tab.id, { timeout: loginTimeout, startTime: Date.now() });

  } catch (err) {
    logError('BG', 'Failed to open portal tab:', err.message);
    isLoginInProgress = false;
    await scheduleRetry();
  }
}

/**
 * Handle successful login response from content script
 */
async function handleLoginSuccess(tabId) {
  log('BG', '✓ Login successful via tab ' + tabId);
  
  // Cancel ALL pending login tabs — not just this one.
  // A different tab may have succeeded (e.g., passive detection tab succeeded
  // while our background tab is still loading). Cancel everything.
  pendingLogins.forEach(function(pending, pendingTabId) {
    clearTimeout(pending.timeout);
    // Close other pending login tabs
    if (pendingTabId !== tabId) {
      try {
        chrome.tabs.remove(pendingTabId);
        log('BG', 'Cancelled pending login tab ' + pendingTabId);
      } catch (e) { /* already closed */ }
    }
  });
  pendingLogins.clear();

  isLoginInProgress = false;
  retryCount = 0;
  lastLoginSuccessTime = Date.now();  // Start cooldown

  var now = Date.now();
  var prevData = await storageGet({ [STORAGE_KEYS.LOGIN_ATTEMPTS]: 0 });
  var prevAttempts = prevData[STORAGE_KEYS.LOGIN_ATTEMPTS] || 0;

  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.CONNECTED,
    [STORAGE_KEYS.LAST_LOGIN_TIME]: now,
    [STORAGE_KEYS.LAST_LOGIN_STATUS]: 'success',
    [STORAGE_KEYS.RETRY_COUNT]: 0,
    [STORAGE_KEYS.LOGIN_ATTEMPTS]: prevAttempts + 1,
  });

  // Close the successful login tab after a brief delay
  setTimeout(function() {
    try {
      chrome.tabs.remove(tabId);
      log('BG', 'Closed login tab ' + tabId);
    } catch (e) {
      // Tab may already be closed
    }
  }, TAB_CLOSE_DELAY_MS);

  // Show success notification (if enabled)
  showNotification(
    NOTIFICATION_IDS.LOGIN_SUCCESS,
    'LPU WiFi Connected',
    'Auto-login successful. You are now connected to the internet.',
    false  // Not requiring interaction
  );
}

/**
 * Handle failed login from content script or timeout
 */
async function handleLoginFailure(tabId, reason) {
  reason = reason || 'Unknown error';
  logError('BG', '✗ Login failed (tab ' + tabId + '): ' + reason);
  
  // Clear pending login timeout
  var pending = pendingLogins.get(tabId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingLogins.delete(tabId);
  }

  isLoginInProgress = false;

  await storageSet({
    [STORAGE_KEYS.LAST_LOGIN_STATUS]: 'failed',
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.LOGIN_FAILED,
  });

  // Close the failed tab
  try {
    chrome.tabs.remove(tabId);
  } catch (e) { /* Tab may already be closed */ }

  // Escalation logic
  if (retryCount >= RETRY_CONFIG.MAX_SILENT_RETRIES && retryCount < RETRY_CONFIG.MAX_TOTAL_RETRIES) {
    // Show notification after silent retries exhausted
    showNotification(
      NOTIFICATION_IDS.LOGIN_FAILED,
      'LPU AutoConnect — Login Failed',
      'Failed after ' + retryCount + ' attempts. Retrying... Click to open portal manually.',
      true
    );
  }

  await scheduleRetry();
}

/**
 * Schedule a retry with exponential backoff
 */
async function scheduleRetry() {
  var delay = getBackoffDelay(
    retryCount,
    RETRY_CONFIG.INITIAL_DELAY_MS,
    RETRY_CONFIG.MAX_DELAY_MS,
    RETRY_CONFIG.BACKOFF_MULTIPLIER
  );
  
  log('BG', 'Scheduling retry #' + (retryCount + 1) + ' in ' + Math.round(delay / 1000) + 's');
  setTimeout(function() { runConnectivityCheck(); }, delay);
}

/**
 * Open portal in a visible tab (last resort after all retries fail)
 */
async function openVisiblePortal(portalUrl) {
  var url = portalUrl || PORTAL_URLS[0];
  
  showNotification(
    NOTIFICATION_IDS.LOGIN_FAILED,
    'LPU AutoConnect — Manual Login Required',
    'Automatic login failed after multiple attempts. Opening portal for manual login.',
    true
  );

  await chrome.tabs.create({
    url: url,
    active: true,  // Visible to user
  });

  await storageSet({
    [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.LOGIN_FAILED,
  });
}

// ─── Web Navigation Listener ─────────────────────────────────────────────────
// Passive detection: watch for any navigation to portal URLs

chrome.webNavigation.onCompleted.addListener(async function(details) {
  if (details.frameId !== 0) return; // Only main frame
  
  if (isPortalURL(details.url)) {
    // Skip post-login pages (servlet responses, status pages, etc.)
    // These pages match portal URL patterns but are NOT login forms
    if (isPostLoginURL(details.url)) {
      log('BG', 'Post-login page detected, skipping: ' + details.url);
      return;
    }

    // Skip if we're within login cooldown (just logged in successfully)
    if (Date.now() - lastLoginSuccessTime < LOGIN_COOLDOWN_MS) {
      log('BG', 'Portal nav detected but within cooldown, skipping: ' + details.url);
      return;
    }

    log('BG', 'Portal page detected via navigation: ' + details.url);
    
    // If this isn't a tab we opened for login, it's a passive detection
    if (!pendingLogins.has(details.tabId)) {
      // Check if we should auto-login on this page too
      var autoSettings = await storageGet({
        [STORAGE_KEYS.AUTO_LOGIN_ENABLED]: true,
      });
      
      if (autoSettings[STORAGE_KEYS.AUTO_LOGIN_ENABLED]) {
        // Inject content script if not already there
        try {
          if (chrome.scripting) {
            // Chrome/Edge MV3
            chrome.scripting.executeScript({
              target: { tabId: details.tabId },
              files: ['src/content/portal-injector.js'],
            });
          } else if (chrome.tabs.executeScript) {
            // Firefox MV2
            chrome.tabs.executeScript(details.tabId, {
              file: 'src/content/portal-injector.js'
            });
          }
        } catch (e) {
          logError('BG', 'Failed to inject content script:', e.message);
        }
      }
    }
  }
});

// Also detect captive portal via webRequest (redirect detection)
chrome.webRequest.onBeforeRedirect.addListener(
  function(details) {
    if (isPortalURL(details.redirectUrl)) {
      log('BG', 'Portal redirect detected via webRequest: ' + details.redirectUrl);
      if (!isLoginInProgress) {
        handlePortalDetected(details.redirectUrl);
      }
    }
  },
  { urls: ['<all_urls>'] }
);

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  // Use async wrapper since onMessage doesn't natively support async
  handleMessage(message, sender)
    .then(function(response) { sendResponse(response); })
    .catch(function(err) {
      logError('BG', 'Message handler error:', err.message);
      sendResponse({ error: err.message });
    });

  // Return true to indicate async response
  return true;
});

async function handleMessage(message, sender) {
  var type = message.type;
  var data = message.data;

  switch (type) {
    // ─── From Content Script ──────────────────────────────
    case MSG.PORTAL_READY: {
      log('BG', 'Portal ready on tab ' + (sender.tab ? sender.tab.id : '?'));
      // Only a frame on a known portal host may receive the password
      if (!isPortalURL(sender.url)) {
        logError('BG', 'Refused credentials for non-portal page: ' + sender.url);
        return { ok: false };
      }
      // Send credentials to content script
      var creds = await storageGet({
        [STORAGE_KEYS.USERNAME]: '',
        [STORAGE_KEYS.PASSWORD]: '',
      });
      return {
        type: MSG.LOGIN_REQUEST,
        username: sanitizeUsername(creds[STORAGE_KEYS.USERNAME]),
        password: creds[STORAGE_KEYS.PASSWORD],
      };
    }

    case MSG.LOGIN_SUCCESS: {
      await handleLoginSuccess(sender.tab ? sender.tab.id : null);
      return { ok: true };
    }

    case MSG.LOGIN_FAILED: {
      var failReason = (data && data.reason) ? data.reason : 'Content script reported failure';
      await handleLoginFailure(sender.tab ? sender.tab.id : null, failReason);
      return { ok: true };
    }

    case MSG.PORTAL_DETECTED: {
      if (!isLoginInProgress) {
        var detectedUrl = (data && data.url) ? data.url : (sender.tab ? sender.tab.url : null);
        await handlePortalDetected(detectedUrl);
      }
      return { ok: true };
    }

    // ─── From Popup ───────────────────────────────────────
    case MSG.GET_STATUS: {
      var status = await storageGet({
        [STORAGE_KEYS.CONNECTION_STATUS]: CONNECTION_STATUS.UNKNOWN,
        [STORAGE_KEYS.LAST_LOGIN_TIME]: null,
        [STORAGE_KEYS.LAST_LOGIN_STATUS]: null,
        [STORAGE_KEYS.RETRY_COUNT]: 0,
        [STORAGE_KEYS.LOGIN_ATTEMPTS]: 0,
        [STORAGE_KEYS.CREDENTIALS_SAVED]: false,
        [STORAGE_KEYS.EXTENSION_ENABLED]: true,
        [STORAGE_KEYS.AUTO_LOGIN_ENABLED]: true,
      });
      return status;
    }

    case MSG.FORCE_RECONNECT: {
      log('BG', 'Force reconnect requested');
      retryCount = 0;
      isLoginInProgress = false;
      await storageSet({ [STORAGE_KEYS.RETRY_COUNT]: 0 });
      // Run immediate check
      runConnectivityCheck();
      return { ok: true };
    }

    case MSG.OPEN_SETTINGS: {
      chrome.tabs.create({
        url: chrome.runtime.getURL('src/options/options.html'),
        active: true,
      });
      return { ok: true };
    }

    // ─── From Options ─────────────────────────────────────
    case MSG.SAVE_CREDENTIALS: {
      var username = data.username;
      var password = data.password;
      var cleanUsername = sanitizeUsername(username);
      
      if (!cleanUsername || !password) {
        return { ok: false, error: 'Invalid credentials' };
      }

      await storageSet({
        [STORAGE_KEYS.USERNAME]: cleanUsername,
        [STORAGE_KEYS.PASSWORD]: password,
        [STORAGE_KEYS.CREDENTIALS_SAVED]: true,
      });

      log('BG', 'Credentials saved');
      return { ok: true, sanitizedUsername: cleanUsername };
    }

    case MSG.GET_CREDENTIALS: {
      // Only the extension's own pages (settings, popup) may read saved credentials
      if (String(sender.url || '').indexOf(chrome.runtime.getURL('')) !== 0) {
        return { ok: false };
      }
      var savedCreds = await storageGet({
        [STORAGE_KEYS.USERNAME]: '',
        [STORAGE_KEYS.PASSWORD]: '',
      });
      return {
        username: savedCreds[STORAGE_KEYS.USERNAME],
        password: savedCreds[STORAGE_KEYS.PASSWORD],
      };
    }

    case MSG.CREDENTIALS_UPDATED: {
      log('BG', 'Credentials updated — running connectivity check');
      retryCount = 0;
      setTimeout(function() { runConnectivityCheck(); }, 1000);
      return { ok: true };
    }

    case MSG.TEST_CONNECTION: {
      var testResult = await checkConnectivity();
      return testResult;
    }

    default:
      log('BG', 'Unknown message type: ' + type);
      return { error: 'Unknown message type: ' + type };
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * Show a browser notification
 */
async function showNotification(id, title, body, requireInteraction) {
  requireInteraction = requireInteraction || false;

  var notifSettings = await storageGet({
    [STORAGE_KEYS.NOTIFICATIONS_ENABLED]: true,
  });

  if (!notifSettings[STORAGE_KEYS.NOTIFICATIONS_ENABLED]) return;

  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: title,
      message: body,
      priority: 2,
      requireInteraction: requireInteraction,
      silent: !requireInteraction,
    });
  } catch (e) {
    logError('BG', 'Notification error:', e.message);
  }
}

/**
 * Show notification prompting user to set up credentials
 */
function showSetupNotification() {
  showNotification(
    NOTIFICATION_IDS.SETUP_REQUIRED,
    'LPU AutoConnect — Setup Required',
    'Please set up your registration number and password to enable auto-login.',
    true
  );
}

// Handle notification clicks — open settings page
chrome.notifications.onClicked.addListener(function(notificationId) {
  if (notificationId === NOTIFICATION_IDS.SETUP_REQUIRED) {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html?setup=true'),
      active: true,
    });
  } else if (notificationId === NOTIFICATION_IDS.LOGIN_FAILED) {
    // Open portal manually
    chrome.tabs.create({
      url: PORTAL_URLS[0],
      active: true,
    });
  }
  chrome.notifications.clear(notificationId);
});

// ─── Tab Close Listener ──────────────────────────────────────────────────────
// Clean up if a pending login tab is closed externally

chrome.tabs.onRemoved.addListener(function(tabId) {
  if (pendingLogins.has(tabId)) {
    var pending = pendingLogins.get(tabId);
    clearTimeout(pending.timeout);
    pendingLogins.delete(tabId);
    isLoginInProgress = false;
    log('BG', 'Pending login tab ' + tabId + ' was closed externally');
  }
});

// ─── Startup Check ───────────────────────────────────────────────────────────
// Run initial connectivity check when service worker / background script loads
log('BG', 'Background script loaded');
setupAlarms();
setTimeout(function() { runConnectivityCheck(); }, 3000);
