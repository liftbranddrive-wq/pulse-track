# PulseTrack — Full deploy guide (click-by-click)

Use this guide when you want **attendance, leave, points, and the new admin pages** live on the internet.

You need **3 things** on your computer:
1. **GitHub Desktop** (sends code to the cloud)
2. **PowerShell** (builds the admin website on your PC)
3. **DigitalOcean** in your browser (runs the API server)

**Your live URLs (already set up):**
- Admin website: `https://admin.liftbrandfulfillment.com`
- API (extension uses this): `https://api.liftbrandfulfillment.com`

---

## PART 0 — One-time on your PC (before every deploy)

Do this **once** if you never ran it, or after big updates.

### Step 0.1 — Open PowerShell

1. Press the **Windows** key on your keyboard.
2. Type **PowerShell**.
3. Click **Windows PowerShell** (blue icon).

### Step 0.2 — Install backend packages

Copy this **whole block**, paste in PowerShell, press **Enter**:

```powershell
cd "C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\backend"
npm install
```

Wait until it stops (no red errors).

### Step 0.3 — Install admin packages

```powershell
cd "C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\admin-panel"
npm install
```

---

## PART 1 — Send code to GitHub (5 minutes)

### Step 1.1 — Open GitHub Desktop

1. Click **GitHub Desktop** on your taskbar or Start menu.
2. At the top, pick your repo (e.g. **pulse-track** or **liftbrand new extension**).

### Step 1.2 — Commit

1. On the **left**, you see changed files — that is normal.
2. Bottom **left**, in the box **Summary**, type:  
   `Attendance system + dark mode + calendar + reports`
3. Click the blue button **Commit to main** (or **Commit to master**).

### Step 1.3 — Push

1. Click **Push origin** at the top (or **Publish branch** if first time).
2. Wait until it says **Fetched** or shows no pending push.

✅ Your code is in the cloud. The server can download it next.

---

## PART 2 — Update the server (API + database) (10 minutes)

### Step 2.1 — Open DigitalOcean

1. Open your browser (Chrome).
2. Go to: **https://cloud.digitalocean.com**
3. Log in if asked.

### Step 2.2 — Open your server console

1. Click **Droplets** on the left.
2. Click your server name (e.g. **PulseTrack** — IP may be `206.189.197.67`).
3. Click the **Access** tab.
4. Click **Launch Droplet Console** or **Launch Console**.
5. A **black window** opens — that is your server.

### Step 2.3 — Log in to the console

1. If it asks **login**, type: `root` and press **Enter**.
2. Type your **root password** (you will **not** see dots — that is normal) and press **Enter**.

### Step 2.4 — Paste this whole block

Click inside the black window, **paste** this, press **Enter**:

```bash
cd /var/www/pulsetrack
git pull
cd pulsetrack/backend
npm install
npx prisma generate
npx prisma db push
npm run db:seed
pm2 restart pulsetrack-api
sleep 2
curl -s http://127.0.0.1:4000/health
```

### Step 2.5 — Check it worked

The **last line** should look like:

```json
{"ok":true,"service":"pulsetrack-api"}
```

If you see that → API is running with the new database tables.

**If `git pull` fails:** go back to Part 1 and click **Push origin** again.

**If `prisma db push` asks something:** type `y` and Enter.

---

## PART 3 — Build admin website on your PC (3 minutes)

Back in **PowerShell** on your Windows PC:

```powershell
cd "C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\admin-panel"
npm run build
```

Wait until you see **built in** or **dist** folder ready. No red errors.

This creates a folder called **`dist`** — that is your admin website.

---

## PART 4 — Upload admin website to server (10 minutes)

Still in PowerShell (same admin-panel folder):

### Step 4.1 — Upload files

Paste **one line at a time**. Each time it may ask for **password** — use your DigitalOcean **root** password.

```powershell
scp -r dist/assets root@206.189.197.67:/var/www/pulsetrack-admin/
```

```powershell
scp dist/index.html root@206.189.197.67:/var/www/pulsetrack-admin/
```

*(Change `206.189.197.67` if your Droplet IP is different — see DigitalOcean Droplet page.)*

### Step 4.2 — Fix permissions (in DigitalOcean console)

Go back to the **black DigitalOcean console**, paste:

```bash
chmod -R 755 /var/www/pulsetrack-admin
```

---

## PART 5 — Chrome extension (each team member’s PC)

No upload to server. Extension files stay on each person’s computer.

### Step 5.1 — Reload extension (you, first)

1. Open Chrome.
2. Type in the address bar: `chrome://extensions` and press **Enter**.
3. Find **Liftbrand PulseTrack**.
4. Click the **Reload** icon (circular arrow).

### Step 5.2 — What each worker does

1. Click the **PulseTrack** icon in Chrome toolbar.
2. **Company API:** `https://api.liftbrandfulfillment.com`
3. Log in with **MEMBER** email + password (you create these in admin → **Members**).
4. Tabs they can use:
   - **Work** — clock in/out, late notes
   - **Leave** — request days off (3 days ahead)
   - **Points** — see score and streak
   - **My record** — calendar of present/late/absent/leave

---

## PART 6 — Open admin and check everything (5 minutes)

### Step 6.1 — Open admin site

1. Browser: **https://admin.liftbrandfulfillment.com**
2. Press **Ctrl + Shift + R** (hard refresh — loads new files).

### Step 6.2 — Log in

- Demo: `admin@pulsetrack.local` / `changeme12345`  
- Or your real admin you created in **Members**.

### Step 6.3 — Click through (checklist)

| Where to click | What you should see |
|----------------|---------------------|
| Top right **Dark** button | Switches dark/light mode |
| **Attendance** (left menu) | Today’s team: present, late, absent |
| **Leave** | Pending requests, approve/reject |
| **Schedule** | Clock-in time, grace, copy announcement |
| **Points** | Leaderboard, manual adjust |
| **Security log** | Device/IP anomalies |
| **Reports** | **Flagged members PDF** download + preview list |
| **Members** | Add real staff, disable demo accounts |

---

## PART 7 — Set up your real team

### Add yourself as boss (ADMIN)

1. **Members** → **Add person**
2. Name, **your email**, strong password, Role: **ADMIN**
3. **Sign out** (bottom left) → log in with **your** email.

### Add each remote worker (MEMBER)

1. Same form, Role: **MEMBER**
2. Send them email + password privately.
3. They install/reload extension and use **MEMBER** login only.

### Turn off demo accounts

1. **Members** list
2. **Disable** `member@pulsetrack.local`
3. After your admin works, **Disable** `admin@pulsetrack.local`

### Set work schedule

1. **Schedule** (left menu)
2. Set clock-in (540 = 9:00 AM UTC), required hours (8), grace (5 min)
3. Click **Save schedule**
4. Click **Copy to clipboard** → paste in your **company WhatsApp/Slack group**

---

## When something breaks

| Problem | What to do |
|---------|------------|
| Admin page blank / old design | Part 3 build again + Part 4 upload + Ctrl+Shift+R |
| Extension “wrong API” | API must be `https://api.liftbrandfulfillment.com` not admin URL |
| Clock-in says window closed | **Schedule** — check times; member must clock in within window |
| `git pull` error on server | Part 1 — Push origin in GitHub Desktop first |
| `curl health` not ok | In console: `pm2 logs pulsetrack-api` — read last red lines |
| Database error after update | Run Part 2.4 again (`prisma db push`) |
| scp asks password forever | Use Droplet root password from DigitalOcean email |

---

## Quick reference — order every deploy

1. **GitHub Desktop** → Commit → Push  
2. **DigitalOcean console** → paste Part 2.4 block  
3. **PowerShell** → `npm run build` in admin-panel  
4. **PowerShell** → `scp` upload dist  
5. **DigitalOcean console** → `chmod`  
6. **Browser** → admin site Ctrl+Shift+R  
7. **chrome://extensions** → Reload extension  

---

## Why the AI cannot click Deploy for you

The assistant can write all the code on your PC, but only **you** can:
- Type your **server password** (DigitalOcean / scp)
- Click **Push** in GitHub Desktop
- Click **Reload** in Chrome

That keeps your server safe. You only **copy and paste** the commands above — no coding needed.
