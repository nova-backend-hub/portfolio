const state = {
  portfolio: null,
  activeFeaturedIdx: 0,
  filter: 'all',
  query: '',
  openRows: new Set(),
};

const els = {
  scrollLine: document.getElementById('scroll-line'),
  navName: document.getElementById('nav-name'),
  heroPfp: document.getElementById('hero-pfp'),
  heroName: document.getElementById('hero-name'),
  heroHandle: document.getElementById('hero-handle'),
  heroLocationStats: document.getElementById('hero-location-stats'),
  heroHeadline: document.getElementById('hero-headline'),
  heroSubhead: document.getElementById('hero-subhead'),
  heroBio: document.getElementById('hero-bio'),
  heroGithub: document.getElementById('hero-github-link'),
  inspectorBody: document.getElementById('inspector-body'),
  inspectorIndex: document.getElementById('inspector-index'),
  inspectorFormat: document.getElementById('inspector-format'),
  inspectorTitle: document.getElementById('inspector-title'),
  inspectorPlatform: document.getElementById('inspector-platform'),
  inspectorSize: document.getElementById('inspector-size'),
  inspectorTagline: document.getElementById('inspector-tagline'),
  inspectorStack: document.getElementById('inspector-stack'),
  inspectorDownload: document.getElementById('inspector-download'),
  inspectorDownloadLabel: document.getElementById('inspector-download-label'),
  inspectorRepo: document.getElementById('inspector-repo'),
  inspectorSwitcher: document.getElementById('inspector-switcher'),
  summaryCounters: document.getElementById('summary-counters'),
  selectedGrid: document.getElementById('selected-grid'),
  filterBar: document.getElementById('filter-bar'),
  filterGlider: document.getElementById('filter-glider'),
  archiveSearch: document.getElementById('archive-search'),
  archiveList: document.getElementById('archive-list'),
  certGrid: document.getElementById('cert-grid'),
  footerName: document.getElementById('footer-name'),
  footerEmail: document.getElementById('footer-email'),
  footerGithub: document.getElementById('footer-github'),
  certModal: document.getElementById('cert-modal'),
  certModalBackdrop: document.getElementById('cert-modal-backdrop'),
  certModalClose: document.getElementById('cert-modal-close'),
  modalCertIssuer: document.getElementById('modal-cert-issuer'),
  modalCertTitle: document.getElementById('modal-cert-title'),
  certModalBody: document.getElementById('cert-modal-body'),
  mobileMenuBtn: document.getElementById('mobile-menu-btn'),
  mobileDrawer: document.getElementById('mobile-drawer'),
  mobileDrawerBackdrop: document.getElementById('mobile-drawer-backdrop'),
  mobileMenuClose: document.getElementById('mobile-menu-close'),
  toast: document.getElementById('toast'),
};

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Source';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
export function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-shown'), 2600);
}

// Download SVG icon helper (16px, stroke 1.5)
const ICON_DOWNLOAD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>';
const ICON_CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function issuerSealSvg(issuer) {
  const norm = String(issuer || '').trim().toLowerCase();
  if (norm === 'ibm') {
    return '<svg width="42" height="18" viewBox="0 0 42 18" fill="none" aria-label="IBM"><g fill="currentColor"><rect x="0" y="1" width="10" height="2"/><rect x="0" y="5" width="10" height="2"/><rect x="3" y="9" width="4" height="2"/><rect x="0" y="13" width="10" height="2"/><rect x="13" y="1" width="11" height="2"/><rect x="14" y="5" width="9" height="2"/><rect x="14" y="9" width="9" height="2"/><rect x="13" y="13" width="11" height="2"/><rect x="27" y="1" width="15" height="2"/><rect x="27" y="5" width="15" height="2"/><rect x="29" y="9" width="11" height="2"/><rect x="29" y="13" width="11" height="2"/></g></svg>';
  }
  if (norm === 'google') {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-label="Google"><path d="M21.6 12.23c0-.7-.06-1.4-.19-2.07H12v3.92h5.39a4.61 4.61 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.37Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 22c2.7 0 4.96-.9 6.62-2.4l-3.23-2.5c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.58-4.12H3.08v2.58A10 10 0 0 0 12 22Z" stroke="currentColor" stroke-width="1.5"/><path d="M6.42 13.93a6.01 6.01 0 0 1 0-3.86V7.49H3.08a10 10 0 0 0 0 9.02l3.34-2.58Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.95 14.7 2 12 2a10 10 0 0 0-8.92 5.49l3.34 2.58C7.2 7.71 9.4 5.95 12 5.95Z" stroke="currentColor" stroke-width="1.5"/></svg>';
  }
  return `<span class="mono-meta">${escapeHtml(issuer)}</span>`;
}

// Halftone wave canvas (follows unslop/references/effects.md: 10fps, paused offscreen, DPR <= 2)
function initHalftoneCanvas() {
  const canvas = document.getElementById('halftone-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dots = [];
  let visible = true;
  let raf = 0;
  let last = 0;
  let step = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = [];
    const cell = 12;
    const cols = Math.ceil(rect.width / cell);
    const rows = Math.ceil(rect.height / cell);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({ x: x * cell + cell / 2, y: y * cell + cell / 2, nx: x / cols, ny: y / rows });
      }
    }
  }

  function draw(t) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const d of dots) {
      const wave = 0.5 + 0.5 * Math.sin(d.nx * 5.2 - t * 0.14 + Math.cos(d.ny * 3.1));
      const radius = 0.8 + wave * 2.2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = wave > 0.84 ? 'rgba(224, 79, 46, 0.72)' : 'rgba(239, 233, 222, 0.18)';
      ctx.fill();
    }
  }

  resize();
  draw(0);
  if (reduced) return;

  window.addEventListener('resize', () => { resize(); draw(step); }, { passive: true });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!visible || now - last < 100) return;
    last = now;
    draw(step++);
  };
  raf = requestAnimationFrame(loop);
}

// Smooth number tween for package size changes
function tweenSizeText(el, targetBytes) {
  if (!targetBytes || targetBytes <= 0) {
    el.textContent = 'Source';
    return;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    el.textContent = formatBytes(targetBytes);
    return;
  }
  const start = performance.now();
  const duration = 340;
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatBytes(Math.round(targetBytes * eased));
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatBytes(targetBytes);
  }
  requestAnimationFrame(tick);
}

function getFeaturedProjects() {
  const { profile, projects } = state.portfolio;
  const ids = Array.isArray(profile.featuredIds) ? profile.featuredIds : [];
  const chosen = ids.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
  if (chosen.length >= 5) return chosen.slice(0, 5);
  const rest = projects.filter((p) => !chosen.some((c) => c.id === p.id));
  return [...chosen, ...rest].slice(0, 5);
}

function renderInspector(animate = false) {
  const featured = getFeaturedProjects();
  if (!featured.length) return;
  if (state.activeFeaturedIdx >= featured.length) state.activeFeaturedIdx = 0;
  const p = featured[state.activeFeaturedIdx];

  const applyContent = () => {
    els.inspectorIndex.textContent = `Release 0${state.activeFeaturedIdx + 1} / 0${featured.length}`;
    els.inspectorFormat.textContent = p.downloadType || 'BUILD';
    els.inspectorFormat.setAttribute('data-type', p.downloadType || '');
    els.inspectorTitle.textContent = p.title;
    els.inspectorPlatform.textContent = `${p.platform} • ${p.year || '2026'}`;
    tweenSizeText(els.inspectorSize, p.fileSizeBytes);
    els.inspectorTagline.textContent = p.tagline;
    els.inspectorStack.innerHTML = (p.stack || []).slice(0, 4).map((s) => `<span class="stack-chip">${escapeHtml(s)}</span>`).join('');

    const dlUrl = p.downloadUrl || p.githubReleaseUrl || p.repoUrl || '#';
    const fileLabel = dlUrl.includes('/') ? dlUrl.split('/').pop() : p.title;
    els.inspectorDownload.href = dlUrl;
    if (p.downloadUrl) {
      els.inspectorDownload.setAttribute('download', '');
      els.inspectorDownloadLabel.textContent = `Download ${fileLabel}`;
    } else {
      els.inspectorDownload.removeAttribute('download');
      els.inspectorDownloadLabel.textContent = 'Open repository';
    }

    if (p.repoUrl) {
      els.inspectorRepo.href = p.repoUrl;
      els.inspectorRepo.classList.remove('hidden');
    } else {
      els.inspectorRepo.classList.add('hidden');
    }

    els.inspectorSwitcher.innerHTML = featured.map((item, idx) => `
      <button type="button" class="switch-btn ${idx === state.activeFeaturedIdx ? 'active' : ''}" data-switch-idx="${idx}" role="tab" aria-selected="${idx === state.activeFeaturedIdx}" title="${escapeHtml(item.title)}">
        0${idx + 1}
      </button>
    `).join('');
  };

  if (!animate) {
    applyContent();
    return;
  }
  els.inspectorBody.classList.add('is-swapping');
  setTimeout(() => {
    applyContent();
    requestAnimationFrame(() => els.inspectorBody.classList.remove('is-swapping'));
  }, 150);
}

function renderProfile() {
  const { profile, stats } = state.portfolio;
  els.navName.textContent = profile.name;
  els.heroName.textContent = profile.name;
  els.heroHandle.textContent = profile.handle;
  els.heroLocationStats.textContent = `${profile.location} — ${stats.totalProjects} projects, ${stats.directBinaries} direct binaries`;
  els.heroHeadline.textContent = profile.headline;
  els.heroSubhead.textContent = profile.subhead;
  els.heroBio.textContent = profile.bio;
  els.heroPfp.src = profile.pfp || 'https://avatars.githubusercontent.com/u/269911050?v=4';
  els.heroPfp.alt = `${profile.name} profile portrait`;
  els.heroGithub.href = profile.github || 'https://github.com/nova-backend-hub';

  els.footerName.textContent = profile.name;
  els.footerEmail.textContent = profile.email;
  els.footerGithub.href = profile.github || 'https://github.com/nova-backend-hub';

  els.summaryCounters.innerHTML = `
    <span>${stats.totalProjects} projects</span>
    <span>${stats.ipaCount} IPA</span>
    <span>${stats.apkCount} APK</span>
    <span>${stats.exeCount} EXE</span>
  `;
}

function renderSelected() {
  const featured = getFeaturedProjects();
  const spans = ['span-8', 'span-4', 'span-5', 'span-4', 'span-3'];
  els.selectedGrid.innerHTML = featured.map((p, idx) => {
    const dl = p.downloadUrl || p.githubReleaseUrl || '';
    const size = formatBytes(p.fileSizeBytes);
    return `
      <article class="feature-card ${spans[idx] || 'span-4'} reveal-item" style="transition-delay:${Math.min(idx, 5) * 45}ms">
        <div>
          <div class="feature-top">
            <span class="mono-meta">${escapeHtml(p.platform)}</span>
            <span class="format-tag" data-type="${escapeHtml(p.downloadType)}">${escapeHtml(p.downloadType)} ${size !== 'Source' ? `• ${escapeHtml(size)}` : ''}</span>
          </div>
          <h3 class="feature-title">${escapeHtml(p.title)}</h3>
          <p class="feature-desc">${escapeHtml(idx === 0 ? p.description : p.tagline)}</p>
        </div>
        <div class="feature-footer">
          <span class="mono-meta">${escapeHtml((p.stack || []).slice(0, 3).join(' / '))}</span>
          <div class="feature-links">
            ${dl ? `<a class="btn btn-accent btn-sm" href="${escapeHtml(dl)}" download>${ICON_DOWNLOAD}<span>Download</span></a>` : ''}
            ${p.repoUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(p.repoUrl)}" target="_blank" rel="noreferrer">Repo ${ICON_ARROW}</a>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderArchive() {
  const q = state.query.trim().toLowerCase();
  const filtered = state.portfolio.projects.filter((p) => {
    const matchesCat = state.filter === 'all' || p.category === state.filter;
    if (!matchesCat) return false;
    if (!q) return true;
    const hay = `${p.title} ${p.tagline} ${p.description} ${p.platform} ${(p.stack || []).join(' ')} ${p.downloadType}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    els.archiveList.innerHTML = '<div style="padding:24px" class="mono-meta">No projects match the current filter.</div>';
    return;
  }

  els.archiveList.innerHTML = filtered.map((p, idx) => {
    const isOpen = state.openRows.has(p.id);
    const num = String(idx + 1).padStart(2, '0');
    const size = formatBytes(p.fileSizeBytes);
    const dl = p.downloadUrl || '';
    const ghDl = p.githubReleaseUrl && p.githubReleaseUrl !== p.downloadUrl ? p.githubReleaseUrl : '';
    return `
      <div class="ledger-row ${isOpen ? 'is-open' : ''}" data-row-id="${escapeHtml(p.id)}">
        <div class="ledger-summary" role="button" tabindex="0" aria-expanded="${isOpen}">
          <span class="ledger-idx mono-num">${num}</span>
          <div class="ledger-main">
            <h3 class="ledger-title">${escapeHtml(p.title)}</h3>
            <p class="ledger-tagline">${escapeHtml(p.tagline)}</p>
          </div>
          <span class="ledger-platform">${escapeHtml(p.platform)}</span>
          <span class="ledger-size mono-num">${escapeHtml(size)}</span>
          <div class="ledger-actions">
            ${dl
              ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(dl)}" download>${ICON_DOWNLOAD}<span>${escapeHtml(p.downloadType)}</span></a>`
              : p.repoUrl
                ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(p.repoUrl)}" target="_blank" rel="noreferrer"><span>Repo</span>${ICON_ARROW}</a>`
                : '<span class="mono-meta">Local build</span>'}
          </div>
          <span class="ledger-chevron">${ICON_CHEVRON}</span>
        </div>
        <div class="ledger-expand">
          <div class="ledger-expand-inner">
            <div class="ledger-detail">
              <p class="ledger-desc">${escapeHtml(p.description)}</p>
              <div class="ledger-meta-row">
                <div class="inspector-stack">
                  ${(p.stack || []).map((s) => `<span class="stack-chip">${escapeHtml(s)}</span>`).join('')}
                </div>
                <div class="feature-links">
                  ${dl ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(dl)}" download>${ICON_DOWNLOAD}<span>Direct download (${escapeHtml(size)})</span></a>` : ''}
                  ${ghDl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(ghDl)}" target="_blank" rel="noreferrer">GitHub Release ${ICON_ARROW}</a>` : ''}
                  ${p.repoUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(p.repoUrl)}" target="_blank" rel="noreferrer">Source repo ${ICON_ARROW}</a>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCertificates() {
  const certs = state.portfolio.certificates || [];
  els.certGrid.innerHTML = certs.map((c, idx) => `
    <article class="cert-card reveal-item" style="transition-delay:${Math.min(idx, 5) * 45}ms">
      <div>
        <div class="cert-top">
          <div class="cert-seal">
            <div class="cert-issuer-mark">${issuerSealSvg(c.issuer)}</div>
            <div>
              <div class="mono-meta">${escapeHtml(c.issuer)} • ${escapeHtml(c.date)}</div>
              <div class="mono-meta">${escapeHtml(c.category)}</div>
            </div>
          </div>
          <span class="format-tag">${escapeHtml(c.credentialId || 'VERIFIED')}</span>
        </div>
        <h3 class="cert-title" style="margin-top:20px">${escapeHtml(c.title)}</h3>
        <p class="cert-summary">${escapeHtml(c.summary)}</p>
        ${c.imageUrl ? `<div class="cert-thumb" style="margin-top:16px"><img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.title)}" loading="lazy" /></div>` : ''}
      </div>
      <div class="cert-footer">
        <span class="mono-meta">${c.imageUrl ? 'Certificate attachment attached' : 'Archival credential record'}</span>
        <div class="feature-links">
          <button type="button" class="btn btn-secondary btn-sm" data-inspect-cert="${escapeHtml(c.id)}">Inspect</button>
          ${c.verifyUrl ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(c.verifyUrl)}" target="_blank" rel="noreferrer">Verify ${ICON_ARROW}</a>` : ''}
        </div>
      </div>
    </article>
  `).join('');
}

function updateFilterGlider() {
  const active = els.filterBar.querySelector('.filter-tab.active');
  if (!active || !els.filterGlider) return;
  const barRect = els.filterBar.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  const x = btnRect.left - barRect.left + els.filterBar.scrollLeft;
  els.filterGlider.style.width = `${btnRect.width}px`;
  els.filterGlider.style.transform = `translate3d(${x}px, 0, 0)`;
}

function observeReveals() {
  const nodes = document.querySelectorAll('.mask-reveal, .reveal-item');
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
  nodes.forEach((n) => io.observe(n));
}

function openCertModal(certId) {
  const cert = (state.portfolio.certificates || []).find((c) => c.id === certId);
  if (!cert) return;
  els.modalCertIssuer.textContent = `${cert.issuer} • ${cert.date} • ${cert.credentialId}`;
  els.modalCertTitle.textContent = cert.title;
  els.certModalBody.innerHTML = `
    <div class="cert-plaque">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="cert-issuer-mark">${issuerSealSvg(cert.issuer)}</div>
        <span class="mono-meta">${escapeHtml(cert.category)}</span>
      </div>
      <p style="margin:0;font-size:15px;color:var(--ink-2)">${escapeHtml(cert.summary)}</p>
      <div class="mono-meta">Awarded to: ${escapeHtml(state.portfolio.profile.name)} (${escapeHtml(state.portfolio.profile.handle)})</div>
      ${cert.imageUrl
        ? (cert.imageUrl.toLowerCase().endsWith('.pdf')
            ? `<a class="btn btn-primary" href="${escapeHtml(cert.imageUrl)}" target="_blank" rel="noreferrer">Open attached certificate PDF ${ICON_ARROW}</a>`
            : `<img src="${escapeHtml(cert.imageUrl)}" alt="${escapeHtml(cert.title)}" style="border-radius:8px;border:1px solid var(--hairline)" />`)
        : ''}
      ${cert.verifyUrl ? `<a class="btn btn-primary" href="${escapeHtml(cert.verifyUrl)}" target="_blank" rel="noreferrer">Verify external credential ${ICON_ARROW}</a>` : ''}
    </div>
  `;
  els.certModal.classList.add('is-open');
  els.certModal.setAttribute('aria-hidden', 'false');
}

function closeCertModal() {
  els.certModal.classList.remove('is-open');
  els.certModal.setAttribute('aria-hidden', 'true');
}

function toggleMobileDrawer(open) {
  els.mobileDrawer.classList.toggle('is-open', open);
  els.mobileDrawer.setAttribute('aria-hidden', String(!open));
  els.mobileMenuBtn.setAttribute('aria-expanded', String(open));
}

export async function refreshPortfolio() {
  const res = await fetch('/api/portfolio');
  state.portfolio = await res.json();
  renderProfile();
  renderInspector(false);
  renderSelected();
  renderArchive();
  renderCertificates();
  observeReveals();
  requestAnimationFrame(updateFilterGlider);
  return state.portfolio;
}

window.addEventListener('portfolio:updated', () => {
  refreshPortfolio();
});

// Events
els.inspectorSwitcher.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-switch-idx]');
  if (!btn) return;
  const nextIdx = Number(btn.dataset.switchIdx);
  if (nextIdx === state.activeFeaturedIdx) return;
  state.activeFeaturedIdx = nextIdx;
  renderInspector(true);
});

els.filterBar.addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  els.filterBar.querySelectorAll('.filter-tab').forEach((t) => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  tab.classList.add('active');
  tab.setAttribute('aria-selected', 'true');
  state.filter = tab.dataset.filter;
  updateFilterGlider();
  renderArchive();
});

els.archiveSearch.addEventListener('input', (e) => {
  state.query = e.target.value;
  renderArchive();
});

els.archiveList.addEventListener('click', (e) => {
  if (e.target.closest('a, button')) return;
  const summary = e.target.closest('.ledger-summary');
  if (!summary) return;
  const row = summary.closest('.ledger-row');
  const id = row.dataset.rowId;
  if (state.openRows.has(id)) state.openRows.delete(id);
  else state.openRows.add(id);
  row.classList.toggle('is-open');
  summary.setAttribute('aria-expanded', String(state.openRows.has(id)));
});

els.archiveList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const summary = e.target.closest('.ledger-summary');
  if (!summary) return;
  e.preventDefault();
  summary.click();
});

els.certGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-inspect-cert]');
  if (btn) openCertModal(btn.dataset.inspectCert);
});

els.certModalBackdrop.addEventListener('click', closeCertModal);
els.certModalClose.addEventListener('click', closeCertModal);

els.mobileMenuBtn.addEventListener('click', () => toggleMobileDrawer(true));
els.mobileMenuClose.addEventListener('click', () => toggleMobileDrawer(false));
els.mobileDrawerBackdrop.addEventListener('click', () => toggleMobileDrawer(false));
els.mobileDrawer.addEventListener('click', (e) => {
  if (e.target.closest('a')) toggleMobileDrawer(false);
});

// Scroll line GPU progress
let scrollTicking = false;
window.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const p = docH > 0 ? Math.min(1, Math.max(0, window.scrollY / docH)) : 0;
    els.scrollLine.style.transform = `scaleX(${p})`;
    scrollTicking = false;
  });
}, { passive: true });

window.addEventListener('resize', () => requestAnimationFrame(updateFilterGlider), { passive: true });

// Boot
initHalftoneCanvas();
refreshPortfolio().catch(() => showToast('Failed to load portfolio data'));

