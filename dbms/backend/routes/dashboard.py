import json, os
from flask import Blueprint, request
from database import get_db, rows_to_list, api_response, api_error

dashboard_bp = Blueprint('dashboard', __name__)


@dashboard_bp.route('/kpis', methods=['GET'])
def get_kpis():
    db = get_db()
    try:
        volume   = db.execute("SELECT COUNT(*) as c FROM entities").fetchone()['c']
        flags    = db.execute("SELECT COUNT(*) as c FROM entities WHERE is_blacklist=1 OR status='Flagged'").fetchone()['c']
        no_ngo   = db.execute("SELECT COUNT(*) as c FROM entities WHERE type IN ('Refugee','Migrant') AND (assigned_ngo IS NULL OR assigned_ngo='')").fetchone()['c']
        incidents = db.execute("SELECT COUNT(*) as c FROM incidents WHERE status='Open'").fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'volume':    volume,
        'flags':     flags,
        'pending_aid': no_ngo,
        'incidents': incidents
    })


@dashboard_bp.route('/marker-stats', methods=['GET'])
def marker_stats():
    location = request.args.get('location', '')
    if not location:
        return api_error('location parameter required')

    db = get_db()
    try:
        total = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ?",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
        flagged = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ? AND (is_blacklist=1 OR status='Flagged')",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
        aid = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ? AND type IN ('Refugee','Migrant') AND (assigned_ngo IS NULL OR assigned_ngo='')",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'location': location,
        'total':    total,
        'flagged':  flagged,
        'pending_aid': aid
    })


@dashboard_bp.route('/entity-types', methods=['GET'])
def entity_types():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT type, COUNT(*) as count FROM entities GROUP BY type"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])


@dashboard_bp.route('/top-entry-points', methods=['GET'])
def top_entry_points():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT entry_point, COUNT(*) as count FROM entities WHERE entry_point IS NOT NULL GROUP BY entry_point ORDER BY count DESC LIMIT 8"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])


NGOS_JSON = os.path.join(os.path.dirname(__file__), '..', 'ngos.json')


def _load_all_ngos():
    """Return a flat list of unique NGO names from ngos.json."""
    with open(NGOS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)
    seen = set()
    ngos = []
    for force_ngos in data.values():
        for ngo in force_ngos:
            name = ngo.get('name', '')
            if name and name not in seen:
                seen.add(name)
                ngos.append(ngo)
    return ngos


@dashboard_bp.route('/refugees', methods=['GET'])
def list_all_refugees():
    """List all registered refugees for the dashboard tab."""
    limit  = min(int(request.args.get('limit', 100)), 500)
    offset = int(request.args.get('offset', 0))
    db = get_db()
    try:
        is_released = request.args.get('released') == 'true'
        condition = "WHERE COALESCE(rr.processed, '') = 'Released'" if is_released else "WHERE COALESCE(rr.processed, '') != 'Released'"
        
        rows = db.execute(f"""
            SELECT rr.id AS reg_id, rr.provisional_id, rr.force, rr.registration_date,
                   rr.assigned_ngo, rr.status AS reg_status, rr.entry_point, rr.processed,
                   e.name, e.nationality, e.assigned_camp, e.status AS entity_status
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            {condition}
            ORDER BY rr.registration_date DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM refugee_registrations").fetchone()['c']
    finally:
        db.close()
    return api_response(data={'items': [dict(r) for r in rows], 'total': total})


@dashboard_bp.route('/refugees/<reg_id>/release', methods=['POST'])
def release_refugee(reg_id):
    """Release a refugee completely from the tracker."""
    data = request.get_json(silent=True) or {}
    officer_id = data.get('officer_id', '').strip()
    if not officer_id:
        return api_error('Officer ID is required for release authorization')

    db = get_db()
    try:
        # Verify the record exists
        row = db.execute("SELECT provisional_id, status FROM refugee_registrations WHERE id=?", (reg_id,)).fetchone()
        if not row:
            return api_error("Refugee registration not found", 404)
            
        if row['status'] != 'Inactive':
            return api_error("Aid has not been recieved yet")

        prov_id = row['provisional_id']
        
        db.execute("UPDATE refugee_registrations SET processed='Released' WHERE id=?", (reg_id,))
        
        db.execute(
            "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'released_from_camp', ?)",
            (prov_id, officer_id)
        )
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by, read) VALUES (?, ?, 'info', ?, 0)",
            ('refugee_released', f"Refugee {prov_id} officially released from camp by officer {officer_id}.", officer_id)
        )
        db.commit()
    finally:
        db.close()
    return api_response(message="Refugee successfully released")


@dashboard_bp.route('/refugees/<reg_id>/undo-release', methods=['POST'])
def undo_release_refugee(reg_id):
    """Revert a released refugee back to at camp."""
    data = request.get_json(silent=True) or {}
    officer_id = data.get('officer_id', '').strip()
    if not officer_id:
        return api_error('Officer ID is required for authorization')

    db = get_db()
    try:
        row = db.execute("SELECT provisional_id FROM refugee_registrations WHERE id=?", (reg_id,)).fetchone()
        if not row:
            return api_error("Refugee registration not found", 404)
            
        prov_id = row['provisional_id']
        db.execute("UPDATE refugee_registrations SET processed='at camp' WHERE id=?", (reg_id,))
        
        db.execute(
            "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'returned_to_camp', ?)",
            (prov_id, officer_id)
        )
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by, read) VALUES (?, ?, 'info', ?, 0)",
            ('refugee_reverted', f"Refugee {prov_id} mathematically reverted back to camp by system officer {officer_id}.", officer_id)
        )
        db.commit()
    finally:
        db.close()
    return api_response(message="Refugee successfully reverted to camp")


@dashboard_bp.route('/ngo-list', methods=['GET'])
def ngo_list():
    """Return the flat list of all NGOs."""
    return api_response(data=_load_all_ngos())


@dashboard_bp.route('/ngo-assignments/<reg_id>', methods=['PATCH'])
def update_ngo_assignment(reg_id):
    """Reassign a refugee to a different NGO."""
    data     = request.get_json(silent=True) or {}
    ngo_name = data.get('ngo_name', '').strip()
    ngo_id   = data.get('ngo_id', '').strip() or 'NGO-AUTO'
    if not ngo_name:
        return api_error('ngo_name is required')

    db = get_db()
    try:
        # Update refugee_registrations
        db.execute(
            "UPDATE refugee_registrations SET assigned_ngo=? WHERE id=?",
            (ngo_name, reg_id)
        )
        # Update entity.assigned_ngo for the matching entity
        db.execute("""
            UPDATE entities SET assigned_ngo=?, updated_at=datetime('now')
            WHERE id IN (SELECT entity_id FROM refugee_registrations WHERE id=?)
        """, (ngo_name, reg_id))
        # Update the ngo_assignments row
        db.execute("""
            UPDATE ngo_assignments SET ngo_name=?, ngo_id=?
            WHERE refugee_registration_id=?
        """, (ngo_name, ngo_id, reg_id))

        # Add to timeline
        prov = db.execute("SELECT provisional_id FROM refugee_registrations WHERE id=?", (reg_id,)).fetchone()
        if prov:
            db.execute("""
                INSERT INTO refugee_status_log (provisional_id, stage, updated_by)
                VALUES (?, 'assigned_to_ngo', 'Dashboard Admin')
            """, (prov['provisional_id'],))

        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message=f'Refugee reassigned to {ngo_name}')


# ── Alerts ────────────────────────────────────────────────────────
@dashboard_bp.route('/alerts', methods=['GET'])
def get_alerts():
    """
    Return all alerts ordered newest-first.
    ?unread=true  — filter to unread only
    ?limit=N      — max items (default 100)
    """
    unread_only = request.args.get('unread', '').lower() == 'true'
    limit       = min(int(request.args.get('limit', 100)), 500)

    db = get_db()
    data = []
    try:
        sql = "SELECT id, type, message, severity, triggered_by, read, timestamp FROM alerts"
        if unread_only:
            sql += " WHERE read=0"
        sql += " ORDER BY timestamp DESC LIMIT ?"
        rows = db.execute(sql, (limit,)).fetchall()
        
        if rows:
            data = [dict(r) for r in rows]
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(data=data)


@dashboard_bp.route('/alerts/read/<int:alert_id>', methods=['POST'])
def mark_alert_read(alert_id):
    """Mark a single alert as read."""
    db = get_db()
    try:
        db.execute(
            "UPDATE alerts SET read=1 WHERE id=?", (alert_id,)
        )
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message=f'Alert {alert_id} marked as read')


@dashboard_bp.route('/alerts/read-all', methods=['POST'])
def mark_all_alerts_read():
    """Mark all alerts as read at once (convenience endpoint)."""
    db = get_db()
    try:
        db.execute("UPDATE alerts SET read=1 WHERE read=0")
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message='All alerts marked as read')


@dashboard_bp.route('/alerts', methods=['POST'])
def create_alert():
    """
    Create a new alert (used by other backend modules or for testing).
    Body: { type, message, severity, triggered_by }
    """
    data = request.get_json(silent=True) or {}
    if not data.get('message'):
        return api_error('message is required')
    db = get_db()
    try:
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?,?,?,?)",
            (
                data.get('type', 'system'),
                data['message'],
                data.get('severity', 'info'),
                data.get('triggered_by', 'system'),
            )
        )
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
        db.close()
    return api_response(message='Alert created', status=201)


@dashboard_bp.route('/stats/units', methods=['GET'])
def get_unit_stats():
    units = ['BSF', 'CISF', 'ITBP', 'SSB', 'Assam Rifles']
    db = get_db()
    stats = []
    try:
        for unit in units:
            # Refugees registered by unit (force)
            refs = db.execute(
                "SELECT COUNT(*) as c FROM refugee_registrations WHERE force=?",
                (unit,)
            ).fetchone()['c']
            
            # Vessels checked
            # In SeaPort, CISF operates at seaports. We will attribute vessel checks to CISF.
            # Otherwise 0.
            vessels = 0
            if unit == 'CISF':
                vessels = db.execute("SELECT COUNT(*) as c FROM vessels").fetchone()['c']
                
            # Flagged incidents
            incs = db.execute(
                "SELECT COUNT(*) as c FROM incidents WHERE reported_by LIKE ?",
                (f"%{unit}%",)
            ).fetchone()['c']
            
            stats.append({
                'unit_name': unit,
                'total_refugees_registered': refs,
                'total_vessels_checked': vessels,
                'flagged_incidents': incs
            })
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()
        
    return api_response(data=stats)


# ── NGO Management ────────────────────────────────────────────────
@dashboard_bp.route('/ngos/all', methods=['GET'])
def get_all_ngos():
    status = request.args.get('status')
    db = get_db()
    try:
        query = """
            SELECT n.*, 
                   (SELECT COUNT(*) FROM refugee_registrations rr WHERE rr.assigned_ngo = n.name) as real_current_count
            FROM ngos n
        """
        params = []
        if status:
            query += " WHERE n.status = ?"
            params.append(status)
        query += " ORDER BY n.created_at DESC"
        
        rows = db.execute(query, params).fetchall()
        
        result = []
        for r in rows:
            d = dict(r)
            d['current_count'] = d['real_current_count']
            result.append(d)
    finally:
        db.close()
    return api_response(data=result)

@dashboard_bp.route('/ngos/<int:ngo_id>/approve', methods=['POST'])
def approve_ngo(ngo_id):
    db = get_db()
    try:
        db.execute("UPDATE ngos SET status='approved' WHERE id=?", (ngo_id,))
        ngo = db.execute("SELECT * FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        if ngo and ngo['contact_email']:
            pwd = ngo['name'].lower().replace(' ', '_')
            db.execute("""
                INSERT OR IGNORE INTO users (name, email, password, role, ngo_id)
                VALUES (?, ?, ?, 'ngo_admin', ?)
            """, (f"{ngo['name']} Admin", ngo['contact_email'], pwd, ngo_id))
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message="NGO approved")

@dashboard_bp.route('/ngos/<int:ngo_id>/deactivate', methods=['POST'])
def deactivate_ngo(ngo_id):
    db = get_db()
    try:
        db.execute("UPDATE ngos SET status='deactivated' WHERE id=?", (ngo_id,))
        db.commit()
    finally:
        db.close()
    return api_response(message="NGO deactivated")

@dashboard_bp.route('/ngos/<int:ngo_id>/reactivate', methods=['POST'])
def reactivate_ngo(ngo_id):
    db = get_db()
    try:
        db.execute("UPDATE ngos SET status='approved' WHERE id=?", (ngo_id,))
        db.commit()
    finally:
        db.close()
    return api_response(message="NGO reactivated")

@dashboard_bp.route('/refugees/<int:reg_id>', methods=['PUT', 'PATCH'])
def update_refugee(reg_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        # Get the entity_id
        rr = db.execute("SELECT entity_id FROM refugee_registrations WHERE id=?", (reg_id,)).fetchone()
        if not rr:
            return api_error("Registration not found", 404)
        entity_id = rr['entity_id']

        # Update entity table fields: name, nationality, assigned_camp, status
        entity_updates = {}
        if 'name' in data:
            entity_updates['name'] = data['name']
        if 'nationality' in data:
            entity_updates['nationality'] = data['nationality']
        if 'assigned_camp' in data:
            entity_updates['assigned_camp'] = data['assigned_camp']
        if 'entity_status' in data:
            entity_updates['status'] = data['entity_status']
        if 'status' in data and 'reg_status' not in data and 'entity_status' not in data:
             # handle ambiguous 'status'
             entity_updates['status'] = data['status']
        
        if entity_updates:
            set_str = ", ".join(f"{k}=?" for k in entity_updates.keys())
            db.execute(f"UPDATE entities SET {set_str} WHERE id=?", list(entity_updates.values()) + [entity_id])
        
        # Update refugee_registrations fields: assigned_ngo, reg_status, assistance_type
        reg_updates = {}
        if 'assigned_ngo' in data:
            reg_updates['assigned_ngo'] = data['assigned_ngo']
        if 'reg_status' in data:
            reg_updates['status'] = data['reg_status']
        if 'assistance_type' in data:
            reg_updates['aid_requirement'] = data['assistance_type']

        if reg_updates:
            set_str = ", ".join(f"{k}=?" for k in reg_updates.keys())
            db.execute(f"UPDATE refugee_registrations SET {set_str} WHERE id=?", list(reg_updates.values()) + [reg_id])
            
        db.commit()
        # Return updated record
        updated = db.execute("""
            SELECT rr.id AS reg_id, rr.provisional_id, rr.force, rr.registration_date,
                   rr.assigned_ngo, rr.status AS reg_status, rr.entry_point, rr.aid_requirement as assistance_type, rr.processed,
                   e.name, e.nationality, e.assigned_camp, e.status AS entity_status
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            WHERE rr.id = ?
        """, (reg_id,)).fetchone()
        
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
        
    return api_response(data=dict(updated) if updated else {}, message="Refugee updated")
