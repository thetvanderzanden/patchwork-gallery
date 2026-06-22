# Gallery — Patchwork Photo Gallery + Content from Google Sheets

A two-part app:
- **Backend** (Node.js → Railway): proxies images from Google Drive, reads text from Google Sheets
- **Frontend** (static HTML → GitHub Pages): patchwork photo grid + content cards

## Architecture

```
GitHub Pages (/docs)  ←→  Railway (Node API)  ←→  Google Drive + Sheets
```

---

## Setup Guide

### Step 1 — Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Gallery")
3. Enable these two APIs:
   - **Google Drive API**
   - **Google Sheets API**
4. Go to **IAM & Admin → Service Accounts → Create Service Account**
5. Give it a name (e.g. "gallery-reader"), click through, no special roles needed
6. Click the service account → **Keys → Add Key → Create new key → JSON**
7. Download the JSON file — keep it safe, never commit it

---

### Step 2 — Google Drive Folder

1. Create a folder in Google Drive for your gallery images
2. Share the folder with the **service account email** (found in the JSON file as `client_email`) — give it **Viewer** access
3. Copy the **Folder ID** from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART`**

To update the gallery: just drop images into this folder. Captions come from the file's **Description** field (right-click → File info → Details).

---

### Step 3 — Google Sheet

1. Create a new Google Sheet
2. Share it with the service account email — **Viewer** access
3. Rename the first sheet tab to exactly: `Content`
4. Set up headers in Row 1:

| A: Order | B: Title | C: Body | D: Tag |
|----------|----------|---------|--------|
| 1 | My First Story | Text copied from email... | Travel |
| 2 | Another Update | More text... | News |

5. Copy the **Sheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

To update content: paste email text into rows. The site refreshes on every page load.

---

### Step 4 — Deploy the Backend to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo** → select this repo
3. Railway will auto-detect Node.js and run `npm start`
4. Go to **Variables** and add:

| Variable | Value |
|----------|-------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Paste the entire JSON key file contents (minified to one line) |
| `DRIVE_FOLDER_ID` | Your Drive folder ID |
| `SHEETS_ID` | Your Google Sheet ID |
| `ALLOWED_ORIGINS` | Your GitHub Pages URL (e.g. `https://thetvanderzanden.github.io`) |

5. Go to **Settings → Networking → Generate Domain** — copy this URL

---

### Step 5 — Configure the Frontend

Open `docs/index.html` and replace the API base URL:

```html
<script>window.API_BASE = 'https://YOUR-RAILWAY-APP.railway.app';</script>
```

Replace with your actual Railway domain, then commit and push to main.

---

### Step 6 — Enable GitHub Pages

```bash
gh api repos/USERNAME/gallery --method POST \
  --field 'source[branch]=main' \
  --field 'source[path]=/docs'
```

Or via GitHub UI: **Settings → Pages → Branch: main / Folder: /docs**

---

## Updating Content

| To do this… | Do this… |
|-------------|----------|
| Add photos | Drop images into the Google Drive folder |
| Add captions | Right-click image in Drive → Details → add Description |
| Add a text section | Add a row to the Google Sheet `Content` tab |
| Reorder sections | Change the number in column A |
| Remove a section | Delete the row from the Sheet |

---

## Local Development

```bash
npm install
cp .env.example .env
# Fill in .env with your keys
npm run dev
# Open docs/index.html in a browser (change API_BASE to http://localhost:3000)
```
