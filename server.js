require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const db        = require('./database');
const analytics = require('./analytics');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── R2 storage ──────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region:      'auto',
  endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET    = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g. https://pub-xxx.r2.dev

// Multer — buffer uploads in memory for R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Analytics — track public page views (must be before express.static)
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/') {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    analytics.recordPageView(ip, req.headers.referer, req.headers['user-agent'], req.path);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(cookieSession({
  name:   'session',
  keys:   [process.env.SESSION_SECRET || 'dev-secret-change-before-live'],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
}));

const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ── PUBLIC API ────────────────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    res.json(await db.getProducts(req.query));
  } catch {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    res.json(await db.getCategories());
  } catch {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    res.json(await db.getSettings());
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    res.json(await db.getReviews());
  } catch {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ── ANALYTICS (public) ───────────────────────────────────────────────────────

app.post('/api/track/product/:id', async (req, res) => {
  await analytics.recordProductView(req.params.id);
  res.json({ ok: true });
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const user = await db.getAdminUser(username);
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
  req.session = null;
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    isAdmin:  !!(req.session && req.session.isAdmin),
    username: req.session?.username || null
  });
});

// ── ADMIN API ─────────────────────────────────────────────────────────────────

app.get('/api/admin/products', requireAuth, async (req, res) => {
  try {
    res.json(await db.getProducts());
  } catch {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/admin/products', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required' });
  try {
    res.status(201).json(await db.createProduct(req.body));
  } catch {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/admin/products/:id', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required' });
  try {
    const product = await db.updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const removed = await db.deleteProduct(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Product not found' });

    const urls = removed.images || (removed.image_url ? [removed.image_url] : []);
    for (const url of urls) {
      if (url && url.includes(R2_PUBLIC_URL)) {
        const key = url.replace(`${R2_PUBLIC_URL}/`, '');
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        } catch (err) {
          console.error('R2 delete error:', err);
        }
      }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.post('/api/admin/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(req.file.originalname)}`;
  try {
    await r2.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         key,
      Body:        req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    res.json({ url: `${R2_PUBLIC_URL}/${key}` });
  } catch (err) {
    console.error('R2 upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.delete('/api/admin/upload', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (url && url.includes(R2_PUBLIC_URL)) {
    const key = url.replace(`${R2_PUBLIC_URL}/`, '');
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } catch (err) {
      console.error('R2 delete error:', err);
    }
  }
  res.json({ success: true });
});

// ── ADMIN ANALYTICS ──────────────────────────────────────────────────────────

app.get('/api/admin/analytics/stats', requireAuth, async (req, res) => {
  try { res.json(await analytics.getStats()); }
  catch { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

app.get('/api/admin/analytics/daily', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    res.json(await analytics.getDailyStats(days));
  } catch { res.status(500).json({ error: 'Failed to fetch daily stats' }); }
});

app.get('/api/admin/analytics/top-products', requireAuth, async (req, res) => {
  try {
    const products = await analytics.getTopProducts(10);
    const all = await db.getProducts();
    const result = products.map(tp => {
      const p = all.find(x => x.id === tp.product_id);
      return { ...tp, name: p ? p.name : `Product #${tp.product_id}` };
    });
    res.json(result);
  } catch { res.status(500).json({ error: 'Failed to fetch top products' }); }
});

app.get('/api/admin/analytics/referrers', requireAuth, async (req, res) => {
  try { res.json(await analytics.getTopReferrers(10)); }
  catch { res.status(500).json({ error: 'Failed to fetch referrers' }); }
});

app.get('/api/admin/analytics/recent', requireAuth, async (req, res) => {
  try { res.json(await analytics.getRecentVisits(30)); }
  catch { res.status(500).json({ error: 'Failed to fetch recent visits' }); }
});

app.get('/api/admin/analytics/devices', requireAuth, async (req, res) => {
  try { res.json(await analytics.getDeviceStats()); }
  catch { res.status(500).json({ error: 'Failed to fetch device stats' }); }
});

app.get('/api/admin/reviews', requireAuth, async (req, res) => {
  try {
    res.json(await db.getReviews());
  } catch {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.post('/api/admin/reviews', requireAuth, async (req, res) => {
  const { author, text } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'Author and text are required' });
  try {
    res.status(201).json(await db.createReview(req.body));
  } catch {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, async (req, res) => {
  try {
    const removed = await db.deleteReview(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

app.put('/api/admin/settings', requireAuth, async (req, res) => {
  try {
    await db.updateSettings(req.body);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.put('/api/admin/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both current and new passwords are required' });

  try {
    const user = await db.getAdminUser(req.session.username);
    if (!bcrypt.compareSync(currentPassword, user.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect' });

    await db.updateAdminPassword(req.session.username, bcrypt.hashSync(newPassword, 10));
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
