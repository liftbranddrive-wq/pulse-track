# Deploy PulseTrack on DigitalOcean — complete guide (non‑technical)

**Read this once from top to bottom.** Then do **Part 1**, then **Part 2**, and so on. Do not skip the “Why” boxes — they tell you *when* and *why* each step matters.

---

## 🟢 START HERE (you have NOT deployed admin yet)

You need **4 things** on the internet:

| # | What | Plain English | Where it lives |
|---|------|---------------|----------------|
| 1 | **Database** | Saves every clock-in, leave, points | DigitalOcean “Managed Database” |
| 2 | **API server** | The brain — extension + admin talk to this | DigitalOcean Droplet (Linux) |
| 3 | **Admin website** | Boss dashboard in the browser | Same Droplet, served as files |
| 4 | **Chrome extension** | Workers click Clock In on their PC | Each person’s Chrome — **not** uploaded to DigitalOcean |

**Your URLs will look like:**

- API: `https://api.liftbrandfulfillment.com`
- Admin: `https://admin.liftbrandfulfillment.com`
- Extension “Company API” field: **same as API** (no `/api` at the end)

---

## 📋 Before you open DigitalOcean — checklist

| You need | Why |
|---------|-----|
| DigitalOcean account + card | To pay for database + server |
| Your project folder on your PC | `pulsetrack` folder with backend, admin-panel, extension |
| A domain (e.g. `liftbrandfulfillment.com`) | HTTPS padlock + pretty links |
| Notebook or password manager | Save IPs, passwords, database URL — **never** share publicly |
| GitHub account (optional but easier) | Server can `git pull` updates later |

**Time:** First full deploy usually takes **2–4 hours** if you go slowly. That is normal.

---

## 🔧 Fix “Invalid or expired token” on Clock In (extension)

**What happened:** You signed in, waited a while, then Clock In failed.

**Why:** The server login expires after ~15 minutes unless the extension refreshes it. **This is now fixed** in the latest extension code — it auto-refreshes your session.

**What you must do after updating code:**

1. On your PC, open Chrome → type in the address bar: `chrome://extensions`
2. Find **Liftbrand PulseTrack** (or PulseTrack)
3. Click the **circular reload arrow** on the extension card
4. Open the extension → click **Sign out** (top right) if you see it
5. Sign in again with your **member** email + password
6. **Company API** must be exactly: `https://api.liftbrandfulfillment.com`  
   (NOT the admin website URL)

If it still fails: wrong API URL, wrong password, or the API server is not running on DigitalOcean yet (finish Parts 1–14 below first).

---

## 🗺️ Big picture — order of work

Do these **in order**:

1. Create database (Part 1–2)
2. Create Droplet / server (Part 4–5)
3. Point domain `api.` and `admin.` to server IP (Part 3 + 6)
4. Install Node + code on server (Part 7–9)
5. Create `.env` file with database password (Part 10)
6. Start API with PM2 (Part 11)
7. Build admin on **your Windows PC**, upload `dist` folder to server (Part 12)
8. Configure Nginx (Part 13)
9. Turn on HTTPS with Certbot (Part 14)
10. Load extension on each worker PC (Part 15)
11. Log into admin, add real staff (Part 15 end)

---

## 📊 New feature: Monthly performance in extension

After deploy, workers open extension → tab **My record**:

- **Monthly performance** cards (hours, attendance, points, streak)
- **Calendar** — tap a day for details
- Use **‹ ›** arrows to see past months

---

# PART 1 — Create the managed PostgreSQL database

**Goal:** A cloud notebook for all PulseTrack data.  
**Where:** Browser → [https://cloud.digitalocean.com](https://cloud.digitalocean.com)

1. **Log in** to DigitalOcean.
2. **Left sidebar** → click **Databases**.
3. Click **Create Database Cluster** (blue button).
4. Choose **PostgreSQL** (not MySQL/MongoDB).
5. Pick a **region** (e.g. NYC — same as your future server if possible).
6. Pick the **smallest/cheapest plan** to start.
7. Name it e.g. `pulsetrack-db` → click **Create**.
8. **Wait** until status says **Online** / **Running** (a few minutes).

**Why:** Without a database, clock-ins cannot be saved.

---

# PART 2 — Copy the database connection string

**Goal:** One long URL you will paste into a secret server file later.

1. Left sidebar → **Databases** → **click your cluster name**.
2. Tab **Overview** (top).
3. Find **Connection details**.
4. Dropdown → choose **Connection string** / **URI**.
5. Copy the line starting with `postgresql://`
6. Paste into your **password manager** only.

**If you see `[YOUR_PASSWORD]`:** go to **Users & Databases** → next to user `doadmin` → **Show password** → paste into the URL where the placeholder was.

**Why:** The API uses this URL to read/write clock-ins. You will paste it in Part 10 as `DATABASE_URL=...`

---

# PART 3 — Domain DNS (do AFTER you have Droplet IP in Part 5)

**Goal:** When someone types `api.yourdomain.com`, they reach your server.

1. Log in where you bought your domain (GoDaddy, Namecheap, Cloudflare, etc.).
2. Open **DNS** / **Manage DNS** / **DNS records**.
3. **Add record** → Type **`A`**
   - **Name / Host:** `api`
   - **Value / Points to:** your Droplet **public IPv4** (from Part 5)
   - TTL: Automatic
4. **Add another `A` record**
   - **Name:** `admin`
   - **Value:** same Droplet IP
5. **Save**. DNS can take **5 minutes to 48 hours** (often ~15 min).

**Why:** Browsers need a name + HTTPS certificate. IP-only is painful for HTTPS.

**Test (later):** open Command Prompt → `ping api.liftbrandfulfillment.com` — should show your Droplet IP.

---

# PART 4 — Create the Droplet (Linux server)

**Goal:** A computer in the cloud that runs your API 24/7.

1. DigitalOcean left sidebar → **Droplets** → **Create Droplet**.
2. **Region:** same as database if possible.
3. **Image:** **Ubuntu 24.04 LTS** (or 22.04).
4. **Size:** Basic → **$6/mo** or smallest that fits your team.
5. **Authentication:** SSH key (best) **or** password emailed to you.
6. **Hostname:** e.g. `pulsetrack-server`
7. Click **Create Droplet**.
8. Wait until **green / active**.

**Why:** The API and admin files live here.

---

# PART 5 — Save Droplet IP + allow database access

1. On Droplets page → copy **PUBLIC IPv4** (e.g. `164.92.xxx.xxx`) → save in notebook.
2. Go back to **Databases** → your cluster → **Network Access** (or Settings → Trusted Sources).
3. **Add trusted source** → add your **Droplet** by name **or** paste the **public IPv4**.
4. Click **Save**.

**Why:** Database blocks strangers. Only your Droplet may connect.

**Now finish Part 3** (DNS A records) if you have not yet.

---

# PART 6 — Connect to your server (SSH)

**Goal:** Open a text window where you type commands **on the server**.

**Windows (easy way):**

1. Download **PuTTY** OR use Windows Terminal.
2. Host: your Droplet **IP**
3. User: `root` (default on DO)
4. Connect → accept fingerprint → enter password if you chose password auth.

**You should see** a prompt like `root@pulsetrack-server:~#`

**Why:** Installing software happens **on the server**, not on your PC desktop.

---

# PART 7 — Install Node.js, Git, Nginx, PM2 on the server

Copy-paste **one block at a time** in SSH (wait for each to finish):

```bash
apt update && apt upgrade -y
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
node -v
```

**Why each:** Node runs the API; Git downloads code; Nginx serves admin + forwards API; PM2 keeps API running after you disconnect.

---

# PART 8 — Put PulseTrack code on the server

**Option A — GitHub (recommended):**

```bash
mkdir -p /var/www/pulsetrack
cd /var/www/pulsetrack
git clone YOUR_GITHUB_REPO_URL .
```

**Option B — Upload ZIP from your PC** using FileZilla/WinSCP to `/var/www/pulsetrack`

**Why:** The server needs the same `pulsetrack/backend` folder you have on your PC.

---

# PART 9 — Install backend dependencies + database tables

```bash
cd /var/www/pulsetrack/pulsetrack/backend
npm install
npx prisma generate
npx prisma db push
npm run seed
```

**Why:** `npm install` = libraries; `prisma db push` = creates tables; `seed` = demo admin + member accounts.

**Demo logins after seed:**

- Admin: `admin@pulsetrack.local` / `changeme12345`
- Member: `member@pulsetrack.local` / `changeme12345`  
  **Change these immediately** after first login in admin → Members.

---

# PART 10 — Create the secret `.env` file on the server

```bash
cd /var/www/pulsetrack/pulsetrack/backend
nano .env
```

Paste (edit the ALL_CAPS parts):

```env
NODE_ENV=production
PORT=4000
DATABASE_URL=PASTE_YOUR_POSTGRESQL_CONNECTION_STRING_HERE
JWT_ACCESS_SECRET=make_a_long_random_string_at_least_32_chars
JWT_REFRESH_SECRET=another_long_random_string_different_from_above
ADMIN_PANEL_ORIGIN=https://admin.liftbrandfulfillment.com
ALLOWED_ORIGINS=https://admin.liftbrandfulfillment.com
```

Save in nano: **Ctrl+O** → Enter → **Ctrl+X**

**Why:** Secrets must never go on GitHub. This file tells the API how to connect.

---

# PART 11 — Start the API and keep it running

```bash
cd /var/www/pulsetrack/pulsetrack/backend
pm2 start src/index.js --name pulsetrack-api
pm2 save
pm2 startup
```

Follow the command `pm2 startup` prints (copy-paste it).

**Test on the server:**

```bash
curl http://127.0.0.1:4000/health
```

Should show JSON with `"ok": true`.

**Why:** PM2 restarts the API if the server reboots.

---

# PART 12 — Build admin on YOUR PC, then upload to server

**This step is on your Windows computer, not SSH.**

1. Open **PowerShell**.
2. Run:

```powershell
cd "C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\admin-panel"
npm install
npm run build
```

3. After success, folder `admin-panel\dist` exists with `index.html` inside.

**Upload `dist` contents to server:**

Using **WinSCP** or **FileZilla**:

- Connect to Droplet IP as `root`
- Create folder: `/var/www/pulsetrack-admin`
- Upload **everything inside** `dist` (not the dist folder itself) into `/var/www/pulsetrack-admin`

**Why:** Admin is static files (HTML/JS). The server just shows them — no `npm run` on the server for admin.

---

# PART 13 — Nginx: connect domain names to API + admin

SSH into server:

```bash
nano /etc/nginx/sites-available/pulsetrack.conf
```

Paste (replace domain if different):

```nginx
server {
    listen 80;
    server_name api.liftbrandfulfillment.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name admin.liftbrandfulfillment.com;

    root /var/www/pulsetrack-admin;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable:

```bash
ln -sf /etc/nginx/sites-available/pulsetrack.conf /etc/nginx/sites-enabled/pulsetrack.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

**Why:** Nginx is the front door — `api.` goes to Node, `admin.` shows your dashboard files.

---

# PART 14 — HTTPS (padlock) with Certbot

**DNS must already point to your Droplet** or this fails.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.liftbrandfulfillment.com -d admin.liftbrandfulfillment.com
```

- Enter email → agree → choose redirect HTTP to HTTPS if asked.

**Test in browser:**

- `https://api.liftbrandfulfillment.com/health` → JSON ok
- `https://admin.liftbrandfulfillment.com` → login page

**Why:** Chrome extensions and modern browsers require HTTPS for secure login.

---

# PART 15 — Chrome extension (every worker)

**On each team member’s PC:**

1. Chrome address bar → type: `chrome://extensions` → Enter
2. Top-right → turn **Developer mode** **ON**
3. Click **Load unpacked**
4. Select folder:  
   `C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\extension`  
   (must contain `manifest.json`)
5. Click the **puzzle piece** icon in Chrome toolbar → **pin** PulseTrack

**First open extension:**

1. **Company API:** `https://api.liftbrandfulfillment.com`
2. Email + password: **member** account (created in admin → Members)
3. Click **Sign in**

**Tabs workers use:**

- **Work** — Clock in/out, breaks
- **Leave** — Request time off
- **Points** — Score + streak
- **My record** — **Monthly performance + calendar**

**Boss / admin:**

- Browser → `https://admin.liftbrandfulfillment.com`
- Login with **admin** account
- Add real members, set schedule, view attendance

---

# PART 16 — When you change code later

**Backend on server (SSH):**

```bash
cd /var/www/pulsetrack/pulsetrack/backend
git pull
npm install
npx prisma generate
npx prisma db push
pm2 restart pulsetrack-api
```

**Admin:** rebuild on PC (`npm run build`), re-upload `dist` to `/var/www/pulsetrack-admin`

**Extension:** each worker goes to `chrome://extensions` → click **reload** on PulseTrack

---

# PART 17 — Troubleshooting

| Problem | What to check |
|--------|----------------|
| Clock in: “Invalid or expired token” | Reload extension → Sign out → Sign in. API URL must be `https://api...` not admin URL |
| Admin white blank page | Re-upload `dist`; press F12 in browser → Console for errors |
| API not responding | SSH: `pm2 status` and `pm2 logs pulsetrack-api` |
| Database connection error | `.env` DATABASE_URL password correct; Droplet IP in DB trusted sources |
| Certbot / HTTPS fails | DNS A records for `api` and `admin` must point to Droplet IP — wait 15+ min |
| Extension “Wrong Company API URL” | Use API domain, not admin domain |
| CORS errors in admin | `.env` ADMIN_PANEL_ORIGIN and ALLOWED_ORIGINS must match exact `https://admin...` URL |

---

# Safety reminders

- Never put `.env` or database passwords on GitHub.
- Change default seed passwords after first login.
- If a password was shared in chat, rotate it in DigitalOcean → Database → Users.

**You are done when:** health URL works, admin login works, extension clock-in works, and My record shows monthly stats.

For the original long-form guide with extra detail, see also `DEPLOY-FULL-ATTENDANCE.md`.
