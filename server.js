require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const db        = require('./database');
const analytics = require('./analytics');

const app  = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer — image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-before-live',
  resave:            false,
  saveUninitialized: false,
  cookie:            { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Analytics — track public page views
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/' && !req.path.startsWith('/admin')) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    analytics.recordPageView(ip, req.headers.referer, req.headers['user-agent'], req.path);
  }
  next();
});

// ── PUBLIC API ────────────────────────────────────────────────────────────────

app.get('/api/products', (req, res) => {
  try {
    res.json(db.getProducts(req.query));
  } catch {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/categories', (req, res) => {
  try {
    res.json(db.getCategories());
  } catch {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    res.json(db.getSettings());
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.get('/api/reviews', (req, res) => {
  try {
    res.json(db.getReviews());
  } catch {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ── ANALYTICS (public) ───────────────────────────────────────────────────────

app.post('/api/track/product/:id', (req, res) => {
  analytics.recordProductView(req.params.id);
  res.json({ ok: true });
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const user = db.getAdminUser(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });

    req.session.isAdmin   = true;
    req.session.username  = username;
    res.json({ success: true, username });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    isAdmin:  !!(req.session && req.session.isAdmin),
    username: req.session?.username || null
  });
});

// ── ADMIN API ─────────────────────────────────────────────────────────────────

app.get('/api/admin/products', requireAuth, (req, res) => {
  try {
    res.json(db.getProducts());
  } catch {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/admin/products', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required' });
  try {
    res.status(201).json(db.createProduct(req.body));
  } catch {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/admin/products/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required' });
  try {
    const product = db.updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
  try {
    const removed = db.deleteProduct(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Product not found' });

    const urls = removed.images || (removed.image_url ? [removed.image_url] : []);
    for (const url of urls) {
      if (url && url.startsWith('/uploads/')) {
        const imgPath = path.join(__dirname, 'public', url);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.post('/api/admin/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.delete('/api/admin/upload', requireAuth, (req, res) => {
  const { url } = req.body;
  if (url && url.startsWith('/uploads/')) {
    const imgPath = path.join(__dirname, 'public', url);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  res.json({ success: true });
});

// ── ADMIN ANALYTICS ──────────────────────────────────────────────────────────

app.get('/api/admin/analytics/stats', requireAuth, (req, res) => {
  try { res.json(analytics.getStats()); }
  catch { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

app.get('/api/admin/analytics/daily', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    res.json(analytics.getDailyStats(days));
  } catch { res.status(500).json({ error: 'Failed to fetch daily stats' }); }
});

app.get('/api/admin/analytics/top-products', requireAuth, (req, res) => {
  try {
    const products = analytics.getTopProducts(10);
    const all = db.getProducts();
    const result = products.map(tp => {
      const p = all.find(x => x.id === tp.product_id);
      return { ...tp, name: p ? p.name : `Product #${tp.product_id}` };
    });
    res.json(result);
  } catch { res.status(500).json({ error: 'Failed to fetch top products' }); }
});

app.get('/api/admin/analytics/referrers', requireAuth, (req, res) => {
  try { res.json(analytics.getTopReferrers(10)); }
  catch { res.status(500).json({ error: 'Failed to fetch referrers' }); }
});

app.get('/api/admin/analytics/recent', requireAuth, (req, res) => {
  try { res.json(analytics.getRecentVisits(30)); }
  catch { res.status(500).json({ error: 'Failed to fetch recent visits' }); }
});

app.get('/api/admin/reviews', requireAuth, (req, res) => {
  try {
    res.json(db.getReviews());
  } catch {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.post('/api/admin/reviews', requireAuth, (req, res) => {
  const { author, text } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'Author and text are required' });
  try {
    res.status(201).json(db.createReview(req.body));
  } catch {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, (req, res) => {
  try {
    const removed = db.deleteReview(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  try {
    db.updateSettings(req.body);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.put('/api/admin/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both current and new passwords are required' });

  try {
    const user = db.getAdminUser(req.session.username);
    if (!bcrypt.compareSync(currentPassword, user.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect' });

    db.updateAdminPassword(req.session.username, bcrypt.hashSync(newPassword, 10));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  Product Catalogue running!');
  console.log('========================================');
  console.log(`  Catalogue:   http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin`);
  console.log('========================================\n');
});
