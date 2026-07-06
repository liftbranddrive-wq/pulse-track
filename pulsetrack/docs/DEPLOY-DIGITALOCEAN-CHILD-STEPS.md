# Deploy PulseTrack on DigitalOcean — every step (explain like I'm new)

Read this **from top to bottom once**, then **do Part 1**, then Part 2, … **Do not skip “Why”**.

**What PulseTrack needs on the internet (4 pieces):**

1. **PostgreSQL database** (DigitalOcean “Managed Database”) — stores all clock-ins, breaks, reports.  
2. **Droplet** (Linux server) — runs the **API** (“brain”).  
3. **Admin website files** (`admin-panel` after `npm run build`) — boss dashboard. Usually on the **same Droplet**, served by Nginx.  
4. **Chrome extension** — stays on **each worker’s PC**; it talks to your **API**. It does **not** upload to DigitalOcean like a PHP site.

Extension + admin both call: `https://api.YOURDOMAIN.com` (your API).

---

## Before you touch DigitalOcean — checklist

| You need | Why |
|---------|-----|
| A **DigitalOcean account** | To rent DB + Droplet |
| Credit card on file | DigitalOcean billing |
| Code on **GitHub** (recommended) | Droplet downloads it with Git |
| A **domain** (e.g. `company.com`) | HTTPS (padlock) + pretty URLs (`api.company.com`). You *can* use IP only later, but HTTPS is messy without a domain. |
| Password manager or notebook | Save **passwords**, **IPs**, copy of **DATABASE_URL** (never post in public chat) |

---

# PART 1 — Create the managed PostgreSQL database

**Goal:** A “notebook” in the cloud. **Where:** DigitalOcean dashboard in the browser.

1. Go to **https://cloud.digitalocean.com** and **log in**.  
2. Look at the **left sidebar**. Click **Databases**.  
3. Click the blue button **Create Database Cluster** (or **Create** → Database).  
4. **Choose PostgreSQL** (PulseTrack expects PostgreSQL, not MongoDB/MySQL here).  
5. **Pick a datacenter region** (e.g. NYC). Try to choose the **same region** as your future Droplet (less latency later if you use “private networking” — optional for starters).  
6. **Pick a plan** — smallest/cheapest tier is OK to start for a small team.  
7. **Cluster name** — any name you like (e.g. `pulsetrack-db`). Click **Create** / **Finalize**.  
8. Wait **minutes** until status is **running** / **healthy**.

### Add your Droplet IP to “Network Access” (you will come back AFTER Droplet exists)

**Why:** The database refuses connections from random computers. Only **allowed IPs** or **trusted resoures** connect.

For now: **skip** finishing this until **Part 5** gives you your **Droplet IP**. Later you’ll open this same database → tab **Network Access** → **Add trusted source** → your **Droplet** or Droplet **public IPv4**.

---

# PART 2 — Copy connection string from the database dashboard

**Goal:** Full URL for `.env` as `DATABASE_URL`.

1. Still in DigitalOcean, left sidebar → **Databases**.  
2. **Click your database cluster name**.  
3. Top row → click **Overview** (**not** Settings, **not** Connection Pools).  
4. Find **Connection details** section.  
5. Use dropdown / tabs → choose **Connection string** (sometimes “URI”).  
6. Copy the whole line starting with **`postgresql://`**.  
7. Paste it somewhere **safe** only for you (**password manager**). **Never** commit this to GitHub.

**Important:** Usually the string includes the real **`doadmin` password**. If you see **`[YOUR_PASSWORD]`** or placeholder, click **Users & Databases**, next to **`doadmin`** click **Show** password copy it and **manually** put it inside the URI.

---

# PART 3 — Buy / use your domain DNS (outside DigitalOcean unless domain is there)

**Goal:** Names like `api.yourcompany.com` and `admin.yourcompany.com` point to **Droplet IP**.

**Wait until Part 5** — you must know your **Droplet public IPv4** first.

Assume your domain DNS is edited at GoDaddy, Namecheap, Cloudflare, Google Domains, etc.:

1. Log in where you bought the domain.  
2. Find **DNS management** / **DNS records** / **Manage DNS**.  
3. Click **Add record** (sometimes **Create record**).  
4. **Record type** = **`A`**  
   - **Name / Host:** `api` (some panels want `api` alone, others `api.yourdomain.com` — follow your provider’s helper text)  
   - **Points to / Value:** Droplet **public IPv4** (from Part 5)  
   - **TTL:** Automatic or 600 seconds  

5. **Add another `A` record:**  
   - **Name:** `admin`  
   - **Points to:** **same Droplet IPv4**

6. **Save** all changes.

**Why two names:** Same server will answer as **API** (`api….`) and as **website** (**admin.**…).

**Propagation:** Often **minutes**, sometimes **up to 48 hours**. Test later with: `ping api.yourdomain.com` (should reply with your Droplet IP when ready).

---

# PART 4 — Create SSH key on your PC (recommended) OR use password login

### Option A — SSH key (recommended, no typing password each time — after setup)

#### On Windows — PowerShell

1. Press **Windows key**, type **`PowerShell`**, open **Windows PowerShell**.  
2. Run:

```powershell
ssh-keygen -t ed25519 -C "your-email-for-label"
```

3. Press **Enter** three times **if asked** save default path `/ no passphrase**.  
4. Show public key:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

5. Select and **copy** the **one-line** output.

#### On DigitalOcean — add that key once

1. DigitalOcean → top right avatar → **Settings** (account) → **Security** → **SSH keys** → **Add SSH Key**.  
2. Paste the line. Give it a **name**. **Save**.

**Why:** When you create the Droplet, you pick this key → you log in securely.

### Option B — Password only on Droplet

Some people choose **root password emailed** — possible but weaker. Prefer keys when you can.

---

# PART 5 — Create the Droplet (Linux server — “brain machine”)

**Goal:** Rent a Ubuntu computer that stays on 24/7.

**Where:** DigitalOcean → **Create** (often top right) → **Droplets** → **Create Droplet**

### Click path (wizard)

1. **Choose Region** — same as DB if you can (e.g. **NYC1**).  

2. **Choose an image** — **Ubuntu** tab → **`24.04 (LTS) x64`** or **`22.04 LTS`**.  

3. **Choose Size** — tab **Regular** / **Shared CPU** → **cheapest/smallest droplet ($4–6/mo tier)** OK for tiny team at first.  

4. **Choose authentication method**:  
   - **SSH keys** → check your key from Part 4, **NOT** passwords only.  

5. **Hostname** — optional, e.g. `pulsetrack-api`.  

6. Click green **Create Droplet** / **Create**.

7. Wait **~1 minute**. Open **Droplets** left menu → click your Droplet → copy **PUBLIC IPv4** (something like `164.208.x.y`).

**Write this IPv4 somewhere safe** — you need it for **DNS Part 3** and **database Network Access**.

### NOW finish database trusted network

8. Left menu → **Databases** → your cluster → tab **Network Access**.  
9. **Add trusted source**: pick **your Droplet** by name OR type **PUBLIC IPv4** of Droplet.  
10. **Save**.

---

# PART 6 — Firewall on Droplet (first SSH session)

### Open PowerShell / Terminal on YOUR computer

Replace `YOUR_DROPLET_IP`:

```powershell
ssh root@YOUR_DROPLET_IP
```

- First prompt about **authenticity**: type **`yes`** → Enter  
- Then you should see **`root@...:~#`**

### Run firewall + updates — copy each block separately

```bash
apt update && apt upgrade -y
```

```bash
apt install -y ufw nginx certbot python3-certbot-nginx git curl
```

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

```bash
ufw status
```

**Why:**

- **`ufw`** = simple firewall — only SSH + HTTP/HTTPS allowed.  
- **Nginx + Certbot** = public web server + **free HTTPS** certificate.  
- **Git** = download code.

---

# PART 7 — Install Node.js 20 LTS on Droplet

**Why:** PulseTrack backend is JavaScript(Node).

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
```

```bash
apt install -y nodejs
```

```bash
node -v && npm -v
```

You want **v20**.

### Install PM2 (keeps Node running forever)

```bash
npm install -g pm2
```

---

# PART 8 — Download PulseTrack code from GitHub onto Droplet

### If repo is PUBLIC

```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git pulsetrack
```

### If repo is PRIVATE

Use **HTTPS** clone URL → when asked **username/password**, use GitHub username + **Personal Access Token** (**not** GitHub login password):

1. Browser → GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained** or **classic** with **repo read** permission → **generate** → **copy token once**.  

```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git pulsetrack
```

Password prompt → paste token.

---

# PART 9 — Navigate to BACKEND folder (important)

PulseTrack backend must be folder that contains **`package.json`** naming `pulsetrack-backend`.

Possible paths (**only one applies**):

```bash
cd /var/www/pulsetrack/pulsetrack/backend   # nested structure
```
or
```bash
cd /var/www/pulsetrack/backend               # simpler structure
```

**Check**:

```bash
ls
```

You MUST see **`package.json`**, **`prisma`**, **`src`**.

If wrong: `pwd` note path, adjust `cd` until correct.

---

# PART 10 — Create BACKEND `.env` on Droplet (secrets)

Still inside **`backend`**:

```bash
nano .env
```

Paste (**edit with your REAL values**) — nano save: **`Ctrl+O`** Enter **`Ctrl+X`** quit:

```env
NODE_ENV=production
PORT=4000

DATABASE_URL=postgresql://doadmin:REAL_PASSWORD_HERE@YOUR_DB_HOST_ON_DO:25060/defaultdb?sslmode=require

JWT_ACCESS_SECRET=type-a-long-random-string-at-least-32-chars
JWT_REFRESH_SECRET=another-long-different-string-32-plus

JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

ADMIN_PANEL_ORIGIN=https://admin.YOURDOMAIN.com
ALLOWED_ORIGINS=https://admin.YOURDOMAIN.com
```

Replace:

- **`DATABASE_URL`** with **exact** copy from Overview → Connection string (**real password**)  
- **`YOURDOMAIN`** with yours  
- JWT strings — generate random (**password generator**).

**Never** paste `.env` in screenshots to public internet.

---

# PART 11 — Backend install — database tables — seed demo users — start API

Still in **`backend`**:

```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed
```

**Why:**

- **`db push`** makes tables empty DB → PulseTrack tables.  
- **`db seed`** makes **admin+beginner member accounts** (**see README** `admin@pulsetrack.local`, etc. — CHANGE passwords afterward in production.)

Start backend:

```bash
pm2 start src/index.js --name pulsetrack-api
```

```bash
pm2 save
```

```bash
pm2 startup
```

If **`pm2 startup`** prints a **sudo** line — copy that **one line**, run it, **Enter**.

Quick test **on server**:

```bash
curl http://127.0.0.1:4000/health
```

Expect JSON **`"ok": true`**.

---

# PART 12 — Build ADMIN website ON YOUR WINDOWS PC upload to Droplet

**Why:** `VITE_API_URL` burns into build time — Must be final **https://api.DOMAIN**

### On YOUR PC locally

Folder **`pulsetrack/admin-panel`**

Create file **`.env.production`** ONE line inside:

```
VITE_API_URL=https://api.YOURDOMAIN.com
```

(No trailing **`/`**.)

Then PowerShell in that folder:

```powershell
npm install
npm run build
```

**Result**: subfolder **`dist`**

### Upload **`dist`** content to Droplet

On Droplet SSH first prepare folder:

```bash
mkdir -p /var/www/pulsetrack-admin
```

Then from **YOUR Windows PowerShell**, **inside** `admin-panel` after build:

```powershell
scp -r dist/* root@YOUR_DROPLET_IP:/var/www/pulsetrack-admin/
```

**(Or use WinSCP / Filezilla SFTP graphical drag-drop same destination.)**

Verify on Droplet:

```bash
ls /var/www/pulsetrack-admin
```

Must show **`index.html`**, **`assets`** folder …

---

# PART 13 — Nginx configs — TWO sites same Droplet HTTP first

SSH droplet →

```bash
nano /etc/nginx/sites-available/pulsetrack.conf
```

Paste — replace **`YOURDOMAIN.com`**:

```nginx
server {
    listen 80;
    server_name api.YOURDOMAIN.com;

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
    server_name admin.YOURDOMAIN.com;

    root /var/www/pulsetrack-admin;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable + remove default conflicting site optional:

```bash
ln -sf /etc/nginx/sites-available/pulsetrack.conf /etc/nginx/sites-enabled/pulsetrack.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

**Why websocket headers:** PulseTrack admin realtime uses socket.io upgrading HTTP.

---

# PART 14 — Free HTTPS Certificates (Let's Encrypt Certbot)

**DNS must ALREADY point BOTH `api` + `admin` A records→ Droplet** or certbot FAILS domain validation.

SSH:

```bash
certbot --nginx -d api.YOURDOMAIN.com -d admin.YOURDOMAIN.com
```

Follow prompts: email OK, agree (A)greement.

Cerbot modifies Nginx to listen **443**.

### Retest HTTPS browser

Visit:

- `https://api.YOURDOMAIN.com/health` — JSON **`ok`**  
- `https://admin.YOURDOMAIN.com` — login  

---

# PART 15 — Chrome EXTENSION teammate instructions (NOT deployed to Droplet ZIP magic)

PulseTrack **`extension`** folder remains project files locally.

Every worker Chrome:

1. Address bar **`chrome://extensions`**  
2. Slide **Developer mode** **ON top-right**.  
3. Button **Load unpacked**  
4. Select folder **`extension`** (**must contain manifest.json**)  
5. Pin extension (**puzzle** icon toolbar).  

Open popup configure:

**Company API** = `https://api.YOURDOMAIN.com` (**no**/api tail).  

Login seeded **MEMBER**: see README seeded member email/password (**change after** verifying).

Boss goes URL:

`https://admin.YOURDOMAIN.com` → **ADMIN** seeded email (**change too** afterward).

---

# PART 16 — Updating code later deployment loop

SSH droplet **`backend`** path:

```bash
cd /var/www/pulsetrack/path/to/backend
git pull
npm install
npx prisma generate
npx prisma db push        # ONLY if prisma schema DB changed developer side
pm2 restart pulsetrack-api
```

Admin rebuilt PC → re-upload **`dist`** SCP again overwriting.

---

# PART 17 — Troubleshooting quick table

| Symptom | Check |
|---------|-------|
| `curl 127 port 4000` fails locally | **`pm2 status`**, **`pm2 logs pulsetrack-api`** |
| HTTPS certbot fails DNS | registrar **A records** wait — `ping api.DOMAIN`, ensure matches droplet IPv4 |
| admin blank page white | **`dist`** paths root correct + browser devtools Errors **F12** Console |
| **`prisma` errors database** unreachable | DATABASE_URL password correct + trusted droplet IPv4 Networking DB |
| **`CORS` errors admin** Browser console | ADMIN_PANEL_ORIGIN ALLOWED_ORIGINS exact **https URLs** typo-free |

---

# Safety reminders

Rotate DB password (`doadmin`) if pasted leak anywhere public. **`git status`** NEVER commit `.env`. Change seed default passwords after first login.

Done.
