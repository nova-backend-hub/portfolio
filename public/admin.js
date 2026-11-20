import { escapeHtml, formatBytes, showToast } from '/app.js';

const adminState = {
  authenticated: false,
  isDefaultPassword: true,
  tab: 'profile',
  editingProjectId: null,
  editingCertId: null,
  data: null,
};

const overlay = document.getElementById('admin-overlay');
const backdrop = document.getElementById('admin-backdrop');
const closeBtn = document.getElementById('admin-close-btn');
const logoutBtn = document.getElementById('admin-logout-btn');
const adminBody = document.getElementById('admin-body');

async function apiJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

async function openAdmin() {
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  await checkAuthAndRender();
}

function closeAdmin() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function checkAuthAndRender() {
  const auth = await apiJson('/api/auth/me');
  adminState.authenticated = auth.authenticated;
  adminState.isDefaultPassword = auth.isDefaultPassword;
  logoutBtn.classList.toggle('hidden', !auth.authenticated);
  if (auth.authenticated) {
    adminState.data = await apiJson('/api/portfolio');
  }
  renderAdmin();
}

function notifyUpdated(msg) {
  showToast(msg);
  window.dispatchEvent(new CustomEvent('portfolio:updated'));
}

function renderAdmin() {
  if (!adminState.authenticated) {
    adminBody.innerHTML = `
      <form id="admin-login-form" style="display:flex;flex-direction:column;gap:16px">
        <p class="mono-meta" style="margin:0">Sign in to edit your profile portrait, name, bio, downloads, and certificates.</p>
        ${adminState.isDefaultPassword ? '<div class="admin-row"><span class="mono-meta">Default password: <strong style="color:var(--ink)">admin1234</strong></span></div>' : ''}
        <div class="field">
          <label for="admin-pass-input">Password</label>
          <input type="password" id="admin-pass-input" required placeholder="Enter admin password" autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Sign in to Admin Studio</button>
      </form>
    `;
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('admin-pass-input').value;
      try {
        await apiJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
        await checkAuthAndRender();
        showToast('Signed in');
      } catch (err) {
        showToast(err.message);
      }
    });
    return;
  }

  const tabsHtml = `
    <div class="admin-tabs">
      <button type="button" class="admin-tab ${adminState.tab === 'profile' ? 'active' : ''}" data-atab="profile">Profile</button>
      <button type="button" class="admin-tab ${adminState.tab === 'projects' ? 'active' : ''}" data-atab="projects">Projects</button>
      <button type="button" class="admin-tab ${adminState.tab === 'certs' ? 'active' : ''}" data-atab="certs">Certificates</button>
      <button type="button" class="admin-tab ${adminState.tab === 'security' ? 'active' : ''}" data-atab="security">Security</button>
    </div>
  `;

  let panelHtml = '';
  if (adminState.tab === 'profile') panelHtml = renderProfileTab();
  else if (adminState.tab === 'projects') panelHtml = renderProjectsTab();
  else if (adminState.tab === 'certs') panelHtml = renderCertsTab();
  else panelHtml = renderSecurityTab();

  adminBody.innerHTML = tabsHtml + panelHtml;
  bindAdminHandlers();
}

function renderProfileTab() {
  const p = adminState.data.profile;
  return `
    <div class="upload-zone">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="${escapeHtml(p.pfp)}" alt="Current avatar" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid var(--hairline)" />
        <div>
          <strong style="font-size:14px;display:block">Profile photo</strong>
          <span class="mono-meta">PNG, JPG, WebP up to 10 MB</span>
        </div>
      </div>
      <input type="file" id="pfp-file-input" accept=".png,.jpg,.jpeg,.webp" />
    </div>

    <form id="profile-form" style="display:flex;flex-direction:column;gap:12px">
      <div class="field-grid">
        <div class="field"><label>Display name</label><input name="name" value="${escapeHtml(p.name)}" required /></div>
        <div class="field"><label>Handle</label><input name="handle" value="${escapeHtml(p.handle)}" /></div>
      </div>
      <div class="field-grid">
        <div class="field"><label>Location</label><input name="location" value="${escapeHtml(p.location)}" /></div>
        <div class="field"><label>Email</label><input name="email" value="${escapeHtml(p.email)}" /></div>
      </div>
      <div class="field"><label>GitHub URL</label><input name="github" value="${escapeHtml(p.github)}" /></div>
      <div class="field"><label>Avatar URL</label><input name="pfp" id="profile-pfp-url" value="${escapeHtml(p.pfp)}" /></div>
      <div class="field"><label>Hero headline</label><input name="headline" value="${escapeHtml(p.headline)}" required /></div>
      <div class="field"><label>Hero subhead</label><textarea name="subhead" rows="2">${escapeHtml(p.subhead)}</textarea></div>
      <div class="field"><label>Bio</label><textarea name="bio" rows="3">${escapeHtml(p.bio)}</textarea></div>
      <button type="submit" class="btn btn-primary btn-block">Save profile</button>
    </form>
  `;
}

function renderProjectsTab() {
  const projects = adminState.data.projects || [];
  const editing = adminState.editingProjectId === '__new__'
    ? { id: '', title: '', tagline: '', description: '', category: 'ios', platform: 'iOS', stack: [], year: '2026', featured: false, repoUrl: '', downloadUrl: '', githubReleaseUrl: '', downloadType: 'IPA', fileSizeBytes: 0 }
    : projects.find((p) => p.id === adminState.editingProjectId);

  if (editing) {
    const isNew = adminState.editingProjectId === '__new__';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:15px">${isNew ? 'New project & binary' : `Edit: ${escapeHtml(editing.title)}`}</strong>
        <button type="button" class="btn btn-secondary btn-sm" id="proj-back-btn">Back to list</button>
      </div>

      <div class="upload-zone">
        <div>
          <strong style="font-size:14px;display:block">Upload build binary</strong>
          <span class="mono-meta">.exe, .ipa, .apk, .zip up to 250 MB</span>
        </div>
        <input type="file" id="binary-file-input" accept=".exe,.ipa,.apk,.zip,.dmg" />
      </div>

      <form id="project-form" style="display:flex;flex-direction:column;gap:12px">
        <div class="field-grid">
          <div class="field"><label>Title</label><input name="title" value="${escapeHtml(editing.title)}" required /></div>
          <div class="field"><label>Year</label><input name="year" value="${escapeHtml(editing.year || '2026')}" /></div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Category</label>
            <select name="category">
              <option value="ios" ${editing.category === 'ios' ? 'selected' : ''}>iOS</option>
              <option value="android" ${editing.category === 'android' ? 'selected' : ''}>Android / TV</option>
              <option value="windows" ${editing.category === 'windows' ? 'selected' : ''}>Windows</option>
              <option value="macos-efi" ${editing.category === 'macos-efi' ? 'selected' : ''}>macOS / EFI</option>
              <option value="ai-web" ${editing.category === 'ai-web' ? 'selected' : ''}>AI &amp; Web</option>
            </select>
          </div>
          <div class="field"><label>Platform label</label><input name="platform" value="${escapeHtml(editing.platform)}" /></div>
        </div>
        <div class="field"><label>Tagline</label><input name="tagline" value="${escapeHtml(editing.tagline)}" /></div>
        <div class="field"><label>Description</label><textarea name="description" rows="3">${escapeHtml(editing.description)}</textarea></div>
        <div class="field"><label>Tech stack (comma-separated)</label><input name="stack" value="${escapeHtml((editing.stack || []).join(', '))}" /></div>
        <div class="field-grid">
          <div class="field"><label>Download URL</label><input name="downloadUrl" id="proj-dl-url" value="${escapeHtml(editing.downloadUrl || '')}" /></div>
          <div class="field"><label>Type (EXE / IPA / APK / REPO)</label><input name="downloadType" id="proj-dl-type" value="${escapeHtml(editing.downloadType || '')}" /></div>
        </div>
        <div class="field-grid">
          <div class="field"><label>File size (bytes)</label><input type="number" name="fileSizeBytes" id="proj-dl-size" value="${Number(editing.fileSizeBytes) || 0}" /></div>
          <div class="field"><label>Source Repo URL</label><input name="repoUrl" value="${escapeHtml(editing.repoUrl || '')}" /></div>
        </div>
        <div class="field"><label>GitHub Release Asset URL (optional)</label><input name="githubReleaseUrl" value="${escapeHtml(editing.githubReleaseUrl || '')}" /></div>
        <button type="submit" class="btn btn-primary btn-block">${isNew ? 'Create project' : 'Save project'}</button>
      </form>
    `;
  }

  return `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="mono-meta">${projects.length} total projects</span>
      <button type="button" class="btn btn-primary btn-sm" id="proj-new-btn">+ Add project</button>
    </div>
    <div class="admin-list">
      ${projects.map((p) => `
        <div class="admin-row">
          <div class="admin-row-info">
            <strong>${escapeHtml(p.title)}</strong>
            <span class="mono-meta">${escapeHtml(p.platform)} • ${escapeHtml(p.downloadType)} ${p.fileSizeBytes ? `• ${escapeHtml(formatBytes(p.fileSizeBytes))}` : ''}</span>
          </div>
          <div class="admin-row-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-proj="${escapeHtml(p.id)}">Edit</button>
            <button type="button" class="btn btn-secondary btn-sm" data-del-proj="${escapeHtml(p.id)}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCertsTab() {
  const certs = adminState.data.certificates || [];
  const editing = adminState.editingCertId === '__new__'
    ? { id: '', issuer: '', title: '', category: 'AI Certification', date: '2026', credentialId: '', verifyUrl: '', imageUrl: '', summary: '' }
    : certs.find((c) => c.id === adminState.editingCertId);

  if (editing) {
    const isNew = adminState.editingCertId === '__new__';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:15px">${isNew ? 'Add certificate' : `Edit: ${escapeHtml(editing.title)}`}</strong>
        <button type="button" class="btn btn-secondary btn-sm" id="cert-back-btn">Back to certificates</button>
      </div>

      <div class="upload-zone">
        <div>
          <strong style="font-size:14px;display:block">Upload certificate image or PDF</strong>
          <span class="mono-meta">PNG, JPG, WebP, PDF up to 15 MB</span>
        </div>
        <input type="file" id="cert-file-input" accept=".png,.jpg,.jpeg,.webp,.pdf" />
      </div>

      <form id="cert-form" style="display:flex;flex-direction:column;gap:12px">
        <div class="field-grid">
          <div class="field"><label>Issuer (e.g. IBM, Google)</label><input name="issuer" value="${escapeHtml(editing.issuer)}" required /></div>
          <div class="field"><label>Year / Date</label><input name="date" value="${escapeHtml(editing.date)}" /></div>
        </div>
        <div class="field"><label>Certificate title</label><input name="title" value="${escapeHtml(editing.title)}" required /></div>
        <div class="field-grid">
          <div class="field"><label>Category</label><input name="category" value="${escapeHtml(editing.category)}" /></div>
          <div class="field"><label>Credential ID</label><input name="credentialId" value="${escapeHtml(editing.credentialId)}" /></div>
        </div>
        <div class="field"><label>Verification URL</label><input name="verifyUrl" value="${escapeHtml(editing.verifyUrl || '')}" /></div>
        <div class="field"><label>Image / PDF URL</label><input name="imageUrl" id="cert-img-url" value="${escapeHtml(editing.imageUrl || '')}" /></div>
        <div class="field"><label>Summary</label><textarea name="summary" rows="3">${escapeHtml(editing.summary)}</textarea></div>
        <button type="submit" class="btn btn-primary btn-block">${isNew ? 'Add certificate' : 'Save certificate'}</button>
      </form>
    `;
  }

  return `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="mono-meta">${certs.length} certificates</span>
      <button type="button" class="btn btn-primary btn-sm" id="cert-new-btn">+ Add certificate</button>
    </div>
    <div class="admin-list">
      ${certs.map((c) => `
        <div class="admin-row">
          <div class="admin-row-info">
            <strong>${escapeHtml(c.issuer)} — ${escapeHtml(c.title)}</strong>
            <span class="mono-meta">${escapeHtml(c.credentialId)} • ${escapeHtml(c.date)}</span>
          </div>
          <div class="admin-row-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-cert="${escapeHtml(c.id)}">Edit</button>
            <button type="button" class="btn btn-secondary btn-sm" data-del-cert="${escapeHtml(c.id)}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSecurityTab() {
  return `
    <form id="password-form" style="display:flex;flex-direction:column;gap:12px">
      <p class="mono-meta" style="margin:0">Update the Admin Studio password stored in <code>data/auth.json</code>.</p>
      <div class="field">
        <label>New password</label>
        <input type="password" name="newPassword" minlength="8" required placeholder="At least 8 characters" />
      </div>
      <button type="submit" class="btn btn-primary btn-block">Update password</button>
    </form>
  `;
}

function bindAdminHandlers() {
  adminBody.querySelectorAll('[data-atab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminState.tab = btn.dataset.atab;
      adminState.editingProjectId = null;
      adminState.editingCertId = null;
      renderAdmin();
    });
  });

  // Profile handlers
  const pfpInput = document.getElementById('pfp-file-input');
  if (pfpInput) {
    pfpInput.addEventListener('change', async () => {
      if (!pfpInput.files[0]) return;
      const fd = new FormData();
      fd.append('file', pfpInput.files[0]);
      try {
        const res = await apiJson('/api/upload/pfp', { method: 'POST', body: fd });
        adminState.data.profile = res.profile;
        renderAdmin();
        notifyUpdated('Profile photo updated');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(profileForm).entries());
      try {
        const res = await apiJson('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
        adminState.data.profile = res.profile;
        notifyUpdated('Profile saved');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  // Projects handlers
  document.getElementById('proj-new-btn')?.addEventListener('click', () => {
    adminState.editingProjectId = '__new__';
    renderAdmin();
  });
  document.getElementById('proj-back-btn')?.addEventListener('click', () => {
    adminState.editingProjectId = null;
    renderAdmin();
  });
  adminBody.querySelectorAll('[data-edit-proj]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminState.editingProjectId = btn.dataset.editProj;
      renderAdmin();
    });
  });
  adminBody.querySelectorAll('[data-del-proj]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiJson(`/api/projects/${encodeURIComponent(btn.dataset.delProj)}`, { method: 'DELETE' });
        adminState.data = await apiJson('/api/portfolio');
        renderAdmin();
        notifyUpdated('Project deleted');
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  const binInput = document.getElementById('binary-file-input');
  if (binInput) {
    binInput.addEventListener('change', async () => {
      if (!binInput.files[0]) return;
      const fd = new FormData();
      fd.append('file', binInput.files[0]);
      try {
        showToast('Uploading binary...');
        const res = await apiJson('/api/upload/binary', { method: 'POST', body: fd });
        document.getElementById('proj-dl-url').value = res.downloadUrl;
        document.getElementById('proj-dl-type').value = res.downloadType;
        document.getElementById('proj-dl-size').value = res.fileSizeBytes;
        showToast(`Uploaded ${res.filename}`);
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  const projectForm = document.getElementById('project-form');
  if (projectForm) {
    projectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(projectForm).entries());
      const isNew = adminState.editingProjectId === '__new__';
      try {
        if (isNew) {
          await apiJson('/api/projects', { method: 'POST', body: JSON.stringify(body) });
        } else {
          await apiJson(`/api/projects/${encodeURIComponent(adminState.editingProjectId)}`, { method: 'PUT', body: JSON.stringify(body) });
        }
        adminState.data = await apiJson('/api/portfolio');
        adminState.editingProjectId = null;
        renderAdmin();
        notifyUpdated(isNew ? 'Project created' : 'Project updated');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  // Certificates handlers
  document.getElementById('cert-new-btn')?.addEventListener('click', () => {
    adminState.editingCertId = '__new__';
    renderAdmin();
  });
  document.getElementById('cert-back-btn')?.addEventListener('click', () => {
    adminState.editingCertId = null;
    renderAdmin();
  });
  adminBody.querySelectorAll('[data-edit-cert]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminState.editingCertId = btn.dataset.editCert;
      renderAdmin();
    });
  });
  adminBody.querySelectorAll('[data-del-cert]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiJson(`/api/certificates/${encodeURIComponent(btn.dataset.delCert)}`, { method: 'DELETE' });
        adminState.data = await apiJson('/api/portfolio');
        renderAdmin();
        notifyUpdated('Certificate removed');
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  const certFileInput = document.getElementById('cert-file-input');
  if (certFileInput) {
    certFileInput.addEventListener('change', async () => {
      if (!certFileInput.files[0]) return;
      const fd = new FormData();
      fd.append('file', certFileInput.files[0]);
      try {
        const res = await apiJson('/api/upload/cert', { method: 'POST', body: fd });
        document.getElementById('cert-img-url').value = res.url;
        showToast('Certificate file uploaded');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  const certForm = document.getElementById('cert-form');
  if (certForm) {
    certForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(certForm).entries());
      const isNew = adminState.editingCertId === '__new__';
      try {
        if (isNew) {
          await apiJson('/api/certificates', { method: 'POST', body: JSON.stringify(body) });
        } else {
          await apiJson(`/api/certificates/${encodeURIComponent(adminState.editingCertId)}`, { method: 'PUT', body: JSON.stringify(body) });
        }
        adminState.data = await apiJson('/api/portfolio');
        adminState.editingCertId = null;
        renderAdmin();
        notifyUpdated(isNew ? 'Certificate added' : 'Certificate saved');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  // Password handler
  const passForm = document.getElementById('password-form');
  if (passForm) {
    passForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(passForm).entries());
      try {
        await apiJson('/api/auth/password', { method: 'POST', body: JSON.stringify(body) });
        adminState.isDefaultPassword = false;
        passForm.reset();
        showToast('Password updated');
      } catch (err) {
        showToast(err.message);
      }
    });
  }
}

// Drawer open/close wiring
document.getElementById('open-admin-btn')?.addEventListener('click', openAdmin);
document.getElementById('footer-admin-btn')?.addEventListener('click', openAdmin);
document.getElementById('mobile-admin-btn')?.addEventListener('click', () => {
  document.getElementById('mobile-drawer')?.classList.remove('is-open');
  openAdmin();
});
backdrop.addEventListener('click', closeAdmin);
closeBtn.addEventListener('click', closeAdmin);

logoutBtn.addEventListener('click', async () => {
  await apiJson('/api/auth/logout', { method: 'POST' });
  adminState.authenticated = false;
  logoutBtn.classList.add('hidden');
  renderAdmin();
  showToast('Signed out');
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    if (overlay.classList.contains('is-open')) closeAdmin();
    else openAdmin();
  } else if (e.key === 'Escape') {
    if (overlay.classList.contains('is-open')) closeAdmin();
    const certModal = document.getElementById('cert-modal');
    if (certModal?.classList.contains('is-open')) {
      certModal.classList.remove('is-open');
      certModal.setAttribute('aria-hidden', 'true');
    }
  }
});

