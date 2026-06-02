# PulseTrack API

Base URL `http://localhost:4000` (dev).

All timestamps are UTC ISO8601 unless noted.

## Auth headers

Protected routes require:

```
Authorization: Bearer <accessJwt>
```

## Auth

### `POST /api/auth/bootstrap`

Creates first admin account when DB has zero users.

Request:

```json
{ "email": "...", "password": "AtLeast8!", "name": "Ada", "companyName": "My Co" }
```

### `POST /api/auth/register` (ADMIN)

Create team member/admin.

### `POST /api/auth/login/admin`

### `POST /api/auth/login/member`

Request: `{ "email": "...", "password": "..." }`

### `POST /api/auth/refresh`

Request: `{ "refreshToken": "..." }` (or httpOnly cookie `refreshToken`).

### `GET /api/auth/me`

## Member Sessions

### `POST /api/sessions/clock-in`

### `POST /api/sessions/clock-out`

`{ "sessionId": "<id>" }`

### `POST /api/sessions/break/start`

`{ "sessionId": "..", "type": "SHORT" | "LUNCH" | "PERSONAL" }`

### `POST /api/sessions/break/end`

### `POST /api/sessions/pause` • `resume`

Manual pause unrelated to escalated reminders.

### `POST /api/sessions/state/idle`

### `POST /api/sessions/state/ghost`

### `POST /api/sessions/state/resume-focus`

### `POST /api/sessions/reminder`

Logs reminder escalations `{ sessionId, level: "L1"|"L2"|"L3" }`.

### `POST /api/sessions/reminder/ack`

### `PATCH /api/sessions/preferences`

`{ "inactivityThresholdMin": 5 | 10 | 15 | 20 | … }`

### `GET /api/sessions/active`

Returns `{ session, liveActiveMs }` — live active milliseconds include the open ACTIVE segment.

### `POST /api/sessions/heartbeat`

Body: `{ "sessionId": "…" }` — re-aggregates segment totals and returns `{ session, liveActiveMs }` (extension calls every ~2 min while clocked in).

### `GET /api/sessions/today`

Totals for local rolling **UTC midnight** aggregates.

---

## Admin (Bearer + role ADMIN)

- `GET /api/admin/dashboard` — `{ team, totals, flaggedToday }`
- `GET /api/admin/members`
- `PATCH /api/admin/members/:id`
- `DELETE /api/admin/members/:id`
- `GET /api/admin/members/:id/sessions`
- `PATCH /api/admin/sessions/:id/edit`
- `POST /api/admin/sessions/:id/recompute`
- `GET /api/admin/flags`
- `PATCH /api/admin/flags/:id/dismiss`
- `GET /api/admin/reports/focus-board?range=today|week`
- `GET /api/admin/reports/reminders`
- `GET /api/admin/email-log`
- `POST /api/admin/email/test` `{ "to": ".." }`

### CSV / XLSX / PDF

Protected downloads:

```
GET /api/admin/export/csv/daily-team?day=<iso date>
GET /api/admin/export/xlsx/week?weekStart=<iso date>
GET /api/admin/export/pdf/daily-summary?day=<iso date>
```

## Socket.io (admins only)

Handshake:

```javascript
socket = io(API_URL, { auth: { token: accessJwt } })
```

Event `team:status` payload:

```json
{
  "board": [
    {
      "userId": "…",
      "name": "",
      "presence": "WORKING|ON_BREAK|IDLE|PAUSED|OFFLINE",
      "session": { "...Prisma.WorkSession snippet..." }
    }
  ],
  "totals": { "totalActiveMs": 0 }
}
```

## Background email jobs (reference)

Queue types handled in `src/jobs/emailQueue.js`: `WEEKLY_TEAM`, `DAILY_ADMIN_SUMMARY`, `INDIVIDUAL_WEEKLY`, `ABSENTEE_ALERT`, `FLAG_ALERT`. Schedules are UTC (`src/jobs/scheduler.js`).

## Error shape

401/403/400:

```json
{ "error": "Short message" }
```
