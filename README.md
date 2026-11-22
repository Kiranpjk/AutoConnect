# AutoConnect

[![CI](https://github.com/Kiranpjk/autoconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/Kiranpjk/autoconnect/actions/workflows/ci.yml)

> Automatically logs into LPU WiFi captive portal (24Online/Cyberoam) whenever internet access is blocked.

**Manifest V3 (Chrome/Edge)** · **Manifest V2 (Firefox)** · **Vanilla JavaScript** · **No runtime dependencies**

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
- **Host-Locked Autofill** — Credentials are only filled in on the exact portal hosts listed in `src/shared/constants.js` (checked by `npm test`)

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

### From a release (recommended)

Each tagged release on the [Releases page](https://github.com/Kiranpjk/autoconnect/releases) has two zips:
`autoconnect-chrome-<version>.zip` and `autoconnect-firefox-<version>.zip`.

**Chrome / Edge**

1. Unzip `autoconnect-chrome-<version>.zip` into a folder
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**
3. Click **Load unpacked** and select the unzipped folder
4. Click the extension icon → **Settings** → enter your registration number and password

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and pick `autoconnect-firefox-<version>.zip`
   (temporary add-ons are removed when Firefox restarts; the add-on is not signed by Mozilla)
3. Configure credentials via the settings page

### From source

```bash
npm ci
npm run build      # creates dist/chrome/, dist/firefox/ and a zip for each
```

Load `dist/chrome` (Chrome/Edge, MV3) or `dist/firefox/manifest.json` (Firefox, MV2) as described above.
The root `manifest.json` is a copy of `manifest_chrome.json`, so the repo root can also be loaded
unpacked in Chrome directly; `./switch-browser.sh firefox` swaps it to the Firefox manifest.

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

## Privacy & Security

Verified against the code in `src/`:

- Your registration number and password are saved only in the browser's extension storage
  (`chrome.storage.local` / `browser.storage.local`) on your machine. Nothing is synced or
  uploaded. Note that this storage is **not encrypted** by the extension; anyone with access
  to your browser profile can read it.
- The only network requests the extension makes itself are body-less `HEAD` requests to the
  public connectivity-check URLs listed in `CONNECTIVITY_CHECK_URLS` (Google, Microsoft,
  Mozilla, Apple). They carry no credentials (`checkConnectivity` in `src/shared/utils.js`;
  a unit test asserts the requests are `HEAD` with no body).
- The background script hands the credentials to a page only if the requesting frame's URL
  is on one of the exact hosts in `PORTAL_HOSTS` (`isPortalURL`). The content script then
  fills the portal's login form, and the portal receives them when the form is submitted.
- No analytics, telemetry or third-party scripts. The Firefox manifest declares
  `data_collection_permissions: none`.

---

## Testing & CI/CD

```bash
npm ci
npm run lint          # ESLint
npm test              # node:test unit tests for src/shared (no browser needed)
npm run build         # dist/ folders + zips for Chrome and Firefox
npm run lint:firefox  # Mozilla's web-ext lint on dist/firefox (run after build)
```

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every pull request it runs
  ESLint, the unit tests, builds both packages, runs `web-ext lint` on the Firefox build and
  uploads the zips as a workflow artifact.
- **Release** (`.github/workflows/release.yml`): pushing a tag like `v1.0.1` runs the tests,
  checks that the tag matches the `version` in both manifests, builds both zips and attaches
  them to a GitHub Release.

  ```bash
  # bump "version" in manifest_chrome.json, manifest_firefox.json and manifest.json first
  git tag v1.0.1 && git push origin v1.0.1
  ```
- **Dependabot** keeps npm dev dependencies and GitHub Actions up to date.

---

## License

MIT — Use freely.
