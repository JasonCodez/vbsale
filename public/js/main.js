(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let allProducts = [];
  let activeCategory = 'all';
  let searchQuery = '';
  let currentPage = 1;
  const PAGE_SIZE = 20;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const grid         = document.getElementById('products-grid');
  const stateEmpty   = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const pillsWrap    = document.getElementById('category-pills');
  const resultsInfo  = document.getElementById('results-info');
  const searchInput  = document.getElementById('search-input');
  const searchClear  = document.getElementById('search-clear');
  const overlay      = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const modalClose   = document.getElementById('modal-close');
  const navbar       = document.getElementById('navbar');

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    initSparkles();
    loadSettings();
    loadReviews();
    await loadProducts();
    await loadCategories();
    bindEvents();
    document.getElementById('footer-year').textContent = new Date().getFullYear();
  }

  // ── Reviews carousel ───────────────────────────────────────────────────────
  async function loadReviews() {
    try {
      const reviews = await fetch('/api/reviews').then(r => r.json());
      initReviewCarousel(reviews);
    } catch (_) {}
  }

  function initReviewCarousel(reviews) {
    const panel   = document.getElementById('hero-reviews-panel');
    const slotEl  = document.getElementById('hero-reviews');
    const dotsEl  = document.getElementById('reviews-dots');
    const mSlot   = document.getElementById('hero-reviews-mobile');
    const mDots   = document.getElementById('reviews-dots-mobile');
    const mStrip  = document.getElementById('mobile-reviews-strip');

    if (!reviews.length) {
      if (panel)  panel.style.display  = 'none';
      if (mStrip) mStrip.style.display = 'none';
      return;
    }

    const dotHTML = reviews.map((_, i) =>
      `<div class="reviews-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
    dotsEl.innerHTML = dotHTML;
    if (mDots) mDots.innerHTML = dotHTML;

    let current = 0;
    let timer = null;

    function renderInto(slot, r) {
      slot.innerHTML = `
        <div class="review-card" style="opacity:0">
          <p class="review-text">"${esc(r.text)}"</p>
          <div class="review-author">— ${esc(r.author)}</div>
          ${r.rating ? `<div class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>` : ''}
        </div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const card = slot.querySelector('.review-card');
        if (card) card.style.opacity = '1';
      }));
    }

    function paintSlot(slot, dotsContainer, r, animate) {
      if (!slot) return;
      if (animate && slot.firstElementChild) {
        slot.firstElementChild.style.opacity = '0';
        setTimeout(() => renderInto(slot, r), 650);
      } else {
        renderInto(slot, r);
      }
      if (dotsContainer) {
        dotsContainer.querySelectorAll('.reviews-dot')
          .forEach((d, i) => d.classList.toggle('active', i === current));
      }
    }

    function advance(idx, animate) {
      current = idx;
      paintSlot(slotEl, dotsEl,  reviews[idx], animate);
      paintSlot(mSlot,  mDots,   reviews[idx], animate);
    }

    function startTimer() {
      if (reviews.length <= 1) return;
      clearInterval(timer);
      timer = setInterval(() => advance((current + 1) % reviews.length, true), 9000);
    }

    function go(delta) {
      advance((current + delta + reviews.length) % reviews.length, true);
      startTimer();
    }

    advance(0, false);
    startTimer();

    ['reviews-prev', 'reviews-prev-mobile'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => go(-1));
    });
    ['reviews-next', 'reviews-next-mobile'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => go(1));
    });
  }

  // ── Sparkles ────────────────────────────────────────────────────────────────
  function initSparkles() {
    const container = document.querySelector('.hero-shapes');
    if (!container) return;
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      const size = 2 + Math.floor(Math.random() * 3);
      s.style.cssText = `left:${(Math.random()*90+5).toFixed(1)}%;top:${(Math.random()*85+5).toFixed(1)}%;width:${size}px;height:${size}px;animation-delay:${(Math.random()*5).toFixed(2)}s;animation-duration:${(2+Math.random()*3).toFixed(2)}s`;
      container.appendChild(s);
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async function loadSettings() {
    try {
      const s = await fetch('/api/settings').then(r => r.json());

      const name = s.store_name || 'My Store';
      document.getElementById('page-title').textContent   = name + ' — Catalogue';
      document.getElementById('nav-store-name').textContent  = name;
      document.getElementById('hero-store-name').textContent = name;
      document.getElementById('footer-store-name').textContent = name;
      document.getElementById('footer-copy-name').textContent  = name;

      if (s.store_tagline) document.getElementById('hero-tagline').textContent = s.store_tagline;
      if (s.store_description) document.getElementById('hero-desc').textContent = s.store_description;


      const contactEl = document.getElementById('footer-contact');
      if (s.contact_email || s.contact_phone) {
        const parts = [];
        if (s.contact_email) parts.push(`<a href="mailto:${s.contact_email}">${s.contact_email}</a>`);
        if (s.contact_phone) parts.push(`<a href="tel:${s.contact_phone}">${s.contact_phone}</a>`);
        contactEl.innerHTML = parts.join('');
      }

    } catch (_) {}
  }

  // ── Products ───────────────────────────────────────────────────────────────
  async function loadProducts() {
    showLoading(true);
    try {
      allProducts = await fetch('/api/products').then(r => r.json());
      renderProducts();
    } catch (_) {
      showEmpty(true);
    } finally {
      showLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const cats = await fetch('/api/categories').then(r => r.json());
      renderPills(cats);
    } catch (_) {}
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderProducts() {
    const q = searchQuery.toLowerCase();
    const filtered = allProducts.filter(p => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      const matchQ   = !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const paged = filtered.slice(start, start + PAGE_SIZE);

    resultsInfo.textContent = filtered.length === 0
      ? '' : `${start + 1}–${start + paged.length} of ${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
      grid.innerHTML = '';
      renderPagination(0, 0);
      showEmpty(true);
      return;
    }

    showEmpty(false);
    grid.innerHTML = paged.map((p, i) => cardHTML(p, i)).join('');

    grid.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id);
        openModal(allProducts.find(p => p.id === id));
      });
    });

    grid.querySelectorAll('.card-fb-btn, .card-share-btn').forEach(btn => {
      btn.addEventListener('click', e => e.stopPropagation());
    });

    observeCards();
    renderPagination(totalPages, filtered.length);
  }

  function renderPagination(totalPages, totalItems) {
    let container = document.getElementById('pagination');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pagination';
      container.className = 'pagination';
      grid.parentNode.appendChild(container);
    }

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    const prevDisabled = currentPage <= 1 ? ' disabled' : '';
    const nextDisabled = currentPage >= totalPages ? ' disabled' : '';

    let pagesHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      pagesHTML += `<button class="page-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
    }

    container.innerHTML = `
      <button class="page-arrow${prevDisabled}" id="page-prev">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      ${pagesHTML}
      <button class="page-arrow${nextDisabled}" id="page-next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="9 6 15 12 9 18"/></svg>
      </button>`;

    document.getElementById('page-prev').addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderProducts(); scrollToGrid(); }
    });
    document.getElementById('page-next').addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderProducts(); scrollToGrid(); }
    });
    container.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = parseInt(btn.dataset.page);
        renderProducts();
        scrollToGrid();
      });
    });
  }

  function scrollToGrid() {
    const filterBar = document.querySelector('.filter-bar');
    if (filterBar) filterBar.scrollIntoView({ behavior: 'smooth' });
  }

  function cardHTML(p, i) {
    const { badge, stockText, stockClass } = stockInfo(p.stock);
    const price = p.price > 0
      ? `<span class="card-price">$${p.price.toFixed(2)}</span>`
      : `<span class="card-price-empty">Contact for price</span>`;

    const imgs = (p.images && p.images.length) ? p.images : (p.image_url ? [p.image_url] : []);
    const imgHTML = imgs.length
      ? `<img src="${esc(imgs[0])}" alt="${esc(p.name)}" loading="lazy">`
        + (imgs.length > 1 ? `<span class="card-image-count">${imgs.length}</span>` : '')
      : `<div class="card-image-placeholder">${boxIcon()}</div>`;

    return `
      <article class="card" data-id="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}">
        <div class="card-image">
          ${imgHTML}
        </div>
        <div class="card-body">
          <div class="card-category-row">
            <div class="card-category">${esc(p.category)}</div>
            <span class="stock-badge ${badge.cls}">${badge.label}</span>
          </div>
          <h2 class="card-name">${esc(p.name)}</h2>
          ${p.description ? `<p class="card-desc">${esc(p.description)}</p>` : ''}
          <div class="card-footer">
            ${price}
            <span class="card-stock-text ${stockClass}">${stockText}</span>
          </div>
        </div>
        <div class="card-fb-wrap">
          <a class="card-fb-btn" href="${esc(p.fb_url || '#')}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View on Facebook Marketplace
          </a>
          <div class="card-share-wrap">
            <p class="card-share-text">Know someone that may be interested in this item? Sharing is caring!</p>
            <a class="card-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(p.fb_url || location.href)}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
              Share on Facebook
            </a>
          </div>
        </div>
      </article>`;
  }

  function renderPills(cats) {
    const extra = cats.map(c => `<button class="pill" data-category="${esc(c)}">${esc(c)}</button>`).join('');
    pillsWrap.innerHTML = `<button class="pill active" data-category="all">All Items</button>${extra}`;
    pillsWrap.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => {
        pillsWrap.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategory = btn.dataset.category;
        currentPage = 1;
        renderProducts();
      });
    });
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(p) {
    if (!p) return;
    fetch(`/api/track/product/${p.id}`, { method: 'POST' }).catch(() => {});
    const { badge, stockText } = stockInfo(p.stock);
    const imgs = (p.images && p.images.length) ? p.images : (p.image_url ? [p.image_url] : []);

    let imgSection;
    if (imgs.length > 1) {
      const dotsHTML = imgs.map((_, i) =>
        `<button class="gallery-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`
      ).join('');
      imgSection = `
        <div class="modal-gallery" id="modal-gallery">
          <img class="modal-img" id="modal-gallery-img" src="${esc(imgs[0])}" alt="${esc(p.name)}">
          <button class="gallery-nav gallery-prev" id="gallery-prev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="gallery-nav gallery-next" id="gallery-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="9 6 15 12 9 18"/></svg>
          </button>
          <div class="gallery-dots" id="gallery-dots">${dotsHTML}</div>
          <div class="gallery-counter" id="gallery-counter">1 / ${imgs.length}</div>
        </div>`;
    } else if (imgs.length === 1) {
      imgSection = `<img class="modal-img" src="${esc(imgs[0])}" alt="${esc(p.name)}">`;
    } else {
      imgSection = `<div class="modal-img-placeholder">${boxIcon(64)}</div>`;
    }

    const price = p.price > 0
      ? `<span class="modal-price">$${p.price.toFixed(2)}</span>`
      : `<span class="modal-price-empty">Contact for price</span>`;

    modalContent.innerHTML = `
      ${imgSection}
      <div class="modal-body">
        <div class="modal-category">${esc(p.category)}</div>
        <h2 class="modal-name">${esc(p.name)}</h2>
        ${p.description ? `<p class="modal-desc">${esc(p.description)}</p>` : ''}
        <div class="modal-meta">
          ${price}
          <div class="modal-stock">
            <span class="stock-badge ${badge.cls}">${badge.label}</span>
            <span style="font-size:0.82rem;color:var(--text-muted)">${stockText}</span>
          </div>
        </div>
        <div class="modal-note">
          This item is for viewing only. Contact us directly to purchase.
        </div>
        <a class="modal-fb-btn" href="${esc(p.fb_url || '#')}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          View on Facebook Marketplace
        </a>
        <div class="modal-share-wrap">
          <p class="modal-share-text">Know someone that may be interested in this item? Sharing is caring!</p>
          <a class="modal-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(p.fb_url || location.href)}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
            Share on Facebook
          </a>
        </div>
      </div>`;

    if (imgs.length > 1) {
      let cur = 0;
      const img = document.getElementById('modal-gallery-img');
      const dots = document.getElementById('gallery-dots');
      const counter = document.getElementById('gallery-counter');

      function go(idx) {
        cur = (idx + imgs.length) % imgs.length;
        img.src = imgs[cur];
        dots.querySelectorAll('.gallery-dot').forEach((d, i) => d.classList.toggle('active', i === cur));
        counter.textContent = `${cur + 1} / ${imgs.length}`;
      }

      document.getElementById('gallery-prev').addEventListener('click', e => { e.stopPropagation(); go(cur - 1); });
      document.getElementById('gallery-next').addEventListener('click', e => { e.stopPropagation(); go(cur + 1); });
      dots.querySelectorAll('.gallery-dot').forEach(d => {
        d.addEventListener('click', e => { e.stopPropagation(); go(parseInt(d.dataset.idx)); });
      });
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function stockInfo(stock) {
    if (stock <= 0)   return { badge: { cls: 'badge-out', label: 'Out of Stock' }, stockText: 'Currently unavailable', stockClass: 'out' };
    if (stock <= 5)   return { badge: { cls: 'badge-low', label: 'Low Stock' },  stockText: `Only ${stock} left`,        stockClass: 'low' };
    return               { badge: { cls: 'badge-in',  label: 'In Stock' },   stockText: `${stock} in stock`,           stockClass: '' };
  }

  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function boxIcon(size = 48) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" width="${size}" height="${size}">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>`;
  }

  function skeletonHTML(n) {
    return Array.from({ length: n }, () => `
      <div class="skeleton-card">
        <div class="skeleton-img skeleton-pulse"></div>
        <div class="skeleton-body">
          <div class="skeleton-line skeleton-pulse" style="width:38%"></div>
          <div class="skeleton-line skeleton-pulse lg" style="width:70%"></div>
          <div class="skeleton-line skeleton-pulse" style="width:90%"></div>
          <div class="skeleton-line skeleton-pulse sm" style="width:55%"></div>
        </div>
      </div>`).join('');
  }

  function observeCards() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const card = entry.target;
        card.classList.add('visible');
        observer.unobserve(card);
        card.addEventListener('transitionend', () => { card.style.transitionDelay = ''; }, { once: true });
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

    grid.querySelectorAll('.card').forEach((card, i) => {
      card.style.transitionDelay = `${Math.min(i * 0.05, 0.4).toFixed(2)}s`;
      observer.observe(card);
    });
  }

  function showLoading(show) {
    stateLoading.style.display = 'none';
    if (show) { showEmpty(false); grid.innerHTML = skeletonHTML(8); }
  }
  function showEmpty(show) {
    stateEmpty.style.display = show ? 'block' : 'none';
    if (show) grid.innerHTML = '';
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function bindEvents() {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      searchClear.classList.toggle('visible', !!searchQuery);
      currentPage = 1;
      renderProducts();
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.remove('visible');
      searchInput.focus();
      renderProducts();
    });

    modalClose.addEventListener('click', closeModal);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    });

    grid.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.card');
        if (card) { e.preventDefault(); card.click(); }
      }
    });
  }

  // ── Disclaimer modal ───────────────────────────────────────────────────────
  function initDisclaimer() {
    const overlay = document.getElementById('disc-overlay');
    if (!overlay) return;

    const KEY = 'disc_seen';
    if (sessionStorage.getItem(KEY)) return;

    function close() {
      overlay.classList.remove('open');
      sessionStorage.setItem(KEY, '1');
    }

    setTimeout(() => overlay.classList.add('open'), 500);

    document.getElementById('disc-close').addEventListener('click', close);
    document.getElementById('disc-cta').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
  }

  // ── Bookmark prompt ────────────────────────────────────────────────────────
  function initBookmarkPrompt() {
    const overlay = document.getElementById('bm-overlay');
    if (!overlay) return;

    const STORAGE_KEY = 'bm_dismissed_at';
    const SNOOZE_DAYS = 7;

    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) {
      const daysSince = (Date.now() - Number(dismissed)) / 86400000;
      if (daysSince < SNOOZE_DAYS) return;
    }

    function close() {
      overlay.classList.remove('open');
      localStorage.setItem(STORAGE_KEY, Date.now());
    }

    setTimeout(() => overlay.classList.add('open'), 3500);

    document.getElementById('bm-close').addEventListener('click', close);
    document.getElementById('bm-cta').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  init();
  initDisclaimer();
  initBookmarkPrompt();
})();
