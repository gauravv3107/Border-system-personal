# 🛡️ Barrage — Digital Border Management System (DBMS)

A unified, real-time operations and humanitarian coordination platform for India's border security forces, immigration officers, sea marshals, and NGO workers — built for the Megahackathon 2026.

---

## Features

**Border Force Dashboards** — Dedicated portals for BSF (Pakistan & Bangladesh), ITBP (China & Tibet), SSB (Nepal & Bhutan), Assam Rifles (Myanmar), and CISF (Airports & Seaports). Each portal shows force-specific refugee registrations, entry points, NGO assignments, and a mini Leaflet map of camps in that force's jurisdiction.

**Refugee Registration** — Officers register refugees at the border capturing: personal details (name, DOB, gender, nationality, passport, medical needs, language), entry point, help tags (Medical, Shelter, Legal Aid, Child Protection, Education), camp assignment, NGO assignment, and officer notes. On submission the system generates a unique Provisional ID (e.g. `PROV-BSF-2026-180381`), creates an NGO assignment record, and presents a copyable ID card with a QR sheet for the refugee.

**Watchlist / Blacklist Check** — Real-time cross-check of passport number or name against the entities blacklist database on form blur. Returns match status, blacklist reason, and risk score with a colour-coded alert banner visible while the officer is filling the registration form.

**Family Grouping** — After registering a refugee, officers can declare family members by name and age. A live debounced search checks existing refugee records for name matches. Matches can be linked into a shared family group (FAM ID), and existing family members can be edited or unlinked from the Registered Refugees tab.

**Passport OCR & Verification** — Immigration officers upload a passport image via drag-and-drop or file picker. The backend runs Tesseract OCR with OpenCV pre-processing to extract the passport number and MRZ, queries it against the entities database, and returns a verification certificate with: MRZ validity, watchlist status, INTERPOL clear flag, and simulated face-match score. Grant Entry or Detain actions update entity status.

**Traveller Database (CRUD)** — Full add / edit / delete of traveller records in the immigration terminal. Each record supports: status changes (Active, Under Verification, Blacklisted), passport photo upload with overwrite, investigation flagging, visa expiry tracking with configurable warning threshold, and a dedicated Under Investigation queue where officers review face-mismatch flags and confirm or clear blacklistings.

**Sea Marshall Vessel Management** — View and manage India's EEZ vessel traffic register, merging a static `vessels.json` registry with DB-persisted records. Officers can: flag vessels as suspicious (FLAGGED\_ILLEGAL), issue intercept orders (INTERCEPTED status + auto-creates an incident), update movement status (Approaching / Docked / Departing), add new vessels, and manage vessel departure history (vessels departing 7+ days ago move to a History view). Vessels also carry health and customs clearance status, both defaulting to granted, with inline panel controls for denial and restoration.

**Incident Filing** — Sea marshals file structured incidents linked to a vessel IMO: type, severity (Low / Medium / High / Critical), location, description, and reporting officer. Incidents feed into the global dashboard's open incident count.

**NGO Support Portal (Govt-side)** — NGO workers see assignments filtered to their NGO. Each assignment card shows refugee details, help tags, medical needs, camp, and a case workflow: Pending → Acknowledged → In Progress → Completed. The portal includes Chart.js visualisations: assignment status doughnut, nationality bar chart, and force distribution bar chart. A banner links to the dedicated standalone NGO portal.

**Standalone NGO Portal** (`/ngo-portal`) — A fully separate frontend served at `/ngo-portal` with distinct green branding. NGO Admins manage worker accounts, view all refugees assigned to their NGO, set capacity, submit resource requests to the government dashboard, and browse the NGO directory. NGO Workers see only their assigned refugees and log aid (Food & Water, Medical, Shelter, Legal Aid, Financial Support) and update case status. NGOs apply via a registration form; govt admins approve them from the main dashboard.

**Refugee Self-Service Portal** — Refugees look up their own record using their Provisional ID. The portal shows: registration status, assigned camp (with a Leaflet mini-map pin), assigned NGO, NGO case status, help tags, rights under international law (non-refoulement, asylum, basic needs, legal access, child rights), emergency contact numbers (UNHCR India, NHRC, Police, Medical), and a 5-stage case progress timeline. Refugees can also set a language preference (EN, HI, BN, TA, TE, MR, GU) saved to their profile, and submit appeals / requests (Medical Help, Change NGO, Report Issue, Other) with a history of past submissions.

**Case Progress Timeline** — A live 5-node progress bar on the refugee portal (Registered → NGO Assigned → Aid Received → Medical Review → Case Resolved) driven by `refugee_status_log` entries. The timeline polls every 30 seconds and syncs with actions taken in the NGO portal.

**Command Dashboard** — Aggregated KPIs: total entities, active security flags, pending refugee aid, and open incidents. Interactive Leaflet map of all border checkpoints, airports, seaports, and refugee camps — clicking a marker calls the entry point stats API and shows a popup with totals, flags, and pending aid. Chart.js doughnut (entity type breakdown) and bar chart (top 8 entry points by volume). Refugee management tab (list, assign/reassign NGOs, edit refugee details, deactivate/reactivate NGOs) and active alerts panel.

**Alerts System** — A persistent `alerts` table receives events from across the system (vessel denial, blacklist confirmation, NGO capacity breach, refugee appeal, investigation flag). The dashboard alerts panel shows unread alerts with severity badges (info / warning / critical), mark-as-read per alert, and a permanent history log.

**Role-Based Access** — Five login paths with separate session guards: Border Patrol (by force sub-role), Sea Marshall, Immigration Officer, NGO (govt portal), and Refugee (Provisional ID self-service). Each role is restricted to appropriate pages via `auth.js` RBAC enforcement. The standalone NGO portal has a separate `ngo_admin` / `ngo_worker` DB-backed auth flow.

**Multi-language UI** — Interface supports EN / हिं (Hindi) via a client-side translation engine (`translation.js`) using JSON string maps (`en.json`, `hi.json`, `bn.json`, `ta.json`). Language pills appear in every sidebar. Hindi activates Noto Sans Devanagari and Hind fonts system-wide. Refugee portal additionally supports TE, MR, GU via a per-profile language preference selector.

---

## Tech Stack

| Library / Tool | Category | Role in Barrage |
|---|---|---|
| Flask 3.0 | Backend framework | Serves the entire application — 7 REST blueprints + static frontend from a single Python process on port 5050 |
| flask-cors 4.0 | CORS middleware | Enables browser fetch calls during local development with `credentials: include` |
| python-dotenv 1.0 | Config | Loads environment secrets from `.env` at startup |
| SQLite (WAL mode) | Database | Stores all entities, refugee registrations, NGO assignments, incidents, vessels, alerts, appeals, and timeline logs in `dbms.sqlite` — zero infrastructure setup |
| pytesseract | OCR | Extracts passport numbers and MRZ text from uploaded passport images in `immigration.py` |
| OpenCV (`opencv-python`) | Image processing | Converts uploaded passport images to greyscale before Tesseract for improved OCR accuracy |
| Pillow | Image I/O | Required by pytesseract for image decoding |
| Leaflet.js 1.9.4 | Interactive maps | Renders the command dashboard border map, border patrol camp mini-maps, and refugee portal camp location pin |
| Chart.js 4.4.0 | Data visualisation | Powers the entity-type doughnut, entry-points bar, security-flags line trend on the dashboard, and NGO portal status / nationality / force charts |
| Google Fonts — Inter, Noto Sans Devanagari, Hind | Typography | Primary typeface loaded via CDN; Devanagari stack activates automatically on Hindi |
| Vanilla CSS + HTML | Frontend | Full custom design system in `global.css` with CSS variables, `--color-sidebar: #002147` brand palette, and a fixed 240px sidebar layout |
| Vanilla JS (no bundler) | Frontend logic | All interactivity without a framework; `apiFetch()` in `config.js` handles all REST calls with `credentials: include` |

---

## Architecture Overview

Barrage is a monolithic Python / Flask application that co-hosts the REST API and static frontend from a single server process. The main frontend lives in `dbms/frontend/` and is served as Flask's `static_folder`. A secondary standalone NGO portal lives in `ngo-frontend/` and is served from `/ngo-portal/<path>` via dedicated Flask routes.

The backend is structured as seven Flask Blueprints — auth, dashboard, border\_patrol, sea\_marshall, immigration, ngo, refugee — each responsible for a vertical slice of the system. All persistence is handled by a single SQLite database (`dbms.sqlite`) with WAL mode enabled. Foreign keys are enforced on every connection.

The database schema is seeded from `seed_data.sql` on first boot (350 entities pre-loaded). Column migrations run on every startup via `PRAGMA table_info` checks in `init_db()`, adding new columns without dropping existing data. The `vessels.json` flat-file registry is merged at runtime with DB vessel records, with DB entries taking precedence on IMO collision.

There is no WebSocket layer. Live polling (KPI refresh, timeline sync) is handled via `setInterval` in the frontend. All external data (watchlist checks, entity lookups) is synchronous REST.

---

## Key Data Flows

### 1. Refugee Registration → NGO Assignment (Border Patrol → NGO Portal)

1. Officer fills the registration form in a border force portal (e.g. `bsf.html`).
2. On submit, `border-patrol.js` POSTs to `/api/border-patrol/register-refugee`.
3. `border_patrol.py` generates a Provisional ID (`PROV-{FORCE}-2026-{N:06d}`), inserts into `entities`, creates a `refugee_registrations` row, and creates an `ngo_assignments` row with status `Pending`.
4. A success modal shows the copyable Provisional ID and a QR sheet button, plus the family declaration form.
5. The assigned NGO sees the case in `/api/ngo/assignments` with status `Pending`; they can progress it through `Acknowledged → In Progress → Completed` via `PATCH /api/ngo/assignments/<id>/status`.
6. Each status change writes a stage entry to `refugee_status_log` (keyed by `provisional_id`).
7. The refugee looks up their ID at the self-service portal; `GET /api/refugee/lookup/<provisional_id>` joins across four tables and returns full record, rights, and emergency contacts. The timeline component polls `GET /api/refugee/<provisional_id>/timeline` every 30 seconds.

### 2. Passport Scan → Verification Result (Immigration)

1. Officer uploads a passport photo via drag-and-drop or file picker in `immigration.html`.
2. `immigration.js` POSTs the file (or just a passport number if typed) to `/api/immigration/verify-passport` as JSON.
3. `immigration.py` queries the `entities` table by `passport_no`; if not found, falls back to name LIKE match.
4. Returns: entity record, MRZ validity, watchlist status, INTERPOL clear flag, and a simulated face-match score (96 for the demo passport `Z8892104`, 0 for blacklisted entities, else `85 + (100 - risk_score) * 0.1`).
5. Frontend renders a full verification certificate with a pass/fail badge. Officer clicks Grant Entry (`POST /api/immigration/grant-entry`) or flags for investigation.
6. Face-mismatch flags write to the `alerts` table and add the entity to the Under Investigation queue in the Traveller Database tab.

### 3. Vessel Flag → Intercept Order (Sea Marshall)

1. Sea Marshall loads the vessel register — `sea-marshall.js` calls `GET /api/sea-marshall/vessels`, which merges `vessels.json` with DB vessels and applies `vessel_status` overrides.
2. Officer clicks Flag on a suspicious vessel; `POST /api/sea-marshall/flag-vessel` sets status to `FLAGGED_ILLEGAL` in `vessel_status`, marks `is_flagged = 1`.
3. Officer then issues an intercept order; `POST /api/sea-marshall/lock-vessel` sets status to `INTERCEPTED` and auto-calls `POST /api/sea-marshall/file-incident` to create a linked incident record.
4. A critical alert is written to the `alerts` table, surfacing immediately in the dashboard alerts panel.

---

## Getting Started

### Prerequisites

- Python 3.11+ (project developed on Python 3.13)
- Tesseract OCR installed on your system (`brew install tesseract` on macOS, `sudo apt install tesseract-ocr` on Ubuntu)
- A `.env` file at the project root (see Environment Variables below)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd "Barrage systems"

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\activate       # Windows

# Install dependencies
pip install -r dbms/backend/requirements.txt
```

### Environment Variables

Create a `.env` file in the project root:

| Variable | Description |
|---|---|
| `FLASK_SECRET_KEY` | Secret used for Flask session signing — generate with `openssl rand -hex 32` |

### Running Locally

```bash
# From the project root, with .venv activated:
cd dbms/backend
python app.py
```

The app starts on **http://localhost:5050**. The login page is served at `/`.

The standalone NGO portal is served at **http://localhost:5050/ngo-portal**.

### Default Login Credentials

| Role | Username | Password |
|---|---|---|
| Border Patrol / Sea Marshall / Immigration | Any non-empty value | Any non-empty value |
| NGO (govt portal) | Any non-empty value | Any non-empty value |
| Refugee | — | Provisional ID self-lookup (no password) |

The standalone NGO portal uses database-backed credentials. NGO admin accounts are auto-created when a govt admin approves an NGO; the initial password is the NGO name in lowercase with spaces replaced by underscores.

---

## Project Structure

```
Barrage systems/
├── .env                              # API keys and secrets (gitignored)
├── .gitignore
│
├── ngo-frontend/                     # Standalone NGO portal (separate branding)
│   ├── index.html                    # NGO login (admin + worker)
│   ├── admin-dashboard.html          # NGO Admin: refugees, workers, capacity, requests, directory
│   ├── worker-dashboard.html         # NGO Worker: assigned refugees, aid logging, status updates
│   ├── app.js                        # Auth guard, apiFetch(), logout, toast helpers
│   └── style.css                     # NGO portal design (teal/green palette, distinct from govt)
│
└── dbms/
    ├── backend/
    │   ├── app.py                    # Flask app factory; registers 7 blueprints; serves both frontends
    │   ├── database.py               # SQLite connection, WAL mode, init_db(), column migrations
    │   ├── requirements.txt          # Python dependencies
    │   ├── seed_data.sql             # Schema + 350 seed entities (auto-runs on first start)
    │   ├── dbms.sqlite               # SQLite database (auto-created on first run)
    │   ├── vessels.json              # Flat vessel registry (merged with DB at runtime)
    │   ├── ngos.json                 # NGO list keyed by border force (used for NGO card display)
    │   ├── seed_alerts.py            # One-time script to seed sample alerts for testing
    │   └── routes/
    │       ├── auth.py               # POST /api/auth/login, /logout, /session, /ngo-login
    │       ├── dashboard.py          # KPIs, marker stats, entity types, entry points, refugee mgmt, NGO mgmt, alerts
    │       ├── border_patrol.py      # Refugee registration, watchlist check, refugee list, family declare/link/search
    │       ├── immigration.py        # Passport OCR verify, traveller CRUD, grant entry, investigation queue
    │       ├── sea_marshall.py       # Vessel list/CRUD, flag, intercept, add vessel, file incident, clearance
    │       ├── ngo.py                # Assignments list/status, counts, NGO list by force, aid logging, capacity
    │       └── refugee.py            # Provisional ID lookup, timeline GET/POST, appeals GET/POST
    │
    └── frontend/
        ├── index.html                # Login gateway — role and force selector
        ├── css/
        │   ├── global.css            # Full design system: CSS variables (#002147 sidebar, #0057B8 primary), layout, components
        │   ├── border-patrol.css     # Force portal styles
        │   ├── sea-marshall.css      # Vessel dashboard, maritime alert banner, movement badges
        │   ├── immigration.css       # Two-panel OCR layout, scan animation, verification certificate
        │   ├── ngo-portal.css        # Assignment cards with status-colour left borders
        │   ├── refugee-portal.css    # Self-service portal, timeline nodes, rights panel
        │   ├── dashboard.css         # KPI grid, chart containers, refugee/NGO management tables
        │   └── login.css             # Split-panel login, role cards, force sub-buttons
        ├── js/
        │   ├── config.js             # API_BASE, FORCE_SLUGS, CAMP_COORDS, CAMP_CAPACITY, ENTRY_POINTS_BY_FORCE, apiFetch(), formatDate()
        │   ├── auth.js               # Session guard (RBAC), sidebar user info, logout
        │   ├── map.js                # Leaflet setup, custom SVG markers (airport/seaport/land/camp), popup builder
        │   ├── border-patrol.js      # Registration form, watchlist check, NGO cards, camp map, refugee table, family declaration
        │   ├── immigration.js        # Webcam, dropzone, OCR pipeline, verification certificate, traveller CRUD, investigation queue
        │   ├── sea-marshall.js       # Vessel table render, movement badges, flag/intercept/clearance actions, Chart.js cargo charts
        │   ├── ngo-portal.js         # Assignment feed, status workflow, Chart.js status/nationality/force charts
        │   ├── refugee-portal.js     # Provisional ID lookup, status card, timeline render (30s poll), appeals form, camp map
        │   ├── dashboard.js          # KPI polling, Leaflet marker map, Chart.js charts, refugee/NGO management, alerts panel
        │   ├── translation.js        # i18n engine (EN/HI, extensible) — loads JSON, applies data-i18n attributes, activates Devanagari font
        │   └── ui-components.js      # showToast(), openModal(), closeModal(), openDrawer(), closeDrawer()
        ├── pages/
        │   ├── dashboard.html        # Command dashboard — KPIs, map, charts, refugee/NGO/alert management tabs
        │   ├── sea-marshall.html     # Vessel traffic register, KPIs, movement controls, clearance panel
        │   ├── immigration.html      # Webcam biometric + passport scan, traveller database, investigation queue
        │   ├── ngo-portal.html       # Govt-side NGO assignments feed + link to standalone NGO portal
        │   ├── refugee-portal.html   # Self-service ID lookup, status card, timeline, rights, appeals
        │   └── border-patrol/
        │       ├── bsf.html          # BSF — Pakistan & Bangladesh
        │       ├── itbp.html         # ITBP — China & Tibet
        │       ├── ssb.html          # SSB — Nepal & Bhutan
        │       ├── assam-rifles.html # Assam Rifles — Myanmar & Northeast
        │       └── cisf.html         # CISF — Airports, Seaports & Critical Infrastructure
        ├── svg/                      # Force emblems (BSF, ITBP, SSB, CISF, Assam Rifles), UI icons, DBMS logo, India flag
        └── assets/translations/      # i18n JSON — en.json, hi.json, bn.json, ta.json
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Authenticate government user — returns session data |
| POST | `/api/auth/ngo-login` | Authenticate NGO admin or worker against DB users table |
| GET | `/api/auth/session` | Check session validity |
| GET | `/api/dashboard/kpis` | Aggregate KPIs: volume, flags, pending aid, open incidents |
| GET | `/api/dashboard/marker-stats` | Entity counts for a given entry point location |
| GET | `/api/dashboard/entity-types` | Entity type breakdown (Traveler / Refugee / Migrant) |
| GET | `/api/dashboard/top-entry-points` | Top 8 entry points by entity count |
| GET | `/api/dashboard/refugees` | Paginated refugee list with NGO assignment details |
| PUT | `/api/dashboard/refugees/<id>` | Edit refugee details (admin override) |
| POST | `/api/dashboard/refugees/<id>/assign` | Assign or reassign refugee to an NGO |
| GET | `/api/dashboard/ngos/all` | All NGOs with status and current refugee count |
| POST | `/api/dashboard/ngos` | Create a new NGO (pending approval) |
| POST | `/api/dashboard/ngos/<id>/approve` | Approve a pending NGO |
| POST | `/api/dashboard/ngos/<id>/deactivate` | Deactivate an approved NGO |
| POST | `/api/dashboard/ngos/<id>/reactivate` | Reactivate a deactivated NGO |
| GET | `/api/dashboard/alerts` | All alerts (supports `?unread=true`) |
| POST | `/api/dashboard/alerts/read/<id>` | Mark an alert as read |
| POST | `/api/border-patrol/register-refugee` | Register refugee, generate Provisional ID, create NGO assignment |
| POST | `/api/border-patrol/watchlist-check` | Check passport/name against blacklist |
| GET | `/api/border-patrol/refugees` | List refugee registrations (filterable by force) |
| POST | `/api/border-patrol/refugee/<prov_id>/family` | Declare family members for a refugee |
| GET | `/api/border-patrol/family/search` | Search existing refugees by name for family matching |
| POST | `/api/border-patrol/family/link` | Link multiple refugees under a shared family ID |
| POST | `/api/immigration/verify-passport` | OCR scan or passport-number lookup + verification checks |
| GET | `/api/immigration/travelers` | Search traveller entities by name / passport / status |
| POST | `/api/immigration/travelers` | Add a new traveller record |
| PUT | `/api/immigration/travelers/<id>` | Update traveller fields (status, blacklisted, notes, etc.) |
| DELETE | `/api/immigration/travelers/<id>` | Delete a traveller record |
| POST | `/api/immigration/travelers/<id>/photo` | Upload / replace passport photo |
| POST | `/api/immigration/grant-entry` | Set entity status to Verified |
| GET | `/api/immigration/travelers/expiring` | Travellers with expired or soon-to-expire visas |
| GET | `/api/immigration/travelers/under-investigation` | Travellers flagged for investigation |
| POST | `/api/immigration/travelers/<id>/flag-investigation` | Flag a traveller for investigation |
| POST | `/api/immigration/travelers/<id>/confirm-blacklist` | Confirm blacklist (requires officer ID) |
| POST | `/api/immigration/travelers/<id>/clear-flag` | Clear investigation flag |
| GET | `/api/sea-marshall/vessels` | All vessels (JSON registry merged with DB, status overrides applied) |
| GET | `/api/sea-marshall/vessels/<imo>` | Single vessel by IMO |
| POST | `/api/sea-marshall/flag-vessel` | Flag vessel as suspicious (FLAGGED\_ILLEGAL) |
| POST | `/api/sea-marshall/lock-vessel` | Issue intercept order (INTERCEPTED + auto-create incident) |
| POST | `/api/sea-marshall/file-incident` | File a maritime incident report |
| POST | `/api/sea-marshall/add-vessel` | Add a new vessel to the DB registry |
| POST | `/api/sea-marshall/vessels/<imo>/health-clearance` | Grant or deny health clearance |
| POST | `/api/sea-marshall/vessels/<imo>/customs-clearance` | Grant or deny customs clearance |
| GET | `/api/ngo/assignments` | NGO assignment list (filterable by status, paginated) |
| PATCH | `/api/ngo/assignments/<id>/status` | Update assignment status (Pending → Acknowledged → In Progress → Completed) |
| GET | `/api/ngo/assignments/counts` | Assignment counts by status |
| GET | `/api/ngo/list-by-force` | NGOs available for a given border force |
| GET | `/api/ngo/<id>/refugees` | All refugees assigned to an NGO |
| GET | `/api/ngo/<id>/workers` | Worker accounts for an NGO |
| POST | `/api/ngo/<id>/workers` | Create an NGO worker account |
| DELETE | `/api/ngo/workers/<id>` | Deactivate a worker account |
| PUT | `/api/ngo/<id>/capacity` | Update NGO max capacity |
| POST | `/api/ngo/resource-request` | Submit resource request to govt dashboard |
| POST | `/api/ngo/aid-log` | Log aid given to a refugee |
| GET | `/api/refugee/lookup/<provisional_id>` | Self-lookup by Provisional ID — returns full record, rights, emergency contacts |
| GET | `/api/refugee/<provisional_id>/timeline` | Refugee case progress timeline entries |
| POST | `/api/refugee/<provisional_id>/timeline` | Add a stage entry to the refugee timeline |
| GET | `/api/refugee/<id>/appeals` | All appeals submitted by a refugee |
| POST | `/api/refugee/<id>/appeal` | Submit a new appeal / request |

---

## Why This Stack

Flask was chosen for rapid iteration — a working multi-route REST API with server-side OCR and static file serving in a single process, with no build step, is ideal for a hackathon timeline. SQLite eliminates all infrastructure setup while providing ACID compliance with WAL mode for concurrent reads. Tesseract runs server-side in Python rather than client-side WASM to keep the browser thin and avoid the complexities of WASM OCR builds. Leaflet is fully open-source and integrates cleanly with the custom SVG marker rendering needed for the four distinct border point types (airport, seaport, land border, refugee camp). Chart.js was chosen over heavier alternatives because it bundles as a single UMD script with no configuration overhead. Vanilla JS with no bundler or framework means the project runs directly from the filesystem in development — `python app.py` and it works.

---

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes and commit with a clear message: `git commit -m "feat: describe your change"`
3. Ensure no secrets are committed — `.env` and `opensky-network credentials*.json` are gitignored
4. Open a Pull Request against `main` with a description of what changed and why

---

## License

MIT License — © 2026 Barrage Team / Megahackathon 2026
