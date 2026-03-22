/* sea-marshall.js — Vessel table, flag logic, status & movement management */

let _vessels = [];

// ── Movement helpers ───────────────────────────────────────────
const MOVEMENT = {
  APPROACHING: { icon: '🔵', label: 'Approaching',   color: '#0284C7' },
  DOCKED:      { icon: '⚓', label: 'Docked at Port', color: '#1A7F4B' },
  DEPARTING:   { icon: '🚢', label: 'Departing',      color: '#B45309' },
};
function movementBadge(mov) {
  const m = MOVEMENT[mov] || MOVEMENT.APPROACHING;
  return `<span class="mov-badge" style="color:${m.color}">${m.icon} ${m.label}</span>`;
}

// ── Manual IMO Lookup ─────────────────────────────────────────
async function lookupByIMO() {
  const input = document.getElementById('imo-lookup-input');
  const imo = input?.value.trim().replace(/\s+/g, '');
  if (!imo) { showToast('Enter an IMO number to search', 'error'); return; }
  let vessel = _vessels.find(v => v.imo === imo);
  if (!vessel) {
    const res = await apiFetch(`/api/sea-marshall/vessels/${encodeURIComponent(imo)}`);
    if (res.success && res.data) {
      vessel = res.data;
      if (!_vessels.find(v => v.imo === imo)) _vessels.push(vessel);
    } else {
      showToast(`IMO ${imo} not found in vessel register.`, 'warning');
      return;
    }
  }
  inspectVessel(vessel.imo);
  showToast(`Vessel profile loaded: ${vessel.vessel_name}`, 'info');
}

async function loadVessels() {
  const res = await apiFetch('/api/sea-marshall/vessels');
  if (!res.success) { showToast('Failed to load vessel data', 'error'); return; }
  _vessels = res.data;
  renderVesselTable(_vessels);
  updateKPIs(_vessels);
  loadSeaCharts();
}

function updateKPIs(vessels) {
  const total     = vessels.length;
  const flagged   = vessels.filter(v => v.is_flagged || v.status === 'FLAGGED_ILLEGAL').length;
  const inspected = vessels.filter(v => v.status === 'INTERCEPTED').length;
  const cleared   = vessels.filter(v => v.status === 'CLEARED').length;
  const el = id => document.getElementById(id);
  if (el('kpi-total'))     el('kpi-total').textContent     = total;
  if (el('kpi-cleared'))   el('kpi-cleared').textContent   = cleared;
  if (el('kpi-inspected')) el('kpi-inspected').textContent = inspected;
  if (el('kpi-alerts'))    el('kpi-alerts').textContent    = flagged;
}

function renderVesselTable(vessels) {
  const tbody = document.getElementById('vessel-tbody');
  if (!tbody) return;
  const viewMode = document.getElementById('vessel-view-mode')?.value || 'active';
  const now = new Date();

  const activeVessels = [];
  const historyVessels = [];

  vessels.forEach(v => {
    if (v.movement_status === 'DEPARTING' && v.departed_at) {
      let dStr = v.departed_at;
      if (!dStr.endsWith('Z') && dStr.includes(' ')) dStr = dStr.replace(' ', 'T') + 'Z';
      const depDate = new Date(dStr);
      const daysPassed = Math.floor((now - depDate) / (1000 * 60 * 60 * 24));
      v._daysPassed = Math.max(0, daysPassed);
      
      if (daysPassed >= 7) {
        historyVessels.push(v);
      } else {
        activeVessels.push(v);
      }
    } else {
      activeVessels.push(v);
    }
  });

  const displayList = viewMode === 'active' ? activeVessels : historyVessels;

  if (viewMode === 'history') {
    tbody.innerHTML = displayList.map(v => {
      return `
      <tr id="row-${v.imo}">
        <td colspan="14" style="padding:12px 16px">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
            <span><strong>IMO:</strong> ${v.imo}</span>
            <span><strong>Name:</strong> ${v.vessel_name}</span>
            <span><strong>Type:</strong> ${v.vessel_type}</span>
            <span><strong>Flag:</strong> ${v.flag_state.split('(')[0].trim()}</span>
            <span><strong>Departed On:</strong> ${formatDate(v.departed_at)}</span>
            <button class="btn btn-secondary btn-sm" onclick="inspectVessel('${v.imo}')">View Details</button>
          </div>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="14" style="text-align:center;padding:20px;color:var(--color-text-muted)">No historical departed vessel records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map(v => {
    const isFlagged    = v.is_flagged || v.status === 'FLAGGED_ILLEGAL';
    const isUnverified = v.status === 'UNVERIFIED';
    const rowClass     = isFlagged ? 'row-flagged' : (isUnverified ? 'row-unverified' : '');
    const mov          = v.movement_status || 'APPROACHING';
    const m            = MOVEMENT[mov] || MOVEMENT.APPROACHING;
    const isHC = v.health_clearance === 1;
    const isCC = v.customs_clearance === 1;
    let clHtml = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <span class="badge" style="background:${isHC ? 'var(--color-success)' : 'var(--color-alert)'};color:#fff;font-size:10px;padding:2px 4px">Health ${isHC ? '✓' : '✗'}</span>
        <span class="badge" style="background:${isCC ? 'var(--color-success)' : 'var(--color-alert)'};color:#fff;font-size:10px;padding:2px 4px">Customs ${isCC ? '✓' : '✗'}</span>
      </div>
    `;
    if (isHC && isCC) {
      clHtml += `<div style="margin-top:6px"><span class="badge" style="background:var(--color-success);color:#fff;font-size:10px;width:100%;text-align:center;padding:3px 6px">Cleared</span></div>`;
    } else {
      clHtml += `<div style="margin-top:6px"><span class="badge" style="background:var(--color-alert);color:#fff;font-size:10px;width:100%;text-align:center;padding:3px 6px">Denied</span></div>`;
    }

    let movHtml = `<span class="mov-badge" style="color:${m.color};font-size:13px">${m.icon} ${m.label}</span>`;
    if (mov === 'DEPARTING' && v.departed_at) {
       movHtml += `<div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;font-weight:600">Day ${v._daysPassed + 1} of 7</div>`;
    }

    return `
    <tr class="${rowClass}" id="row-${v.imo}">
      <td><span class="font-mono">${isFlagged ? '<span class="flag-pulse"></span> ' : ''}</span>${v.imo}</td>
      <td><strong>${v.vessel_name}</strong></td>
      <td>${v.vessel_type}</td>
      <td>${v.flag_state.split('(')[0].trim()}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${v.cargo||''}">${v.cargo||'—'}</td>
      <td class="font-mono">${v.gross_tonnage?.toLocaleString()||'—'}</td>
      <td>${v.destination_port?.split(',')[0]||'—'}</td>
      <td class="font-mono">${v.eta||'—'}</td>
      <td>${v.captain||'—'}</td>
      <td class="font-mono">${v.crew_count||'—'}</td>
      <td>${movHtml}</td>
      <td>${statusBadge(v.status)}</td>
      <td>${clHtml}</td>
      <td>
        <div class="table-actions" style="flex-direction:column;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="inspectVessel('${v.imo}')" style="width:100%">Inspect</button>
          <button class="btn btn-primary btn-sm" onclick="manageClearance('${v.imo}')" style="width:100%">Clearance</button>
          ${isFlagged ? `<button class="btn btn-danger btn-sm" onclick="showIncidentModal('${v.imo}')" style="width:100%">Report</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Inspect Vessel Drawer ─────────────────────────────────────
function inspectVessel(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  if (!vessel) return;
  const status       = vessel.status || 'CLEARED';
  const mov          = vessel.movement_status || 'APPROACHING';
  const isFlagged    = status === 'FLAGGED_ILLEGAL';
  const isIntercepted= status === 'INTERCEPTED';
  const isUnverified = status === 'UNVERIFIED';
  const isCleared    = status === 'CLEARED';
  const imoVerified  = !isFlagged;

  // Movement position changer
  const movSelectorHtml = `
    <div style="margin-top:12px;border-top:1px solid var(--color-border);padding-top:12px">
      <div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Update Movement Status</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${Object.entries(MOVEMENT).map(([k,m]) => `
          <button class="btn btn-sm mov-change-btn ${mov===k?'mov-active':''}"
            style="color:${m.color};border-color:${mov===k?m.color:'var(--color-border)'};background:${mov===k?`${m.color}18`:'transparent'}"
            onclick="setMovementStatus('${imo}','${k}',this)">${m.icon} ${m.label}</button>
        `).join('')}
      </div>
    </div>`;

  // Security action buttons based on status
  let actionSection = '';
  if (isCleared) {
    actionSection = `
      <div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:14px">
        <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Officer Actions</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-sm" style="background:rgba(180,130,0,0.1);color:#B27800;border:1.5px solid rgba(180,130,0,0.3);font-weight:700"
            onclick="markUnverified('${imo}')">⏳ Revoke Clearance — Mark as Unverified</button>
          <button class="btn btn-danger btn-sm" onclick="flagVessel('${imo}')" style="width:100%">⚑ Flag as Illegal / Suspicious</button>
        </div>
      </div>`;
  } else if (isUnverified) {
    actionSection = `
      <div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:14px">
        <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Officer Actions</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-sm" style="background:rgba(26,127,75,0.1);color:var(--color-success);border:1.5px solid rgba(26,127,75,0.3);font-weight:700"
            onclick="verifyVessel('${imo}')">✓ Verify &amp; Clear This Vessel</button>
          <button class="btn btn-danger btn-sm" onclick="flagVessel('${imo}')" style="width:100%">⚑ Flag as Illegal / Suspicious</button>
          <button class="btn btn-sm" style="background:rgba(220,38,38,0.1);color:var(--color-alert);border:1.5px solid rgba(220,38,38,0.3);font-weight:700"
            onclick="issueInterceptOrder('${imo}')">⚑ Issue Intercept Order — Coast Guard</button>
        </div>
      </div>`;
  } else if (isFlagged) {
    actionSection = `
      <div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:14px">
        <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Officer Actions</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-sm" style="background:rgba(26,127,75,0.1);color:var(--color-success);border:1.5px solid rgba(26,127,75,0.3);font-weight:700"
            onclick="verifyVessel('${imo}')">✓ Clear &amp; Verify This Vessel (Override)</button>
          <button class="btn btn-sm" style="background:rgba(220,38,38,0.1);color:var(--color-alert);border:1.5px solid rgba(220,38,38,0.3);font-weight:700"
            onclick="issueInterceptOrder('${imo}')">⚑ Issue Intercept Order — Coast Guard</button>
          <button class="btn btn-secondary btn-sm" onclick="showIncidentModal('${imo}')" style="width:100%">📋 File Incident Report</button>
        </div>
      </div>`;
  } else if (isIntercepted) {
    actionSection = `
      <div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:14px">
        <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Officer Actions</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-sm" style="background:rgba(26,127,75,0.1);color:var(--color-success);border:1.5px solid rgba(26,127,75,0.3);font-weight:700"
            onclick="verifyVessel('${imo}')">✓ Boarding Complete — Clear &amp; Release Vessel</button>
          <button class="btn btn-secondary btn-sm" onclick="showIncidentModal('${imo}')" style="width:100%">📋 File Incident Report</button>
        </div>
      </div>`;
  }

  const drawerHTML = `
    <div class="data-grid" style="margin-bottom:16px">
      <div class="data-field"><span class="data-label">IMO</span><span class="data-value mono">${vessel.imo} ${imoVerified ? '<span class="imo-verify-ok">✓ Verified</span>' : '<span class="imo-verify-warn">⚠ NOT IN REGISTRY</span>'}</span></div>
      <div class="data-field"><span class="data-label">Flag State</span><span class="data-value">${vessel.flag_state}</span></div>
      <div class="data-field"><span class="data-label">Vessel Type</span><span class="data-value">${vessel.vessel_type}</span></div>
      <div class="data-field"><span class="data-label">Gross Tonnage</span><span class="data-value mono">${vessel.gross_tonnage?.toLocaleString()||'—'} GT</span></div>
      <div class="data-field"><span class="data-label">Captain</span><span class="data-value">${vessel.captain||'—'}</span></div>
      <div class="data-field"><span class="data-label">Crew Count</span><span class="data-value">${vessel.crew_count||'—'}</span></div>
      <div class="data-field"><span class="data-label">Last Port</span><span class="data-value">${vessel.last_port||'—'}</span></div>
      <div class="data-field"><span class="data-label">Destination</span><span class="data-value">${vessel.destination_port||'—'}</span></div>
      <div class="data-field"><span class="data-label">ETA</span><span class="data-value mono">${vessel.eta||'—'}</span></div>
      <div class="data-field col-span-2"><span class="data-label">Declared Cargo</span><span class="data-value">${vessel.cargo||'—'}</span></div>
    </div>
    ${isFlagged && vessel.flag_reason ? `<blockquote class="vessel-flag-reason"><strong>INTEL / SECURITY FLAG REASON</strong><br><br>${vessel.flag_reason}</blockquote>` : ''}
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
      ${statusBadge(status)}
      ${movementBadge(mov)}
      <div style="margin-left:auto;">
         <button class="btn btn-secondary btn-sm" onclick="openEditVesselModal('${imo}')">✏ Edit Details</button>
      </div>
    </div>
    ${movSelectorHtml}
    ${actionSection}
  `;
  openDrawer(drawerHTML, `${vessel.vessel_name} — IMO ${vessel.imo}`);
}

// ── Set Movement Status inline (from drawer) ───────────────────
async function setMovementStatus(imo, newMov, btnEl) {
  const v = _vessels.find(v => v.imo === imo);
  if (!v) return;

  if (newMov === 'DEPARTING') {
    if (v.health_clearance !== 1 || v.customs_clearance !== 1) {
      showToast('Cannot depart: Vessel requires BOTH Health and Customs clearance first.', 'error');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Confirm Vessel Departure',
      message: `<strong>Vessel:</strong> ${v.vessel_name || imo}<br><strong>IMO:</strong> ${imo}<br><br>Are you sure you want to mark this vessel as departed? This will start a 7-day tracking timer before moving it to history.`,
      confirmText: 'Confirm Departure'
    });
    if (!confirmed) return;
  }

  const currentMov = v.movement_status || 'APPROACHING';
  if (currentMov === 'DOCKED' && newMov === 'APPROACHING') {
    showToast('Cannot revert to approaching: Vessel is already docked.', 'warning');
    return;
  }

  const res = await apiFetch('/api/sea-marshall/set-movement-status', {
    method: 'POST',
    body: JSON.stringify({ imo, movement_status: newMov })
  });
  if (res.success) {
    // Update local cache
    const v = _vessels.find(v => v.imo === imo);
    if (v) v.movement_status = newMov;
    // Update all buttons in drawer
    const allBtns = btnEl.parentElement.querySelectorAll('.mov-change-btn');
    allBtns.forEach(b => {
      b.classList.remove('mov-active');
      b.style.background = 'transparent';
      b.style.borderColor = 'var(--color-border)';
    });
    const m = MOVEMENT[newMov];
    btnEl.classList.add('mov-active');
    btnEl.style.background = `${m.color}18`;
    btnEl.style.borderColor = m.color;
    // Update table row
    // Force complete redraw to properly handle timer UI
    document.getElementById('vessel-tbody').innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px;color:var(--color-text-muted)">Reloading traffic data...</td></tr>';
    await loadVessels();
    
    showToast(`Movement status updated: ${m.icon} ${m.label}`, 'success');
    loadSeaCharts();
  } else {
    showToast('Failed to update movement status: ' + res.message, 'error');
  }
}

// ── Verify a vessel ───────────────────────────────────────────
async function verifyVessel(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  const confirmed = await confirmDialog({
    title: '✓ Verify & Clear Vessel',
    message: `<strong>Vessel:</strong> ${vessel?.vessel_name || imo}<br><strong>IMO:</strong> ${imo}<br><br>This will mark the vessel as <strong>Verified &amp; Cleared</strong>. All flags and intercept orders will be lifted.`,
    confirmText: '✓ Confirm — Clear Vessel'
  });
  if (!confirmed) return;
  const res = await apiFetch('/api/sea-marshall/verify-vessel', {
    method: 'POST',
    body: JSON.stringify({ imo, verified_by: getSession()?.user_id || 'Marshal' })
  });
  if (res.success) {
    closeDrawer();
    showToast(`✓ Vessel IMO ${imo} cleared and verified.`, 'success');
    await loadVessels();
  } else {
    showToast('Failed to verify vessel: ' + res.message, 'error');
  }
}

// ── Mark Unverified ───────────────────────────────────────────
async function markUnverified(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  const confirmed = await confirmDialog({
    title: '⏳ Revoke Clearance',
    message: `<strong>Vessel:</strong> ${vessel?.vessel_name || imo}<br><br>This will remove clearance and mark the vessel as <strong>Unverified</strong>.`,
    confirmText: 'Revoke Clearance'
  });
  if (!confirmed) return;
  const res = await apiFetch('/api/sea-marshall/set-vessel-status', {
    method: 'POST',
    body: JSON.stringify({ imo, status: 'UNVERIFIED', updated_by: getSession()?.user_id || 'Marshal' })
  });
  if (res.success) {
    closeDrawer();
    showToast(`Vessel IMO ${imo} marked as Unverified.`, 'warning');
    await loadVessels();
  } else {
    showToast('Failed to update: ' + res.message, 'error');
  }
}

// ── Vessel Clearance Logic ──────────────────────────────────────
window.manageClearance = function(imo) {
  let panelRow = document.getElementById(`panel-${imo}`);
  if (panelRow) {
    panelRow.remove();
    return;
  }
  
  // Close any other open clearance panels
  document.querySelectorAll('.clearance-panel-row').forEach(el => el.remove());
  
  const tr = document.getElementById(`row-${imo}`);
  if (!tr) return;
  
  const vessel = _vessels.find(v => v.imo === imo);
  if (!vessel) return;
  
  const isHC = vessel.health_clearance === 1;
  const isCC = vessel.customs_clearance === 1;
  const mov = vessel.movement_status || 'APPROACHING';

  panelRow = document.createElement('tr');
  panelRow.id = `panel-${imo}`;
  panelRow.className = 'clearance-panel-row';
  
  panelRow.innerHTML = `
    <td colspan="14" style="padding: 16px; background: var(--color-surface); border-bottom: 2px solid var(--color-border); border-left: 4px solid var(--color-primary);">
      <div style="display:flex; gap: 24px; font-size: 13px;">
         <div style="flex:1;">
           <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
             <strong>Health Clearance</strong>
             <span id="hc-status-${imo}" style="color:${isHC ? 'var(--color-success)' : 'var(--color-alert)'}; font-weight:600;">Status: ${isHC ? '✓ Granted' : '✗ Denied'}</span>
             ${isHC ? 
               `<button type="button" class="btn btn-danger btn-sm" onclick="prepareClearanceAction('${imo}', 'health', false)">Deny Health</button>` : 
               `<button type="button" class="btn btn-success btn-sm" onclick="prepareClearanceAction('${imo}', 'health', true)" ${mov!=='DOCKED'?'disabled title="Vessel must be docked"':''}>Grant Health</button>`
             }
           </div>
           <div style="display:flex; justify-content:space-between; align-items:center;">
             <strong>Customs Clearance</strong>
             <span id="cc-status-${imo}" style="color:${isCC ? 'var(--color-success)' : 'var(--color-alert)'}; font-weight:600;">Status: ${isCC ? '✓ Granted' : '✗ Denied'}</span>
             ${isCC ? 
               `<button type="button" class="btn btn-danger btn-sm" onclick="prepareClearanceAction('${imo}', 'customs', false)">Deny Customs</button>` : 
               `<button type="button" class="btn btn-success btn-sm" onclick="prepareClearanceAction('${imo}', 'customs', true)" ${mov!=='DOCKED'?'disabled title="Vessel must be docked"':''}>Grant Customs</button>`
             }
           </div>
           
           <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--color-border); display:flex; gap:8px;">
             <strong>Batch Action</strong>
             <button type="button" class="btn btn-sm" style="background:var(--color-success);color:#fff;margin-left:auto" onclick="prepareClearanceAction('${imo}', 'both', true)" ${mov!=='DOCKED'?'disabled title="Vessel must be docked"':''}>Grant Both</button>
             <button type="button" class="btn btn-sm" style="background:var(--color-alert);color:#fff" onclick="prepareClearanceAction('${imo}', 'both', false)">Deny Both</button>
           </div>
         </div>
         
         <div id="auth-panel-${imo}" style="flex:1; border-left: 1px solid var(--color-border); padding-left: 24px; opacity: 0.5; pointer-events: none; transition: opacity 0.2s;">
            <div style="margin-bottom:8px;"><strong>Officer Override Required</strong></div>
            <div style="display:flex; gap: 8px; align-items:center; margin-bottom:12px;">
              <label style="width:80px;">Officer ID:</label>
              <input type="text" id="officer-id-${imo}" class="form-input" style="flex:1;" placeholder="Enter ID to confirm">
            </div>
            <div style="display:flex; gap: 8px; justify-content:flex-end;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="cancelClearanceAction('${imo}')">Cancel</button>
              <button type="button" class="btn btn-primary btn-sm" id="confirm-btn-${imo}" onclick="confirmClearanceAction('${imo}')">Confirm Action</button>
            </div>
         </div>
         <div style="display:flex; justify-content:flex-end; align-items:flex-start; margin-left: auto;">
             <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('panel-${imo}').remove()">✕ Close Panel</button>
         </div>
      </div>
    </td>
  `;
  
  tr.parentNode.insertBefore(panelRow, tr.nextSibling);
};

window._pendingClearance = {};

window.prepareClearanceAction = function(imo, type, granted) {
  window._pendingClearance[imo] = { type, granted };
  const authPanel = document.getElementById(`auth-panel-${imo}`);
  if (authPanel) {
    authPanel.style.opacity = '1';
    authPanel.style.pointerEvents = 'auto';
    const input = document.getElementById(`officer-id-${imo}`);
    if(input) {
      input.value = '';
      input.placeholder = `Enter ID to confirm ${granted ? 'grant' : 'denial'}`;
      input.focus();
    }
    const btn = document.getElementById(`confirm-btn-${imo}`);
    if(btn) btn.innerText = `Confirm ${granted ? 'Grant' : 'Deny'}`;
  }
};

window.cancelClearanceAction = function(imo) {
  delete window._pendingClearance[imo];
  const authPanel = document.getElementById(`auth-panel-${imo}`);
  if (authPanel) {
    authPanel.style.opacity = '0.5';
    authPanel.style.pointerEvents = 'none';
    const input = document.getElementById(`officer-id-${imo}`);
    if(input) input.value = '';
  }
};

window.confirmClearanceAction = async function(imo) {
  const pending = window._pendingClearance[imo];
  if (!pending) return;
  const input = document.getElementById(`officer-id-${imo}`);
  const officer_id = input ? input.value.trim() : '';
  if (!officer_id) {
    showToast(`Officer ID is required to ${pending.granted ? 'grant' : 'deny'} clearance`, 'error');
    if(input) input.classList.add('error');
    return;
  }
  if(input) input.classList.remove('error');
  
  const btn = document.getElementById(`confirm-btn-${imo}`);
  if (btn) btn.disabled = true;
  
  if (pending.type === 'both') {
    const resH = await apiFetch(`/api/sea-marshall/vessels/${imo}/health-clearance`, { method: 'POST', body: { officer_id, granted: pending.granted, notes: '' } });
    const resC = await apiFetch(`/api/sea-marshall/vessels/${imo}/customs-clearance`, { method: 'POST', body: { officer_id, granted: pending.granted, notes: '' } });
    if (resH.success && resC.success) {
      showToast(`Both clearances ${pending.granted ? 'granted' : 'denied'}`, 'success');
      const vessel = _vessels.find(v => v.imo === imo);
      if (vessel) {
        const flag = pending.granted ? 1 : 0;
        vessel.health_clearance = flag;
        vessel.health_clearance_by = officer_id;
        vessel.health_clearance_at = new Date().toISOString();
        vessel.customs_clearance = flag;
        vessel.customs_clearance_by = officer_id;
        vessel.customs_clearance_at = new Date().toISOString();
      }
      const panel = document.getElementById(`panel-${imo}`);
      if (panel) panel.remove();
      updateVesselRowBadge(imo, vessel);
    } else {
      showToast(`Error updating both clearances.`, 'error');
      if (btn) btn.disabled = false;
    }
  } else {
    await submitInlineClearance(imo, pending.type, pending.granted, officer_id);
  }
};

window.submitInlineClearance = async function(imo, type, granted, officer_id = 'System') {
  const res = await apiFetch(`/api/sea-marshall/vessels/${imo}/${type}-clearance`, {
    method: 'POST',
    body: { officer_id, granted, notes: '' }
  });
  
  if (res.success) {
    showToast(`${type.toUpperCase()} clearance updated`, 'success');
    
    // Update local vessel state
    const vessel = _vessels.find(v => v.imo === imo);
    if (vessel) {
       vessel[`${type}_clearance`] = granted ? 1 : 0;
       vessel[`${type}_clearance_by`] = officer_id;
       vessel[`${type}_clearance_at`] = new Date().toISOString();
    }
    
    // Close the inline panel immediately
    const panel = document.getElementById(`panel-${imo}`);
    if (panel) panel.remove();
    
    updateVesselRowBadge(imo, vessel);
  } else {
    showToast(`Error: ${res.message}`, 'error');
    const btn = document.getElementById(`confirm-btn-${imo}`);
    if (btn) btn.disabled = false;
  }
};

window.updateVesselRowBadge = function(imo, vessel) {
  const row = document.getElementById(`row-${imo}`);
  if (row && vessel) {
    const isHC = vessel.health_clearance === 1;
    const isCC = vessel.customs_clearance === 1;
    let clHtml = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <span class="badge" style="background:${isHC ? 'var(--color-success)' : 'var(--color-alert)'};color:#fff;font-size:10px;padding:2px 4px">Health ${isHC ? '✓' : '✗'}</span>
        <span class="badge" style="background:${isCC ? 'var(--color-success)' : 'var(--color-alert)'};color:#fff;font-size:10px;padding:2px 4px">Customs ${isCC ? '✓' : '✗'}</span>
      </div>
    `;
    if (isHC && isCC) {
      clHtml += `<div style="margin-top:6px"><span class="badge" style="background:var(--color-success);color:#fff;font-size:10px;width:100%;text-align:center;padding:3px 6px">Cleared</span></div>`;
    } else {
      clHtml += `<div style="margin-top:6px"><span class="badge" style="background:var(--color-alert);color:#fff;font-size:10px;width:100%;text-align:center;padding:3px 6px">Denied</span></div>`;
    }
    
    if (row.cells[12]) row.cells[12].innerHTML = clHtml;
    updateKPIs(_vessels);
  }
};

// ── Flag Vessel ────────────────────────────────────────────────
async function flagVessel(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  openModal({
    title: '⚑ Flag Vessel as Illegal / Suspicious',
    body: `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="alert-banner warning" style="margin-bottom:0">
          <div class="alert-body-text">Flagging <strong>${vessel?.vessel_name || imo}</strong> as suspicious. A watch-list entry will be created and forwarded to Intel Command.</div>
        </div>
        <div class="form-group">
          <label class="form-label required">Reason for Flagging</label>
          <select id="flag-reason-type">
            <option value="Undeclared Cargo Suspected">Undeclared Cargo Suspected</option>
            <option value="AIS Anomaly">AIS Signal Anomaly / Transponder Off</option>
            <option value="Unusual Route">Unusual / Suspicious Route</option>
            <option value="Intelligence Tip">Intelligence Tip-off</option>
            <option value="Document Discrepancy">Document Discrepancy</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label required">Details</label>
          <textarea id="flag-details" rows="3" placeholder="Describe the suspicious activity..."></textarea>
        </div>
      </div>`,
    footer: `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-danger" onclick="submitVesselFlag('${imo}')">⚑ Confirm Flag</button>`
  });
}

async function submitVesselFlag(imo) {
  const reason  = document.getElementById('flag-reason-type')?.value;
  const details = document.getElementById('flag-details')?.value.trim();
  if (!details) { showToast('Please provide flagging details', 'error'); return; }
  const res = await apiFetch('/api/sea-marshall/flag-vessel', {
    method: 'POST',
    body: JSON.stringify({ imo, flag_reason: `${reason}: ${details}`, flagged_by: getSession()?.user_id || 'Marshal' })
  });
  if (res.success) {
    closeModal(); closeDrawer();
    showToast(`Vessel IMO ${imo} flagged. Intel Command notified.`, 'success');
    await loadVessels();
  } else {
    showToast('Failed to flag: ' + res.message, 'error');
  }
}

// ── Intercept Order ────────────────────────────────────────────
async function issueInterceptOrder(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  const confirmed = await confirmDialog({
    title: 'Confirm Coastal Guard Intercept Order',
    message: `<strong>Vessel:</strong> ${vessel?.vessel_name || imo}<br><strong>IMO:</strong> ${imo}<br><br>Notify the Indian Coastal Guard and lock berth clearance. This cannot be undone.`,
    confirmText: 'Confirm — Issue Order'
  });
  if (!confirmed) return;
  const res = await apiFetch('/api/sea-marshall/lock-vessel', { method: 'POST', body: JSON.stringify({ imo }) });
  if (res.success) {
    closeDrawer();
    showToast(`Intercept order for IMO ${imo} issued. Coast Guard notified.`, 'success');
    await loadVessels();
  } else {
    showToast('Failed to issue intercept order: ' + res.message, 'error');
  }
}

// ── Incident Report Modal ──────────────────────────────────────
function showIncidentModal(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  openModal({
    title: 'File Incident Report — Maritime Security',
    body: `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="form-row-2">
          <div class="form-group"><label class="form-label">IMO</label><input type="text" value="${imo}" readonly></div>
          <div class="form-group"><label class="form-label">Vessel Name</label><input type="text" value="${vessel?.vessel_name||''}" readonly></div>
        </div>
        <div class="form-group"><label class="form-label required">Incident Type</label>
          <select id="inc-type"><option>Arms Suspected</option><option>Narcotics Suspected</option><option>Document Fraud</option><option>Unauthorized Entry</option><option>Other</option></select>
        </div>
        <div class="form-group"><label class="form-label required">Description</label><textarea id="inc-desc" rows="4" placeholder="Describe the incident in detail..."></textarea></div>
      </div>`,
    footer: `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-danger" onclick="submitIncident('${imo}')">File Report →</button>`
  });
}

async function submitIncident(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  const description = document.getElementById('inc-desc')?.value;
  if (!description) { showToast('Description is required', 'error'); return; }
  const res = await apiFetch('/api/sea-marshall/file-incident', {
    method: 'POST',
    body: JSON.stringify({
      imo,
      incident_type: document.getElementById('inc-type')?.value,
      severity: (vessel?.is_flagged || vessel?.status === 'FLAGGED_ILLEGAL') ? 'Critical' : 'High',
      description,
      location: 'Maritime — Indian EEZ',
      reporting_marshal: `Marshal-${getSession()?.user_id || 'Sea'}`
    })
  });
  if (res.success) {
    closeModal();
    showToast(`Incident ${res.data?.incident_id} filed successfully.`, 'success');
  } else {
    showToast('Failed to file incident: ' + res.message, 'error');
  }
}

// ── Charts ─────────────────────────────────────────────────────
let _chartTypes = null, _chartFlags = null, _chartMovement = null;

function loadSeaCharts() {
  const vessels = _vessels;
  if (!vessels.length) return;

  // Chart 1: Vessel Types (bar)
  const typeCtx = document.getElementById('chart-vessel-types')?.getContext('2d');
  if (typeCtx) {
    const typeCounts = {};
    vessels.forEach(v => { typeCounts[v.vessel_type] = (typeCounts[v.vessel_type] || 0) + 1; });
    if (_chartTypes) _chartTypes.destroy();
    _chartTypes = new Chart(typeCtx, {
      type: 'bar',
      data: { labels: Object.keys(typeCounts), datasets: [{ data: Object.values(typeCounts), backgroundColor: '#0057B8', borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#F0F0F0' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }, responsive: true, maintainAspectRatio: false }
    });
  }

  // Chart 2: Flag States (pie)
  const flagCtx = document.getElementById('chart-flags')?.getContext('2d');
  if (flagCtx) {
    const flagCounts = {};
    vessels.forEach(v => { const f = v.flag_state.split('(')[0].trim(); flagCounts[f] = (flagCounts[f] || 0) + 1; });
    const colors = ['#0057B8', '#002147', '#1A7F4B', '#D97706', '#DC2626', '#0284C7', '#8B5CF6', '#6B7280'];
    if (_chartFlags) _chartFlags.destroy();
    _chartFlags = new Chart(flagCtx, {
      type: 'pie',
      data: { labels: Object.keys(flagCounts), datasets: [{ data: Object.values(flagCounts), backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } } } }
    });
  }

  // Chart 3: Movement Status (doughnut)
  const movCtx = document.getElementById('chart-movement')?.getContext('2d');
  if (movCtx) {
    const movCounts = { DOCKED: 0, APPROACHING: 0, DEPARTING: 0 };
    vessels.forEach(v => {
      const ms = v.movement_status || 'APPROACHING';
      if (ms in movCounts) movCounts[ms]++;
    });
    const movLabels  = ['⚓ Docked at Port', '🔵 Approaching', '🚢 Departing'];
    const movColors  = ['#1A7F4B', '#0284C7', '#B45309'];
    if (_chartMovement) _chartMovement.destroy();
    _chartMovement = new Chart(movCtx, {
      type: 'doughnut',
      data: {
        labels: movLabels,
        datasets: [{ data: [movCounts.DOCKED, movCounts.APPROACHING, movCounts.DEPARTING], backgroundColor: movColors, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        cutout: '55%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } } }
      }
    });
  }
}

// ── Register New Vessel ────────────────────────────────────────
function toggleRegisterPanel() {
  const body  = document.getElementById('register-vessel-body');
  const arrow = document.getElementById('register-toggle-arrow');
  if (!body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  arrow?.classList.toggle('open', !isOpen);
}

function resetRegisterForm() {
  const form = document.getElementById('register-vessel-form');
  if (form) form.reset();
  const defStatus = document.getElementById('rv-status-unverified');
  if (defStatus) defStatus.checked = true;
  const defMov = document.getElementById('rv-mov-approaching');
  if (defMov) defMov.checked = true;
}

async function registerNewVessel() {
  const btn         = document.getElementById('rv-submit-btn');
  const imo         = document.getElementById('rv-imo')?.value.trim();
  const vessel_name = document.getElementById('rv-name')?.value.trim();
  const vessel_type = document.getElementById('rv-type')?.value;
  const flag_state  = document.getElementById('rv-flag')?.value.trim();
  const statusRad   = document.querySelector('input[name="rv-status"]:checked');
  const movRad      = document.querySelector('input[name="rv-movement"]:checked');
  const initialStatus   = statusRad?.value || 'UNVERIFIED';
  const initialMovement = movRad?.value || 'APPROACHING';

  if (!imo || !vessel_name || !vessel_type || !flag_state) {
    showToast('Please fill in all required fields (IMO, Name, Type, Flag State)', 'error');
    return;
  }
  if (!/^\d{7}$/.test(imo)) {
    showToast('IMO number must be exactly 7 digits', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Registering…'; }

  const etaRaw = document.getElementById('rv-eta')?.value;
  const payload = {
    imo, vessel_name, vessel_type, flag_state,
    status: initialStatus,
    movement_status: initialMovement,
    country_of_origin: document.getElementById('rv-country')?.value.trim() || null,
    gross_tonnage:     document.getElementById('rv-tonnage')?.value || null,
    captain:           document.getElementById('rv-captain')?.value.trim() || null,
    crew_count:        document.getElementById('rv-crew')?.value || null,
    last_port:         document.getElementById('rv-lastport')?.value.trim() || null,
    destination_port:  document.getElementById('rv-dest')?.value.trim() || null,
    eta:               etaRaw ? etaRaw.replace('T', ' ') : null,
    cargo:             document.getElementById('rv-cargo')?.value.trim() || null,
  };

  const res = await apiFetch('/api/sea-marshall/vessels', { method: 'POST', body: JSON.stringify(payload) });
  if (btn) { btn.disabled = false; btn.textContent = 'Register Vessel →'; }

  if (res.success) {
    const m = MOVEMENT[initialMovement];
    showToast(`✓ Vessel ${vessel_name} registered — ${m.icon} ${m.label}, ${initialStatus}.`, 'success', 5000);
    resetRegisterForm();
    toggleRegisterPanel();
    await loadVessels();
  } else {
    showToast('Registration failed: ' + (res.message || 'Unknown error'), 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadVessels();
});

// ── Edit Details Logic ─────────────────────────────────────────
window.openEditVesselModal = function(imo) {
  const vessel = _vessels.find(v => v.imo === imo);
  if (!vessel) return;
  
  openModal({
    title: `Edit Details: ${vessel.vessel_name}`,
    body: `
      <form id="edit-vessel-form" onsubmit="submitEditVessel(event, '${imo}')">
        <div class="form-row-2" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">IMO</label>
            <input type="text" class="form-input" value="${imo}" disabled style="background:var(--color-bg)">
          </div>
          <div class="form-group">
            <label class="form-label required">Vessel Name</label>
            <input type="text" id="edit-v-name" class="form-input" value="${vessel.vessel_name || ''}" required>
          </div>
        </div>
        
        <div class="form-row-2" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label required">Vessel Type</label>
            <input type="text" id="edit-v-type" class="form-input" value="${vessel.vessel_type || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label required">Flag State</label>
            <input type="text" id="edit-v-flag" class="form-input" value="${vessel.flag_state || ''}" required>
          </div>
        </div>
        
        <div class="form-row-2" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">Captain</label>
            <input type="text" id="edit-v-captain" class="form-input" value="${vessel.captain || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Gross Tonnage</label>
            <input type="number" id="edit-v-tonnage" class="form-input" value="${vessel.gross_tonnage || ''}">
          </div>
        </div>
        
        <div class="form-row-2" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">Destination Port</label>
            <input type="text" id="edit-v-dest" class="form-input" value="${vessel.destination_port || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Declared Cargo</label>
            <input type="text" id="edit-v-cargo" class="form-input" value="${vessel.cargo || ''}">
          </div>
        </div>
      </form>
    `,
    footer: `
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="submit" form="edit-vessel-form" class="btn btn-primary" id="btn-save-edit">Save Changes</button>
    `
  });
};

window.submitEditVessel = async function(e, imo) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-edit');
  if (btn) btn.disabled = true;
  
  const payload = {
    vessel_name: document.getElementById('edit-v-name').value.trim(),
    vessel_type: document.getElementById('edit-v-type').value.trim(),
    flag_state: document.getElementById('edit-v-flag').value.trim(),
    captain: document.getElementById('edit-v-captain').value.trim(),
    gross_tonnage: parseInt(document.getElementById('edit-v-tonnage').value) || null,
    destination_port: document.getElementById('edit-v-dest').value.trim(),
    cargo: document.getElementById('edit-v-cargo').value.trim(),
  };
  
  const res = await apiFetch(`/api/sea-marshall/vessels/${imo}`, {
    method: 'PUT',
    body: payload
  });
  
  if (res.success) {
    showToast('Vessel details updated successfully', 'success');
    closeModal();
    closeDrawer();
    await loadVessels(); // refresh list
  } else {
    showToast('Failed to update details: ' + res.message, 'error');
    if (btn) btn.disabled = false;
  }
};
