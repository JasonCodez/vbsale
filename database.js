const fs   = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const LOCAL_FILE = path.join(__dirname, 'catalogue.json');

const r2 = new S3Client({
  region:      'auto',
  endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const R2_KEY = 'data/catalogue.json';

const DEFAULT_DATA = {
  products: [],
  reviews: [],
  settings: {
    store_name:        'My Store',
    store_tagline:     'Quality Products for Every Need',
    store_description: 'Browse our curated selection of quality merchandise. Find exactly what you need.',
    contact_email:     '',
    contact_phone:     ''
  },
  admin_users: [],
  _nextProductId: 1,
  _nextReviewId:  1,
  _nextUserId:    1
};

let cache = null;
let dirty = false;
let flushTimer = null;

async function load() {
  if (cache) return cache;
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: R2_KEY }));
    const body = await res.Body.transformToString();
    cache = JSON.parse(body);
  } catch {
    try {
      cache = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    } catch {
      cache = { ...DEFAULT_DATA };
    }
  }
  return cache;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!dirty || !cache) return;
    dirty = false;
    try {
      await r2.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         R2_KEY,
        Body:        JSON.stringify(cache, null, 2),
        ContentType: 'application/json',
      }));
    } catch (err) {
      console.error('Catalogue R2 flush error:', err);
      dirty = true;
    }
  }, 2000);
}

function markDirty() {
  dirty = true;
  scheduleFlush();
}

// ── Products ─────────────────────────────────────────────────────────────────

function normalizeProduct(p) {
  if (!p.images) p.images = p.image_url ? [p.image_url] : [];
  if (!p.image_url && p.images.length) p.image_url = p.images[0];
  return p;
}

async function getProducts({ category, search } = {}) {
  const { products } = await load();
  let list = [...products].map(normalizeProduct).reverse();
  if (category && category !== 'all')
    list = list.filter(p => p.category === category);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }
  return list;
}

async function getProductById(id) {
  const data = await load();
  const p = data.products.find(p => p.id === Number(id));
  return p ? normalizeProduct(p) : null;
}

async function getCategories() {
  const data = await load();
  return [...new Set(data.products.map(p => p.category))].sort();
}

async function createProduct({ name, description, price, category, stock, images, image_url, fb_url }) {
  const data = await load();
  const id   = data._nextProductId++;
  const now  = new Date().toISOString();
  const product = {
    id,
    name,
    description: description || '',
    price:       parseFloat(price)  || 0,
    category:    category           || 'General',
    stock:       parseInt(stock)    || 0,
    images:      Array.isArray(images) ? images : (image_url ? [image_url] : []),
    fb_url:      fb_url             || '',
    created_at:  now,
    updated_at:  now
  };
  data.products.push(product);
  markDirty();
  return product;
}

async function updateProduct(id, { name, description, price, category, stock, images, image_url, fb_url }) {
  const data = await load();
  const idx  = data.products.findIndex(p => p.id === Number(id));
  if (idx === -1) return null;
  data.products[idx] = {
    ...data.products[idx],
    name,
    description: description || '',
    price:       parseFloat(price) || 0,
    category:    category          || 'General',
    stock:       parseInt(stock)   || 0,
    images:      Array.isArray(images) ? images : (image_url ? [image_url] : []),
    fb_url:      fb_url            || '',
    updated_at:  new Date().toISOString()
  };
  markDirty();
  return data.products[idx];
}

async function deleteProduct(id) {
  const data = await load();
  const idx  = data.products.findIndex(p => p.id === Number(id));
  if (idx === -1) return null;
  const [removed] = data.products.splice(idx, 1);
  markDirty();
  return removed;
}

// ── Reviews ───────────────────────────────────────────────────────────────────

async function getReviews() {
  const data = await load();
  return data.reviews || [];
}

async function createReview({ author, text, rating }) {
  const data = await load();
  if (!data.reviews) data.reviews = [];
  if (!data._nextReviewId) data._nextReviewId = 1;
  const id = data._nextReviewId++;
  const review = {
    id,
    author: String(author || 'Anonymous').trim(),
    text:   String(text   || '').trim(),
    rating: rating ? Math.min(5, Math.max(1, parseInt(rating))) : null,
    created_at: new Date().toISOString()
  };
  data.reviews.push(review);
  markDirty();
  return review;
}

async function deleteReview(id) {
  const data = await load();
  if (!data.reviews) return null;
  const idx = data.reviews.findIndex(r => r.id === Number(id));
  if (idx === -1) return null;
  const [removed] = data.reviews.splice(idx, 1);
  markDirty();
  return removed;
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const data = await load();
  return data.settings || {};
}

async function updateSettings(updates) {
  const data = await load();
  data.settings = { ...data.settings, ...updates };
  markDirty();
}

// ── Admin users ───────────────────────────────────────────────────────────────

async function getAdminUser(username) {
  const data = await load();
  return data.admin_users.find(u => u.username === username) || null;
}

async function createAdminUser(username, passwordHash) {
  const data = await load();
  const id   = data._nextUserId++;
  const user = { id, username, password_hash: passwordHash };
  data.admin_users.push(user);
  markDirty();
  return user;
}

async function updateAdminPassword(username, passwordHash) {
  const data = await load();
  const user = data.admin_users.find(u => u.username === username);
  if (!user) return false;
  user.password_hash = passwordHash;
  markDirty();
  return true;
}

module.exports = {
  getProducts, getProductById, getCategories,
  createProduct, updateProduct, deleteProduct,
  getReviews, createReview, deleteReview,
  getSettings, updateSettings,
  getAdminUser, createAdminUser, updateAdminPassword
};
