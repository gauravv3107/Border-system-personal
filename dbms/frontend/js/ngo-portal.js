/* ngo-portal.js — NGO assignments feed, case workflow, stats */

let _ngoChartStatus = null;
let _ngoChartForce  = null;
let _ngoChartNat    = null;

// ── Status badge helper ──────────────────────────────────────────
function statusBadge(st) {
  const map = {
    active:          ['var(--color-warning)',  'Active'],
    acknowledged:    ['var(--color-warning)',  'Active'],
    aid_given:       ['var(--color-primary)',  'Aid Given'],
    medical_review:  ['#9333ea',               'Medical Review'],
    resolved:        ['var(--color-success)',  'Resolved'],
    // legacy
    Pending:         ['var(--color-warning)',  'Pending'],
    Acknowledged:    ['var(--color-warning)',  'Active'],
    'In Progress':   ['var(--color-primary)',  'In Progress'],
    Completed:       ['var(--color-success)',  'Completed'],
  };
  const [color, label] = map[st] || ['var(--color-text-muted)', st || 'Unknown'];
  return `<span class="badge" style="background:${color};color:#fff;font-size:11px;padding:2px 8px;border-radius:12px">${label}</span>`;
}

// ── Build action buttons — aid_given and medical_review_done are INDEPENDENT flags ──
function buildActions(regId, st, aidGiven, medReview) {
  if (st === 'active' || !st) {
    return '<button class="btn btn-primary btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="acknowledge">✓ Acknowledge Case</button>';
  }
  if (st === 'resolved') return ''; // should not appear in active list

  // st = 'acknowledged' (or anything non-resolved after acknowledge)
  // Both buttons are always shown. If already done, show a green ✓ chip instead.
  var aidBtn, medBtn;

  if (aidGiven) {
    aidBtn = '<button class="btn btn-success btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="aid-given">✅ Aid Given</button>';
  } else {
    aidBtn = '<button class="btn btn-secondary btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="aid-given">💊 Mark Aid Given</button>';
  }

  if (medReview) {
    medBtn = '<button class="btn btn-success btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="medical-review">✅ Medical Review Done</button>';
  } else {
    medBtn = '<button class="btn btn-secondary btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="medical-review">🏥 Mark Medical Review</button>';
  }

  var resolveBtn = '<button class="btn btn-success btn-sm case-action-btn" data-reg-id="' + regId + '" data-action="resolve">✔ Mark Case Resolved</button>';

  return '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
    + '<span style="font-size:12.5px;color:var(--color-text-muted);font-weight:500;">Progress:</span></div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">'
    + aidBtn
    + medBtn
    + resolveBtn
    + '</div>';
}

// ── Load assignments feed ────────────────────────────────────────
async function loadAssignments() {
  const container = document.getElementById('assignments-container');
  if (!container) return;
  const viewFilter = document.getElementById('case-view-filter')?.value || 'active';

  container.innerHTML = '<p style="color:var(--color-text-muted);padding:16px">Loading cases...</p>';

  const ngoId = (typeof _user !== 'undefined' && _user && _user.ngo_id) ? _user.ngo_id : 'all';
  const url = `/api/ngo/${ngoId}/cases?status=${viewFilter}`;
  const res = await apiFetch(url);
  if (!res.success) {
    showToast('Failed to load cases: ' + (res.message || res.error || 'error'), 'error');
    container.innerHTML = '<p style="color:var(--color-alert);padding:16px">Failed to load cases.</p>';
    return;
  }

  const items = res.data;
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty-state"><p>No cases found.</p></div>';
    return;
  }

  if (viewFilter === 'resolved') {
    container.innerHTML = items.map(a => `
      <div class="assignment-card status-completed" id="assignment-${a.reg_id}">
        <div class="assignment-card-header" style="cursor:pointer" onclick="toggleTimeline('${a.provisional_id}', ${a.reg_id})">
          <div>
            <div class="assignment-prov">${a.provisional_id || 'N/A'} <span style="font-size:10px;font-weight:normal;color:var(--color-primary)">(Processed: ${a.processed || 'at camp'})</span></div>
            <div class="assignment-force">${a.name || '—'}</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            ${statusBadge('resolved')}
            <button class="btn btn-secondary btn-sm case-revert-btn" data-reg-id="${a.reg_id}" data-revert-to="acknowledged">Reopen</button>
          </div>
        </div>
        <div id="timeline-container-${a.reg_id}" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);font-size:13px"></div>
      </div>`
    ).join('');
    return;
  }

  container.innerHTML = items.map(function(a) {
    var tags = (a.help_tags || '').split(',').filter(Boolean).map(function(t) {
      return '<span class="tag-pill">' + t.trim() + '</span>';
    }).join('');
    var st = a.case_status || 'active';
    var aidGiven  = !!(a.aid_given);
    var medReview = !!(a.medical_review_done);
    var actionsHtml = buildActions(a.reg_id, st, aidGiven, medReview);
    var escapedId = String(a.reg_id).replace(/"/g, '&quot;');

    return '<div class="assignment-card" style="border-left:4px solid var(--color-primary)" id="assignment-' + escapedId + '" data-aid-given="' + (aidGiven?'1':'0') + '" data-med-review="' + (medReview?'1':'0') + '">'
      + '<div class="assignment-card-header">'
      + '<div>'
      + '<div class="assignment-prov">' + (a.provisional_id || 'N/A') + ' <span style="font-size:10px;font-weight:normal;color:var(--color-primary)">(Processed: ' + (a.processed || 'at camp') + ')</span></div>'
      + '<div class="assignment-force">' + (a.name || '\u2014') + '</div>'
      + '</div>'
      + '<div id="badge-' + escapedId + '">' + statusBadge(st) + '</div>'
      + '</div>'
      + '<div class="assignment-nat">' + (a.nationality || '') + (a.gender ? ' \u00b7 ' + a.gender : '') + (a.dob ? ' \u00b7 DOB: ' + a.dob : '') + '</div>'
      + (a.medical_needs && a.medical_needs !== 'None' ? '<div class="alert-banner warning" style="margin-top:8px;padding:8px 12px"><div class="alert-body-text">Medical: ' + a.medical_needs + '</div></div>' : '')
      + (tags ? '<div class="assignment-tags" style="margin-top:12px">' + tags + '</div>' : '')
      + '<div class="assignment-actions" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border)" id="actions-' + escapedId + '">'
      + actionsHtml
      + '</div>'
      + '</div>';
  }).join('');

  renderChartsFromAssignments(items);
}

// ── Update case status — called from event delegation ─────────────────
async function updateCaseStatus(regId, action) {
  try {
    var res = await fetch('/api/ngo/cases/' + regId + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    }).then(function(r) { return r.json(); });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast('Case updated', 'success');

      if (action === 'resolve') {
        // Remove from active list
        var card = document.getElementById('assignment-' + regId);
        if (card) card.remove();
        if (typeof showToast === 'function') showToast('Case resolved — moved to history', 'success');

      } else if (action === 'acknowledge') {
        // Badge changes to Acknowledged in data, but visually stays Active
        var badgeEl = document.getElementById('badge-' + regId);
        if (badgeEl) badgeEl.innerHTML = statusBadge('acknowledged');
        var actEl = document.getElementById('actions-' + regId);
        if (actEl) actEl.innerHTML = buildActions(regId, 'acknowledged', false, false);

      } else {
        // aid-given or medical-review: flags returned in response
        var aidGiven  = !!(res.aid_given);
        var medReview = !!(res.medical_review_done);
        // Update the card's data attributes
        var card = document.getElementById('assignment-' + regId);
        if (card) {
          card.dataset.aidGiven  = aidGiven  ? '1' : '0';
          card.dataset.medReview = medReview ? '1' : '0';
        }
        // Re-render action buttons with updated flags
        var actEl = document.getElementById('actions-' + regId);
        if (actEl) actEl.innerHTML = buildActions(regId, 'acknowledged', aidGiven, medReview);
      }
      loadCounts();
    } else {
      var msg = (res && (res.message || res.error)) || 'Unknown error';
      alert('Failed to update case: ' + msg);
    }
  } catch(err) {
    alert('Network error: ' + err.message);
  }
}

// ── Revert case ──────────────────────────────────────────────────
function revertCase(regId, revertTo) {
  if (!confirm('Revert this case to: ' + revertTo + '?')) return;
  fetch('/api/ngo/cases/' + regId + '/revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ revert_to: revertTo })
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (res && res.success) {
      if (typeof showToast === 'function') showToast('Reverted successfully', 'success');
      loadAssignments();
      loadCounts();
    } else {
      alert('Revert failed: ' + ((res && (res.message || res.error)) || 'Unknown error'));
    }
  }).catch(function(err) { alert('Network error: ' + err.message); });
}

// ── Timeline toggle ──────────────────────────────────────────────
async function toggleTimeline(provId, regId) {
  var el = document.getElementById('timeline-container-' + regId);
  if (!el) return;
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="color:var(--color-text-muted)">Loading timeline...</div>';
  const res = await apiFetch('/api/refugee/' + encodeURIComponent(provId) + '/timeline');
  if (!res.success) { el.innerHTML = '<div style="color:var(--color-alert)">Failed to load timeline</div>'; return; }

  if (!res.data || !res.data.length) {
    el.innerHTML = '<div style="color:var(--color-text-muted)">No timeline events recorded yet.</div>';
    return;
  }

  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' +
    res.data.map(function(log) { return `
      <div style="display:flex;justify-content:space-between;border-bottom:1px dashed var(--color-border);padding-bottom:4px">
        <strong>${log.stage.replace(/_/g, ' ').toUpperCase()}</strong>
        <span style="color:var(--color-text-muted)">${formatDateTime(log.timestamp)} · ${log.updated_by || 'System'}</span>
      </div>
    `; }).join('') + '</div>';
}

// ── Load stats counts ────────────────────────────────────────────
async function loadCounts() {
  const res = await apiFetch('/api/ngo/assignments/case-counts');
  if (!res.success) return;

  const counts = res.data || {};

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? 0;
  };
  set('count-active',         counts['active']         ?? 0);
  set('count-aid-given',      counts['aid_given']      ?? 0);
  set('count-medical-review', counts['medical_review'] ?? 0);
  set('count-completed',      counts['resolved']       ?? 0);

  renderStatusChart(counts);
}

/* ── Chart helpers ─────────────────────────────────────────── */
const CHART_PALETTE = ['#D97706','#3B82F6','#0057B8','#9333EA','#1A7F4B','#DC2626','#0EA5E9','#F59E0B','#10B981','#EF4444'];

function _canvas(id) {
  return document.getElementById(id)?.getContext('2d') || null;
}

function renderStatusChart(counts) {
  const labels = ['Unacknowledged', 'Aid Given', 'Medical Review', 'Resolved'];
  const keys   = ['unacknowledged', 'aid_given', 'medical_review', 'resolved'];
  const values = keys.map(k => counts[k] ?? 0);
  if (values.every(v => v === 0)) return;

  const grid = document.getElementById('ngo-charts-grid');
  if (grid) grid.style.display = '';

  if (_ngoChartStatus) _ngoChartStatus.destroy();
  const ctx = _canvas('ngo-chart-status');
  if (!ctx) return;
  _ngoChartStatus = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#D97706', '#0057B8','#9333ea','#10B981'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter', size:11 }, boxWidth:10 } } }
    }
  });
}

function renderChartsFromAssignments(items) {
  const forceCounts = {};
  const natCounts   = {};
  items.forEach(a => {
    const f = (a.force || 'Unknown').trim();
    forceCounts[f] = (forceCounts[f] || 0) + 1;
    const n = (a.nationality || 'Unknown').trim();
    natCounts[n] = (natCounts[n] || 0) + 1;
  });

  const forceEntries = Object.entries(forceCounts).sort((a,b) => b[1]-a[1]).slice(0,10);
  const natEntries   = Object.entries(natCounts).sort((a,b) => b[1]-a[1]).slice(0,8);

  const grid = document.getElementById('ngo-charts-grid');
  if (grid) grid.style.display = '';

  if (_ngoChartForce) _ngoChartForce.destroy();
  const ctxF = _canvas('ngo-chart-force');
  if (ctxF && forceEntries.length) {
    _ngoChartForce = new Chart(ctxF, {
      type: 'bar',
      data: {
        labels: forceEntries.map(([k]) => k),
        datasets: [{ label: 'Assignments', data: forceEntries.map(([,v]) => v),
          backgroundColor: '#0057B8', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#F0F0F0' }, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  if (_ngoChartNat) _ngoChartNat.destroy();
  const ctxN = _canvas('ngo-chart-nationality');
  if (ctxN && natEntries.length) {
    _ngoChartNat = new Chart(ctxN, {
      type: 'doughnut',
      data: {
        labels: natEntries.map(([k]) => k),
        datasets: [{ data: natEntries.map(([,v]) => v),
          backgroundColor: CHART_PALETTE, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter', size:11 }, boxWidth:10 } } }
      }
    });
  }
}

// ── Appeals ──────────────────────────────────────────────────────
async function loadAppeals() {
  const container = document.getElementById('ngo-appeals-container');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--color-text-muted);padding:16px">Loading appeals...</p>';

  // Use ngo_id 'all' to load all appeals
  const ngoId = (typeof _user !== 'undefined' && _user && _user.ngo_id) ? _user.ngo_id : 'all';
  const res = await apiFetch(`/api/ngo/${ngoId}/appeals`);
  if (!res.success) {
    container.innerHTML = '<div class="empty-state"><p>No appeals found or error loading.</p></div>';
    return;
  }

  const items = res.data;
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty-state"><p>No pending appeals or requests.</p></div>';
    return;
  }

  container.innerHTML = items.map(a => `
    <div class="assignment-card" id="appeal-${a.id}" style="border-left:4px solid var(--color-warning)">
      <div class="assignment-card-header">
        <div>
          <div class="assignment-prov">${a.refugee_name || 'Refugee'} (${a.provisional_id})</div>
          <div class="assignment-force">Appeal Type: <strong>${a.type}</strong></div>
        </div>
        ${statusBadge(a.status === 'open' ? 'Pending' : 'In Progress')}
      </div>
      <div class="assignment-message" style="margin-top:12px">"${a.description}"</div>
      <div class="assignment-meta"><span>Submitted: ${formatDateTime(a.timestamp)}</span></div>
      <div style="margin-top:16px;padding:16px;background:var(--color-surface-hover);border-radius:6px;border:1px solid var(--color-border)">
        <div style="margin-bottom:12px">
          <label class="form-label">Update Status</label>
          <select id="appeal-status-${a.id}" class="form-input" style="background:#fff;padding:6px">
            <option value="in_progress" ${a.status === 'in_progress' ? 'selected' : ''}>Investigating / In Progress</option>
            <option value="resolved">Mark Resolved</option>
            <option value="closed">Close Request</option>
          </select>
        </div>
        <div style="margin-bottom:12px">
          <label class="form-label">Response Notes to Refugee</label>
          <textarea id="appeal-notes-${a.id}" class="form-input" rows="2" style="background:#fff" placeholder="Describe the resolution..."></textarea>
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveAppealUpdate(${a.id})">Save Response</button>
      </div>
    </div>
  `).join('');
}

async function saveAppealUpdate(appealId) {
  var statusEl = document.getElementById('appeal-status-' + appealId);
  var notesEl  = document.getElementById('appeal-notes-' + appealId);
  if (!statusEl || !notesEl) return;

  try {
    const res = await fetch('/api/ngo/appeals/' + appealId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: statusEl.value, response_notes: notesEl.value })
    }).then(function(r) { return r.json(); });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast('Appeal updated', 'success');
      loadAppeals();
    } else {
      alert('Failed to update appeal: ' + ((res && res.message) || 'Unknown error'));
    }
  } catch(err) { alert('Network error: ' + err.message); }
}

// ── DOMContentLoaded ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAssignments();
  loadCounts();
  loadAppeals();

  document.getElementById('btn-refresh')?.addEventListener('click', function() {
    loadAssignments();
    loadCounts();
    loadAppeals();
    if (typeof showToast === 'function') showToast('Refreshed', 'info');
  });

  // ── EVENT DELEGATION for case action buttons ─────────────────────────────
  // Handles clicks on ANY button inside the container regardless of when they were created.
  // data-reg-id is stored as a raw HTML attribute — no JS quoting issues.
  document.getElementById('assignments-container').addEventListener('click', function(e) {
    // Action button (acknowledge / aid-given / medical-review / resolve)
    var actionBtn = e.target.closest('.case-action-btn');
    if (actionBtn) {
      var regId  = actionBtn.getAttribute('data-reg-id');
      var action = actionBtn.getAttribute('data-action');
      updateCaseStatus(regId, action);
      return;
    }
    // Revert button
    var revertBtn = e.target.closest('.case-revert-btn');
    if (revertBtn) {
      e.preventDefault();
      var regId    = revertBtn.getAttribute('data-reg-id');
      var revertTo = revertBtn.getAttribute('data-revert-to');
      revertCase(regId, revertTo);
      return;
    }
    // Toggle timeline (resolved view — click on card header)
    var header = e.target.closest('.timeline-header');
    if (header) {
      var provId = header.getAttribute('data-prov-id');
      var regId  = header.getAttribute('data-reg-id');
      if (provId && regId) toggleTimeline(provId, regId);
      return;
    }
  });

  // Tab switching
  document.querySelectorAll('.ngo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ngo-tab').forEach(t => {
        t.classList.remove('active');
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--color-text-muted)';
      });
      tab.classList.add('active');
      tab.style.borderBottomColor = 'var(--color-primary)';
      tab.style.color = 'var(--color-primary)';

      document.querySelectorAll('.ngo-tab-content').forEach(c => c.style.display = 'none');
      document.getElementById(tab.dataset.tab).style.display = 'block';
    });
  });
});
