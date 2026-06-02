# PulseTrack

Smart, privacy-respecting team time tracking: **manifest v3** browser companion for members plus a React admin console for honest insights (including **ghost** time heuristics, not keystroke surveillance).

```
pulsetrack/
├── backend/           # Express + Prisma + Socket.io + Bull (optional Redis)
├── admin-panel/       # React + Tailwind + Recharts
├── extension/         # Chromium MV3 popup + alarms + lightweight activity pings
├── docs/API.md        # Endpoint reference
```

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- (Optional) Redis 6+ — enables Bull-backed email retries (`REDIS_URL`)
- Chromium / Edge for loading the unpacked extension

## 1 · Database & backend

```bash
cd backend
cp .env.example .env
# Fill DATABASE_URL, JWT_* secrets

npm install

npx prisma generate
npx prisma db push   # or prisma migrate dev

npm run db:seed      # optional demo admin/member credentials (see stdout)

npm run dev
```

If you updated PulseTrack, run `npx prisma db push` again so new columns (for example optional **job title** on team members) exist in your database.

Default seed logins (`SEED_ADMIN_*`/`SEED_MEMBER_*` env overrides supported):

- **Admin dashboard:** `admin@pulsetrack.local` / `changeme12345`
- **Member / extension:** `member@pulsetrack.local` / `changeme12345`

> First-ever install with no seed? Use `POST /api/auth/bootstrap` (documented in `docs/API.md`).

### JWT & CORS

Set `EXTENSION_ORIGIN` to `chrome-extension://<id>` after first load (`chrome://extensions` → PulseTrack).

`ALLOWED_ORIGINS` accepts comma-separated values for hardened deployments.

## 2 · Admin panel

```bash
cd admin-panel
cp .env.example .env.development.local
npm install
npm run dev
```

`VITE_API_URL` should point at the API (defaults to `http://localhost:4000` in code paths).

JWT auto-logout after **20 minutes** of idle mouse/keyboard in the dashboard tab mirrors the humane approach of PulseTrack everywhere else.

### Production build

```
npm run build
```

Serve the `dist/` folder via HTTPS behind the same apex domain as the API **or** continue setting `VITE_API_URL`.

## 3 · Browser extension

1. `chrome://extensions` → Developer mode ON → **Load unpacked** → choose `pulsetrack/extension`.
2. Open the PulseTrack popup, set **Company API** to your backend (`http://localhost:4000` local dev works if `host_permissions` cover it).
3. Sign in using a **MEMBER** account.

Chrome will prompt for alarms + notifications grants — alarms drive the escalation ladder; notifications mirror the humane nudge copy from the brief.

### Behaviour highlights

- Content script only pings the service worker (throttled)—**no keystroke capture**.
- Separate **Ghost** spans when Level 3 idle triggers (`/api/sessions/state/ghost`).
- Break types & manual pause/resume endpoints match admin expectations.

Update `EXTENSION_ORIGIN` in backend `.env` after Chrome assigns an ID so tightening CORS in production stays simple.

## Email + scheduling

SMTP / SendGrid fields live inside `OrgSettings` (editable in **Settings** in the admin UI or via `PATCH /api/admin/org`).

- **SMTP:** populate `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`.
- **SendGrid:** set `emailProvider` to `SENDGRID`, store `sendgridApiKey`.

**Scheduled jobs (UTC server clock)** — toggles and recipients are under admin **Settings**:

| Job | Cron (UTC) | Email types |
|-----|------------|-------------|
| Monday batch | `0 9 * * 1` | `WEEKLY_TEAM`, `INDIVIDUAL_WEEKLY` |
| Daily admin rollup | `0 19 * * *` | `DAILY_ADMIN_SUMMARY` (if enabled) |
| Weekday absentee | `0 11 * * 1-5` | `ABSENTEE_ALERT` (if enabled) |

**Flag alert:** when a member **clocks out**, if they have **≥3 open flags that day** or **>2h ghost** on that UTC day, admins on `adminSummaryRecipients` (or weekly recipients as fallback) get one `FLAG_ALERT` per member per day (deduplicated).

Templates are MJML-based in `backend/src/services/weeklyEmail.js` and `bulkEmails.js` — shorter than a full marketing suite, but production-safe to extend.

Provide `REDIS_URL` for Bull-backed retries; without it, email runs inline (`src/jobs/emailQueue.js`).

**Timezone note:** jobs use **UTC** until a follow-up wires `OrgSettings.timezone` into `node-cron` for every org change. Stored org timezone still applies to copy in emails where noted.

## MongoDB configurability note

PulseTrack ships with **PostgreSQL + Prisma** for relational integrity across sessions/break segments/audit trails. Supporting Mongo alongside Prisma doubles the datastore surface — if Mongo is a hard constraint, scaffold a sibling `mongoose/` package mirrored from Prisma entities and expose it via repository interfaces.

## Security checklist

1. bcrypt password hashes (`bcryptjs`).
2. JWT access + hashed refresh persistence.
3. Helmet + `express-rate-limit`.
4. Admin-only realtime channel + RBAC middleware.
5. No screenshot / DOM capture — code review `extension/content/activity-bridge.js`.

Happy shipping — keep conversations human when interpreting **ghost minutes**. 🎯

---

## Your mega-spec vs this codebase (honest checklist)

This table is against the full PulseTrack + “cheat intelligence” + email prompt you pasted.

| Area | Status |
|------|--------|
| MV3 extension, clock in/out, breaks, pause, thresholds, ghost/idle paths | **Done** |
| Activity via mouse/keyboard signals only (no screenshots / no keystroke content) | **Done** |
| JWT auth, admin vs member, refresh, rate limits, CORS + extension origin | **Done** |
| PostgreSQL + Prisma (Mongo “configurable” = not bundled; would be a separate datastore layer) | **Partial** (PG only) |
| Socket.io live team board | **Done** |
| Admin: dashboard, members, time logs, ghost report, focus board, flags, audit, reports, exports (CSV/XLSX/PDF) | **Done** (chart depth varies by page) |
| Session timeline + segments (active / idle / break / ghost) | **Done** |
| Cheat flags (ghost ratio, reminders, low score, etc.) + dismiss with audit | **Done** (some edge flags like “instant clock-out” need real-world tuning) |
| In-app email settings toggles + test send + email log | **Done** (SMTP/SendGrid via org; full “Email Reports” UI polish can grow) |
| Weekly team + individual weekly + daily summary + absentee + flag alert emails | **Done** (MJML templates are **simpler** than your novel-length spec; content is expandable) |
| Cron exactly matching custom per-org times/timezone | **Partial** (runs on **UTC**; org timezone field exists for future wiring) |
| GHL native integration | **Not done** (placeholder page + README note) |
| GoHighLevel “paste HTML/CSS/JS” funnel builder | **Wrong tool for admin app** (see below) |
| Chrome Web Store packaging (icons, store listing) | **You / designer** (icons + manifest polish) |
| Claude’s exact premium mock CSS | **Different** — this repo uses a cohesive **light SaaS** admin skin + extension styling you can iterate in `admin-panel/src` |

---

## Vercel, Firebase, and GoHighLevel (plain English)

- **Vercel — YES for the admin website.** After `cd admin-panel && npm run build`, deploy the **`dist/`** folder (or connect the Git repo and set build command `npm run build`, output `dist`). Set env **`VITE_API_URL`** to your **real public API URL** (must start with `https://` in production).
- **Vercel — NO for the main API** if you keep **Express + Socket.io + long-lived cron** as-is. Those need a **container / VPS / Railway / Render / Fly.io** style host, not a pure serverless function.
- **Firebase** can host the **same built admin** (`dist`) like Vercel, but **this project does not use Firestore/Realtime DB** for core data — the database is **PostgreSQL** (e.g. Neon, Supabase, RDS, or your host’s Postgres).
- **GoHighLevel custom pages** are for **marketing / funnels**, not a signed-in SaaS dashboard. You **cannot** drop this whole React admin into a GHL HTML box and expect logins, charts, and sockets to work. Use GHL for **landing pages**; host PulseTrack admin on **Vercel** (or Firebase Hosting) and link out to it.

---

## For non-technical owners — how to see it on your PC

### What was confusing before

A earlier pass mixed **big design goals** with **what was actually coded**. The repo now has **end-to-end** extension + API + admin + ghost/focus + exports + many emails — not every paragraph of the spec is duplicated word-for-word in email HTML.

### Steps (same as before, still the easiest path)

These steps assume **Node.js** from [https://nodejs.org](https://nodejs.org) (LTS) and **PostgreSQL** for Windows from [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/).

1. Install PostgreSQL; remember the `postgres` password.
2. Folder: `pulsetrack\backend` — copy `.env.example` → `.env`, set `DATABASE_URL` (and JWT secrets).
3. PowerShell in `backend`: `npm install` → `npx prisma generate` → `npx prisma db push` → `npm run db:seed` → `npm run dev` (leave open).
4. Second window in `pulsetrack\admin-panel`: `npm install` → `npm run dev` → open **http://localhost:5173** → log in as **admin** (seed defaults in this README).
5. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `pulsetrack\extension`. Popup: **Company API** `http://localhost:4000`, sign in as **member**.

If something errors, screenshot the red text — usually `DATABASE_URL`, Postgres not running, or Node not installed.

### “Going live” checklist (after everything works locally)

| You provide | A developer / host configures |
|-------------|-------------------------------|
| Domain (optional) | HTTPS |
| Postgres (managed) | `DATABASE_URL` on the server |
| SMTP or SendGrid | Secrets on the server |
| Chrome Web Store account ($5 one-time) | Icons + listing + privacy wording |

**Order of operations:** (1) Deploy **API + Postgres** and get **`https://api.yourcompany.com`**. (2) Deploy **admin** to Vercel with **`VITE_API_URL`** pointing there. (3) Set backend **`ALLOWED_ORIGINS`** to your Vercel admin URL and **`EXTENSION_ORIGIN`** to `chrome-extension://…`. (4) Publish extension or distribute unpacked for internal use.

---

### Summary

**Does this match the “Claude premium UI” screenshot?** Not pixel-perfect — that conversation was cut off before export. **Does it match the *intent* of your spec (honest time tracking, ghost signals, admin clarity, no surveillance)?** **Yes**, as a working product you can run, deploy, and extend.

Enterprise extras (SOC 2 pack, perfect localized PDFs, deep GHL automation, per-admin cron designer) are **follow-on work**, not magic implied by the spec text alone.