# PulseTrack — deploy guide (non-coder)

**Already done on your PC:** admin website was built (`admin-panel/dist` folder is ready).

You only need **2 websites** in the browser:
1. **GitHub Desktop** (send code to the cloud)
2. **DigitalOcean** (update your server)

---

## BOX 1 — GitHub Desktop (5 minutes)

1. Open **GitHub Desktop**
2. Pick repo **pulse-track** (or your PulseTrack repo)
3. You should see changed files on the left
4. Bottom left: type message: `Add members and fixes`
5. Click **Commit to main**
6. Click **Push origin** (top)

✅ Code is in the cloud.

---

## BOX 2 — DigitalOcean server (10 minutes)

### Open the server “remote control”

1. Go to https://cloud.digitalocean.com
2. Click your Droplet **PulseTrack** (IP `206.189.197.67`)
3. Click **Access** → **Launch Droplet Console** (or **Web Console**)
4. Log in: user `root`, then your server password (typing is invisible — normal)

### Paste this WHOLE block (one time)

Click in the black window, paste, press **Enter**. Wait until you see the `root@...` prompt again.

```bash
cd /var/www/pulsetrack
git pull
cd pulsetrack/backend
npm install
npx prisma generate
npx prisma db push
pm2 restart pulsetrack-api
curl http://127.0.0.1:4000/health
```

Last line should show: `{"ok":true,...}`

---

## BOX 3 — Upload admin website from your PC (10 minutes)

### On your Windows PC

1. Press **Windows key**, type **PowerShell**, open it
2. Paste this line, press **Enter**:

```powershell
cd "C:\Users\HP\OneDrive\Desktop\liftbrand new extension\pulsetrack\admin-panel"
```

3. Paste this (asks for server password — same as DigitalOcean root):

```powershell
scp -r dist/assets root@206.189.197.67:/var/www/pulsetrack-admin/
```

4. Paste this:

```powershell
scp dist/index.html root@206.189.197.67:/var/www/pulsetrack-admin/
```

### Back in DigitalOcean console

Paste:

```bash
chmod -R 755 /var/www/pulsetrack-admin
```

---

## BOX 4 — See the new admin

1. Open https://admin.liftbrandfulfillment.com
2. Press **Ctrl + Shift + R**
3. Log in: `admin@pulsetrack.local` / `changeme12345` (until you add your own admin)
4. Click **Members** — you should see **Add person**

---

## Add real team (remove demo)

### Add yourself as boss (ADMIN)

**Members** → **Add person**

- Name: your name  
- Email: your real email  
- Password: pick a strong password (8+ letters)  
- Role: **ADMIN**

Create → log out → log in with **your** email.

### Add each worker (MEMBER)

Same form:

- Role: **MEMBER**  
- Give them email + password  
- They use **Chrome extension** with those details  

### Turn off demo accounts

On **Members** list:

- **Disable** `member@pulsetrack.local` (demo worker)  
- **Disable** `admin@pulsetrack.local` only **after** your own ADMIN works  

---

## Extension on each PC

No server upload. Each person:

1. `chrome://extensions` → **Reload** Liftbrand PulseTrack  
2. Company API: `https://api.liftbrandfulfillment.com`  
3. Their MEMBER email + password  

---

## Stuck?

| Problem | Fix |
|---------|-----|
| `git pull` says error | Code not pushed — do GitHub Desktop Push first |
| scp asks password | Use Droplet root password from DigitalOcean email |
| Admin page blank | Run `chmod` command again in console |
| No “Add person” | Hard refresh Ctrl+Shift+R; redo BOX 3 upload |

---

## Why the AI cannot “do it all” for you

The assistant can build on your computer but **cannot type your server password** safely. You only paste commands in **DigitalOcean Web Console** — no coding required.
