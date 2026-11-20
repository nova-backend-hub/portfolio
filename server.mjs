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

const IS_PROD = Boolean(process.env.K_SERVICE || process.env.NODE_ENV === 'production');
const GCS_BUCKET = (process.env.GCS_BUCKET || '').trim();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const MAX_LOGIN_FAILS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

const LOGIN_ATTEMPTS = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function parsePasswordHashEnv(val) {
  const raw = String(val || '').trim();
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const salt = raw.slice(0, idx);
  const hash = raw.slice(idx + 1);
  if (!salt || !/^[0-9a-fA-F]{32,}$/.test(hash)) return null;
  return { salt, hash };
}

// Runtime credential state (GCS override -> env hash -> env password -> local dev auth.json)
let runtimeEnvAuth = null;
if (process.env.ADMIN_PASSWORD_HASH) {
  const parsed = parsePasswordHashEnv(process.env.ADMIN_PASSWORD_HASH);
  if (parsed) runtimeEnvAuth = { ...parsed, isDefault: false };
} else if (process.env.ADMIN_PASSWORD) {
  runtimeEnvAuth = { ...hashPassword(process.env.ADMIN_PASSWORD), isDefault: false };
}

function loadAuth() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const fileAuth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8').replace(/^\uFEFF/, ''));
      if (fileAuth && fileAuth.salt && fileAuth.hash) {
        return { ...fileAuth, configured: true };
      }
    } catch {
      /* ignore corrupt file */
    }
  }
  if (runtimeEnvAuth) {
    return { ...runtimeEnvAuth, configured: true };
  }
  if (IS_PROD) {
    return { configured: false, isDefault: false, salt: '', hash: '' };
  }
  const { salt, hash } = hashPassword('admin1234');
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const auth = { salt, hash, sessionSecret, isDefault: true, updatedAt: new Date().toISOString() };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  return { ...auth, configured: true };
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (!IS_PROD) {
    const auth = loadAuth();
    if (auth.sessionSecret) return auth.sessionSecret;
  }
  return EPHEMERAL_SECRET;
}

function verifyPassword(password, auth) {
  if (!auth?.configured || !auth.salt || !auth.hash) return false;
  const derived = crypto.scryptSync(password, auth.salt, 64);
  const expected = Buffer.from(auth.hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// Lightweight GCS helper using GCP Metadata Server (when GCS_BUCKET is set)
let gcsTokenCache = { token: null, expiresAt: 0 };

async function getGcsToken() {
  if (gcsTokenCache.token && Date.now() < gcsTokenCache.expiresAt - 60000) {
    return gcsTokenCache.token;
  }
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!res.ok) throw new Error(`Metadata token error ${res.status}`);
  const body = await res.json();
  gcsTokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 300) * 1000,
  };
  return gcsTokenCache.token;
}

async function gcsDownload(objectName) {
  if (!GCS_BUCKET) return null;
  const token = await getGcsToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(GCS_BUCKET)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS download ${objectName} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function gcsUpload(objectName, buffer, contentType = 'application/octet-stream') {
  if (!GCS_BUCKET) return;
  const token = await getGcsToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(GCS_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`GCS upload ${objectName} failed (${res.status})`);
}

async function initFromGcs() {
  if (!GCS_BUCKET) return;
  try {
    const pBuf = await gcsDownload('data/portfolio.json');
    if (pBuf) {
      fs.writeFileSync(PORTFOLIO_FILE, pBuf);
    } else if (fs.existsSync(PORTFOLIO_FILE)) {
      await gcsUpload('data/portfolio.json', fs.readFileSync(PORTFOLIO_FILE), 'application/json');
    }
    const aBuf = await gcsDownload('data/auth.json');
    if (aBuf) {
      fs.writeFileSync(AUTH_FILE, aBuf);
    }
    console.log(`GCS persistence initialized (${GCS_BUCKET})`);
  } catch (err) {
    console.error('GCS init warning:', err.message);
  }
}

// Signed stateless session cookies
function createSessionToken(auth) {
  const payload = {
    exp: Date.now() + SESSION_TTL_MS,
    v: auth.hash.slice(0, 16),
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifySessionToken(token, auth) {
  if (!token || !auth?.configured) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!payload || Date.now() > Number(payload.exp)) return false;
    return payload.v === auth.hash.slice(0, 16);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function isHttpsRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || proto === 'https';
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const auth = loadAuth();
  return verifySessionToken(cookies.portfolio_session, auth);
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (!expectedHost || originHost !== expectedHost) {
      return res.status(403).json({ error: 'Cross-origin mutation rejected' });
    }
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid origin header' });
  }
}

function readPortfolio() {
  return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8').replace(/^\uFEFF/, ''));
}

function writePortfolio(data) {
  const json = JSON.stringify(data, null, 2);
  const tmp = `${PORTFOLIO_FILE}.tmp`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, PORTFOLIO_FILE);
  if (GCS_BUCKET) {
    gcsUpload('data/portfolio.json', Buffer.from(json, 'utf8'), 'application/json').catch((e) =>
      console.error('GCS writePortfolio warning:', e.message)
    );
  }
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

function verifyMagicBytes(filePath, allowPdf = false) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    if (n < 4) return false;
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    // WebP (RIFF....WEBP)
    if (n >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
    // PDF (certs only)
    if (allowPdf && buf.toString('ascii', 0, 4) === '%PDF') return true;
    return false;
  } finally {
    fs.closeSync(fd);
  }
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
    cb(null, ['.exe', '.ipa', '.apk', '.zip', '.dmg', '.wgt'].includes(ext));
  },
});

if (!IS_PROD) loadAuth();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Global Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://avatars.githubusercontent.com data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/api', requireSameOrigin);

// Static public assets
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

// Uploaded media (local cache + GCS fallback)
app.get('/uploads/:filename', async (req, res) => {
  const name = path.basename(req.params.filename || '');
  const full = path.join(UPLOADS_DIR, name);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return res.sendFile(full, { dotfiles: 'allow' });
  }
  if (GCS_BUCKET) {
    try {
      const buf = await gcsDownload(`uploads/${name}`);
      if (buf) {
        fs.writeFileSync(full, buf);
        return res.sendFile(full, { dotfiles: 'allow' });
      }
    } catch (err) {
      console.error('GCS upload fetch error:', err.message);
    }
  }
  return res.status(404).json({ error: 'Upload not found' });
});

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
  const binaries = projects.filter((p) => p.downloadUrl && ['EXE', 'IPA', 'APK', 'ZIP', 'WGT'].includes(p.downloadType));
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
  const auth = loadAuth();
  res.json({
    authenticated: isAuthenticated(req),
    isDefaultPassword: IS_PROD ? false : Boolean(auth.isDefault),
  });
});

app.post('/api/auth/login', async (req, res) => {
  const auth = loadAuth();
  if (!auth.configured) {
    return res.status(503).json({ error: 'Admin authentication not configured' });
  }

  const clientIp = req.ip || 'unknown';
  const now = Date.now();
  const rec = LOGIN_ATTEMPTS.get(clientIp);
  if (rec && now < rec.resetAt && rec.count >= MAX_LOGIN_FAILS) {
    const retryAfterSec = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: `Too many login attempts. Retry in ${retryAfterSec}s.` });
  }
  if (rec && now >= rec.resetAt) {
    LOGIN_ATTEMPTS.delete(clientIp);
  }
  if (LOGIN_ATTEMPTS.size > 5000) LOGIN_ATTEMPTS.clear();

  const password = String(req.body?.password || '');
  if (!verifyPassword(password, auth)) {
    const nextCount = (LOGIN_ATTEMPTS.get(clientIp)?.count || 0) + 1;
    LOGIN_ATTEMPTS.set(clientIp, { count: nextCount, resetAt: now + LOCKOUT_WINDOW_MS });
    await sleep(400);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  LOGIN_ATTEMPTS.delete(clientIp);
  const token = createSessionToken(auth);
  const secureFlag = IS_PROD || isHttpsRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `portfolio_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag}`
  );
  res.json({
    authenticated: true,
    isDefaultPassword: IS_PROD ? false : Boolean(auth.isDefault),
  });
});

app.post('/api/auth/logout', (req, res) => {
  const secureFlag = IS_PROD || isHttpsRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `portfolio_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secureFlag}`);
  res.json({ ok: true });
});

app.post('/api/auth/password', requireAuth, async (req, res) => {
  const nextPass = String(req.body?.newPassword || '');
  if (nextPass.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const { salt, hash } = hashPassword(nextPass);
  const prev = loadAuth();
  const nextAuth = {
    salt,
    hash,
    sessionSecret: prev.sessionSecret || (IS_PROD ? undefined : getSessionSecret()),
    isDefault: false,
    updatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(nextAuth, null, 2);
  fs.writeFileSync(AUTH_FILE, json);
  if (GCS_BUCKET) {
    await gcsUpload('data/auth.json', Buffer.from(json, 'utf8'), 'application/json');
  }
  const token = createSessionToken(nextAuth);
  const secureFlag = IS_PROD || isHttpsRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `portfolio_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag}`
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

app.post('/api/upload/pfp', requireAuth, pfpUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid image (.png, .jpg, .webp) required' });
  if (!verifyMagicBytes(req.file.path, false)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid file signature' });
  }
  if (GCS_BUCKET) {
    await gcsUpload(`uploads/${req.file.filename}`, fs.readFileSync(req.file.path), req.file.mimetype || 'image/png');
  }
  const url = `/uploads/${req.file.filename}`;
  const data = readPortfolio();
  data.profile.pfp = url;
  writePortfolio(data);
  res.json({ url, profile: data.profile });
});

// Admin binary & certificate uploads
app.post('/api/upload/binary', requireAuth, binaryUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid binary (.exe, .ipa, .apk, .zip, .wgt) required' });
  const ext = path.extname(req.file.filename).replace('.', '').toUpperCase();
  res.json({
    downloadUrl: `/downloads/${req.file.filename}`,
    fileSizeBytes: req.file.size,
    downloadType: ['EXE', 'IPA', 'APK', 'ZIP', 'WGT'].includes(ext) ? ext : 'BIN',
    filename: req.file.filename,
  });
});

app.post('/api/upload/cert', requireAuth, certUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Valid certificate image or PDF required' });
  if (!verifyMagicBytes(req.file.path, true)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid file signature' });
  }
  if (GCS_BUCKET) {
    await gcsUpload(`uploads/${req.file.filename}`, fs.readFileSync(req.file.path), req.file.mimetype || 'application/octet-stream');
  }
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
    category: ['windows', 'ios', 'android', 'macos-efi', 'ai-web'].includes(body.category) ? body.category : 'ai-web',
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
  const nextCategory =
    body.category && ['windows', 'ios', 'android', 'macos-efi', 'ai-web'].includes(body.category)
      ? body.category
      : prev.category;
  data.projects[idx] = {
    ...prev,
    ...body,
    id: prev.id,
    category: nextCategory,
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
initFromGcs().finally(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Portfolio server running at http://localhost:${PORT} (prod=${IS_PROD})`);
  });
});
