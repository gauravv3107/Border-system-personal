from flask import Blueprint, request
from database import get_db, row_to_dict, api_response, api_error

refugee_bp = Blueprint('refugee', __name__)


@refugee_bp.route('/lookup/<provisional_id>', methods=['GET'])
def lookup(provisional_id):
    provisional_id = provisional_id.strip().upper()
    if not provisional_id.startswith('PROV-'):
        return api_error('Invalid provisional ID format. Expected: PROV-FORCE-YEAR-NUMBER', 400)

    db = get_db()
    try:
        row = db.execute("""
            SELECT rr.id as refugee_id, rr.provisional_id, rr.force, rr.entry_point, rr.registration_date, rr.processed,
                   rr.assigned_camp, rr.assigned_ngo, rr.help_tags, rr.status AS reg_status,
                   e.name, e.nationality, e.dob, e.gender, e.medical_needs, e.language_preference,
                   e.status AS entity_status, e.assigned_camp AS entity_camp,
                   na.ngo_name, na.status AS ngo_status
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            LEFT JOIN ngo_assignments na ON na.refugee_registration_id = rr.id
            WHERE rr.provisional_id = ?
        """, (provisional_id,)).fetchone()
    finally:
        db.close()

    if not row:
        return api_error(
            'No record found for this Provisional ID. Please contact the officer who registered you.',
            404
        )

    data = dict(row)
    # Add rights and camp info
    data['rights'] = [
        'You have the right to non-refoulement — you cannot be returned to a country where you face danger.',
        'You have the right to seek asylum and have your claim individually assessed.',
        'You have the right to basic shelter, food, and medical care during processing.',
        'You have the right to speak with UNHCR and legal aid representatives.',
        'Children have additional rights under the UN Convention on the Rights of the Child.',
    ]
    data['emergency_contacts'] = [
        {'label': 'UNHCR India Helpline', 'number': '+91-11-4653-7444'},
        {'label': 'NHRC Helpline',        'number': '14433'},
        {'label': 'Police Emergency',      'number': '100'},
        {'label': 'Medical Emergency',     'number': '108'},
    ]
    return api_response(data=data)

@refugee_bp.route('/<provisional_id>/timeline', methods=['GET'])
def get_timeline(provisional_id):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, provisional_id as refugee_id, stage, timestamp, updated_by FROM refugee_status_log WHERE provisional_id=? ORDER BY timestamp ASC",
            (provisional_id,)
        ).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()

@refugee_bp.route('/<provisional_id>/timeline', methods=['POST'])
def add_timeline_entry(provisional_id):
    data = request.get_json(silent=True) or {}
    stage = data.get('stage')
    updated_by = data.get('updated_by', 'System')
    if not stage:
        return api_error('stage is required')
    
    db = get_db()
    try:
        db.execute(
            "INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, ?, ?)",
            (provisional_id, stage, updated_by)
        )
        db.commit()
        return api_response(message='Timeline entry added')
    finally:
        db.close()

@refugee_bp.route('/<provisional_id>/language', methods=['PUT'])
def update_language(provisional_id):
    data = request.get_json(silent=True) or {}
    lang = data.get('language')
    if not lang:
        return api_error('language is required')
    
    db = get_db()
    try:
        # Find entity id first
        e_id = db.execute(
            "SELECT entity_id FROM refugee_registrations WHERE provisional_id=?", 
            (provisional_id,)
        ).fetchone()
        
        if not e_id:
            return api_error('Refugee not found', 404)
            
        db.execute(
            "UPDATE entities SET language_preference=? WHERE id=?",
            (lang, e_id['entity_id'])
        )
        db.commit()
        return api_response(message='Language preference updated')
    finally:
        db.close()

@refugee_bp.route('/<id>/appeal', methods=['POST'])
def create_appeal(id):
    data = request.get_json(silent=True) or {}
    a_type = data.get('type')
    desc = data.get('description', '')
    if not a_type:
        return api_error('Appeal type is required')
    
    db = get_db()
    try:
        ref = db.execute(
            "SELECT e.name, rr.provisional_id FROM refugee_registrations rr JOIN entities e ON rr.entity_id=e.id WHERE rr.id=?", 
            (id,)
        ).fetchone()
        if not ref:
            return api_error('Invalid Refugee ID', 404)
            
        cursor = db.execute(
            "INSERT INTO appeals (refugee_id, provisional_id, type, description) VALUES (?, ?, ?, ?)",
            (id, ref['provisional_id'], a_type, desc)
        )
        new_id = cursor.lastrowid
        # Write warning alert
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by, read) VALUES (?, ?, ?, ?, 0)",
            ('appeal', f"Refugee {ref['name']} submitted an appeal: {a_type}", 'warning', 'refugee_portal')
        )
        db.commit()
        from flask import jsonify
        return jsonify({"success": True, "appeal_id": new_id}), 201
    finally:
        db.close()

@refugee_bp.route('/<id>/appeals', methods=['GET'])
def get_appeals(id):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, type, description, status, response_notes, timestamp FROM appeals WHERE refugee_id=? ORDER BY timestamp DESC",
            (id,)
        ).fetchall()
        
        if not rows:
            ref = db.execute("SELECT provisional_id FROM refugee_registrations WHERE id=?", (id,)).fetchone()
            if ref:
                rows = db.execute(
                    "SELECT id, type, description, status, response_notes, timestamp FROM appeals WHERE provisional_id=? ORDER BY timestamp DESC",
                    (ref['provisional_id'],)
                ).fetchall()
                
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()

