# AutoConnect

> Automatically logs into LPU WiFi captive portal (24Online/Cyberoam) whenever internet access is blocked.

**Manifest V3** · **Vanilla JavaScript** · **Chrome/Edge/Firefox** · **Zero Dependencies**

---

## Features

- **Automatic Portal Detection** — Detects captive portal redirects and blocked internet via multiple connectivity check endpoints
- **Silent Background Login** — Opens portal in a hidden tab, fills credentials, submits, and closes — all invisible to the user
- **Smart Reconnect** — Works after browser restart, laptop restart, WiFi reconnect, sleep/wake, and session timeouts
- **Username Sanitization** — Automatically strips `@lpu.in`, `@lpu.com`, and non-numeric characters from registration number input
- **Exponential Backoff** — Failed login attempts use intelligent retry with jittered exponential backoff
- **Failure Escalation** — Silent retries → notification → visible portal tab (graceful degradation)
- **Periodic Health Checks** — Alarm-based connectivity monitoring every 60 seconds with supplementary 45-second interval checks
- **Passive + Active Detection** — Monitors `webNavigation` and `webRequest` events alongside active fetch-based checks
- **Minimal UI** — Clean dark popup showing connection status, last login time, and reconnect button
- **Local Credential Storage** — Credentials stored in browser local storage, never transmitted externally

---

## Project Structure

```
lpu-autoconnect/
├── manifest.json                    # Extension manifest (MV3)
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background/
│   │   └── service-worker.js        # Core brain: alarms, portal detection, login orchestration
│   ├── content/
│   │   └── portal-injector.js       # Injected into portal pages: form fill + submit
│   ├── popup/
│   │   ├── popup.html               # Popup UI
│   │   ├── popup.css                # Popup styles (dark glassmorphism)
│   │   └── popup.js                 # Popup logic
│   ├── options/
│   │   ├── options.html             # Settings/setup page
│   │   ├── options.css              # Settings styles
│   │   └── options.js               # Settings logic
│   └── shared/
│       ├── constants.js             # All configuration, URLs, timing, storage keys
│       └── utils.js                 # Sanitization, connectivity check, backoff, storage helpers
└── README.md
```

---

## Installation

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the project root folder (the folder containing `manifest.json`)
5. The extension icon will appear in the toolbar
6. Click the icon → click **Settings** → enter your registration number and password

### Firefox

> Firefox MV3 support requires some minor adjustments. The extension is designed to be compatible but Firefox may need the `browser_specific_settings` key in manifest.json.

1. Open `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on"**
3. Select `manifest.json` from the project folder
4. Configure credentials via the settings page

#### Firefox Compatibility Note

For persistent Firefox installation, you may need to add to `manifest.json`:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "lpu-autoconnect@extension",
    "strict_min_version": "109.0"
  }
}
```

---

## Usage

### First-Time Setup

1. After installation, the settings page opens automatically
2. Enter your **LPU Registration Number** (e.g., `12345678`)
   - You can enter it as `12345678`, `12345678@lpu.in`, or `12345678@lpu.com` — it will be auto-sanitized
3. Enter your **WiFi portal password**
4. Click **Save Credentials**
5. The extension is now active and will auto-login whenever the portal appears

### Daily Usage

- **The extension works silently** — no interaction needed
- Click the extension icon to see connection status
- Use the **Reconnect** button to force a reconnect attempt
- The green pulsing dot means you're connected
- Amber/yellow means the extension is working on reconnecting

---

## How It Works

### Detection Architecture (Hybrid)

```
┌──────────────────────────────────┐
│        DETECTION LAYER           │
├──────────────────────────────────┤
│                                  │
│  1. Alarm-based check (60s)      │  ← Chrome Alarms API
│  2. Interval check (45s)         │  ← Supplementary faster check
│  3. webNavigation listener       │  ← Passive portal URL detection
│  4. webRequest redirect listener │  ← Passive redirect detection
│  5. Content script detection     │  ← Page-level form detection
│                                  │
└───────────┬──────────────────────┘
            │
            ▼
┌──────────────────────────────────┐
│       CONNECTIVITY CHECK         │
├──────────────────────────────────┤
│                                  │
│  Fetch HEAD to known endpoints:  │
│  • connectivitycheck.gstatic.com │
│  • clients3.google.com           │
│  • www.msftconnecttest.com       │
│  • detectportal.firefox.com      │
│  • captive.apple.com             │
│                                  │
│  redirect:manual → detect portal │
│  expected status → connected     │
│  network error → disconnected    │
│                                  │
└───────────┬──────────────────────┘
            │
            ▼
┌──────────────────────────────────┐
│        LOGIN ORCHESTRATION       │
├──────────────────────────────────┤
│                                  │
│  1. Open portal in background    │
│  2. Content script detects form  │
│  3. Request credentials from BG  │
│  4. Fill username + password     │
│  5. Check terms checkbox         │
│  6. Submit form                  │
│  7. Monitor for success/failure  │
│  8. Close tab on success         │
│                                  │
└───────────┬──────────────────────┘
            │
            ▼
┌──────────────────────────────────┐
│        FAILURE HANDLING          │
├──────────────────────────────────┤
│                                  │
│  Retry 1–5:  Silent backoff      │
│  Retry 6–10: Notification shown  │
│  Retry 10+:  Open visible portal │
│                                  │
│  Backoff: 2s × 1.5^n (±20%)     │
│  Max delay: 30s                  │
│                                  │
└──────────────────────────────────┘
```

---

## Permissions Explained

| Permission | Why |
|---|---|
| `storage` | Store credentials and settings locally |
| `tabs` | Open/close background login tabs |
| `alarms` | Periodic connectivity checks |
| `notifications` | Alert user on login failure |
| `scripting` | Inject content script into portal pages |
| `webNavigation` | Detect when browser navigates to portal URLs |
| `webRequest` | Detect redirect-based portal captures |
| `host_permissions` | Access portal IPs and connectivity check endpoints |

---

## Configuration

All timing and behavior can be tuned in `src/shared/constants.js`:

| Setting | Default | Description |
|---|---|---|
| `CHECK_INTERVAL_MS` | 45000 | Supplementary check interval |
| `ALARM_PERIOD_MINUTES` | 1 | Chrome alarm period |
| `MAX_SILENT_RETRIES` | 5 | Retries before notification |
| `MAX_TOTAL_RETRIES` | 10 | Retries before opening visible portal |
| `INITIAL_DELAY_MS` | 2000 | First retry delay |
| `MAX_DELAY_MS` | 30000 | Maximum backoff delay |
| `BACKOFF_MULTIPLIER` | 1.5 | Exponential backoff factor |

---

## Development & Testing

### Testing Without LPU Network

1. Load the extension in developer mode
2. Open the popup to verify UI renders correctly
3. Open the settings page and save test credentials
4. Click "Test Connection" in diagnostics section
5. Check the background service worker console at `chrome://extensions` → "Inspect views: service worker"

### Adding New Portal URLs

Edit `PORTAL_URLS` and `PORTAL_URL_PATTERNS` in `src/shared/constants.js` and add corresponding URL patterns to the `content_scripts.matches` and `host_permissions` arrays in `manifest.json`.

### Debugging

- **Background logs**: `chrome://extensions` → find LPU AutoConnect → "Inspect views: service worker"
- **Content script logs**: Open portal page → DevTools → Console (filter by `[LPU AutoConnect]`)
- **Popup logs**: Right-click extension icon → "Inspect popup"

---

## Security Notes

- Credentials are stored in `chrome.storage.local` — **encrypted at rest** by the browser
- Credentials are **never** sent to any external server
- Only transmitted to the local captive portal page via content script injection
- The extension only accesses known LPU portal IPs and standard connectivity check endpoints

---

## License

MIT — Use freely.
