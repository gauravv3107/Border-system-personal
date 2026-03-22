/* refugee-portal.js — Provisional ID lookup, rights display, camp map */

const TIMELINE_STAGES = ['registered', 'assigned_to_ngo', 'aid_received', 'under_medical_review', 'case_resolved'];
const STAGE_LABELS = {
  'registered': 'Registered',
  'assigned_to_ngo': 'NGO Assigned',
  'aid_received': 'Aid Received',
  'under_medical_review': 'Medical Review',
  'case_resolved': 'Case Resolved'
};

let _campMap = null;
let _timelinePoll = null;

async function lookupID() {
  const input  = document.getElementById('prov-id-input');
  const status = document.getElementById('refugee-status-card');
  if (!input || !status) return;

  const id = input.value.trim().toUpperCase();
  if (!id) { showToast('Please enter your Provisional ID','error'); return; }
  if (!id.startsWith('PROV-')) {
    showToast('Invalid format. Expected: PROV-FORCE-YEAR-NUMBER','error');
    return;
  }

  const btn = document.getElementById('btn-lookup');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }

  const res = await apiFetch(`/api/refugee/lookup/${encodeURIComponent(id)}`);
  if (btn) { btn.disabled = false; btn.textContent = window.i18n?.t('refugee.find_button') || 'Find My Record'; }

  if (!res.success || !res.data) {
    showToast(res.message || 'Record not found. Please contact the officer who registered you.', 'error');
    status.classList.remove('visible');
    return;
  }

  // Apply saved language preference
  const prefLang = res.data.language_preference || 'en';
  const langSelect = document.getElementById('lang-pref-selector');
  if (langSelect && langSelect.value !== prefLang) {
    langSelect.value = prefLang;
    if (typeof switchLanguage === 'function') switchLanguage(prefLang);
  }

  renderStatusCard(res.data);
  fetchAndRenderTimeline(id);
  
  if (_timelinePoll) clearInterval(_timelinePoll);
  _timelinePoll = setInterval(() => { fetchAndRenderTimeline(id); }, 30000);
  
  loadAppeals(res.data.refugee_id);
  
  status.classList.add('visible');
  document.getElementById('refugee-appeals-card').style.display = 'block';
  status.scrollIntoView({ behavior:'smooth', block:'start' });
  
  // Fix Leaflet tile loading issue when container display changes
  if (_campMap) {
    setTimeout(() => { _campMap.invalidateSize(); }, 250);
  }
}

function renderStatusCard(data) {
  const el = id => document.getElementById(id);
  const card = document.getElementById('refugee-status-card');
  if (card && data.refugee_id) card.dataset.refugeeId = data.refugee_id;
  
  if (el('sc-prov-id'))    el('sc-prov-id').textContent    = data.provisional_id;
  if (el('sc-name'))       el('sc-name').textContent       = data.name;
  if (el('sc-nationality'))el('sc-nationality').textContent = data.nationality;
  if (el('sc-camp'))       el('sc-camp').textContent       = data.assigned_camp || data.entity_camp || '—';
  if (el('sc-ngo'))        el('sc-ngo').textContent        = data.ngo_name || data.assigned_ngo || '—';
  if (el('sc-ngo-status')) el('sc-ngo-status').innerHTML   = statusBadge(data.ngo_status || 'Pending');
  if (el('sc-status'))     el('sc-status').innerHTML       = statusBadge(data.reg_status || 'Active');
  if (el('sc-force'))      el('sc-force').textContent      = data.force;
  if (el('sc-registered')) el('sc-registered').textContent = formatDateTime(data.registration_date);

  // Help tags
  const tagsEl = el('sc-tags');
  if (tagsEl && data.help_tags) {
    tagsEl.innerHTML = data.help_tags.split(',').map(t =>
      `<span class="tag-pill">${t.trim()}</span>`
    ).join(' ');
  }

  // Rights
  const rightsEl = el('sc-rights');
  if (rightsEl && data.rights) {
    rightsEl.innerHTML = data.rights.map(r =>
      `<div class="rights-item">${r}</div>`
    ).join('');
  }

  // Emergency contacts
  const emEl = el('sc-emergency');
  if (emEl && data.emergency_contacts) {
    emEl.innerHTML = data.emergency_contacts.map(c =>
      `<div class="emergency-item"><div class="emergency-label">${c.label}</div><div class="emergency-number">${c.number}</div></div>`
    ).join('');
  }

  // Camp map — show all 7 camps, highlight the assigned one
  if (!_campMap) {
    _campMap = L.map('refugee-camp-map', {
      center: [22, 82], zoom: 4.5, zoomControl: false, attributionControl: false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(_campMap);
    Object.entries(CAMP_COORDS).forEach(([name, coords]) => {
      const isAssigned = name.includes((data.assigned_camp || '').split(',')[0]);
      const marker = L.marker(coords, {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${isAssigned ? '#D97706' : '#8A95A3'};color:#fff;width:${isAssigned?28:22}px;height:${isAssigned?28:22}px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;font-size:12px;">⛺</div>`,
          iconSize: isAssigned ? [28,28] : [22,22], 
          iconAnchor: isAssigned ? [14,14] : [11,11],
          popupAnchor: isAssigned ? [0,-14] : [0,-11]
        })
      }).addTo(_campMap);
      marker.bindPopup(`<strong>${name}</strong><br>Capacity: ~${(CAMP_CAPACITY[name]||0).toLocaleString()}${isAssigned?'<br><span style="color:#D97706;font-weight:700">← Your assigned camp</span>':''}`);
      if (isAssigned) marker.openPopup();
    });
  }
}

async function fetchAndRenderTimeline(provId) {
  const container = document.getElementById('timeline-nodes');
  const widget = document.getElementById('status-timeline');
  if (!container || !widget) return;
  
  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/timeline`);
  if (!res.success) return;
  
  widget.style.display = 'block';
  const logs = res.data;
  
  let activeIndex = -1;
  TIMELINE_STAGES.forEach((s, idx) => {
    if (logs.find(l => l.stage === s) && idx > activeIndex) activeIndex = idx;
  });

  let pct = 0;
  if (activeIndex >= 0 && TIMELINE_STAGES.length > 1) {
    pct = (activeIndex / (TIMELINE_STAGES.length - 1)) * 100;
  }
  
  let barWidth = pct * 0.8;
  let html = `<div style="position:absolute;top:15px;left:10%;right:10%;height:2px;background:var(--color-border);z-index:0"></div>`;
  html += `<div id="timeline-bar-active" style="position:absolute;top:15px;left:10%;height:2px;background:var(--color-primary);z-index:1;transition:width 0.5s;width:${barWidth}%"></div>`;

  const hasResolved = !!logs.find(l => l.stage === 'case_resolved');

  // Dynamically update summary badges
  const statusEl    = document.getElementById('sc-status');
  const ngoStatusEl = document.getElementById('sc-ngo-status');

  if (hasResolved) {
    if (statusEl)    statusEl.innerHTML    = '<span class="badge" style="background:var(--color-text-muted);color:#fff;font-size:11px;padding:2px 8px;border-radius:12px">Inactive</span>';
    if (ngoStatusEl) ngoStatusEl.innerHTML = '<span class="badge" style="background:var(--color-success);color:#fff;font-size:11px;padding:2px 8px;border-radius:12px">Resolved</span>';
  } else {
    if (statusEl) statusEl.innerHTML = '<span class="badge" style="background:var(--color-success);color:#fff;font-size:11px;padding:2px 8px;border-radius:12px">Active</span>';
    
    let nextStepIndex = activeIndex >= 0 ? activeIndex + 1 : 0;
    if (nextStepIndex < TIMELINE_STAGES.length && ngoStatusEl) {
      let nextLabel = STAGE_LABELS[TIMELINE_STAGES[nextStepIndex]];
      ngoStatusEl.innerHTML = `<span class="badge" style="background:var(--color-warning);color:#fff;font-size:11px;padding:2px 8px;border-radius:12px">Pending ${nextLabel}</span>`;
    }
  }

  TIMELINE_STAGES.forEach((s, idx) => {
    let log = logs.find(l => l.stage === s);
    let isCompleted = !!log;
    let isSkipped = hasResolved && !isCompleted;
    let isCurrent = idx === activeIndex;

    let circleBg = 'var(--color-surface)';
    let borderColor = 'var(--color-border)';
    let textColor = 'var(--color-text-muted)';
    let label = STAGE_LABELS[s];

    if (isCompleted) {
      circleBg = 'var(--color-primary)';
      borderColor = 'var(--color-primary)';
      textColor = 'var(--color-text-primary)';
    } else if (isSkipped) {
      circleBg = 'var(--color-border)'; // solid grey fill
      borderColor = 'var(--color-border)';
      label = STAGE_LABELS[s] + '<br><span style="font-size:9px;font-weight:400">(Skipped)</span>';
    }

    if (isCurrent && isCompleted) textColor = 'var(--color-primary)';

    let fontWeight = isCurrent ? '700' : '600';
    let ring = isCurrent ? `box-shadow: 0 0 0 4px var(--color-primary-tint)` : '';
    let timeStr = log ? formatDateTime(log.timestamp) : '';
    
    html += `
      <div style="z-index:2;display:flex;flex-direction:column;align-items:center;width:20%;text-align:center">
        <div style="width:32px;height:32px;border-radius:50%;background:${circleBg};border:2px solid ${borderColor};${ring};margin-bottom:8px;transition:all 0.3s"></div>
        <div style="font-size:11px;font-weight:${fontWeight};color:${textColor};margin-bottom:4px;line-height:1.2">${label}</div>
        ${timeStr ? `<div style="font-size:10px;color:var(--color-text-muted)">${timeStr}</div>` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
}

async function updateLanguagePreference() {
  const select = document.getElementById('lang-pref-selector');
  const lang = select.value;
  const provIdEl = document.getElementById('sc-prov-id');
  const provId = provIdEl ? provIdEl.textContent.replace('PROV-ID: ', '').trim() : '';
  
  // If not logged in yet, just do local switch
  if (!provId || provId.startsWith('PROV-')) {
    if (typeof switchLanguage === 'function') switchLanguage(lang);
    return;
  }
  
  if (typeof switchLanguage === 'function') switchLanguage(lang);
  
  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/language`, {
    method: 'PUT',
    body: { language: lang }
  });
  
  if (res.success) {
    showToast('Language preference saved', 'success');
  } else {
    showToast('Failed to save language preference', 'error');
  }
}

async function submitAppeal(e) {
  e.preventDefault();
  const card = document.getElementById('refugee-status-card');
  const refId = card ? card.dataset.refugeeId : null;
  if (!refId) return;

  const btn = document.getElementById('appeal-submit');
  const typeEl = document.getElementById('appeal-type');
  const descEl = document.getElementById('appeal-description');
  const msgEl = document.getElementById('appeal-message');
  
  const type = typeEl.value;
  const desc = descEl.value;

  btn.disabled = true;
  btn.textContent = 'Submitting...';
  msgEl.style.display = 'none';

  const url = `/api/refugee/${refId}/appeal`;
  console.log('Submitting appeal to:', url, {type, description: desc});

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, description: desc })
    });
    
    // Check if response is actually JSON before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response:', text);
      throw new Error(`Server returned HTML instead of JSON. Status: ${response.status}. The route ${url} may not be registered.`);
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unknown error');
    
    // inline success
    msgEl.textContent = 'Appeal submitted successfully';
    msgEl.style.color = 'var(--color-success)';
    msgEl.style.display = 'block';
    typeEl.value = '';
    descEl.value = '';
    loadAppeals(refId);

  } catch (err) {
    // inline error
    msgEl.textContent = err.message || 'Failed to submit request';
    msgEl.style.color = 'var(--color-alert)';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Request';
  }
}

async function loadAppeals(refId) {
  const container = document.getElementById('past-appeals');
  if (!container) return;
  
  const res = await apiFetch(`/api/refugee/${refId}/appeals`);
  if (!res.success) return;
  
  const appeals = res.data;
  if (!appeals.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--color-text-muted)">No requests submitted yet.</p>';
    return;
  }
  
  container.innerHTML = appeals.map(a => {
    let statusClass = 'status-pending';
    let statusLabel = 'Open';
    if (a.status === 'in_progress') { statusClass = 'status-in-progress'; statusLabel = 'In Progress'; }
    if (a.status === 'resolved') { statusClass = 'status-completed'; statusLabel = 'Resolved'; }
    if (a.status === 'closed') { statusClass = 'status-acknowledged'; statusLabel = 'Closed'; }
    
    return `
      <div style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <strong style="font-size:13px">${a.type}</strong>
            <div style="font-size:11px;color:var(--color-text-muted)">${formatDateTime(a.timestamp)}</div>
          </div>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        <p style="font-size:13px;margin:0;color:var(--color-text-secondary);line-height:1.4">${a.description}</p>
        ${a.response_notes ? `
          <div style="margin-top:12px;padding:8px;background:var(--color-surface);border-left:3px solid var(--color-primary);font-size:12px;color:var(--color-text-primary)">
            <strong>Official Response:</strong><br>${a.response_notes}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-lookup')?.addEventListener('click', lookupID);
  document.getElementById('prov-id-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') lookupID();
  });
});

