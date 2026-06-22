require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

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

    const images = (response.data.files || []).map(file => ({
      id:          file.id,
      name:        file.name.replace(/\.[^.]+$/, ''), // strip extension
      caption:     file.description || '',
      width:       file.imageMediaMetadata?.width  || null,
      height:      file.imageMediaMetadata?.height || null,
      created:     file.createdTime
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
