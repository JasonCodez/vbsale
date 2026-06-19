(() => {
  'use strict';

  // ── Auth guard ─────────────────────────────────────────────────────────────
  fetch('/api/auth/status').then(r => r.json()).then(d => {
    if (!d.isAdmin) { window.location.href = '/admin/'; return; }
    const nameEl = document.getElementById('admin-username');
    const avatarEl = document.getElementById('admin-avatar');
    if (nameEl) nameEl.textContent = d.username || 'Admin';
    if (avatarEl) avatarEl.textContent = (d.username || 'A')[0].toUpperCase();
    init();
  }).catch(() => { window.location.href = '/admin/'; });

  // ── State ──────────────────────────────────────────────────────────────────
  let allProducts = [];
  let tableSearch = '';
  let tableCategory = 'all';
  let pendingDeleteId = null;
  let editingId = null;
  let uploadedImages = [];

  // ── Navigation ─────────────────────────────────────────────────────────────
  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.remove('hidden');

    document.querySelectorAll(`[data-page="${page}"]`).forEach(n => n.classList.add('active'));

    if (page === 'overview')  loadOverview();
    if (page === 'analytics') loadAnalytics();
    if (page === 'products')  loadProducts();
    if (page === 'reviews')   loadAdminReviews();
    if (page === 'settings')  loadSettings();

    closeSidebar();
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    bindNav();
    bindSidebar();
    bindLogout();
    bindProductModal();
    bindDeleteModal();
    bindTableSearch();
    bindSettingsForms();
    bindReviewForm();
    bindAnalyticsRange();
    navigateTo('overview');
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  function bindSidebar() {
    const hamburger      = document.getElementById('hamburger');
    const sidebarClose   = document.getElementById('sidebar-close');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    hamburger?.addEventListener('click', openSidebar);
    sidebarClose?.addEventListener('click', closeSidebar);
    sidebarOverlay?.addEventListener('click', closeSidebar);
  }

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  // ── Navigation binding ─────────────────────────────────────────────────────
  function bindNav() {
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    });
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/admin/';
    });
  }

  // ── Overview ───────────────────────────────────────────────────────────────
  async function loadOverview() {
    try {
      const products = await api('/api/admin/products');
      allProducts = products;

      const total  = products.length;
      const inStock = products.filter(p => p.stock > 5).length;
      const low    = products.filter(p => p.stock > 0 && p.stock <= 5).length;
      const out    = products.filter(p => p.stock <= 0).length;

      setText('stat-total', total);
      setText('stat-in',    inStock);
      setText('stat-low',   low);
      setText('stat-out',   out);

      renderRecent(products.slice(0, 6));
    } catch (_) {}
  }

  function renderRecent(products) {
    const el = document.getElementById('recent-list');
    if (!products.length) { el.innerHTML = '<div class="table-loading">No products yet.</div>'; return; }

    el.innerHTML = products.map(p => {
      const { badgeCls, label } = stockStatus(p.stock);
      const thumbUrl = (p.images && p.images[0]) || p.image_url;
      const thumb = thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;

      return `<div class="recent-row">
        <div class="recent-thumb">${thumb}</div>
        <div style="flex:1;min-width:0">
          <div class="recent-name">${esc(p.name)}</div>
          <div class="recent-cat">${esc(p.category)}</div>
        </div>
        <span class="badge ${badgeCls}">${label}</span>
      </div>`;
    }).join('');
  }

  // ── Products ───────────────────────────────────────────────────────────────
  async function loadProducts() {
    document.getElementById('table-loading').classList.remove('hidden');
    document.getElementById('products-tbody').innerHTML = '';
    document.getElementById('table-empty').classList.add('hidden');

    try {
      allProducts = await api('/api/admin/products');
      populateCategoryFilter();
      renderTable();
    } catch (_) {
      document.getElementById('table-loading').innerHTML = 'Failed to load products.';
    }

    document.getElementById('table-loading').classList.add('hidden');
  }

  function populateCategoryFilter() {
    const sel = document.getElementById('table-category-filter');
    const cats = [...new Set(allProducts.map(p => p.category))].sort();
    sel.innerHTML = `<option value="all">All Categories</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    // Refresh datalist in modal
    const dl = document.getElementById('category-list');
    if (dl) dl.innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  }

  function renderTable() {
    const q = tableSearch.toLowerCase();
    const filtered = allProducts.filter(p => {
      const matchCat = tableCategory === 'all' || p.category === tableCategory;
      const matchQ   = !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    const subtitle = document.getElementById('products-subtitle');
    if (subtitle) subtitle.textContent = `${allProducts.length} product${allProducts.length !== 1 ? 's' : ''} total`;

    const tbody = document.getElementById('products-tbody');
    const emptyEl = document.getElementById('table-empty');

    if (!filtered.length) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    tbody.innerHTML = filtered.map(p => {
      const { badgeCls, label } = stockStatus(p.stock);
      const thumbUrl = (p.images && p.images[0]) || p.image_url;
      const thumb = thumbUrl
        ? `<div class="table-thumb"><img src="${esc(thumbUrl)}" alt=""></div>`
        : `<div class="table-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>`;

      const price = p.price > 0 ? `$${p.price.toFixed(2)}` : '—';

      return `<tr>
        <td>${thumb}</td>
        <td>
          <div class="table-name">${esc(p.name)}</div>
          ${p.description ? `<div class="table-desc">${esc(p.description)}</div>` : ''}
        </td>
        <td style="color:var(--text-muted)">${esc(p.category)}</td>
        <td style="font-weight:500">${price}</td>
        <td>${p.stock}</td>
        <td><span class="badge ${badgeCls}">${label}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon edit-btn" data-id="${p.id}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon delete delete-btn" data-id="${p.id}" data-name="${esc(p.name)}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Bind row actions
    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openProductModal(parseInt(btn.dataset.id)));
    });

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => openDeleteModal(parseInt(btn.dataset.id), btn.dataset.name));
    });
  }

  function bindTableSearch() {
    document.getElementById('table-search')?.addEventListener('input', e => {
      tableSearch = e.target.value;
      renderTable();
    });

    document.getElementById('table-category-filter')?.addEventListener('change', e => {
      tableCategory = e.target.value;
      renderTable();
    });
  }

  // ── Product Modal ──────────────────────────────────────────────────────────
  function bindProductModal() {
    document.getElementById('add-product-btn')?.addEventListener('click', () => openProductModal(null));
    document.getElementById('modal-x')?.addEventListener('click', closeProductModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeProductModal);
    document.getElementById('modal-save')?.addEventListener('click', saveProduct);

    document.getElementById('product-modal-backdrop')?.addEventListener('click', e => {
      if (e.target === document.getElementById('product-modal-backdrop')) closeProductModal();
    });

    const fileInput = document.getElementById('image-file');
    document.getElementById('image-add-btn')?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';

      const formData = new FormData();
      formData.append('image', file);

      try {
        const btn = document.getElementById('modal-save');
        btn.disabled = true;
        const data = await fetch('/api/admin/upload', { method: 'POST', body: formData }).then(r => r.json());
        if (data.url) {
          uploadedImages.push(data.url);
          renderImageThumbs();
        }
      } catch (_) {
        showFormError('Image upload failed. Please try again.');
      } finally {
        document.getElementById('modal-save').disabled = false;
      }
    });
  }

  function renderImageThumbs() {
    const container = document.getElementById('image-thumbs');
    container.innerHTML = uploadedImages.map((url, i) => `
      <div class="image-thumb">
        <img src="${esc(url)}" alt="">
        <button type="button" class="image-thumb-remove" data-idx="${i}" title="Remove image">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
        ${i === 0 ? '<div class="image-thumb-primary">Main</div>' : ''}
      </div>`).join('');

    container.querySelectorAll('.image-thumb-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        uploadedImages.splice(parseInt(btn.dataset.idx), 1);
        renderImageThumbs();
      });
    });
  }

  function openProductModal(id) {
    editingId = id;
    uploadedImages = [];
    hideFormError();

    document.getElementById('modal-title').textContent = id ? 'Edit Product' : 'Add Product';
    document.getElementById('modal-save-label').textContent = id ? 'Save Changes' : 'Add Product';

    if (id) {
      const p = allProducts.find(x => x.id === id);
      if (!p) return;
      document.getElementById('product-name').value     = p.name || '';
      document.getElementById('product-category').value = p.category || '';
      document.getElementById('product-desc').value     = p.description || '';
      document.getElementById('product-price').value    = p.price > 0 ? p.price : '';
      document.getElementById('product-stock').value    = p.stock ?? '';
      document.getElementById('product-fb-url').value   = p.fb_url || '';
      uploadedImages = Array.isArray(p.images) ? [...p.images] : (p.image_url ? [p.image_url] : []);
    } else {
      document.getElementById('product-name').value     = '';
      document.getElementById('product-category').value = '';
      document.getElementById('product-desc').value     = '';
      document.getElementById('product-price').value    = '';
      document.getElementById('product-stock').value    = '';
      document.getElementById('product-fb-url').value   = '';
    }

    renderImageThumbs();
    document.getElementById('product-modal-backdrop').classList.remove('hidden');
    document.getElementById('product-name').focus();
  }

  function closeProductModal() {
    document.getElementById('product-modal-backdrop').classList.add('hidden');
    editingId = null;
    uploadedImages = [];
  }

  async function saveProduct() {
    const name     = document.getElementById('product-name').value.trim();
    const category = document.getElementById('product-category').value.trim() || 'General';
    const desc     = document.getElementById('product-desc').value.trim();
    const price    = parseFloat(document.getElementById('product-price').value) || 0;
    const stock    = parseInt(document.getElementById('product-stock').value) || 0;
    const fbUrl    = document.getElementById('product-fb-url').value.trim();

    if (!name) { showFormError('Product name is required.'); return; }

    const body = { name, description: desc, price, category, stock, images: uploadedImages, fb_url: fbUrl };
    const url  = editingId ? `/api/admin/products/${editingId}` : '/api/admin/products';
    const method = editingId ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('modal-save');
    saveBtn.disabled = true;
    document.getElementById('modal-save-label').textContent = 'Saving…';
    hideFormError();

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok) { showFormError(data.error || 'Failed to save product.'); return; }

      closeProductModal();
      await loadProducts();
      loadOverview();
    } catch {
      showFormError('Network error — please try again.');
    } finally {
      saveBtn.disabled = false;
      document.getElementById('modal-save-label').textContent = editingId ? 'Save Changes' : 'Add Product';
    }
  }

  function showFormError(msg) {
    const el = document.getElementById('product-form-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideFormError() {
    document.getElementById('product-form-error').classList.add('hidden');
  }

  // ── Delete Modal ───────────────────────────────────────────────────────────
  function bindDeleteModal() {
    document.getElementById('delete-modal-x')?.addEventListener('click', closeDeleteModal);
    document.getElementById('delete-cancel')?.addEventListener('click', closeDeleteModal);
    document.getElementById('delete-confirm')?.addEventListener('click', confirmDelete);

    document.getElementById('delete-modal-backdrop')?.addEventListener('click', e => {
      if (e.target === document.getElementById('delete-modal-backdrop')) closeDeleteModal();
    });
  }

  function openDeleteModal(id, name) {
    pendingDeleteId = id;
    document.getElementById('delete-product-name').textContent = `"${name}"`;
    document.getElementById('delete-modal-backdrop').classList.remove('hidden');
  }

  function closeDeleteModal() {
    document.getElementById('delete-modal-backdrop').classList.add('hidden');
    pendingDeleteId = null;
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;

    const btn = document.getElementById('delete-confirm');
    btn.disabled = true;
    btn.textContent = 'Deleting…';

    try {
      const res = await fetch(`/api/admin/products/${pendingDeleteId}`, { method: 'DELETE' });
      if (res.ok) {
        closeDeleteModal();
        await loadProducts();
        loadOverview();
      }
    } catch (_) {}

    btn.disabled = false;
    btn.textContent = 'Delete';
  }

  // ── Reviews ────────────────────────────────────────────────────────────────
  async function loadAdminReviews() {
    const listEl = document.getElementById('reviews-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="table-loading">Loading…</div>';
    try {
      const reviews = await api('/api/admin/reviews');
      renderReviewsList(reviews);
    } catch (_) {
      listEl.innerHTML = '<div class="table-loading">Failed to load reviews.</div>';
    }
  }

  function renderReviewsList(reviews) {
    const listEl = document.getElementById('reviews-list');
    if (!reviews.length) {
      listEl.innerHTML = '<p class="reviews-empty">No reviews yet. Add your first one!</p>';
      return;
    }
    listEl.innerHTML = reviews.map(r => `
      <div class="review-item">
        <div class="review-item-body">
          ${r.rating ? `<div class="review-item-stars">${'★'.repeat(r.rating)}</div>` : ''}
          <p class="review-item-text">"${esc(r.text)}"</p>
          <div class="review-item-author">— ${esc(r.author)}</div>
        </div>
        <button class="btn-icon delete review-del-btn" data-id="${r.id}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>`).join('');

    listEl.querySelectorAll('.review-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this review?')) return;
        try {
          const res = await fetch(`/api/admin/reviews/${btn.dataset.id}`, { method: 'DELETE' });
          if (res.ok) loadAdminReviews();
        } catch (_) {}
      });
    });
  }

  function bindReviewForm() {
    const form = document.getElementById('review-form');
    if (!form) return;

    let selectedRating = 0;
    const starBtns = document.querySelectorAll('.star-btn');

    function paintStars() {
      starBtns.forEach((b, i) => b.classList.toggle('fill', i < selectedRating));
    }

    starBtns.forEach(btn => {
      const val = parseInt(btn.dataset.val);
      btn.addEventListener('mouseenter', () =>
        starBtns.forEach((b, i) => b.classList.toggle('fill', i < val)));
      btn.addEventListener('mouseleave', paintStars);
      btn.addEventListener('click', () => {
        selectedRating = selectedRating === val ? 0 : val;
        document.getElementById('r-rating').value = selectedRating || '';
        paintStars();
      });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const author  = document.getElementById('r-author').value.trim();
      const text    = document.getElementById('r-text').value.trim();
      const rating  = document.getElementById('r-rating').value;
      const errEl   = document.getElementById('review-form-error');
      const msgEl   = document.getElementById('review-save-msg');
      const submitBtn = document.getElementById('review-submit');

      errEl.classList.add('hidden');

      if (!author || !text) {
        errEl.textContent = 'Customer name and review text are required.';
        errEl.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding…';

      try {
        const res = await fetch('/api/admin/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author, text, rating: rating || null })
        });

        if (res.ok) {
          form.reset();
          selectedRating = 0;
          document.getElementById('r-rating').value = '';
          paintStars();
          msgEl.textContent = '✓ Review added!';
          msgEl.classList.remove('hidden');
          setTimeout(() => msgEl.classList.add('hidden'), 3000);
          loadAdminReviews();
        } else {
          const data = await res.json();
          errEl.textContent = data.error || 'Failed to add review.';
          errEl.classList.remove('hidden');
        }
      } catch {
        errEl.textContent = 'Network error — please try again.';
        errEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Review';
      }
    });
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  let analyticsDays = 30;

  function bindAnalyticsRange() {
    document.getElementById('analytics-range')?.addEventListener('change', e => {
      analyticsDays = parseInt(e.target.value) || 30;
      loadAnalytics();
    });
  }

  async function loadAnalytics() {
    try {
      const [stats, daily, topProducts, referrers, recent] = await Promise.all([
        api('/api/admin/analytics/stats'),
        api(`/api/admin/analytics/daily?days=${analyticsDays}`),
        api('/api/admin/analytics/top-products'),
        api('/api/admin/analytics/referrers'),
        api('/api/admin/analytics/recent')
      ]);

      setText('stat-today-views',    stats.today_views);
      setText('stat-today-visitors', stats.today_visitors);
      setText('stat-total-views',    stats.total_views);
      setText('stat-total-visitors', stats.total_visitors);

      renderTrafficChart(daily);
      renderTopProducts(topProducts);
      renderReferrers(referrers);
      renderRecentVisits(recent);
    } catch (_) {}
  }

  function renderTrafficChart(daily) {
    const el = document.getElementById('traffic-chart');
    if (!el) return;

    if (!daily.length || daily.every(d => d.views === 0)) {
      el.innerHTML = '<div class="chart-empty">No traffic data yet. Stats will appear as visitors browse your site.</div>';
      return;
    }

    const maxVal = Math.max(...daily.map(d => d.views), 1);
    const barW   = Math.max(100 / daily.length, 2);

    el.innerHTML = `<div class="chart-bars">${daily.map((d, i) => {
      const viewH   = Math.max((d.views / maxVal) * 100, d.views ? 3 : 0);
      const visitH  = Math.max((d.visitors / maxVal) * 100, d.visitors ? 3 : 0);
      const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const showLabel = daily.length <= 14 || i % Math.ceil(daily.length / 10) === 0;
      return `<div class="chart-bar-group" style="width:${barW}%" title="${dayLabel}: ${d.views} views, ${d.visitors} visitors">
        <div class="chart-bar-stack">
          <div class="chart-bar chart-bar-views" style="height:${viewH}%"></div>
          <div class="chart-bar chart-bar-visitors" style="height:${visitH}%"></div>
        </div>
        ${showLabel ? `<span class="chart-label">${dayLabel}</span>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function renderTopProducts(products) {
    const el = document.getElementById('top-products-list');
    if (!products.length) {
      el.innerHTML = '<div class="analytics-empty">No product views recorded yet.</div>';
      return;
    }
    el.innerHTML = products.map((p, i) => `
      <div class="analytics-row">
        <span class="analytics-rank">${i + 1}</span>
        <span class="analytics-row-name">${esc(p.name)}</span>
        <span class="analytics-row-value">${p.views} view${p.views !== 1 ? 's' : ''}</span>
      </div>`).join('');
  }

  function renderReferrers(referrers) {
    const el = document.getElementById('top-referrers-list');
    if (!referrers.length) {
      el.innerHTML = '<div class="analytics-empty">No referrer data yet.</div>';
      return;
    }
    el.innerHTML = referrers.map((r, i) => `
      <div class="analytics-row">
        <span class="analytics-rank">${i + 1}</span>
        <span class="analytics-row-name">${esc(r.domain)}</span>
        <span class="analytics-row-value">${r.count} visit${r.count !== 1 ? 's' : ''}</span>
      </div>`).join('');
  }

  function renderRecentVisits(visits) {
    const el = document.getElementById('recent-visits-list');
    if (!visits.length) {
      el.innerHTML = '<div class="analytics-empty">No recent visits recorded yet.</div>';
      return;
    }
    el.innerHTML = visits.map(v => {
      const time = new Date(v.ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const device = /Mobile|Android|iPhone/i.test(v.ua) ? 'Mobile' : 'Desktop';
      const ref = v.referrer ? (() => {
        try { return new URL(v.referrer).hostname.replace(/^www\./, ''); } catch { return ''; }
      })() : '';

      return `<div class="analytics-row">
        <span class="analytics-visit-time">${time}</span>
        <span class="analytics-visit-path">${esc(v.path)}</span>
        <span class="badge badge-in" style="font-size:0.68rem">${device}</span>
        ${ref ? `<span class="analytics-visit-ref">via ${esc(ref)}</span>` : ''}
        <span class="analytics-visit-id" title="Visitor ID">${v.visitor.slice(0, 6)}</span>
      </div>`;
    }).join('');
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async function loadSettings() {
    try {
      const s = await api('/api/settings');
      document.getElementById('s-name').value    = s.store_name || '';
      document.getElementById('s-tagline').value = s.store_tagline || '';
      document.getElementById('s-desc').value    = s.store_description || '';
      document.getElementById('s-email').value   = s.contact_email || '';
      document.getElementById('s-phone').value   = s.contact_phone || '';
    } catch (_) {}
  }

  function bindSettingsForms() {
    document.getElementById('settings-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const msgEl = document.getElementById('settings-save-msg');
      msgEl.classList.add('hidden');
      msgEl.classList.remove('error-txt');

      try {
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_name:        document.getElementById('s-name').value,
            store_tagline:     document.getElementById('s-tagline').value,
            store_description: document.getElementById('s-desc').value,
            contact_email:     document.getElementById('s-email').value,
            contact_phone:     document.getElementById('s-phone').value,
          })
        });

        if (res.ok) {
          msgEl.textContent = '✓ Saved successfully!';
        } else {
          msgEl.textContent = 'Failed to save.';
          msgEl.classList.add('error-txt');
        }
      } catch {
        msgEl.textContent = 'Network error.';
        msgEl.classList.add('error-txt');
      }

      msgEl.classList.remove('hidden');
      setTimeout(() => msgEl.classList.add('hidden'), 3000);
    });

    document.getElementById('password-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const msgEl = document.getElementById('password-save-msg');
      msgEl.classList.add('hidden');
      msgEl.classList.remove('error-txt');

      const current = document.getElementById('p-current').value;
      const newPw   = document.getElementById('p-new').value;
      const confirm = document.getElementById('p-confirm').value;

      if (newPw !== confirm) {
        msgEl.textContent = 'New passwords do not match.';
        msgEl.classList.add('error-txt', 'show');
        msgEl.classList.remove('hidden');
        return;
      }

      if (newPw.length < 6) {
        msgEl.textContent = 'Password must be at least 6 characters.';
        msgEl.classList.add('error-txt');
        msgEl.classList.remove('hidden');
        return;
      }

      try {
        const res = await fetch('/api/admin/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current, newPassword: newPw })
        });
        const data = await res.json();

        if (res.ok) {
          msgEl.textContent = '✓ Password updated!';
          document.getElementById('password-form').reset();
        } else {
          msgEl.textContent = data.error || 'Failed to update password.';
          msgEl.classList.add('error-txt');
        }
      } catch {
        msgEl.textContent = 'Network error.';
        msgEl.classList.add('error-txt');
      }

      msgEl.classList.remove('hidden');
      setTimeout(() => msgEl.classList.add('hidden'), 3500);
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function stockStatus(stock) {
    if (stock <= 0) return { badgeCls: 'badge-out', label: 'Out of Stock' };
    if (stock <= 5) return { badgeCls: 'badge-low', label: 'Low Stock' };
    return               { badgeCls: 'badge-in',  label: 'In Stock' };
  }

  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeProductModal();
      closeDeleteModal();
    }
  });

})();
