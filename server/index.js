require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-too';

// --- uploads folder for payment screenshots ---
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, ''))
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Sirf images allowed hain'));
    cb(null, true);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Login required' });
}

// ---------- Public: customer submits a payment ----------
app.post('/api/orders', upload.single('screenshot'), (req, res) => {
  const { customer_name, phone, amount, method, transaction_id } = req.body;
  if (!customer_name || !phone || !method || !transaction_id) {
    return res.status(400).json({ error: 'Naam, phone, method aur transaction ID zaroori hain' });
  }
  const orderRef = 'ORD-' + Date.now().toString(36).toUpperCase();
  const screenshotPath = req.file ? '/uploads/' + req.file.filename : null;

  const stmt = db.prepare(`
    INSERT INTO orders (order_ref, customer_name, phone, amount, method, transaction_id, screenshot_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(orderRef, customer_name, phone, amount || null, method, transaction_id, screenshotPath);

  res.json({ ok: true, order_ref: orderRef, id: info.lastInsertRowid });
});

// ---------- Admin: login ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Galat password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- Admin: list orders ----------
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const status = req.query.status;
  let rows;
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    rows = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

// ---------- Admin: approve / reject ----------
app.post('/api/admin/orders/:id/:action', requireAdmin, (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
