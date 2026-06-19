const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'catalogue.json');

function read() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return null; }
}

function write(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// Initialise the file if it doesn't exist yet
(function init() {
  if (read()) return;
  write({
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
  });
})();

// ── Products ─────────────────────────────────────────────────────────────────

function normalizeProduct(p) {
  if (!p.images) p.images = p.image_url ? [p.image_url] : [];
  if (!p.image_url && p.images.length) p.image_url = p.images[0];
  return p;
}

function getProducts({ category, search } = {}) {
  const { products } = read();
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

function getProductById(id) {
  const p = read().products.find(p => p.id === Number(id));
  return p ? normalizeProduct(p) : null;
}

function getCategories() {
  return [...new Set(read().products.map(p => p.category))].sort();
}

function createProduct({ name, description, price, category, stock, images, image_url, fb_url }) {
  const data = read();
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
  write(data);
  return product;
}

function updateProduct(id, { name, description, price, category, stock, images, image_url, fb_url }) {
  const data = read();
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
  write(data);
  return data.products[idx];
}

function deleteProduct(id) {
  const data = read();
  const idx  = data.products.findIndex(p => p.id === Number(id));
  if (idx === -1) return null;
  const [removed] = data.products.splice(idx, 1);
  write(data);
  return removed;
}

// ── Reviews ───────────────────────────────────────────────────────────────────

function getReviews() {
  return read().reviews || [];
}

function createReview({ author, text, rating }) {
  const data = read();
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
  write(data);
  return review;
}

function deleteReview(id) {
  const data = read();
  if (!data.reviews) return null;
  const idx = data.reviews.findIndex(r => r.id === Number(id));
  if (idx === -1) return null;
  const [removed] = data.reviews.splice(idx, 1);
  write(data);
  return removed;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSettings() {
  return read().settings || {};
}

function updateSettings(updates) {
  const data = read();
  data.settings = { ...data.settings, ...updates };
  write(data);
}

// ── Admin users ───────────────────────────────────────────────────────────────

function getAdminUser(username) {
  return read().admin_users.find(u => u.username === username) || null;
}

function createAdminUser(username, passwordHash) {
  const data = read();
  const id   = data._nextUserId++;
  const user = { id, username, password_hash: passwordHash };
  data.admin_users.push(user);
  write(data);
  return user;
}

function updateAdminPassword(username, passwordHash) {
  const data = read();
  const user = data.admin_users.find(u => u.username === username);
  if (!user) return false;
  user.password_hash = passwordHash;
  write(data);
  return true;
}

module.exports = {
  getProducts, getProductById, getCategories,
  createProduct, updateProduct, deleteProduct,
  getReviews, createReview, deleteReview,
  getSettings, updateSettings,
  getAdminUser, createAdminUser, updateAdminPassword
};
