import json, os
from flask import Blueprint, request, jsonify
from database import get_db, api_response, api_error

ngo_bp = Blueprint('ngo', __name__)

NGOS_JSON = os.path.join(os.path.dirname(__file__), '..', 'ngos.json')

def _load_ngos():
    with open(NGOS_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


@ngo_bp.route('/list-by-force', methods=['GET'])
def list_by_force():
    force = request.args.get('force', '').strip()
    all_ngos = _load_ngos()
    ngos = all_ngos.get(force, [])
    return api_response(data=ngos)




@ngo_bp.route('/assignments', methods=['GET'])
def get_assignments():
    status = request.args.get('status', '')
    limit  = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    cond   = "WHERE 1=1"
    params = []
    if status:
        cond += " AND na.status=?"
        params.append(status)

    db = get_db()
    try:
        rows = db.execute(f"""
            SELECT na.id, na.ngo_name, na.message, na.status,
                   na.created_at, na.acknowledged_at,
                   rr.provisional_id, rr.force, rr.entry_point,
                   e.name, e.nationality, e.assigned_camp,
                   e.medical_needs, e.help_tags, e.dob, e.gender
            FROM ngo_assignments na
            JOIN refugee_registrations rr ON rr.id = na.refugee_registration_id
            JOIN entities e ON e.id = rr.entity_id
            {cond}
            ORDER BY na.created_at DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

        total = db.execute(f"""
            SELECT COUNT(*) as c FROM ngo_assignments na {cond}
        """, params).fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'items': [dict(r) for r in rows],
        'total': total
    })


@ngo_bp.route('/assignments/<assignment_id>/status', methods=['PATCH'])
def update_status(assignment_id):
    data       = request.get_json(silent=True) or {}
    new_status = data.get('status', '').strip()
    valid      = ('Pending', 'Acknowledged', 'In Progress', 'Completed')
    if new_status not in valid:
        return api_error(f'status must be one of: {", ".join(valid)}')

    db = get_db()
    try:
        ack = "datetime('now')" if new_status == 'Acknowledged' else 'NULL'
        db.execute(f"""
            UPDATE ngo_assignments
            SET status=?, acknowledged_at={ack}
            WHERE id=?
        """, (new_status, assignment_id))
        db.commit()
        if db.execute("SELECT changes() as n").fetchone()['n'] == 0:
            db.close()
            return api_error('Assignment not found', 404)
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(message=f'Status updated to {new_status}')


@ngo_bp.route('/assignments/counts', methods=['GET'])
def assignment_counts():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT status, COUNT(*) as count FROM ngo_assignments GROUP BY status"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])

@ngo_bp.route('/assignments/case-counts', methods=['GET'])
def assignment_case_counts():
    """Return counts for the workflow tracking stats."""
    db = get_db()
    try:
        row = db.execute("""
            SELECT 
                SUM(CASE WHEN case_status != 'resolved' OR case_status IS NULL THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN COALESCE(case_status, 'active') = 'active' THEN 1 ELSE 0 END) as unacknowledged,
                SUM(CASE WHEN aid_given = 1 THEN 1 ELSE 0 END) as aid_given,
                SUM(CASE WHEN medical_review_done = 1 THEN 1 ELSE 0 END) as medical_review,
                SUM(CASE WHEN case_status = 'resolved' THEN 1 ELSE 0 END) as resolved
            FROM ngo_assignments
        """).fetchone()
    finally:
        db.close()
    
    data = dict(row) if row else {"active":0,"unacknowledged":0,"aid_given":0,"medical_review":0,"resolved":0}
    # Ensure no None values
    data = {k: (v or 0) for k, v in data.items()}
    return api_response(data=data)



@ngo_bp.route('/<int:ngo_id>/capacity', methods=['PUT'])
def update_ngo_capacity(ngo_id):
    data = request.get_json(silent=True) or {}
    max_cap = int(data.get('max_capacity', 0))
    db = get_db()
    try:
        db.execute("UPDATE ngos SET max_capacity=? WHERE id=?", (max_cap, ngo_id))
        
        # Check occupancy
        ngo = db.execute("SELECT name, max_capacity FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        if ngo and ngo['max_capacity'] > 0:
            count = db.execute("SELECT COUNT(*) as c FROM refugee_registrations WHERE assigned_ngo=?", (ngo['name'],)).fetchone()['c']
            pct = (count / ngo['max_capacity']) * 100
            if pct >= 90:
                # Write critical alert
                db.execute("INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                           ('ngo', f"NGO {ngo['name']} is at {pct:.1f}% capacity.", 'critical', 'Capacity Monitor'))
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message="Capacity updated")

@ngo_bp.route('/<ngo_id>/appeals', methods=['GET'])
def get_ngo_appeals(ngo_id):
    db = get_db()
    try:
        # Join to get assignment info
        rows = db.execute("""
            SELECT a.id, a.provisional_id, a.type, a.description, a.status, a.timestamp, e.name as refugee_name
            FROM appeals a
            JOIN refugee_registrations rr ON a.provisional_id = rr.provisional_id
            JOIN entities e ON rr.entity_id = e.id
            WHERE a.status = 'open' OR a.status = 'in_progress'
            ORDER BY a.timestamp ASC
        """).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()

@ngo_bp.route('/appeals/<int:appeal_id>', methods=['PUT'])
def update_appeal(appeal_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status', 'open')
    notes = data.get('response_notes', '')
    
    db = get_db()
    try:
        db.execute(
            "UPDATE appeals SET status=?, response_notes=? WHERE id=?",
            (status, notes, appeal_id)
        )
        db.commit()
        return api_response(message='Appeal updated successfully')
    finally:
        db.close()


# ── Prompt 10: Standalone NGO Portal Endpoints ────────────────

@ngo_bp.route('/<int:ngo_id>/refugees', methods=['GET'])
def get_ngo_refugees(ngo_id):
    db = get_db()
    try:
        ngo = db.execute("SELECT name FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        if not ngo:
            return api_error('NGO not found', 404)
        rows = db.execute("""
            SELECT rr.id as reg_id, rr.provisional_id, rr.status as reg_status, rr.processed,
                   e.name, e.status, e.medical_needs, e.help_tags, e.gender, e.dob,
                   (SELECT MAX(date) FROM aid_distribution ad WHERE ad.refugee_id = rr.provisional_id) as last_aid_date
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            WHERE rr.assigned_ngo = ?
        """, (ngo['name'],)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/workers', methods=['GET'])
def get_ngo_workers(ngo_id):
    db = get_db()
    try:
        rows = db.execute("SELECT id, name, email, role FROM users WHERE ngo_id=? AND role='ngo_worker'", (ngo_id,)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/workers', methods=['POST'])
def create_ngo_worker(ngo_id):
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    if not name or not email or not password:
        return api_error("Name, email and password are required")
    db = get_db()
    try:
        db.execute("INSERT INTO users (name, email, password, role, ngo_id) VALUES (?, ?, ?, 'ngo_worker', ?)",
                   (name, email, password, ngo_id))
        db.commit()
        return api_response(message="Worker created")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()


@ngo_bp.route('/workers/<int:worker_id>', methods=['DELETE'])
def delete_ngo_worker(worker_id):
    db = get_db()
    try:
        db.execute("DELETE FROM users WHERE id=?", (worker_id,))
        db.commit()
        return api_response(message="Worker deactivated/deleted")
    finally:
        db.close()


@ngo_bp.route('/resource-request', methods=['POST'])
def create_resource_request():
    data = request.get_json(silent=True) or {}
    ngo_id = data.get('ngo_id')
    req_type = data.get('request_type', '').strip()
    desc = data.get('description', '').strip()
    if not ngo_id or not req_type:
        return api_error("ngo_id and request_type required")
    db = get_db()
    try:
        db.execute("INSERT INTO resource_requests (ngo_id, request_type, description) VALUES (?, ?, ?)",
                   (ngo_id, req_type, desc))
        ngo = db.execute("SELECT name FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        ngo_name = ngo['name'] if ngo else 'Unknown NGO'
        db.execute("INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                   ('ngo', f"Resource request from NGO {ngo_name}: {desc}", 'warning', 'NGO Portal'))
        db.commit()
        return api_response(message="Resource request submitted")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/resource-requests', methods=['GET'])
def get_resource_requests(ngo_id):
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM resource_requests WHERE ngo_id=? ORDER BY timestamp DESC", (ngo_id,)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/aid-log', methods=['POST'])
def log_aid():
    data = request.get_json(silent=True) or {}
    refugee_id = data.get('refugee_id')
    worker_id = data.get('worker_id')
    ngo_id = data.get('ngo_id')
    aid_type = data.get('aid_type')
    desc = data.get('description')
    date_str = data.get('date')
    if not all([refugee_id, worker_id, ngo_id, aid_type, date_str]):
        return api_error("Missing required fields")
    db = get_db()
    try:
        db.execute("INSERT INTO aid_distribution (refugee_id, worker_id, ngo_id, aid_type, description, date) VALUES (?, ?, ?, ?, ?, ?)",
                   (refugee_id, worker_id, ngo_id, aid_type, desc, date_str))
        worker = db.execute("SELECT name FROM users WHERE id=?", (worker_id,)).fetchone()
        worker_name = worker['name'] if worker else 'Worker'
        db.execute("INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'aid_received', ?)",
                   (refugee_id, worker_name))
        db.commit()
        return api_response(message="Aid logged successfully")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()

def _get_prov_id(db, refugee_reg_id):
    """Look up provisional_id from a refugee_registration id."""
    row = db.execute(
        "SELECT provisional_id FROM refugee_registrations WHERE id=?", (refugee_reg_id,)
    ).fetchone()
    return row['provisional_id'] if row else None


@ngo_bp.route('/cases/<refugee_id>/acknowledge', methods=['POST'])
def case_acknowledge(refugee_id):
    try:
        db = get_db()
        try:
            db.execute(
                "UPDATE ngo_assignments SET case_status='acknowledged' WHERE refugee_registration_id=?",
                (refugee_id,)
            )
            db.commit()
        finally:
            db.close()
        return jsonify({"success": True, "case_status": "acknowledged"}), 200
    except Exception as e:
        print(f"Acknowledge error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@ngo_bp.route('/cases/<refugee_id>/aid-given', methods=['POST'])
def case_aid_given(refugee_id):
    try:
        db = get_db()
        try:
            prov_id = _get_prov_id(db, refugee_id)
            # Get current flag
            row = db.execute("SELECT aid_given FROM ngo_assignments WHERE refugee_registration_id=?", (refugee_id,)).fetchone()
            new_flag = 1 if (not row or row['aid_given'] == 0) else 0

            if new_flag == 1:
                if prov_id:
                    db.execute(
                        "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'aid_received', 'NGO System')",
                        (prov_id,)
                    )
            else:
                if prov_id:
                    db.execute(
                        "DELETE FROM refugee_status_log WHERE provisional_id=? AND stage='aid_received'",
                        (prov_id,)
                    )

            db.execute(
                "UPDATE ngo_assignments SET aid_given=? WHERE refugee_registration_id=?",
                (new_flag, refugee_id)
            )
            db.commit()
            # Return both flag states so frontend can update buttons
            row = db.execute(
                "SELECT aid_given, medical_review_done FROM ngo_assignments WHERE refugee_registration_id=?",
                (refugee_id,)
            ).fetchone()
        finally:
            db.close()
        return jsonify({"success": True, "aid_given": bool(row and row['aid_given']), "medical_review_done": bool(row and row['medical_review_done'])}), 200
    except Exception as e:
        print(f"Aid given error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@ngo_bp.route('/cases/<refugee_id>/medical-review', methods=['POST'])
def case_medical_review(refugee_id):
    try:
        db = get_db()
        try:
            prov_id = _get_prov_id(db, refugee_id)
            
            row = db.execute("SELECT medical_review_done FROM ngo_assignments WHERE refugee_registration_id=?", (refugee_id,)).fetchone()
            new_flag = 1 if (not row or row['medical_review_done'] == 0) else 0

            if new_flag == 1:
                if prov_id:
                    db.execute(
                        "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'under_medical_review', 'NGO System')",
                        (prov_id,)
                    )
            else:
                if prov_id:
                    db.execute(
                        "DELETE FROM refugee_status_log WHERE provisional_id=? AND stage='under_medical_review'",
                        (prov_id,)
                    )

            db.execute(
                "UPDATE ngo_assignments SET medical_review_done=? WHERE refugee_registration_id=?",
                (new_flag, refugee_id)
            )
            db.commit()
            row = db.execute(
                "SELECT aid_given, medical_review_done FROM ngo_assignments WHERE refugee_registration_id=?",
                (refugee_id,)
            ).fetchone()
        finally:
            db.close()
        return jsonify({"success": True, "aid_given": bool(row and row['aid_given']), "medical_review_done": bool(row and row['medical_review_done'])}), 200
    except Exception as e:
        print(f"Medical review error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@ngo_bp.route('/cases/<refugee_id>/resolve', methods=['POST'])
def case_resolve(refugee_id):
    try:
        db = get_db()
        try:
            prov_id = _get_prov_id(db, refugee_id)
            if prov_id:
                db.execute(
                    "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'case_resolved', 'NGO System')",
                    (prov_id,)
                )
            db.execute(
                "UPDATE ngo_assignments SET case_status='resolved' WHERE refugee_registration_id=?",
                (refugee_id,)
            )
            
            row = db.execute("SELECT entity_id FROM refugee_registrations WHERE id=?", (refugee_id,)).fetchone()
            if row:
                db.execute("UPDATE entities SET status='Inactive' WHERE id=?", (row['entity_id'],))
            db.execute("UPDATE refugee_registrations SET status='Inactive' WHERE id=?", (refugee_id,))
            
            db.commit()
        finally:
            db.close()
        return jsonify({"success": True, "case_status": "resolved"}), 200
    except Exception as e:
        print(f"Resolve error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@ngo_bp.route('/cases/<refugee_id>/revert', methods=['POST'])
def case_revert(refugee_id):
    try:
        data = request.get_json(force=True, silent=True) or {}
        revert_to = data.get('revert_to', 'active')

        db = get_db()
        try:
            prov_id = _get_prov_id(db, refugee_id)
            if prov_id and revert_to != 'active':
                target_log = db.execute(
                    "SELECT timestamp FROM refugee_status_log WHERE provisional_id=? AND stage=? ORDER BY timestamp DESC LIMIT 1",
                    (prov_id, revert_to)
                ).fetchone()
                if target_log:
                    db.execute(
                        "DELETE FROM refugee_status_log WHERE provisional_id=? AND timestamp > ?",
                        (prov_id, target_log['timestamp'])
                    )
                else:
                    # Remove all non-baseline stages
                    db.execute(
                        "DELETE FROM refugee_status_log WHERE provisional_id=? AND stage NOT IN ('registered', 'assigned_to_ngo')",
                        (prov_id,)
                    )
            elif prov_id and revert_to == 'active':
                db.execute(
                    "DELETE FROM refugee_status_log WHERE provisional_id=? AND stage NOT IN ('registered', 'assigned_to_ngo')",
                    (prov_id,)
                )

            if revert_to == 'active':
                db.execute(
                    "UPDATE ngo_assignments SET case_status=?, aid_given=0, medical_review_done=0 WHERE refugee_registration_id=?",
                    (revert_to, refugee_id)
                )
            elif revert_to == 'acknowledged':
                # Reverting from resolved -> acknowledged shouldn't necessarily delete the aid/medical flags.
                # The frontend lets you revert from Acknowledged -> Active too.
                db.execute(
                    "UPDATE ngo_assignments SET case_status=? WHERE refugee_registration_id=?",
                    (revert_to, refugee_id)
                )
            
            db.commit()
        finally:
            db.close()
        return jsonify({"success": True, "case_status": revert_to}), 200
    except Exception as e:
        print(f"Revert error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@ngo_bp.route('/<ngo_id>/cases', methods=['GET'])
def get_ngo_cases(ngo_id):
    try:
        status = request.args.get('status', 'active')
        db = get_db()
        try:
            if str(ngo_id).lower() != 'all':
                ngo = db.execute("SELECT name FROM ngos WHERE id=?", (ngo_id,)).fetchone()
                if not ngo:
                    return jsonify({"success": False, "message": "NGO not found"}), 404
                assigned_cond = "rr.assigned_ngo = ?"
                params = [ngo['name']]
            else:
                assigned_cond = "1=1"
                params = []

            status_cond = (
                "na.case_status = 'resolved'"
                if status == 'resolved'
                else "(na.case_status != 'resolved' OR na.case_status IS NULL)"
            )

            rows = db.execute(f"""
                SELECT rr.id as reg_id, rr.provisional_id, rr.status as reg_status, rr.processed,
                       rr.force, rr.assigned_camp,
                       e.name, e.nationality, e.status, e.medical_needs, e.help_tags,
                       e.gender, e.dob,
                       na.case_status, na.id as assignment_id,
                       na.aid_given, na.medical_review_done
                FROM refugee_registrations rr
                JOIN entities e ON e.id = rr.entity_id
                JOIN ngo_assignments na ON na.refugee_registration_id = rr.id
                WHERE {assigned_cond} AND ({status_cond})
                ORDER BY na.created_at DESC
            """, params).fetchall()
        finally:
            db.close()

        return api_response(data=[dict(r) for r in rows])
    except Exception as e:
        print(f"Get cases error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

