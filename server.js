const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Log incoming requests for debugging
app.use((req, res, next) => { console.log('REQ', req.method, req.path); next(); });
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/register') {
    return res.status(403).json({ error: 'Registration disabled. Use contact form to send messages.' });
  }
  next();
});

const db = new Database(path.join(__dirname, 'data.db'));

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
db.prepare(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  slug TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  filename TEXT,
  caption TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

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
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pid = req.params.id || 'misc';
    const dir = path.join(uploadsDir, 'products', String(pid));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({ storage });
console.log('Registering products API routes');
app.get('/api/products', (req, res) => {
  console.log('HANDLER /api/products called');
  const rows = db.prepare(`SELECT p.*, pi.filename as thumbnail FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id
    GROUP BY p.id ORDER BY p.created_at DESC`).all();
  const out = rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, thumbnail: r.thumbnail ? `/uploads/products/${r.id}/${r.thumbnail}` : null }));
  res.json(out);
});
app.use((req, res, next) => {
  console.log('FALLBACK 404 for', req.method, req.path);
  next();
});
app.get('/__test_products', (req, res) => res.json({ ok: 'test' }));

app.post('/api/products', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    const info = db.prepare('INSERT INTO products (name, slug) VALUES (?,?)').run(name, slug);
    res.json({ id: info.lastInsertRowid, name, slug });
  } catch (e) {
    res.status(500).json({ error: 'create_failed' });
  }
});

app.post('/api/products/:id/images', authMiddleware, upload.array('images', 30), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const id = Number(req.params.id);
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'no files' });
  const stmt = db.prepare('INSERT INTO product_images (product_id, filename, caption) VALUES (?,?,?)');
  const saved = [];
  for (const f of req.files) {
    const fn = path.basename(f.filename);
    stmt.run(id, fn, f.originalname || '');
    saved.push(fn);
  }
  res.json({ saved: saved.length });
});

app.get('/api/products/:id/images', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare('SELECT id, filename, caption FROM product_images WHERE product_id = ? ORDER BY created_at DESC').all(id);
  const out = rows.map(r => ({ id: r.id, url: `/uploads/products/${id}/${r.filename}`, caption: r.caption }));
  res.json(out);
});

// Delete a product/category and all its images (admin only)
app.delete('/api/products/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const id = Number(req.params.id);
  const images = db.prepare('SELECT id, filename FROM product_images WHERE product_id = ?').all(id);
  for (const img of images) {
    const filePath = path.join(uploadsDir, 'products', String(id), img.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('unlink failed', filePath, e && e.message);
    }
  }
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ deleted: info.changes });
});

// Delete a product image by image id (admin only)
app.delete('/api/product-images/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const imgId = Number(req.params.id);
  const row = db.prepare('SELECT id, product_id, filename FROM product_images WHERE id = ?').get(imgId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const filePath = path.join(uploadsDir, 'products', String(row.product_id), row.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('unlink failed', filePath, e && e.message);
  }
  const info = db.prepare('DELETE FROM product_images WHERE id = ?').run(imgId);
  res.json({ deleted: info.changes });
});

// Update product (e.g., change or clear name) (admin only)
app.patch('/api/products/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins only' });
  const id = Number(req.params.id);
  const { name } = req.body;
  if (typeof name === 'undefined') return res.status(400).json({ error: 'name required' });
  const slug = name ? String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : '';
  try {
    const info = db.prepare('UPDATE products SET name = ?, slug = ? WHERE id = ?').run(name, slug, id);
    res.json({ updated: info.changes });
  } catch (e) {
    res.status(500).json({ error: 'update_failed' });
  }
});

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

const PORT = process.env.PORT || 3000;
console.log('SERVER START - build: disable-register v2');
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  console.log(`Server listening on port ${PORT} (bound to 0.0.0.0)`);
  if (addresses.length) {
    addresses.forEach(a => console.log(` - http://${a}:${PORT}`));
  } else {
    console.log(' - no non-internal IPv4 addresses detected');
  }
  try { console.log('routes count', app._router && app._router.stack ? app._router.stack.length : 0); } catch(e) { console.log('routes inspect failed'); }
  console.log('process pid', process.pid);
});
