# WebGaze

A Chrome extension that turns your webcam into an eye tracker for UX research — no hardware required. Record where participants look, generate gaze heatmaps, and analyse dwell time across any website.

Built with [WebGazer.js](https://webgazer.cs.brown.edu/), Chrome Extension
Manifest V3, FastAPI, and PostgreSQL.

> **Independent clean-room project:** this repository contains independently
> developed code and synthetic examples only. It is not affiliated with an
> employer or commercial eye-tracking product.

---

## What it does

- **Calibration** — guided 9-point calibration + boundary sweep + accuracy check before every session
- **Live gaze overlay** — real-time gaze dot and accumulating heatmap rendered on top of any page
- **Session recording** — gaze points sampled at ~10 fps, auto-screenshots on URL changes, scroll stops, and significant DOM mutations (e.g. modals opening)
- **Results Dashboard** — view screenshots side-by-side with heatmap overlays; load the current session or import a participant's exported JSON
- **Export** — one-click JSON export containing all gaze points, screenshots, dwell times, and AOI data
- **Local-first collection** — webcam frames remain on-device, and the extension
  does not send session data to the M1 API unless a later milestone adds an
  explicit, consent-aware upload flow

---

## Architecture

```
popup.js ──► background.js (Service Worker)
                  │
                  ├─ chrome.scripting.executeScript → injects webgazer.js into tab
                  └─ chrome.tabs.sendMessage(START_WEBGAZER)
                              │
                        content.js  ◄──── WebGazer runs here
                              │           (camera prompt fires in visible tab)
                              │
                        webgazer.begin()
                              │
                     [Calibration flow]
                        showCameraCheck()
                        showInstruction('calibration')
                        runCalibration()        ← 9 points × 5 clicks
                        showInstruction('boundary')
                        runBoundaryStep()       ← 4 corners × 3 clicks + edge trace
                        runAccuracyCheck()      ← 5 s stare at centre dot
                        showAccuracyResult()    ← retry loop if < 60%
                              │
                        CAL_DONE ──► background ──► CALIBRATION_COMPLETE
                              │
                        startTracking()         ← heatmap + gaze dot active
```

The repository is evolving into a full-stack platform. The M1 API foundation
adds a normalized research domain model, versioned REST endpoints, reversible
database migrations, stable error contracts, and generated TypeScript types.
The existing extension remains usable while later milestones connect collection
and analysis to the API.

**Key design decisions:**

- **Content script, not Offscreen Document** — `getUserMedia` only shows a permission prompt in a visible tab context. Moving WebGazer to the content script was the only reliable way to get the camera working in MV3.
- **`activeTabId` persisted in state** — MV3 Service Workers are killed after ~30 s of inactivity. Persisting the tab ID in `chrome.storage.local` means the SW can still send `CALIBRATION_COMPLETE` after restarting mid-session.
- **WebGazer.js is patched** — `lib/webgazer.js` has three patches applied: `Function()` / `eval()` calls replaced to satisfy MV3 CSP, and `canvas.getContext('2d')` calls updated to `{willReadFrequently: true}` to silence TFLite hot-loop warnings.

---

## Install (development)

1. Clone the repo
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the WebGaze extension icon

No build step required — plain JS, no bundler.

### Run the API foundation

Requirements: Python 3.10+, Node.js 22+, and Docker.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e 'apps/api[dev]'
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
.venv/bin/uvicorn webgaze_api.main:app --app-dir apps/api --reload
```

The OpenAPI UI is available at `http://localhost:8000/api/docs`. Project
endpoints use a documented temporary demo identity seam during M1; production
authentication is intentionally deferred and must be implemented before public
deployment.

Generate the committed OpenAPI document and TypeScript types with:

```bash
npm run generate:contract
```

## Test

The session-analysis core is separated from Chrome APIs so its validation,
dwell-time accounting, and versioned export contract can be tested directly:

```bash
npm test
```

## Privacy and responsible use

Webcam frames are processed locally and are not saved by the extension. Gaze
coordinates and page screenshots remain in Chrome local storage until the user
exports or deletes them. Screenshots may contain sensitive content; obtain
participant consent and use synthetic data for public demonstrations.

See [PRIVACY.md](PRIVACY.md) for the full data boundary and limitations. This
tool is intended for exploratory UX research, not medical, employment,
accessibility-certification, or other consequential decisions.

## Clean-room development

The next full-stack version is governed by an implementation-independent
[functional specification](docs/clean-room/functional-spec.md),
[data dictionary](docs/clean-room/data-dictionary.md), and
[failure-mode checklist](docs/clean-room/failure-modes.md). The
[source-boundary protocol](docs/clean-room/source-boundary.md) records which
materials may and may not be used during implementation.

---

## How to run a session

1. Navigate to the page you want to test
2. Open the WebGaze popup → enter a **Participant ID** → click **Start Session**
3. Allow camera access when prompted
4. Follow the on-screen calibration flow (~2 min):
   - **Camera check** — confirm your face is detected
   - **9-point calibration** — click each dot 5× while looking at it
   - **Boundary calibration** — click each corner 3× and trace the edges
   - **Accuracy check** — stare at the centre dot for 5 s; retry if < 60%
5. Browse normally — gaze dot and heatmap are now live
6. Click **Stop & Export** when done
7. Click **Open Dashboard** to view heatmaps, or **Download JSON** to share with a researcher

---

## Project status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Camera + calibration flow + live heatmap | ✅ Complete |
| 2 | Session persistence + participant ID + Dashboard MVP | ✅ Complete |
| 3 | AOI Builder (auto-propose + manual draw) | 🔜 Next |
| 4 | Participant onboarding (remote + in-person) | Planned |
| 5 | Full Results Dashboard (dwell time, AOI stats) | Planned |
| 6 | Chrome Web Store distribution + polish | Planned |

---

## Tech stack

| | |
|---|---|
| Platform | Chrome Extension MV3 |
| Eye tracking | WebGazer.js (patched for MV3) |
| ML model | TensorFlow.js FaceMesh |
| API | FastAPI · Pydantic · OpenAPI |
| Database | PostgreSQL · SQLAlchemy 2 · Alembic |
| Collection storage | `chrome.storage.local` during the transition |
| Languages | Python · TypeScript contract · Vanilla JS · HTML · CSS |
| Tests | Pytest · Node.js built-in test runner |
