import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

for (const dir of [DATA_DIR, DOWNLOADS_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULT_PASS = process.env.ADMIN_PASSWORD || 'admin1234';
const SESSIONS = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function loadOrCreateAuth() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    } catch {
      /* regenerate if corrupted */
    }
  }
  const { salt, hash } = hashPassword(DEFAULT_PASS);
  const auth = { salt, hash, isDefault: true, updatedAt: new Date().toISOString() };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  return auth;
}

function verifyPassword(password, auth) {
  const derived = crypto.scryptSync(password, auth.salt, 64);
  const expected = Buffer.from(auth.hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies.portfolio_session;
  if (!token) return false;
  const entry = SESSIONS.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function readPortfolio() {
  return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
}

function writePortfolio(data) {
  const tmp = `${PORTFOLIO_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PORTFOLIO_FILE);
}

function safeSlug(input, fallback = 'item') {
  const cleaned = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `${fallback}-${Date.now()}`;
}

function safeFilename(original, allowedExts, prefix = 'file') {
  const ext = path.extname(original || '').toLowerCase();
  const safeExt = allowedExts.includes(ext) ? ext : '';
  const base = path.basename(original || prefix, ext).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return `${prefix ? `${prefix}-` : ''}${base || 'asset'}-${Date.now()}${safeExt}`;
}

const pfpUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, safeFilename(file.originalname, ['.png', '.jpg', '.jpeg', '.webp'], 'pfp')),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ['.png', '.jpg', '.jpeg', '.webp'].includes(ext));
  },
});

const certUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, safeFilename(file.originalname, ['.png', '.jpg', '.jpeg', '.webp', '.pdf'], 'cert')),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ['.png', '.jpg', '.jpeg', '.webp', '.pdf'].includes(ext));
  },
});

const binaryUpload = multer({
  storage: multer.diskStorage({
    destination: DOWNLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const base = path.basename(file.originalname || 'build', ext).replace(/[^a-zA-Z0-9._-]+/g, '-');
      cb(null, `${base || 'build'}${ext}`);
    },
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ['.exe', '.ipa', '.apk', '.zip', '.dmg'].includes(ext));
  },
});

loadOrCreateAuth();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Static assets and uploaded media
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', dotfiles: 'allow' }));

// Direct binary downloads with Content-Disposition: attachment and GitHub Release fallback
app.get('/downloads/:filename', (req, res) => {
  const name = path.basename(req.params.filename || '');
  const full = path.join(DOWNLOADS_DIR, name);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    const size = fs.statSync(full).size;
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    return res.sendFile(full, { dotfiles: 'allow' });
  }
  const data = readPortfolio();
  const match = (data.projects || []).find(
    (p) => p.downloadUrl === `/downloads/${name}` && p.githubReleaseUrl
  );
  if (match) {
    return res.redirect(302, match.githubReleaseUrl);
  }
  return res.status(404).json({ error: 'Binary not found' });
});

// Public read endpoint
app.get('/api/portfolio', (_req, res) => {
  const data = readPortfolio();
  // Sync exact sizes for local binaries if present
  const projects = (data.projects || []).map((p) => {
    if (p.downloadUrl && p.downloadUrl.startsWith('/downloads/')) {
      const fname = path.basename(p.downloadUrl);
      const localPath = path.join(DOWNLOADS_DIR, fname);
      if (fs.existsSync(localPath)) {
        return { ...p, fileSizeBytes: fs.statSync(localPath).size };
      }
    }
    return p;
  });
  const binaries = projects.filter((p) => p.downloadUrl && ['EXE', 'IPA', 'APK'].includes(p.downloadType));
  res.json({
    ...data,
    projects,
    stats: {
      totalProjects: projects.length,
      directBinaries: binaries.length,
      ipaCount: binaries.filter((p) => p.downloadType === 'IPA').length,
      apkCount: binaries.filter((p) => p.downloadType === 'APK').length,
      exeCount: binaries.filter((p) => p.downloadType === 'EXE').length,
    },
  });
});

// Auth endpoints
app.get('/api/auth/me', (req, res) => {
  const auth = loadOrCreateAuth();
  res.json({
    authenticated: isAuthenticated(req),
    isDefaultPassword: Boolean(auth.isDefault),
  });
});

app.post('/api/auth/login', (req, res) => {
  const password = String(req.body?.password || '');
  const auth = loadOrCreateAuth();
  if (!verifyPassword(password, auth)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader(
    'Set-Cookie',
    `portfolio_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
  res.json({ authenticated: true, isDefaultPassword: Boolean(auth.isDefault) });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.portfolio_session) SESSIONS.delete(cookies.portfolio_session);
  res.setHeader('Set-Cookie', 'portfolio_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
  const nextPass = String(req.body?.newPassword || '');
  if (nextPass.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const { salt, hash } = hashPassword(nextPass);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ salt, hash, isDefault: false, updatedAt: new Date().toISOString() }, null, 2)
  );
  res.json({ ok: true, isDefaultPassword: false });
});

// Admin profile routes
app.put('/api/profile', requireAuth, (req, res) => {
  const data = readPortfolio();
  const allowed = ['name', 'handle', 'headline', 'subhead', 'bio', 'location', 'email', 'github', 'pfp', 'featuredIds'];
  const next = { ...data.profile };
  for (const key of allowed) {
    if (req.body[key] !== undefined) next[key] = req.body[key];
  }
  data.profile = next;
  writePortfolio(data);
  res.json({ profile: data.profile });
});

app.post('/api/upload/pfp', requireAuth, pfpUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid image (.png, .jpg, .webp) required' });
  const url = `/uploads/${req.file.filename}`;
  const data = readPortfolio();
  data.profile.pfp = url;
  writePortfolio(data);
  res.json({ url, profile: data.profile });
});

// Admin binary & certificate uploads
app.post('/api/upload/binary', requireAuth, binaryUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid binary (.exe, .ipa, .apk, .zip) required' });
  const ext = path.extname(req.file.filename).replace('.', '').toUpperCase();
  res.json({
    downloadUrl: `/downloads/${req.file.filename}`,
    fileSizeBytes: req.file.size,
    downloadType: ['EXE', 'IPA', 'APK'].includes(ext) ? ext : 'BIN',
    filename: req.file.filename,
  });
});

app.post('/api/upload/cert', requireAuth, certUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid certificate image or PDF required' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Admin projects CRUD
app.post('/api/projects', requireAuth, (req, res) => {
  const data = readPortfolio();
  const body = req.body || {};
  const id = safeSlug(body.id || body.title, 'project');
  if (data.projects.some((p) => p.id === id)) {
    return res.status(409).json({ error: 'Project ID already exists' });
  }
  const project = {
    id,
    title: String(body.title || 'Untitled Project'),
    tagline: String(body.tagline || ''),
    description: String(body.description || ''),
    category: ['windows', 'ios', 'android', 'ai-web'].includes(body.category) ? body.category : 'ai-web',
    platform: String(body.platform || 'Cross-platform'),
    stack: Array.isArray(body.stack)
      ? body.stack
      : String(body.stack || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    year: String(body.year || '2026'),
    featured: Boolean(body.featured),
    repoUrl: String(body.repoUrl || ''),
    downloadUrl: String(body.downloadUrl || ''),
    githubReleaseUrl: String(body.githubReleaseUrl || ''),
    downloadType: String(body.downloadType || (body.downloadUrl ? 'BIN' : 'REPO')).toUpperCase(),
    fileSizeBytes: Number(body.fileSizeBytes) || 0,
  };
  data.projects.unshift(project);
  writePortfolio(data);
  res.status(201).json({ project });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const data = readPortfolio();
  const idx = data.projects.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Project not found' });
  const prev = data.projects[idx];
  const body = req.body || {};
  const stack =
    body.stack !== undefined
      ? Array.isArray(body.stack)
        ? body.stack
        : String(body.stack)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
      : prev.stack;
  data.projects[idx] = {
    ...prev,
    ...body,
    id: prev.id,
    stack,
    fileSizeBytes: body.fileSizeBytes !== undefined ? Number(body.fileSizeBytes) || 0 : prev.fileSizeBytes,
  };
  writePortfolio(data);
  res.json({ project: data.projects[idx] });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const data = readPortfolio();
  const next = data.projects.filter((p) => p.id !== req.params.id);
  if (next.length === data.projects.length) return res.status(404).json({ error: 'Project not found' });
  data.projects = next;
  writePortfolio(data);
  res.json({ ok: true });
});

// Admin certificates CRUD
app.post('/api/certificates', requireAuth, (req, res) => {
  const data = readPortfolio();
  const body = req.body || {};
  const id = safeSlug(body.id || `${body.issuer}-${body.title}`, 'cert');
  const cert = {
    id,
    issuer: String(body.issuer || 'Issuer'),
    title: String(body.title || 'Certificate'),
    category: String(body.category || 'Credential'),
    date: String(body.date || '2026'),
    credentialId: String(body.credentialId || ''),
    verifyUrl: String(body.verifyUrl || ''),
    imageUrl: String(body.imageUrl || ''),
    summary: String(body.summary || ''),
  };
  data.certificates.push(cert);
  writePortfolio(data);
  res.status(201).json({ certificate: cert });
});

app.put('/api/certificates/:id', requireAuth, (req, res) => {
  const data = readPortfolio();
  const idx = data.certificates.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Certificate not found' });
  data.certificates[idx] = { ...data.certificates[idx], ...req.body, id: data.certificates[idx].id };
  writePortfolio(data);
  res.json({ certificate: data.certificates[idx] });
});

app.delete('/api/certificates/:id', requireAuth, (req, res) => {
  const data = readPortfolio();
  const next = data.certificates.filter((c) => c.id !== req.params.id);
  if (next.length === data.certificates.length) return res.status(404).json({ error: 'Certificate not found' });
  data.certificates = next;
  writePortfolio(data);
  res.json({ ok: true });
});

// Fallback for SPA navigation
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), { dotfiles: 'allow' });
});

const PORT = Number(process.env.PORT) || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Portfolio server running at http://localhost:${PORT}`);
});

