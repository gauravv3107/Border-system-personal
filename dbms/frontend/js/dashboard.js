/* dashboard.js — Map init, KPI polling, chart rendering, refugee/NGO management */

let _kpiPollInterval = null;
let _ngoList         = [];  // cached list of NGOs for dropdowns
let _dashboardRefugees = [];

async function loadKPIs() {
  const res = await apiFetch('/api/dashboard/kpis');
  if (!res.success) return;
  const d = res.data;
  const el = id => document.getElementById(id);
  if (el('kpi-volume'))    el('kpi-volume').textContent    = d.volume?.toLocaleString() ?? '—';
  if (el('kpi-flags'))     el('kpi-flags').textContent     = d.flags?.toLocaleString() ?? '—';
  if (el('kpi-incidents')) el('kpi-incidents').textContent = d.incidents?.toLocaleString() ?? '—';
  // Registered Refugees count from the refugee list endpoint
  apiFetch('/api/dashboard/refugees?limit=1').then(r => {
    if (r.success && el('kpi-refugees')) el('kpi-refugees').textContent = r.data.total?.toLocaleString() ?? '—';
  });
}

async function loadCharts() {
  const [typesRes, epRes] = await Promise.all([
    apiFetch('/api/dashboard/entity-types'),
    apiFetch('/api/dashboard/top-entry-points')
  ]);

  // ── Donut chart: Entity types ──────────────────────────────
  const donutCtx = document.getElementById('chart-types')?.getContext('2d');
  if (donutCtx && typesRes.success) {
    const labels  = typesRes.data.map(r => r.type);
    const values  = typesRes.data.map(r => r.count);
    const colors  = ['#0057B8','#D97706','#1A7F4B'];
    new Chart(donutCtx, {
      type: 'doughnut',
      data: { labels, datasets:[{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter',size:11 }, boxWidth:10 }}}
      }
    });
  }

  // ── Bar chart: Top entry points ────────────────────────────
  const barCtx = document.getElementById('chart-entry-points')?.getContext('2d');
  if (barCtx && epRes.success) {
    const labs = epRes.data.map(r => r.entry_point.split(',')[0]);
    const vals = epRes.data.map(r => r.count);
    new Chart(barCtx, {
      type: 'bar',
      data: { labels: labs, datasets:[{ data: vals, backgroundColor: '#0057B8', borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color:'#F0F0F0' }}, y: { grid: { display: false }, ticks:{ font:{ size:10 }}}}
      }
    });
  }

  // ── Line chart: Security flags (simulated 7-day trend) ─────
  const lineCtx = document.getElementById('chart-trend')?.getContext('2d');
  if (lineCtx) {
    const days   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const values = [12,18,14,21,17,24,19];
    new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: days,
        datasets:[{
          data: values, borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,0.07)',
          fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#DC2626'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display:false }}, y: { grid: { color:'#F0F0F0' }}}
      }
    });
  }
}

// ── Refugee Management Tabs ───────────────────────────────────

async function loadDashboardRefugees() {
  const tbody = document.getElementById('dash-refugee-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  const res = await apiFetch('/api/dashboard/refugees?limit=100');
  if (!res.success) { showToast('Failed to load refugees', 'error'); return; }
  const allItems = res.data.items;
  const items = allItems.filter(r => r.processed !== 'Released');
  _dashboardRefugees = items;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered yet</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(r => `
    <tr id="dash-refugee-row-${r.reg_id}">
      <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}<br><button class="btn btn-primary btn-sm" style="font-size:10px;padding:4px 8px;margin-top:6px;cursor:pointer" onclick="promptReleaseRefugee('${r.reg_id}')">Processed: ${r.processed || 'at camp'}</button></td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.force || '—'}</td>
      <td>${formatDateTime(r.registration_date)}</td>
      <td>${r.assigned_camp || '—'}</td>
      <td>${r.assigned_ngo ? `<span style="color:var(--color-success);font-weight:600">${r.assigned_ngo}</span>` : '<span style="color:var(--color-text-muted)">Unassigned</span>'}</td>
      <td>${statusBadge(r.reg_status || r.entity_status || 'Active')}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openEditRefugeeModal('${r.reg_id}')">✏ Edit</button></td>
    </tr>`).join('');
}

async function loadNgoAssignmentsTab() {
  const tbody = document.getElementById('dash-ngo-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';

  // Load refugees + NGO list in parallel
  const [refugeesRes, ngoRes] = await Promise.all([
    apiFetch('/api/dashboard/refugees?limit=100'),
    apiFetch('/api/dashboard/ngo-list')
  ]);
  if (!refugeesRes.success) { showToast('Failed to load data', 'error'); return; }
  _ngoList = ngoRes.success ? ngoRes.data : [];

  const items = refugeesRes.data.items;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered yet</td></tr>';
    return;
  }

  const ngoOptions = _ngoList.map(n => `<option value="${n.name}">${n.name}</option>`).join('');

  tbody.innerHTML = items.map(r => `
    <tr id="ngo-row-${r.reg_id}">
      <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}<br><span style="color:var(--color-primary);font-size:10px">Processed: ${r.processed || 'at camp'}</span></td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.force || '—'}</td>
      <td id="ngo-current-${r.reg_id}">${r.assigned_ngo ? `<span style="color:var(--color-success);font-weight:600">${r.assigned_ngo}</span>` : '<span style="color:var(--color-text-muted)">Unassigned</span>'}</td>
      <td>
        <select id="ngo-select-${r.reg_id}" style="width:100%;font-size:12px">
          <option value="">— Select NGO —</option>
          ${ngoOptions}
        </select>
      </td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="saveNgoAssignment('${r.reg_id}', '${r.name.replace(/'/g,"\\'")}')">Save</button>
      </td>
    </tr>`).join('');

  // Pre-select the currently assigned NGO in each dropdown
  items.forEach(r => {
    const sel = document.getElementById(`ngo-select-${r.reg_id}`);
    if (sel && r.assigned_ngo) sel.value = r.assigned_ngo;
  });
}

async function saveNgoAssignment(regId, refugeeName) {
  const sel = document.getElementById(`ngo-select-${regId}`);
  const ngoName = sel?.value;
  if (!ngoName) { showToast('Please select an NGO first', 'error'); return; }

  // Find the ngo_id from the cached list
  const ngo    = _ngoList.find(n => n.name === ngoName);
  const ngoId  = ngo?.id || 'NGO-AUTO';

  const res = await apiFetch(`/api/dashboard/ngo-assignments/${regId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ngo_name: ngoName, ngo_id: ngoId })
  });

  if (res.success) {
    showToast(`${refugeeName} assigned to ${ngoName}`, 'success');
    // Update the "Current NGO" cell in place without re-fetching everything
    const currentCell = document.getElementById(`ngo-current-${regId}`);
    if (currentCell) currentCell.innerHTML = `<span style="color:var(--color-success);font-weight:600">${ngoName}</span>`;
  } else {
    showToast('Assignment failed: ' + res.message, 'error');
  }
}

// ── Edit Refugee ──────────────────────────────────────────────────
async function openEditRefugeeModal(regId) {
  const ref = _dashboardRefugees.find(r => r.reg_id == regId);
  if (!ref) return;

  if (!_ngoList.length) {
    const res = await apiFetch('/api/dashboard/ngo-list');
    if (res.success) _ngoList = res.data;
  }
  
  const ngoSelect = document.getElementById('edit-ref-ngo');
  ngoSelect.innerHTML = '<option value="">— Unassigned —</option>' + 
    _ngoList.filter(n => n.status === 'approved').map(n => `<option value="${n.name}">${n.name}</option>`).join('');

  document.getElementById('edit-refugee-id').value = regId;
  document.getElementById('edit-ref-name').value = ref.name || '';
  document.getElementById('edit-ref-nationality').value = ref.nationality || '';
  document.getElementById('edit-ref-camp').value = ref.assigned_camp || '';
  ngoSelect.value = ref.assigned_ngo || '';
  document.getElementById('edit-ref-status').value = ref.reg_status || ref.entity_status || 'Active';
  document.getElementById('edit-ref-assistance').value = ref.assistance_type || '';

  document.getElementById('edit-refugee-modal').style.display = 'flex';
}

async function submitEditRefugeeForm(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-refugee');
  btn.disabled = true;
  
  const regId = document.getElementById('edit-refugee-id').value;
  const payload = {
    name: document.getElementById('edit-ref-name').value,
    nationality: document.getElementById('edit-ref-nationality').value,
    assigned_camp: document.getElementById('edit-ref-camp').value,
    assigned_ngo: document.getElementById('edit-ref-ngo').value,
    status: document.getElementById('edit-ref-status').value,
    assistance_type: document.getElementById('edit-ref-assistance').value
  };

  const res = await apiFetch(`/api/dashboard/refugees/${regId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  
  btn.disabled = false;
  
  if (res.success) {
    document.getElementById('edit-refugee-modal').style.display = 'none';
    showToast('Refugee updated', 'success');
    const r = res.data;
    const idx = _dashboardRefugees.findIndex(item => item.reg_id == regId);
    if (idx >= 0) _dashboardRefugees[idx] = r;
    const row = document.getElementById(`dash-refugee-row-${regId}`);
    if (row) {
      row.innerHTML = `
        <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.nationality}</td>
        <td>${r.force || '—'}</td>
        <td>${formatDateTime(r.registration_date)}</td>
        <td>${r.assigned_camp || '—'}</td>
        <td>${r.assigned_ngo ? `<span style="color:var(--color-success);font-weight:600">${r.assigned_ngo}</span>` : '<span style="color:var(--color-text-muted)">Unassigned</span>'}</td>
        <td>${statusBadge(r.reg_status || r.entity_status || 'Active')}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openEditRefugeeModal(${r.reg_id})">✏ Edit</button></td>
      `;
    }
  } else {
    showToast('Update failed: ' + res.message, 'error');
  }
}

// ── Alerts ────────────────────────────────────────────────────────
const _SEVERITY_STYLE = {
  critical: { bg: '#FEF2F2', border: '#DC2626', badge: '#DC2626', label: '🔴 Critical' },
  warning:  { bg: '#FFFBEB', border: '#D97706', badge: '#D97706', label: '🟡 Warning'  },
  info:     { bg: '#EFF6FF', border: '#0057B8', badge: '#0057B8', label: '🔵 Info'     },
};

function _renderAlertRow(alert, showReadBtn = true) {
  const sev  = _SEVERITY_STYLE[alert.severity] || _SEVERITY_STYLE.info;
  const time = formatDateTime(alert.timestamp);
  const readBtn = showReadBtn && !alert.read
    ? `<button class="btn btn-secondary btn-sm" style="flex-shrink:0"
         onclick="markAlertRead(${alert.id}, this)">✓ Mark read</button>`
    : (alert.read ? `<span style="font-size:11px;color:var(--color-text-muted)">Read</span>` : '');
  return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;
              background:${sev.bg};border:1px solid ${sev.border};border-radius:8px;
              opacity:${alert.read ? '0.6' : '1'}">
    <span style="background:${sev.badge};color:#fff;font-size:10px;font-weight:700;
                 padding:3px 8px;border-radius:100px;white-space:nowrap;margin-top:2px">
      ${sev.label}
    </span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;color:var(--color-text-primary);line-height:1.5">${alert.message}</div>
      <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">
        ${alert.type ? `[${alert.type}]` : ''} ${alert.triggered_by ? `· ${alert.triggered_by}` : ''} · ${time}
      </div>
    </div>
    ${readBtn}
  </div>`;
}

async function loadAlerts() {
  const container = document.getElementById('alerts-active-list');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--color-text-muted)">Loading…</div>';
  const res = await apiFetch('/api/dashboard/alerts?unread=true');
  if (!res.success) { container.innerHTML = '<div style="color:var(--color-alert);padding:12px">Failed to load alerts</div>'; return; }
  
  const items = res.data || [];
  const unread_count = items.length;
  // Update badge
  const badge = document.getElementById('alert-unread-badge');
  if (badge) { badge.textContent = unread_count; badge.style.display = unread_count > 0 ? 'inline' : 'none'; }
  if (!items.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--color-text-muted)">✓ No unread alerts</div>';
    return;
  }
  container.innerHTML = items.map(a => _renderAlertRow(a, true)).join('');
}

async function loadAllAlerts() {
  const container = document.getElementById('alerts-history-list');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--color-text-muted)">Loading…</div>';
  const res = await apiFetch('/api/dashboard/alerts');
  if (!res.success) { container.innerHTML = '<div style="color:var(--color-alert);padding:12px">Failed to load</div>'; return; }
  const items = res.data || [];
  if (!items.length) { container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--color-text-muted)">No alerts in history</div>'; return; }
  container.innerHTML = items.map(a => _renderAlertRow(a, false)).join('');
}

async function markAlertRead(alertId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const res = await apiFetch(`/api/dashboard/alerts/read/${alertId}`, { method: 'POST' });
  if (res.success) { loadAlerts(); showToast('Alert acknowledged', 'success'); }
  else { showToast('Could not mark alert as read', 'error'); if (btn) { btn.disabled = false; btn.textContent = '✓ Mark read'; } }
}

async function markAllAlertsRead() {
  const res = await apiFetch('/api/dashboard/alerts/read-all', { method: 'POST' });
  if (res.success) { loadAlerts(); showToast('All alerts acknowledged', 'success'); }
  else showToast('Failed to clear alerts', 'error');
}

// ── NGO Management ──────────────────────────────────────────────────
async function loadNgoMgmtTab() {
  const tbody = document.getElementById('dash-ngo-mgmt-tbody');
  const filter = document.getElementById('ngo-status-filter')?.value || 'active';
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  const res = await apiFetch('/api/dashboard/ngos/all');
  if (!res.success) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-alert)">Error loading NGOs</td></tr>';
    return;
  }
  
  let ngos = res.data;
  if (filter === 'active') {
    ngos = ngos.filter(n => n.status === 'approved' || n.status === 'pending');
  } else if (filter === 'deactivated') {
    ngos = ngos.filter(n => n.status === 'deactivated');
  }

  if (!ngos.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-text-muted)">No NGOs found</td></tr>';
    return;
  }
  
  const pendingSelect = document.getElementById('pending-ngo-select');
  if (pendingSelect) {
    const pendingNgos = ngos.filter(n => n.status === 'pending');
    if (pendingNgos.length) {
      pendingSelect.innerHTML = '<option value="">— Select Pending Request —</option>' + 
        pendingNgos.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    } else {
      pendingSelect.innerHTML = '<option value="">No Pending Requests</option>';
    }
  }
  
  tbody.innerHTML = ngos.map(ngo => {
    let focus = ngo.focus_area || '—';
    let contact = `<div>${ngo.contact_person || '—'}</div><div style="font-size:11px;color:var(--color-text-muted)">${ngo.contact_email || ''}</div>`;
    
    let pct = ngo.max_capacity > 0 ? (ngo.current_count / ngo.max_capacity) * 100 : 0;
    pct = Math.min(100, Math.max(0, pct));
    let color = 'var(--color-success)';
    if (pct >= 90) color = 'var(--color-alert)';
    else if (pct >= 70) color = 'var(--color-warning)';
    let capBar = `
      <div style="font-size:11px;font-weight:600;margin-bottom:4px">${ngo.current_count} / ${ngo.max_capacity}  (${pct.toFixed(0)}%)</div>
      <div style="height:6px;background:var(--color-border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};transition:width 300ms"></div>
      </div>
    `;

    let badgeStyle = ngo.status === 'approved' ? 'background:var(--color-success-tint);color:var(--color-success)' : 
                     (ngo.status === 'pending' ? 'background:var(--color-warning-tint);color:var(--color-warning)' : 
                     'background:var(--color-border);color:var(--color-text-secondary)');
    let statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:100px;font-size:11px;font-weight:700;${badgeStyle}">${ngo.status.toUpperCase()}</span>`;

    let actions = '';
    if (ngo.status === 'pending') {
      actions += `<button class="btn btn-secondary btn-sm" onclick="approveNgo(${ngo.id})">Approve</button>`;
    } else if (ngo.status === 'approved') {
      actions += `<button class="btn btn-secondary btn-sm" style="color:var(--color-alert)" onclick="deactivateNgo(${ngo.id})">Deactivate</button>`;
    } else if (ngo.status === 'deactivated') {
      actions += `<button class="btn btn-secondary btn-sm" style="color:var(--color-success)" onclick="reactivateNgo(${ngo.id})">Reactivate</button>`;
    }
    
    return `<tr>
      <td style="font-weight:600">${ngo.name}</td>
      <td style="font-size:12px">${focus}</td>
      <td>${contact}</td>
      <td>${capBar}</td>
      <td>${statusBadge}</td>
      <td><div style="display:flex;gap:4px">${actions}</div></td>
    </tr>`;
  }).join('');
}

async function approveNgo(id) {
  const res = await apiFetch(`/api/dashboard/ngos/${id}/approve`, { method: 'POST' });
  if (res.success) { showToast('NGO Approved', 'success'); loadNgoMgmtTab(); }
  else showToast(res.message, 'error');
}

async function deactivateNgo(id) {
  if (!confirm('Are you sure you want to deactivate this NGO?')) return;
  const res = await apiFetch(`/api/dashboard/ngos/${id}/deactivate`, { method: 'POST' });
  if (res.success) { showToast('NGO Deactivated', 'success'); loadNgoMgmtTab(); }
  else showToast(res.message, 'error');
}

async function reactivateNgo(id) {
  const res = await apiFetch(`/api/dashboard/ngos/${id}/reactivate`, { method: 'POST' });
  if (res.success) { showToast('NGO Reactivated', 'success'); loadNgoMgmtTab(); }
  else showToast(res.message, 'error');
}
async function acceptSelectedNgo() {
  const sel = document.getElementById('pending-ngo-select');
  if (!sel || !sel.value) {
    showToast('Please select a pending NGO request', 'warning');
    return;
  }
  await approveNgo(sel.value);
}

// ── Unit Statistics ─────────────────────────────────────────────────
let _unitStatsData = [];
let _unitStatsChart = null;

async function loadUnitStats() {
  const res = await apiFetch('/api/dashboard/stats/units');
  if (res.success) {
    _unitStatsData = res.data;
    renderUnitStats();
  } else {
    showToast('Failed to load unit stats', 'error');
  }
}

function renderUnitStats() {
  const selector = document.getElementById('unit-stats-selector');
  const allView  = document.getElementById('unit-stats-all-view');
  const singleView = document.getElementById('unit-stats-single-view');
  if (!selector || !_unitStatsData.length) return;

  const selected = selector.value;
  
  if (selected === 'All') {
    allView.style.display = 'block';
    singleView.style.display = 'none';
    
    const ctx = document.getElementById('chart-unit-stats')?.getContext('2d');
    if (!ctx) return;
    
    if (_unitStatsChart) _unitStatsChart.destroy();
    
    const labels = _unitStatsData.map(d => d.unit_name);
    const refugees = _unitStatsData.map(d => d.total_refugees_registered);
    const vessels = _unitStatsData.map(d => d.total_vessels_checked);
    const incidents = _unitStatsData.map(d => d.flagged_incidents);
    
    _unitStatsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Refugees Registered', data: refugees, backgroundColor: '#0057B8', borderRadius: 4 },
          { label: 'Vessels Checked', data: vessels, backgroundColor: '#0284C7', borderRadius: 4 },
          { label: 'Flagged Incidents', data: incidents, backgroundColor: '#DC2626', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#F0F0F0' }, ticks: { precision: 0 } }
        }
      }
    });
  } else {
    allView.style.display = 'none';
    singleView.style.display = 'block';
    
    const unitData = _unitStatsData.find(d => d.unit_name === selected);
    if (unitData) {
      document.getElementById('kpi-unit-refugees').textContent = unitData.total_refugees_registered.toLocaleString();
      document.getElementById('kpi-unit-vessels').textContent = unitData.total_vessels_checked.toLocaleString();
      document.getElementById('kpi-unit-incidents').textContent = unitData.flagged_incidents.toLocaleString();
    }
  }
}


// ── DOMContentLoaded ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadKPIs();
  _kpiPollInterval = setInterval(loadKPIs, 30000);
  loadCharts();
  const mapEl = document.getElementById('main-map');
  if (mapEl && typeof initMainMap === 'function') {
    initMainMap('main-map');
  }

  // Refugee management tabs
  document.querySelectorAll('#refugee-tab-bar .tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#refugee-tab-bar .tab-item').forEach(t => t.classList.remove('active'));
      ['dash-tab-refugees','dash-tab-released','dash-tab-ngo','dash-tab-ngo-mgmt','dash-tab-unit-stats'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');
      if (tab.dataset.tab === 'dash-tab-refugees') loadDashboardRefugees();
      if (tab.dataset.tab === 'dash-tab-released') loadReleasedRefugeesTab();
      if (tab.dataset.tab === 'dash-tab-ngo') loadNgoAssignmentsTab();
      if (tab.dataset.tab === 'dash-tab-ngo-mgmt') loadNgoMgmtTab();
      if (tab.dataset.tab === 'dash-tab-unit-stats') loadUnitStats();
    });
  });

  // Alerts tabs
  document.querySelectorAll('#alerts-tab-bar .tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#alerts-tab-bar .tab-item').forEach(t => t.classList.remove('active'));
      ['atab-active','atab-history'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.atab);
      if (target) target.classList.add('active');
      if (tab.dataset.atab === 'atab-active') loadAlerts();
      if (tab.dataset.atab === 'atab-history') loadAllAlerts();
    });
  });

  // Default: load refugee list and alerts on page open
  loadDashboardRefugees();
  loadAlerts();
});

// ── Released Refugees Tab ─────────────────────────────────────
window.loadReleasedRefugeesTab = async function() {
  const tbody = document.getElementById('dash-released-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  
  const res = await apiFetch('/api/dashboard/refugees?released=true&limit=200');
  if (!res.success) { showToast('Failed to load released refugees', 'error'); return; }
  
  const items = res.data.items;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-muted)">No released refugees yet</td></tr>';
    return;
  }
  
  tbody.innerHTML = items.map(r => `
    <tr>
      <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}<br>
        <button class="btn btn-secondary btn-sm" style="font-size:10px;padding:4px 8px;margin-top:6px;cursor:pointer" onclick="promptUndoReleaseRefugee('${r.reg_id}')">Revert to Camp</button>
      </td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.force || '—'}</td>
      <td>${formatDateTime(r.registration_date)}</td>
      <td>${r.assigned_camp || '—'}</td>
      <td>${r.assigned_ngo || '—'}</td>
      <td>${statusBadge(r.reg_status)}</td>
    </tr>`).join('');
};

window.promptReleaseRefugee = async function(regId) {
  if (!confirm('Are you sure you want to release this refugee?')) return;
  const officer_id = prompt('Enter Authorizing Officer ID:', 'OFF-001');
  if (!officer_id) {
    showToast('Officer ID is required for authorization', 'error');
    return;
  }
  
  showToast('Authorizing release...', 'info');
  const res = await apiFetch(`/api/dashboard/refugees/${regId}/release`, {
    method: 'POST',
    body: JSON.stringify({ officer_id: officer_id.trim() })
  });
  
  if (res.success) {
    showToast('Refugee released successfully', 'success');
    loadDashboardRefugees();
    loadReleasedRefugeesTab();
  } else {
    showToast(res.message || 'Failed to authorize release', 'error');
  }
};

window.submitReleaseRefugee = async function(regId) {
  const officerInput = document.getElementById('release-override-officer');
  if (!officerInput) return;
  const officer_id = officerInput.value.trim();
  if (!officer_id) {
    showToast('Officer ID is required for authorization', 'error');
    return;
  }
  
  const btn = document.getElementById('btn-submit-release');
  if (btn) { btn.disabled = true; btn.textContent = 'Authorizing...'; }
  
  const res = await apiFetch(`/api/dashboard/refugees/${regId}/release`, {
    method: 'POST',
    body: { officer_id }
  });
  
  if (res.success) {
    showToast('Refugee released successfully', 'success');
    document.getElementById('release-refugee-modal').style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = 'Authorize Release'; }
    loadDashboardRefugees();
    loadReleasedRefugeesTab();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Authorize Release'; }
    showToast(res.message || 'Failed to authorize release', 'error');
  }
};

window.promptUndoReleaseRefugee = async function(regId) {
  if (!confirm('Are you sure you want to revert this refugee back to "at camp"?')) return;
  const officer_id = prompt('Enter Authorizing Officer ID to revert:', 'OFF-001');
  if (!officer_id) {
    showToast('Officer ID is required for authorization', 'error');
    return;
  }
  
  showToast('Authorizing reversion...', 'info');
  const res = await apiFetch(`/api/dashboard/refugees/${regId}/undo-release`, { 
    method: 'POST',
    body: JSON.stringify({ officer_id: officer_id.trim() })
  });
  
  if (res.success) {
    showToast('Refugee reverted to camp successfully', 'success');
    loadDashboardRefugees();
    loadReleasedRefugeesTab();
  } else {
    showToast(res.message || 'Failed to revert', 'error');
  }
};

