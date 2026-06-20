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

function parseUA(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown', isBot: false };

  const botPattern = /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|bingpreview|whatsapp|telegram|discord|slack|preview|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|semrush|ahrefs|mj12bot|dotbot|yandex|baidu|sogou|bytespider|gptbot|chatgpt|claude|amazonbot|applebot|twitterbot|linkedinbot|pinterestbot/i;
  const isBot = botPattern.test(ua);

  let browser = 'Other';
  if (/Edg\//i.test(ua))           browser = 'Edge';
  else if (/OPR|Opera/i.test(ua))  browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Chrome/i.test(ua))     browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua))    browser = 'Firefox';
  else if (/MSIE|Trident/i.test(ua)) browser = 'IE';

  let os = 'Other';
  if (/Windows/i.test(ua))              os = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS';
  else if (/iPhone/i.test(ua))          os = 'iOS';
  else if (/iPad/i.test(ua))            os = 'iPadOS';
  else if (/Android/i.test(ua))         os = 'Android';
  else if (/Linux/i.test(ua))           os = 'Linux';
  else if (/CrOS/i.test(ua))            os = 'ChromeOS';

  let device = 'Desktop';
  if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) device = 'Mobile';
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) device = 'Tablet';

  if (isBot) { browser = 'Bot'; device = 'Bot'; }

  return { browser, os, device, isBot };
}

async function recordPageView(ip, referer, userAgent, urlPath) {
  const data = await load();
  const date = today();
  const vid  = hashIP(ip || 'unknown');
  const parsed = parseUA(userAgent);

  if (!data.daily[date]) data.daily[date] = { views: 0, visitors: [], botViews: 0, botVisitors: [] };
  if (!data.daily[date].botViews) { data.daily[date].botViews = 0; data.daily[date].botVisitors = []; }

  if (parsed.isBot) {
    data.daily[date].botViews++;
    if (!data.daily[date].botVisitors.includes(vid)) {
      data.daily[date].botVisitors.push(vid);
    }
  } else {
    data.daily[date].views++;
    if (!data.daily[date].visitors.includes(vid)) {
      data.daily[date].visitors.push(vid);
    }
  }

  if (referer) {
    try {
      const host = new URL(referer).hostname.replace(/^www\./, '');
      if (host) data.referrers[host] = (data.referrers[host] || 0) + 1;
    } catch {}
  }

  if (!data.devices) data.devices = { browsers: {}, os: {}, types: {} };
  if (!parsed.isBot) {
    data.devices.browsers[parsed.browser] = (data.devices.browsers[parsed.browser] || 0) + 1;
    data.devices.os[parsed.os]            = (data.devices.os[parsed.os] || 0) + 1;
    data.devices.types[parsed.device]     = (data.devices.types[parsed.device] || 0) + 1;
  }

  data.recent.unshift({
    ts:       new Date().toISOString(),
    path:     urlPath || '/',
    visitor:  vid,
    referrer: referer || '',
    ua:       (userAgent || '').slice(0, 200),
    browser:  parsed.browser,
    os:       parsed.os,
    device:   parsed.device,
    isBot:    parsed.isBot
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
  const d    = data.daily[date] || { views: 0, visitors: [], botViews: 0, botVisitors: [] };

  const dates = Object.keys(data.daily).sort();
  let totalViews    = 0;
  let totalVisitors = new Set();
  let totalBotViews = 0;
  let totalBotVisitors = new Set();
  for (const dt of dates) {
    totalViews += data.daily[dt].views;
    for (const v of data.daily[dt].visitors) totalVisitors.add(v);
    totalBotViews += (data.daily[dt].botViews || 0);
    for (const v of (data.daily[dt].botVisitors || [])) totalBotVisitors.add(v);
  }

  return {
    today_views:        d.views,
    today_visitors:     d.visitors.length,
    today_bot_views:    d.botViews || 0,
    today_bot_visitors: (d.botVisitors || []).length,
    total_views:        totalViews,
    total_visitors:     totalVisitors.size,
    total_bot_views:    totalBotViews,
    total_bot_visitors: totalBotVisitors.size
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

async function getDeviceStats() {
  const data = await load();
  return data.devices || { browsers: {}, os: {}, types: {} };
}

module.exports = {
  recordPageView,
  recordProductView,
  getStats,
  getDailyStats,
  getTopProducts,
  getTopReferrers,
  getRecentVisits,
  getDeviceStats
};
