const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'analytics.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { daily: {}, product_views: {}, referrers: {}, recent: [] }; }
}

function write(data) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'catalogue-salt').digest('hex').slice(0, 12);
}

function recordPageView(ip, referer, userAgent, urlPath) {
  const data  = read();
  const date  = today();
  const vid   = hashIP(ip || 'unknown');

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

  write(data);
}

function recordProductView(productId) {
  const data = read();
  const key  = String(productId);
  data.product_views[key] = (data.product_views[key] || 0) + 1;
  write(data);
}

function getStats() {
  const data = read();
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

function getDailyStats(days = 30) {
  const data   = read();
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

function getTopProducts(limit = 10) {
  const data = read();
  return Object.entries(data.product_views)
    .map(([id, views]) => ({ product_id: Number(id), views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

function getTopReferrers(limit = 10) {
  const data = read();
  return Object.entries(data.referrers)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getRecentVisits(limit = 30) {
  const data = read();
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
