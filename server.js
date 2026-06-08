const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
var path = require('path');
var fs = require('fs');
var os = require('os');
var multer = require('multer');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION', reason);
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Kök dizindeki HTML, CSS ve JS dosyalarını Vercel'in okuyabilmesi için statik olarak açıyoruz
app.use(express.static(__dirname));

// Biri siteye girdiğinde doğrudan index.html dosyasını karşısına çıkarıyoruz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Log incoming requests for debugging
app.use((req, res, next) => { console.log('REQ', req.method, req.path); next(); });
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/register') {
    return res.status(403).json({ error: 'Registration disabled. Use contact form to send messages.' });
  }
  next();
});

const localDbPath = path.join(__dirname, 'data.db');
const vercelDbPath = path.join(os.tmpdir(), 'data.db');
const dbPath = process.env.VERCEL ? vercelDbPath : localDbPath;

if (process.env.VERCEL && !fs.existsSync(vercelDbPath)) {
  try {
    if (fs.existsSync(localDbPath)) {
      fs.copyFileSync(localDbPath, vercelDbPath);
    }
  } catch (e) {
    console.warn('Could not copy local SQLite database to /tmp; creating new DB in Vercel tmp folder.');
  }
}

let db;
try {
  db = new Database(dbPath);
} catch (e) {
  console.error('Failed to open SQLite database', e);
  process.exit(1);
}

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  phone TEXT,
  role TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  admin_id INTEGER,
  content TEXT,
  is_quote INTEGER DEFAULT 0,
  reply TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  replied_at DATETIME
)`).run();

// Products and images
try { db.prepare('ALTER TABLE messages ADD COLUMN sender_name TEXT').run(); } catch (e) { }
try { db.prepare('ALTER TABLE messages ADD COLUMN sender_phone TEXT').run(); } catch (e) { }

const desiredAdminUsername = 'MK PERDE';
const desiredAdminPassword = 'MK1907';
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(desiredAdminUsername);
const hashed = bcrypt.hashSync(desiredAdminPassword, 8);
if (existingAdmin) {
  db.prepare('UPDATE users SET password_hash = ?, role = ?, name = ? WHERE id = ?')
    .run(hashed, 'admin', 'MK Perde', existingAdmin.id);
  console.log(`Updated admin account: username=${desiredAdminUsername}`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, name, phone, role) VALUES (?,?,?,?,?)')
    .run(desiredAdminUsername, hashed, 'MK Perde', '', 'admin');
  console.log(`Created admin account: username=${desiredAdminUsername} password=${desiredAdminPassword}`);
}

function createToken(userId) {
  const token = uuidv4();
  db.prepare('INSERT INTO tokens (user_id, token) VALUES (?,?)').run(userId, token);
  return token;
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token required' });
  const row = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'Invalid token' });
  const user = db.prepare('SELECT id, username, name, phone, role FROM users WHERE id = ?').get(row.user_id);
  req.user = user;
  next();
}
app.get('/ping', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const user = db.prepare('SELECT id, password_hash, role, username, name FROM users WHERE username = ?').get(username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = createToken(user.id);
  res.json({ token, role: user.role, username: user.username, name: user.name });
});

app.post('/api/messages', authMiddleware, (req, res) => {
  const { content, is_quote } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const info = db.prepare('INSERT INTO messages (user_id, content, is_quote) VALUES (?,?,?)')
    .run(req.user.id, content, is_quote ? 1 : 0);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/my/messages', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

app.get('/api/messages', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const rows = db.prepare(`SELECT m.*,
    u.username as user_username,
    COALESCE(m.sender_name, u.name) as sender_name,
    COALESCE(m.sender_phone, u.phone) as sender_phone
    FROM messages m LEFT JOIN users u ON m.user_id = u.id ORDER BY m.created_at DESC`).all();
  res.json(rows);
});

app.post('/api/messages/public', (req, res) => {
  const { name, phone, content, is_quote } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const info = db.prepare('INSERT INTO messages (user_id, content, is_quote, sender_name, sender_phone) VALUES (?,?,?,?,?)')
    .run(null, content, is_quote ? 1 : 0, name || '', phone || '');
  res.json({ id: info.lastInsertRowid });
});

app.post('/api/messages/delete', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  let deleted = 0;
  const del = db.transaction((arr) => {
    for (const id of arr) {
      const info = stmt.run(Number(id));
      deleted += info.changes;
    }
  });
  try {
    del(ids);
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: 'delete_failed' });
  }
});

app.post('/api/messages/:id/reply', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const id = Number(req.params.id);
  const { reply } = req.body;
  if (!reply) return res.status(400).json({ error: 'reply required' });
  const info = db.prepare('UPDATE messages SET reply = ?, replied_at = CURRENT_TIMESTAMP, admin_id = ? WHERE id = ?')
    .run(reply, req.user.id, id);
  res.json({ updated: info.changes });
});

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const productsManifestPath = path.join(__dirname, 'products.json');
function loadProductsManifest() {
  try {
    const raw = fs.readFileSync(productsManifestPath, 'utf8');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.filter(p => p && p.id && p.name).map(p => ({ id: Number(p.id), name: String(p.name), slug: p.slug ? String(p.slug) : String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }));
  } catch (e) {
    return [];
  }
}

function productThumbnail(id) {
  const dir = path.join(uploadsDir, 'products', String(id));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  if (!files.length) return null;
  return `/uploads/products/${id}/${encodeURIComponent(files[0])}`;
}

function getProductImages(id) {
  const dir = path.join(uploadsDir, 'products', String(id));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map(f => ({ id: `${id}-${f}`, url: `/uploads/products/${id}/${encodeURIComponent(f)}`, caption: f }));
}

app.get('/api/products', (req, res) => {
  const products = loadProductsManifest();
  const out = products.map(p => ({ id: p.id, name: p.name, slug: p.slug, thumbnail: productThumbnail(p.id) }));
  res.json(out);
});

app.get('/api/products/:id/images', (req, res) => {
  const id = Number(req.params.id);
  res.json(getProductImages(id));
});

app.use((req, res, next) => {
  console.log('FALLBACK 404 for', req.method, req.path);
  next();
});
app.get('/__test_products', (req, res) => res.json({ ok: 'test' }));

// Debug: list registered routes
app.get('/_routes', (req, res) => {
  const routes = [];
  const stack = app._router && app._router.stack ? app._router.stack : [];
  stack.forEach(m => {
    if (m && m.route && m.route.path) {
      const methods = Object.keys(m.route.methods || {}).join(',').toUpperCase();
      routes.push({ path: m.route.path, methods });
    }
  });
  res.json(routes);
});

// Serve static files (the frontend)
app.use(express.static(path.join(__dirname)));

// Tek ve temizlenmiş Port Dinleme Kurgusu (Vercel ile tam uyumlu)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor.`);
});

module.exports = app;