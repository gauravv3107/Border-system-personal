import json, random, os
from flask import Blueprint, request  # type: ignore[import-untyped,import-not-found]
from database import get_db, rows_to_list, api_response, api_error  # type: ignore[import-untyped,import-not-found]

sea_marshall_bp = Blueprint('sea_marshall', __name__)

VESSELS_PATH = os.path.join(os.path.dirname(__file__), '..', 'vessels.json')

def _load_json_vessels():
    with open(VESSELS_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def _load_db_vessels(db):
    rows = db.execute("SELECT * FROM vessels").fetchall()
    return [dict(r) for r in rows]

def _apply_status_overrides(vessels, db):
    overrides = db.execute("SELECT imo, status FROM vessel_status").fetchall()
    override_map = {r['imo']: r['status'] for r in overrides}
    result = []
    for v in vessels:
        # Always produce a fresh plain dict — removes Union type ambiguity
        d: dict = dict(v)
        if d['imo'] in override_map:
            d['status'] = override_map[d['imo']]
        st = str(d.get('status') or 'CLEARED')
        d['is_flagged'] = bool(d.get('is_flagged')) or (st == 'FLAGGED_ILLEGAL')
        if not d.get('movement_status'):
            d['movement_status'] = 'APPROACHING'
        result.append(d)
    return result


@sea_marshall_bp.route('/vessels', methods=['GET'])
def get_vessels():
    db = get_db()
    try:
        json_vessels = _load_json_vessels()
        db_vessels   = _load_db_vessels(db)
        
        # Merge — DB vessels keyed by IMO take precedence over JSON if there's a collision
        json_imos = {v['imo'] for v in json_vessels}
        unique_db = [v for v in db_vessels if v['imo'] not in json_imos]
        
        # Merge DB vessel 'departed_at' values into JSON vessels if they already have an entry
        override_db = {v['imo']: v.get('departed_at') for v in db_vessels if v.get('departed_at')}
        for jv in json_vessels:
            if jv['imo'] in override_db:
                jv['departed_at'] = override_db[jv['imo']]
                
        all_vessels = json_vessels + unique_db
        all_vessels = _apply_status_overrides(all_vessels, db)
    finally:
        db.close()
    return api_response(data=all_vessels)


@sea_marshall_bp.route('/vessels/<imo>', methods=['GET'])
def get_vessel(imo):
    db = get_db()
    vessel: dict = {}
    try:
        json_vessels = _load_json_vessels()
        match = next((v for v in json_vessels if v['imo'] == imo), None)
        if match:
            vessel = dict(match)
        if not vessel:
            row = db.execute("SELECT * FROM vessels WHERE imo=?", (imo,)).fetchone()
            if row:
                vessel = dict(row)
        if not vessel:
            return api_error('Vessel not found', 404)
        override = db.execute("SELECT status FROM vessel_status WHERE imo=?", (imo,)).fetchone()
        if override:
            vessel['status'] = str(override['status'])  # pyre-ignore[6]
        if not vessel.get('movement_status'):
            vessel['movement_status'] = 'APPROACHING'  # pyre-ignore[6]
            
        # check if it has a DB departed_at overriding JSON value
        db_vessel = db.execute("SELECT departed_at FROM vessels WHERE imo=?", (imo,)).fetchone()
        if db_vessel and db_vessel['departed_at']:
            vessel['departed_at'] = db_vessel['departed_at']
            
        # Add clearance defaults if missing from JSON vessels
        if 'health_clearance' not in vessel:
            vessel['health_clearance'] = 1
            vessel['customs_clearance'] = 1
    finally:
        db.close()
    return api_response(data=vessel)


@sea_marshall_bp.route('/vessels', methods=['POST'])
def register_vessel():
    """Register a new vessel into the database."""
    data: dict = request.get_json(silent=True) or {}
    required = ['imo', 'vessel_name', 'vessel_type', 'flag_state']
    for field in required:
        val = data.get(field)
        if not val or not str(val).strip():
            return api_error(f'Field required: {field}')

    imo = str(data['imo']).strip()  # pyre-ignore[16]

    # Check for duplicate IMO in JSON
    json_vessels = _load_json_vessels()
    if any(v['imo'] == imo for v in json_vessels):
        return api_error(f'IMO {imo} already exists in the vessel register', 409)

    # Determine initial status
    allowed_statuses = ('CLEARED', 'UNVERIFIED', 'FLAGGED_ILLEGAL')
    initial_status = str(data.get('status') or 'UNVERIFIED').strip().upper()
    if initial_status not in allowed_statuses:
        initial_status = 'UNVERIFIED'

    db = get_db()
    try:
        existing = db.execute("SELECT imo FROM vessels WHERE imo=?", (imo,)).fetchone()
        if existing:
            return api_error(f'IMO {imo} already registered in the database', 409)

        allowed_movement = ('APPROACHING', 'DOCKED', 'DEPARTING')
        movement_status = str(data.get('movement_status') or 'APPROACHING').strip().upper()
        if movement_status not in allowed_movement:
            movement_status = 'APPROACHING'
        db.execute("""
            INSERT INTO vessels
              (imo, vessel_name, vessel_type, country_of_origin, flag_state,
               cargo, gross_tonnage, destination_port, eta, last_port,
               captain, crew_count, status, is_flagged, flag_reason, movement_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)
        """, (
            imo,
            str(data['vessel_name']).strip(),  # pyre-ignore[16]
            str(data['vessel_type']).strip(),  # pyre-ignore[16]
            str(data.get('country_of_origin') or '').strip() or None,  # pyre-ignore[16]
            str(data['flag_state']).strip(),
            str(data.get('cargo') or '').strip() or None,
            int(data['gross_tonnage']) if data.get('gross_tonnage') else None,
            str(data.get('destination_port') or '').strip() or None,
            str(data.get('eta') or '').strip() or None,
            str(data.get('last_port') or '').strip() or None,
            str(data.get('captain') or '').strip() or None,
            str(data.get('crew_count') or '').strip() or None,
            initial_status,
            1 if initial_status == 'FLAGGED_ILLEGAL' else 0,
            movement_status,
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(
        data={'imo': imo, 'vessel_name': data['vessel_name']},
        message=f'Vessel IMO {imo} — {data["vessel_name"]} registered successfully.',
        status=201
    )


@sea_marshall_bp.route('/vessels/<imo>', methods=['PUT'])
def update_vessel(imo):
    """Update details of an existing vessel."""
    data: dict = request.get_json(silent=True) or {}
    db = get_db()
    try:
        existing = db.execute("SELECT imo FROM vessels WHERE imo=?", (imo,)).fetchone()
        if not existing:
            return api_error("Cannot edit a JSON-only fallback vessel. Please register it in the databased system first.", 404)
        
        db.execute("""
            UPDATE vessels SET
              vessel_name = COALESCE(?, vessel_name),
              vessel_type = COALESCE(?, vessel_type),
              flag_state = COALESCE(?, flag_state),
              gross_tonnage = COALESCE(?, gross_tonnage),
              captain = COALESCE(?, captain),
              crew_count = COALESCE(?, crew_count),
              destination_port = COALESCE(?, destination_port),
              eta = COALESCE(?, eta),
              last_port = COALESCE(?, last_port),
              cargo = COALESCE(?, cargo)
            WHERE imo = ?
        """, (
            data.get('vessel_name'),
            data.get('vessel_type'),
            data.get('flag_state'),
            data.get('gross_tonnage'),
            data.get('captain'),
            data.get('crew_count'),
            data.get('destination_port'),
            data.get('eta'),
            data.get('last_port'),
            data.get('cargo'),
            imo
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message=f"Vessel {imo} updated successfully.")


@sea_marshall_bp.route('/lock-vessel', methods=['POST'])
def lock_vessel():
    data = request.get_json(silent=True) or {}
    imo  = data.get('imo', '').strip()
    if not imo:
        return api_error('imo required')

    db = get_db()
    try:
        db.execute("""
            INSERT INTO vessel_status(imo, status, updated_at)
            VALUES (?, 'INTERCEPTED', datetime('now'))
            ON CONFLICT(imo) DO UPDATE SET status='INTERCEPTED', updated_at=datetime('now')
        """, (imo,))
        # Auto-create incident
        inc_id = f"INC-{random.randint(100000,999999)}"
        db.execute("""
            INSERT INTO incidents(id, type, severity, location, description, reported_by, vessel_imo, status)
            VALUES (?,?,?,?,?,?,?,'Open')
        """, (
            inc_id, 'Unauthorized Entry', 'Critical',
            'JNPT, Navi Mumbai — Maritime Approach',
            f'Coast Guard intercept order issued for IMO {imo} — MV Shadow Runner. Vessel suspected of arms and narcotics trafficking. Flagged by RAW Level 3 Intelligence.',
            'Sea Marshall System', imo
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(data={'imo': imo, 'new_status': 'INTERCEPTED'},
                        message='Intercept order issued. Indian Coast Guard notified.')


@sea_marshall_bp.route('/file-incident', methods=['POST'])
def file_incident():
    data: dict = request.get_json(silent=True) or {}
    required = ['imo', 'incident_type', 'description']
    for f in required:
        if not data.get(f):  # pyre-ignore[16]
            return api_error(f'Field required: {f}')

    inc_id = f"INC-{random.randint(100000,999999)}"
    db = get_db()
    try:
        db.execute("""
            INSERT INTO incidents(id, type, severity, location, description, reported_by, vessel_imo, status)
            VALUES (?,?,?,?,?,?,?,'Open')
        """, (
            inc_id,
            data['incident_type'],  # pyre-ignore[16]
            data.get('severity', 'Critical'),
            data.get('location', 'Maritime — Indian EEZ'),
            data['description'],  # pyre-ignore[16]
            data.get('reporting_marshal', 'Sea Marshall'),
            data['imo']  # pyre-ignore[16]
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(data={'incident_id': inc_id},
                        message=f'Incident {inc_id} filed successfully.')


@sea_marshall_bp.route('/flag-vessel', methods=['POST'])
def flag_vessel():
    """Flag a currently-cleared vessel as suspicious."""
    data = request.get_json(silent=True) or {}
    imo = data.get('imo', '').strip()
    flag_reason = data.get('flag_reason', 'Flagged by sea marshall officer').strip()
    flagged_by  = data.get('flagged_by', 'Sea Marshall').strip()
    if not imo:
        return api_error('imo required')

    db = get_db()
    try:
        db.execute("""
            INSERT INTO vessel_status(imo, status, updated_at)
            VALUES (?, 'FLAGGED_ILLEGAL', datetime('now'))
            ON CONFLICT(imo) DO UPDATE SET status='FLAGGED_ILLEGAL', updated_at=datetime('now')
        """, (imo,))
        # Create incident record
        inc_id = f"INC-{random.randint(100000,999999)}"
        db.execute("""
            INSERT INTO incidents(id, type, severity, location, description, reported_by, vessel_imo, status)
            VALUES (?,?,?,?,?,?,?,'Open')
        """, (
            inc_id, 'Suspicious Vessel', 'High',
            'Maritime — Indian EEZ',
            f'Vessel IMO {imo} flagged by officer {flagged_by}. Reason: {flag_reason}',
            flagged_by, imo
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(
        data={'imo': imo, 'new_status': 'FLAGGED_ILLEGAL', 'incident_id': inc_id},
        message=f'Vessel IMO {imo} flagged. Intel Command notified. Incident {inc_id} created.'
    )


@sea_marshall_bp.route('/verify-vessel', methods=['POST'])
def verify_vessel():
    """Mark a vessel as CLEARED (verified & approved for entry)."""
    data = request.get_json(silent=True) or {}
    imo = data.get('imo', '').strip()
    verified_by = data.get('verified_by', 'Sea Marshall').strip()
    if not imo:
        return api_error('imo required')

    db = get_db()
    try:
        db.execute("""
            INSERT INTO vessel_status(imo, status, updated_at)
            VALUES (?, 'CLEARED', datetime('now'))
            ON CONFLICT(imo) DO UPDATE SET status='CLEARED', updated_at=datetime('now')
        """, (imo,))
        # Also update the vessels table if it's a DB-registered vessel
        db.execute("""
            UPDATE vessels SET status='CLEARED', is_flagged=0
            WHERE imo=?
        """, (imo,))
        # Log an incident for audit trail
        inc_id = f"INC-{random.randint(100000,999999)}"
        db.execute("""
            INSERT INTO incidents(id, type, severity, location, description, reported_by, vessel_imo, status)
            VALUES (?,?,?,?,?,?,?,'Resolved')
        """, (
            inc_id, 'Vessel Clearance', 'Low',
            'Maritime — Indian EEZ',
            f'Vessel IMO {imo} has been verified and cleared for entry by officer {verified_by}.',
            verified_by, imo
        ))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(
        data={'imo': imo, 'new_status': 'CLEARED'},
        message=f'Vessel IMO {imo} verified and cleared for entry.'
    )


@sea_marshall_bp.route('/set-vessel-status', methods=['POST'])
def set_vessel_status():
    """Set a vessel to any valid status (CLEARED, UNVERIFIED, FLAGGED_ILLEGAL, INTERCEPTED)."""
    data = request.get_json(silent=True) or {}
    imo = data.get('imo', '').strip()
    new_status = data.get('status', '').strip().upper()
    updated_by = data.get('updated_by', 'Sea Marshall').strip()

    allowed = ('CLEARED', 'UNVERIFIED', 'FLAGGED_ILLEGAL', 'INTERCEPTED')
    if not imo:
        return api_error('imo required')
    if new_status not in allowed:
        return api_error(f'status must be one of: {", ".join(allowed)}')

    db = get_db()
    try:
        db.execute("""
            INSERT INTO vessel_status(imo, status, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(imo) DO UPDATE SET status=?, updated_at=datetime('now')
        """, (imo, new_status, new_status))
        # Update vessels table if DB-registered
        db.execute("""
            UPDATE vessels SET status=?, is_flagged=?
            WHERE imo=?
        """, (new_status, 1 if new_status == 'FLAGGED_ILLEGAL' else 0, imo))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(
        data={'imo': imo, 'new_status': new_status},
        message=f'Vessel IMO {imo} status updated to {new_status} by {updated_by}.'
    )


@sea_marshall_bp.route('/set-movement-status', methods=['POST'])
def set_movement_status():
    """Update the movement status (DOCKED / APPROACHING / DEPARTING) for a vessel."""
    data = request.get_json(silent=True) or {}
    imo = (data.get('imo') or '').strip()
    movement = (data.get('movement_status') or '').strip().upper()
    allowed  = ('DOCKED', 'APPROACHING', 'DEPARTING')
    if not imo:
        return api_error('imo required')
    if movement not in allowed:
        return api_error(f'movement_status must be one of: {", ".join(allowed)}')

    db = get_db()
    try:
        if movement == 'DEPARTING':
            db.execute("UPDATE vessels SET movement_status=?, departed_at=datetime('now') WHERE imo=?", (movement, imo))
        else:
            db.execute("UPDATE vessels SET movement_status=?, departed_at=NULL WHERE imo=?", (movement, imo))
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(
        data={'imo': imo, 'movement_status': movement},
        message=f'Vessel IMO {imo} movement status updated to {movement}.'
    )


@sea_marshall_bp.route('/vessels/<imo>/health-clearance', methods=['POST'])
def health_clearance(imo):
    data = request.get_json(silent=True) or {}
    officer_id = data.get('officer_id', 'Unknown Officer')
    granted = int(bool(data.get('granted', False)))
    notes = data.get('notes', '')

    db = get_db()
    try:
        # Update vessel
        db.execute("""
            UPDATE vessels
            SET health_clearance=?, health_clearance_by=?, health_clearance_at=datetime('now')
            WHERE imo=?
        """, (granted, officer_id, imo))
        
        # Write to log
        db.execute("""
            INSERT INTO vessel_clearance_log (vessel_id, clearance_type, granted, officer_id, notes)
            VALUES (?, 'health', ?, ?, ?)
        """, (imo, granted, officer_id, notes))
        
        # Alert if denied
        if not granted:
            db.execute(
                "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                ('health_clearance_denied', f"Vessel {imo} denied health clearance by {officer_id}.", 'critical', officer_id)
            )
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()
        
    status_str = "granted" if granted else "denied"
    return api_response(message=f"Health clearance {status_str} for vessel {imo}")


@sea_marshall_bp.route('/vessels/<imo>/customs-clearance', methods=['POST'])
def customs_clearance(imo):
    data = request.get_json(silent=True) or {}
    officer_id = data.get('officer_id', 'Unknown Officer')
    granted = int(bool(data.get('granted', False)))
    notes = data.get('notes', '')

    db = get_db()
    try:
        # Update vessel
        db.execute("""
            UPDATE vessels
            SET customs_clearance=?, customs_clearance_by=?, customs_clearance_at=datetime('now')
            WHERE imo=?
        """, (granted, officer_id, imo))
        
        # Write to log
        db.execute("""
            INSERT INTO vessel_clearance_log (vessel_id, clearance_type, granted, officer_id, notes)
            VALUES (?, 'customs', ?, ?, ?)
        """, (imo, granted, officer_id, notes))
        
        # Alert if denied
        if not granted:
            db.execute(
                "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                ('customs_clearance_denied', f"Vessel {imo} denied customs clearance by {officer_id}.", 'critical', officer_id)
            )
        db.commit()
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()
        
    status_str = "granted" if granted else "denied"
    return api_response(message=f"Customs clearance {status_str} for vessel {imo}")


@sea_marshall_bp.route('/vessels/<imo>/clearance-log', methods=['GET'])
def get_clearance_log(imo):
    db = get_db()
    try:
        rows = db.execute("""
            SELECT id, clearance_type, granted, officer_id, notes, timestamp
            FROM vessel_clearance_log
            WHERE vessel_id = ?
            ORDER BY timestamp DESC
        """, (imo,)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


