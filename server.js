require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const { google } = require('googleapis');

// In-memory cache for reverse geocode results keyed by "lat,lng"
const geocodeCache = new Map();

function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(key)) return Promise.resolve(geocodeCache.get(key));

  return new Promise(resolve => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
    const req = https.get(url, { headers: { 'User-Agent': 'patchwork-gallery/1.0' } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const addr = data.address || {};
          const parts = [
            addr.city || addr.town || addr.village || addr.county,
            addr.state,
            addr.country
          ].filter(Boolean);
          const label = parts.join(', ') || data.display_name || null;
          geocodeCache.set(key, label);
          resolve(label);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow the GitHub Pages frontend and localhost for dev
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  }
}));

app.use(express.json());

// ── Google Auth ───────────────────────────────────────────────────────────────
function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var not set');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(key),
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  });
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── GET /api/images ───────────────────────────────────────────────────────────
// Returns an array of image objects from a Google Drive folder.
// Each image is served via /api/image/:id to avoid CORS / expiry issues.
app.get('/api/images', async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: getAuth() });
    const folderId = process.env.DRIVE_FOLDER_ID;
    if (!folderId) return res.status(500).json({ error: 'DRIVE_FOLDER_ID not configured' });

    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id, name, description, imageMediaMetadata, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 100
    });

    const files = response.data.files || [];

    const images = await Promise.all(files.map(async file => {
      const loc = file.imageMediaMetadata?.location;
      let location = null;
      if (loc?.latitude != null && loc?.longitude != null) {
        location = await reverseGeocode(loc.latitude, loc.longitude);
      }
      return {
        id:       file.id,
        name:     file.name.replace(/\.[^.]+$/, ''),
        caption:  file.description || '',
        location,
        width:    file.imageMediaMetadata?.width  || null,
        height:   file.imageMediaMetadata?.height || null,
        taken:    file.imageMediaMetadata?.time   || file.createdTime || null
      };
    }));

    res.json(images);
  } catch (err) {
    console.error('Drive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/image/:id ────────────────────────────────────────────────────────
// Proxies the raw image bytes from Drive so the browser never needs
// a Drive URL (avoids CORS, quota, and auth issues).
app.get('/api/image/:id', async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: getAuth() });

    // Fetch file metadata for content type
    const meta = await drive.files.get({
      fileId: req.params.id,
      fields: 'mimeType, name'
    });

    res.setHeader('Content-Type', meta.data.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h

    const stream = await drive.files.get(
      { fileId: req.params.id, alt: 'media' },
      { responseType: 'stream' }
    );

    stream.data.pipe(res);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/content ──────────────────────────────────────────────────────────
// Returns text sections from a Google Sheet.
// Sheet format (row 1 = headers, data starts row 2):
//   A: Order (number)  B: Title  C: Body text  D: Tag/category
app.get('/api/content', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const sheetId = process.env.SHEETS_ID;
    if (!sheetId) return res.status(500).json({ error: 'SHEETS_ID not configured' });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Content!A2:D200'
    });

    const rows = response.data.values || [];
    const sections = rows
      .filter(row => row[1]) // must have a title
      .map(row => ({
        order:   parseInt(row[0]) || 99,
        title:   row[1] || '',
        body:    row[2] || '',
        tag:     row[3] || ''
      }))
      .sort((a, b) => a.order - b.order);

    res.json(sections);
  } catch (err) {
    console.error('Sheets error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Gallery API running on port ${PORT}`));
