const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const LOCAL_FILE = path.join(__dirname, 'analytics.json');

const r2 = new S3Client({
  region:      'auto',
  endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const R2_KEY = 'data/analytics.json';

const EMPTY = { daily: {}, product_views: {}, referrers: {}, recent: [] };

let cache = null;
let dirty = false;
let flushTimer = null;

async function load() {
  if (cache) return cache;
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: R2_KEY }));
    const body = await res.Body.transformToString();
    cache = JSON.parse(body);
  } catch (err) {
    try {
      cache = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    } catch {
      cache = { ...EMPTY };
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
      console.error('Analytics R2 flush error:', err);
      dirty = true;
    }
  }, 5000);
}

function markDirty() {
  dirty = true;
  scheduleFlush();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'catalogue-salt').digest('hex').slice(0, 12);
}

async function recordPageView(ip, referer, userAgent, urlPath) {
  const data = await load();
  const date = today();
  const vid  = hashIP(ip || 'unknown');

  if (!data.daily[date]) data.daily[date] = { views: 0, visitors: [] };
  data.daily[date].views++;
  if (!data.daily[date].visitors.includes(vid)) {
    data.daily[date].visitors.push(vid);
  }

  if (referer) {
    try {
      const host = new URL(referer).hostname.replace(/^www\./, '');
      if (host) data.referrers[host] = (data.referrers[host] || 0) + 1;
    } catch {}
  }

  data.recent.unshift({
    ts:       new Date().toISOString(),
    path:     urlPath || '/',
    visitor:  vid,
    referrer: referer || '',
    ua:       (userAgent || '').slice(0, 120)
  });
  if (data.recent.length > 200) data.recent.length = 200;

  markDirty();
}

async function recordProductView(productId) {
  const data = await load();
  const key  = String(productId);
  data.product_views[key] = (data.product_views[key] || 0) + 1;
  markDirty();
}

async function getStats() {
  const data = await load();
  const date = today();
  const d    = data.daily[date] || { views: 0, visitors: [] };

  const dates = Object.keys(data.daily).sort();
  let totalViews    = 0;
  let totalVisitors = new Set();
  for (const dt of dates) {
    totalViews += data.daily[dt].views;
    for (const v of data.daily[dt].visitors) totalVisitors.add(v);
  }

  return {
    today_views:      d.views,
    today_visitors:   d.visitors.length,
    total_views:      totalViews,
    total_visitors:   totalVisitors.size
  };
}

async function getDailyStats(days = 30) {
  const data   = await load();
  const result = [];
  const now    = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d    = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const entry = data.daily[date] || { views: 0, visitors: [] };
    result.push({
      date,
      views:    entry.views,
      visitors: entry.visitors.length
    });
  }
  return result;
}

async function getTopProducts(limit = 10) {
  const data = await load();
  return Object.entries(data.product_views)
    .map(([id, views]) => ({ product_id: Number(id), views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

async function getTopReferrers(limit = 10) {
  const data = await load();
  return Object.entries(data.referrers)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function getRecentVisits(limit = 30) {
  const data = await load();
  return data.recent.slice(0, limit);
}

module.exports = {
  recordPageView,
  recordProductView,
  getStats,
  getDailyStats,
  getTopProducts,
  getTopReferrers,
  getRecentVisits
};
