/* border-patrol.js — Force page logic, refugee form, NGO assignment, camp mini-map */

const FORCE_NAME = document.querySelector('meta[name="dbms-force"]')?.content || 'BSF';

// ── Watchlist Check ───────────────────────────────────────────
let _watchlistTimeout = null;

function setupWatchlistCheck() {
  const passportInput = document.getElementById('f-passport');
  const nameInput     = document.getElementById('f-name');
  if (!passportInput && !nameInput) return;

  const check = async () => {
    const passport = passportInput?.value.trim();
    const name     = nameInput?.value.trim();
    if (!passport && !name) return;
    const res = await apiFetch('/api/border-patrol/watchlist-check', {
      method: 'POST',
      body: JSON.stringify({ passport_no: passport, name })
    });
    if (!res.success) return;
    const alertEl  = document.getElementById('watchlist-alert');
    const clearEl  = document.getElementById('watchlist-clear');
    if (res.data.is_blacklist) {
      if (alertEl) {
        alertEl.classList.add('visible');
        document.getElementById('wl-name').textContent   = res.data.matched_name;
        document.getElementById('wl-reason').textContent = res.data.blacklist_reason;
      }
      if (clearEl) clearEl.style.display = 'none';
    } else {
      if (alertEl) alertEl.classList.remove('visible');
      if (clearEl) clearEl.style.display = 'flex';
    }
  };

  [passportInput, nameInput].filter(Boolean).forEach(el => {
    el.addEventListener('blur', () => {
      clearTimeout(_watchlistTimeout);
      _watchlistTimeout = setTimeout(check, 300);
    });
  });
}

// ── NGO Cards ─────────────────────────────────────────────────
let _selectedNGO = null;

async function loadNGOCards() {
  const container = document.getElementById('ngo-cards-container');
  if (!container) return;
  try {
    const res = await fetch(`/api/ngo/list-by-force?force=${encodeURIComponent(FORCE_NAME)}`);
    const json = await res.json();
    if (!json.success) throw new Error('NGO load failed');
    const all  = { [FORCE_NAME]: json.data };
    const ngos = all[FORCE_NAME] || [];
    container.innerHTML = ngos.map(n => `
      <div class="ngo-card" id="ngo-${n.id}" data-ngo-id="${n.id}" data-ngo-name="${n.name}" onclick="selectNGO('${n.id}','${n.name.replace(/'/g,"\\'")}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span class="ngo-card-title">${n.name}</span>
          <span class="badge badge-${n.type === 'National' ? 'national' : 'regional'}">${n.type}</span>
        </div>
        <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:8px">${n.description}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${n.specializations.map(s => `<span class="tag-pill">${s}</span>`).join('')}</div>
        <div style="font-size:11px;color:var(--color-text-muted)">${n.contact} — Load: ${n.current_load} cases</div>
      </div>`).join('');
  } catch {
    if (container) container.innerHTML = '<p class="text-muted">NGO data unavailable</p>';
  }
}

function selectNGO(id, name) {
  document.querySelectorAll('.ngo-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`ngo-${id}`);
  if (card) card.classList.add('selected');
  _selectedNGO = { id, name };
  document.getElementById('f-ngo-selected').value = name;
  document.getElementById('f-ngo-id').value = id;
}

// ── Character counter ─────────────────────────────────────────
function setupCharCounter() {
  const textarea = document.getElementById('f-ngo-message');
  const counter  = document.getElementById('ngo-msg-count');
  if (!textarea || !counter) return;
  textarea.addEventListener('input', () => {
    const n = textarea.value.length;
    counter.textContent = `${n} / 50 minimum`;
    counter.classList.toggle('min-met', n >= 50);
  });
}

// ── Submit registration ───────────────────────────────────────
async function submitRegistration(e) {
  e.preventDefault();
  const form = document.getElementById('refugee-form');
  if (!validateForm(form)) { showToast('Please fill all required fields','error'); return; }

  const ngoMessage = document.getElementById('f-ngo-message').value;
  if (ngoMessage.trim().length < 50) {
    showToast('NGO message must be at least 50 characters','error');
    document.getElementById('f-ngo-message').classList.add('error');
    return;
  }

  const session = getSession();
  const payload = {
    name:           document.getElementById('f-name').value,
    dob:            document.getElementById('f-dob').value,
    gender:         document.getElementById('f-gender').value,
    nationality:    document.getElementById('f-nationality').value,
    entry_point:    document.getElementById('f-entry-point').value,
    assigned_camp:  document.getElementById('f-camp').value,
    assigned_ngo:   document.getElementById('f-ngo-selected').value,
    ngo_id:         document.getElementById('f-ngo-id').value,
    ngo_message:    ngoMessage,
    passport_no:    document.getElementById('f-passport').value,
    officer_notes:  document.getElementById('f-notes').value,
    needs_medical:  document.getElementById('f-need-medical')?.checked,
    needs_shelter:  document.getElementById('f-need-shelter')?.checked,
    needs_legal:    document.getElementById('f-need-legal')?.checked,
    needs_child:    document.getElementById('f-need-child')?.checked,
    needs_education:document.getElementById('f-need-education')?.checked,
    force:          FORCE_NAME,
    registered_by:  session.user_id || 'Officer'
  };

  const submitBtn = document.getElementById('btn-register');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Registering...'; }

  const res = await apiFetch('/api/border-patrol/register-refugee', {
    method: 'POST', body: JSON.stringify(payload)
  });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register Refugee & Notify NGO →'; }

  if (!res.success) { showToast('Registration failed: ' + res.message,'error'); return; }

  const provId = res.data.provisional_id;
  showSuccessModal(provId);
  form.reset();
  document.querySelectorAll('.ngo-card').forEach(c => c.classList.remove('selected'));
  _selectedNGO = null;
}

function showSuccessModal(provId) {
  const qrContainer = `<div id="qr-modal-canvas" style="display:flex;justify-content:center;margin-top:12px"></div>`;
  openModal({
    title: '✓ Refugee Registered Successfully',
    size: 'lg',
    body: `
      <div class="success-modal-prov">
        <div class="prov-label">Provisional ID — Print and give to refugee</div>
        <div class="prov-id" onclick="navigator.clipboard.writeText('${provId}');showToast('Copied!','success')" title="Click to copy" style="cursor:pointer">${provId}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">Click ID to copy to clipboard</div>
      </div>
      ${qrContainer}
      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:12px">The NGO has been notified. Print this document and give it to the refugee as their reference.</p>
      
      <hr style="margin:20px 0;border:none;border-top:1px solid var(--color-border)">
      <div id="family-declare-section">
        <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--color-text-primary)">Declare Family Members</h4>
        <div id="family-members-container">
          <div class="family-member-row" style="display:flex;gap:8px;margin-bottom:8px;position:relative;">
            <input type="text" class="form-input mem-name" placeholder="Relative Name" style="flex:1">
            <input type="number" class="form-input mem-age" placeholder="Age" style="width:80px">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); addFamilyRow()">+ Add Another</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); submitFamily('${provId}')" id="btn-family-search">Search Matches</button>
        </div>
      </div>
      <div id="family-matches-section" style="display:none;margin-top:16px;padding:12px;background:var(--color-surface-hover);border-radius:6px;border:1px solid var(--color-border)">
        <!-- Matches injected here -->
      </div>
      `,
    footer: `
      <div style="display:flex;gap:8px;width:100%;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" onclick="event.stopPropagation(); window.print()">Print Document</button>
        <button type="button" class="btn btn-secondary" onclick="event.stopPropagation(); closeModal()">Register Another</button>
        <button type="button" class="btn btn-primary" onclick="event.stopPropagation(); closeModal();loadRefugeeTable()">Done</button>
      </div>`
  });
  setTimeout(() => {
    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(document.createElement('canvas'), provId, { width: 180 }, (err, canvas) => {
        if (!err) { const el = document.getElementById('qr-modal-canvas'); if (el) el.appendChild(canvas); }
      });
    }
    const firstInput = document.querySelector('#family-members-container .mem-name');
    if (firstInput) setupLiveFamilySearch(firstInput, provId);
  }, 100);
}

window.setupLiveFamilySearch = function(input, provId) {
  let timeout;
  let dd = document.createElement('div');
  dd.className = 'family-search-dropdown';
  dd.style.cssText = 'position:absolute; top:100%; left:0; background:var(--color-surface); border:1px solid var(--color-border); width:calc(100% - 88px); z-index:100; max-height:200px; overflow-y:auto; display:none; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.1);';
  input.parentElement.appendChild(dd);

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const val = input.value.trim();
    if(val.length < 2) { dd.style.display = 'none'; return; }
    timeout = setTimeout(async () => {
      const res = await apiFetch(`/api/border-patrol/family/search?name=${encodeURIComponent(val)}`);
      if(res.success && res.data.length > 0) {
        const matches = res.data.filter(m => m.id !== provId);
        if(!matches.length) { dd.style.display = 'none'; return; }
        dd.innerHTML = matches.map(m => `
          <div style="padding:10px; border-bottom:1px solid var(--color-border); cursor:pointer; background:var(--color-surface); transition:background 150ms;" onmouseover="this.style.background='var(--color-bg)'" onmouseout="this.style.background='var(--color-surface)'" onclick="event.stopPropagation(); linkFamily('${provId}', '${m.id}', this)">
            <strong style="color:var(--color-text-primary)">${m.name}</strong> <span style="font-family:var(--font-mono); font-size:11px; color:var(--color-primary)">${m.id}</span><br>
            <span style="font-size:11px; color:var(--color-text-muted)">${m.nationality} | ${m.assigned_camp || 'No Camp'}</span>
          </div>`).join('');
        dd.style.display = 'block';
      } else {
        dd.style.display = 'none';
      }
    }, 400);
  });
  
  document.addEventListener('click', e => {
    if(!input.parentElement.contains(e.target)) dd.style.display = 'none';
  });
};

window.addFamilyRow = function(provId) {
  const container = document.getElementById('family-members-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'family-member-row';
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;position:relative;';
  div.innerHTML = `
    <input type="text" class="form-input mem-name" placeholder="Relative Name" style="flex:1">
    <input type="number" class="form-input mem-age" placeholder="Age" style="width:80px">
    <button type="button" class="btn btn-secondary btn-sm text-danger" onclick="event.stopPropagation(); this.parentElement.remove()" style="padding:0 12px">×</button>
  `;
  container.appendChild(div);
  setupLiveFamilySearch(div.querySelector('.mem-name'), provId || window._currentRefugeeId);
};

window.submitFamily = async function(provId, isEditMode = false) {
  const rows = document.querySelectorAll('#family-members-container .family-member-row');
  const members = Array.from(rows).map(row => {
    return {
      name: row.querySelector('.mem-name').value.trim(),
      age: parseInt(row.querySelector('.mem-age').value) || 0
    };
  }).filter(m => m.name);

  // Allow "search matches" to proceed even if members is empty in edit mode, 
  // but if they click it from registration they should have entered someone.
  if (!members.length && !isEditMode) {
    showToast('Please enter at least one name to search', 'error');
    return;
  }

  const btn = document.getElementById('btn-family-search');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }

  if (members.length) {
    await apiFetch(`/api/border-patrol/refugee/${provId}/family`, {
      method: 'POST',
      body: { members }
    });
  }

  if (btn) { btn.disabled = false; btn.textContent = isEditMode ? 'Search and Link' : 'Search Matches'; }

  const matchesSection = document.getElementById('family-matches-section');
  if (!matchesSection) return;
  matchesSection.style.display = 'block';
  matchesSection.innerHTML = '<div style="padding:12px;color:var(--color-text-muted)">Searching system...</div>';

  let allMatches = [];
  for (const m of members) {
    const res = await apiFetch(`/api/border-patrol/family/search?name=${encodeURIComponent(m.name)}`);
    if (res.success) {
      allMatches.push(...res.data.filter(x => x.id !== provId));
    }
  }

  // Deduplicate
  const uniqueMatches = Array.from(new Map(allMatches.map(item => [item.id, item])).values());

  if (uniqueMatches.length > 0) {
    matchesSection.innerHTML = `
      <h5 style="margin:0 0 8px 0;color:var(--color-warning);">Possible Matches Found</h5>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${uniqueMatches.map(m => `
          <div style="background:var(--color-surface); padding:10px; border-radius:4px; border:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="color:var(--color-text-primary)">${m.name}</strong> <span style="font-family:var(--font-mono); font-size:11px; color:var(--color-primary)">${m.id}</span><br>
              <span style="font-size:11px; color:var(--color-text-muted)">${m.nationality} | ${m.assigned_camp||'No Camp'}</span>
            </div>
            <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); linkFamily('${provId}', '${m.id}', this)">Link as Family</button>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    matchesSection.innerHTML = `<div style="padding:12px; color:var(--color-text-muted)">No matches found in the system.</div>`;
    setTimeout(() => { if(!isEditMode) matchesSection.style.display = 'none'; }, 3000);
  }
};

window.linkFamily = async function(currentProvId, matchId, btnEl) {
  if (btnEl && btnEl.tagName === 'BUTTON') { btnEl.disabled = true; }
  const allIds = [currentProvId, matchId];
  const res = await apiFetch('/api/border-patrol/family/link', {
    method: 'POST',
    body: { refugee_ids: allIds }
  });

  if (res.success) {
    if (btnEl && btnEl.tagName !== 'DIV') {
      btnEl.outerHTML = `<span class="text-success" style="font-size:12px; font-weight:600;">✓ Family linked.</span>`;
    } else if (btnEl && btnEl.tagName === 'DIV') {
      // From dropdown
      const d = document.createElement('span');
      d.className = 'text-success';
      d.style.cssText = 'float:right; font-size:12px; font-weight:600; padding:4px;';
      d.innerText = '✓ Linked';
      btnEl.appendChild(d);
      setTimeout(() => btnEl.parentElement.style.display = 'none', 1000);
    } else {
      showToast('Family records linked successfully', 'success');
    }
    
    // Refresh modal if open
    if (document.getElementById('edit-family-current')) {
      refreshEditFamilyModal(currentProvId);
    }
  } else {
    if (btnEl && btnEl.tagName === 'BUTTON') { btnEl.disabled = false; }
    showToast('Failed to link family: ' + res.message, 'error');
  }
};

// ── Edit Family Modal ─────────────────────────────────────────
window.openEditFamilyModal = async function(provId) {
  window._currentRefugeeId = provId;
  openModal({
    title: `Edit Family — ${provId}`,
    size: 'lg',
    body: `
      <div id="edit-family-current" style="margin-bottom:20px;">
        <h4 style="font-size:14px; margin-bottom:12px; color:var(--color-text-primary);">Current Linked Family</h4>
        <div id="linked-family-list"><div class="text-muted" style="font-size:13px">Loading...</div></div>
      </div>
      <hr style="margin:20px 0;border:none;border-top:1px solid var(--color-border)">
      <div id="family-declare-section">
        <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--color-text-primary)">Declare / Link Relative</h4>
        <div id="family-members-container">
          <div class="family-member-row" style="display:flex;gap:8px;margin-bottom:8px;position:relative;">
            <input type="text" class="form-input mem-name" placeholder="Relative Name" style="flex:1">
            <input type="number" class="form-input mem-age" placeholder="Age" style="width:80px">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); addFamilyRow('${provId}')">+ Add Another</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); submitFamily('${provId}', true)" id="btn-family-search">Search and Link</button>
        </div>
      </div>
      <div id="family-matches-section" style="display:none;margin-top:16px;padding:12px;background:var(--color-surface-hover);border-radius:6px;border:1px solid var(--color-border)">
      </div>
    `
  });
  
  setTimeout(() => {
    const firstInput = document.querySelector('#family-members-container .mem-name');
    if (firstInput) setupLiveFamilySearch(firstInput, provId);
  }, 100);

  refreshEditFamilyModal(provId);
};

window.refreshEditFamilyModal = async function(provId) {
  const container = document.getElementById('linked-family-list');
  if (!container) return;
  const res = await apiFetch(`/api/border-patrol/refugee/${provId}/family-members`);
  if (res.success && res.data.length > 0) {
    container.innerHTML = res.data.map(m => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border:1px solid var(--color-border); margin-bottom:8px; border-radius:4px; background:var(--color-surface)">
        <div>
          <strong style="color:var(--color-text-primary)">${m.name}</strong> 
          <span style="font-family:var(--font-mono); font-size:11px; color:var(--color-primary); margin-left:6px">${m.provisional_id}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm text-danger" onclick="event.stopPropagation(); unlinkFamily('${m.provisional_id}', '${provId}', this)">Unlink</button>
      </div>
    `).join('');
  } else {
    container.innerHTML = '<div class="text-muted" style="font-size:13px">No linked family members.</div>';
  }
};

window.unlinkFamily = async function(memberProvId, currentProvId, btnEl) {
  if (btnEl) btnEl.disabled = true;
  const res = await apiFetch('/api/border-patrol/family/unlink', {
    method: 'POST', body: { refugee_id: memberProvId }
  });
  if (res.success) {
    showToast('Unlinked successfully', 'success');
    refreshEditFamilyModal(currentProvId);
  } else {
    if (btnEl) btnEl.disabled = false;
    showToast('Failed to unlink', 'error');
  }
};

// ── Refugee table ─────────────────────────────────────────────
async function loadRefugeeTable() {
  const tbody = document.getElementById('refugee-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  const res = await apiFetch(`/api/border-patrol/refugees?force=${encodeURIComponent(FORCE_NAME)}&limit=100`);
  if (!res.success || !res.data.items.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered for this force yet.</td></tr>';
    return;
  }
  
  // Note: the table in HTML might only have 8 columns. We are adding an Edit Family button. 
  // We'll replace the last column or append to it. The previous row had:
  // ProvID | Name | Nat | RegDate | Camp | NGO | Status | Tags -> 8 columns.
  // We will append the Edit Family button next to Tags.
  tbody.style.cssText = ''; 
  tbody.innerHTML = res.data.items.map(r => `
    <tr>
      <td class="font-mono" style="font-size:12px">${r.provisional_id}<br><span style="color:var(--color-primary);font-size:10px">Processed: ${r.processed || 'at camp'}</span></td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${formatDate(r.registration_date)}</td>
      <td>${r.assigned_camp?.split(',')[0] || '—'}</td>
      <td>${r.assigned_ngo || '—'}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        ${(r.help_tags||'').split(',').filter(Boolean).map(t=>`<span class="tag-pill" style="font-size:10px">${t.trim()}</span>`).join(' ')}
      </td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm" onclick="openEditFamilyModal('${r.provisional_id}')" style="font-size:11px; padding:4px 8px">Edit Family</button>
      </td>
    </tr>`).join('');
}

// ── Collapsible sections ──────────────────────────────────────
function setupCollapsibles() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const body = header.nextElementSibling;
      if (body) body.classList.toggle('collapsed');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupWatchlistCheck();
  setupCharCounter();
  setupCollapsibles();
  loadNGOCards();

  const campsMiniMapEl = document.getElementById('camps-mini-map');
  const forceCamps = FORCE_CAMPS[FORCE_NAME] || [];
  if (campsMiniMapEl && forceCamps.length && typeof initCampMiniMap === 'function') {
    initCampMiniMap('camps-mini-map', forceCamps);
  }

  document.getElementById('refugee-form')?.addEventListener('submit', submitRegistration);
  loadRefugeeTable();

  // Tab switching on refugee records section
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-item,.tab-content').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(tab.dataset.tab);
      if (content) content.classList.add('active');
    });
  });
});
