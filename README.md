# WebGaze

A Chrome extension that turns your webcam into an eye tracker for UX research — no hardware required. Record where participants look, generate gaze heatmaps, and analyse dwell time across any website.

Built with [WebGazer.js](https://webgazer.cs.brown.edu/), Chrome Extension
Manifest V3, FastAPI, and PostgreSQL.

**Live system:** [Study Builder](https://webgaze-research.vercel.app) ·
[REST API docs](https://remoteeyetrackingmarketresearch-production.up.railway.app/api/docs) ·
[Health check](https://remoteeyetrackingmarketresearch-production.up.railway.app/healthz)

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
- **Consent-aware collection API** — participant sessions are token-scoped,
  calibration quality gates collection, tasks produce durable boundaries, and
  gaze batches are validated and safe to retry

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

The repository is evolving into a full-stack platform. The API now includes a
normalized research domain model, versioned REST endpoints, reversible database
migrations, stable error contracts, generated TypeScript types, and an explicit
participant collection state machine. The existing extension remains usable
while the next milestone connects its browser collection client to this API.

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

The OpenAPI UI is available at `http://localhost:8000/api/docs`. Researcher
project endpoints use a documented temporary demo identity seam during this
portfolio milestone; production researcher authentication and abuse controls
are still required before handling real research data. Participant collection
uses the scoped capability token described below.

The participant protocol is available under `/api/v1` after a study is
published:

- `POST /participate/{token}/sessions` creates an anonymous session and returns
  a one-time capability token.
- `POST /participant-sessions/{id}/consent` records the exact consent version.
- `POST /participant-sessions/{id}/calibrations` records ordered quality-gated
  calibration attempts.
- `POST /participant-sessions/{id}/task-runs` and its completion endpoint
  enforce ordered, non-overlapping task runs.
- `POST /participant-sessions/{id}/gaze-batches` persists bounded, versioned
  batches with checksum-based idempotent replay and missing-sequence reports.

These endpoints are intentionally API-first in this milestone; the browser
participant runner and submission/analysis queue will consume them next.

Run the M2 Study Builder in a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The React/TypeScript application exercises the
full draft workflow: study configuration, one to four ordered tasks, server-side
validation, immutable publishing, and participant-link resolution. Its API
types are generated from the same OpenAPI document served by FastAPI.

## Production deployment

The web application and API are intentionally deployed as separate services:

- **Vercel** builds the React application from the repository root using
  `vercel.json`. Set `VITE_API_URL` to the public Railway API origin.
- **Railway** builds `apps/api/Dockerfile` with the service root directory set
  to `/apps/api`. Add a PostgreSQL service and set `WEBGAZE_DATABASE_URL` to its
  private `DATABASE_URL` reference. The container runs Alembic migrations before
  starting Uvicorn and Railway checks `/healthz` before routing traffic.

```text
Browser
  └── Vercel CDN · React/Vite Study Builder
        └── HTTPS REST calls
              └── Railway · FastAPI container
                    └── private network
                          └── Railway PostgreSQL
```

The production API only permits browser requests from the Vercel production
origin. Railway database credentials remain server-side and the browser build
contains only the public API origin.

Set the following API variables in Railway after Vercel assigns the production
domain:

```text
WEBGAZE_ENVIRONMENT=production
WEBGAZE_DATABASE_URL=${{Postgres.DATABASE_URL}}
WEBGAZE_CORS_ORIGINS=["https://your-project.vercel.app"]
WEBGAZE_SQL_ECHO=false
```

Deploy the API first, copy its Railway public origin into Vercel as
`VITE_API_URL`, deploy the web app, then update `WEBGAZE_CORS_ORIGINS` with the
final Vercel origin. Keep all demo data synthetic: authentication and abuse
controls remain required before this API can host real research data.

The current production API is deployed from the CLI using `apps/api` as the
Railway service root. GitHub-triggered
deployments should be enabled after granting both hosting providers access to
this repository and choosing `main` as the production branch.

Generate the committed OpenAPI document and TypeScript types with:

```bash
npm run generate:contract
```

## Test

The session-analysis core is separated from Chrome APIs so its validation,
dwell-time accounting, and versioned export contract can be tested directly:

```bash
npm test
npm run build:web
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
| 3 | Versioned Study Builder + participant protocol API | ✅ Complete |
| 4 | Browser participant runner + offline batch buffer | 🔜 Next |
| 5 | Async analysis pipeline + task-level results | Planned |
| 6 | Full Results Dashboard + export | Planned |

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
