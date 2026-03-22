import random, string
from flask import Blueprint, request
from database import get_db, row_to_dict, rows_to_list, api_response, api_error

border_patrol_bp = Blueprint('border_patrol', __name__)


def _gen_provisional_id(force):
    code_map = {
        'BSF': 'BSF', 'ITBP': 'ITBP', 'SSB': 'SSB',
        'Assam Rifles': 'AR', 'CISF': 'CISF'
    }
    code = code_map.get(force, 'BP')
    num  = random.randint(1, 999999)
    return f"PROV-{code}-2026-{num:06d}"


@border_patrol_bp.route('/assign-ngo/<provisional_id>', methods=['POST'])
def assign_ngo(provisional_id):
    # Keep original mock implementation
    return api_response(message="NGO Assiged successfully.")

@border_patrol_bp.route('/refugee/<provisional_id>/family', methods=['POST'])
def declare_family(provisional_id):
    data = request.get_json(silent=True) or {}
    members = data.get('members', [])
    if not isinstance(members, list):
        return api_error('members must be a list')
        
    db = get_db()
    try:
        # Clear existing declarations for this refugee to avoid duplicates if re-submitting
        db.execute("DELETE FROM family_declarations WHERE provisional_id=?", (provisional_id,))
        for mem in members:
            name = mem.get('name', '').strip()
            age = mem.get('age', 0)
            if name:
                db.execute(
                    "INSERT INTO family_declarations (provisional_id, declared_member_name, declared_member_age) VALUES (?, ?, ?)",
                    (provisional_id, name, age)
                )
        db.commit()
        return api_response(message="Family declarations saved successfully.")
    finally:
        db.close()


@border_patrol_bp.route('/family/search', methods=['GET'])
def family_search():
    name = request.args.get('name', '').strip()
    if not name:
        return api_response(data=[])
    db = get_db()
    try:
        rows = db.execute("""
            SELECT rr.provisional_id, rr.provisional_id as id, e.name, e.nationality, e.assigned_camp, e.family_id 
            FROM entities e
            JOIN refugee_registrations rr ON e.id = rr.entity_id
            WHERE e.name LIKE ?
            LIMIT 20
        """, (f"%{name}%",)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@border_patrol_bp.route('/family/link', methods=['POST'])
def link_family():
    data = request.get_json(silent=True) or {}
    prov_ids = data.get('refugee_ids', []) or data.get('provisional_ids', [])
    if not prov_ids or not isinstance(prov_ids, list):
        return api_error('refugee_ids must be a list of IDs')
        
    db = get_db()
    try:
        placeholders = ','.join(['?'] * len(prov_ids))
        
        # Check if any already has a family_id
        rows = db.execute(f"SELECT e.family_id FROM entities e JOIN refugee_registrations rr ON e.id = rr.entity_id WHERE rr.provisional_id IN ({placeholders})", prov_ids).fetchall()
        
        family_id = None
        for r in rows:
            if r['family_id']:
                family_id = r['family_id']
                break
                
        if not family_id:
            import time
            family_id = f"FAM-{int(time.time())}"
            
        entity_rows = db.execute(f"SELECT entity_id FROM refugee_registrations WHERE provisional_id IN ({placeholders})", prov_ids).fetchall()
        entity_ids = [r['entity_id'] for r in entity_rows]
        
        if entity_ids:
            e_placeholders = ','.join(['?'] * len(entity_ids))
            db.execute(
                f"UPDATE entities SET family_id=? WHERE id IN ({e_placeholders})",
                [family_id] + entity_ids
            )
        db.commit()
        return api_response(message=f"Successfully linked refugees")
    finally:
        db.close()


@border_patrol_bp.route('/refugee/<provisional_id>/family-members', methods=['GET'])
def get_family_members(provisional_id):
    db = get_db()
    try:
        entity = db.execute("SELECT e.family_id FROM entities e JOIN refugee_registrations rr ON e.id = rr.entity_id WHERE rr.provisional_id = ?", (provisional_id,)).fetchone()
        if not entity or not entity['family_id']:
            return api_response(data=[])
        
        rows = db.execute("""
            SELECT rr.provisional_id, e.name, e.nationality, e.assigned_camp, e.family_id
            FROM entities e
            JOIN refugee_registrations rr ON e.id = rr.entity_id
            WHERE e.family_id = ? AND rr.provisional_id != ?
        """, (entity['family_id'], provisional_id)).fetchall()
        
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@border_patrol_bp.route('/family/unlink', methods=['POST'])
def unlink_family():
    data = request.get_json(silent=True) or {}
    prov_id = data.get('refugee_id') or data.get('provisional_id')
    if not prov_id:
        return api_error("refugee_id required")
        
    db = get_db()
    try:
        db.execute("""
            UPDATE entities 
            SET family_id = NULL 
            WHERE id IN (
                SELECT entity_id FROM refugee_registrations WHERE provisional_id = ?
            )
        """, (prov_id,))
        db.commit()
        return api_response(message="Unlinked successfully")
    finally:
        db.close()


@border_patrol_bp.route('/watchlist-check', methods=['POST'])
def watchlist_check():
    data = request.get_json(silent=True) or {}
    passport_no = data.get('passport_no', '').strip()
    name        = data.get('name', '').strip()

    if not passport_no and not name:
        return api_error('passport_no or name required')

    db = get_db()
    try:
        row = None
        if passport_no:
            row = db.execute(
                "SELECT * FROM entities WHERE passport_no=? AND is_blacklist=1",
                (passport_no,)
            ).fetchone()
        if not row and name:
            row = db.execute(
                "SELECT * FROM entities WHERE name LIKE ? AND is_blacklist=1",
                (f'%{name}%',)
            ).fetchone()
    finally:
        db.close()

    if row:
        r = dict(row)
        return api_response(data={
            'is_blacklist':      True,
            'matched_name':      r['name'],
            'blacklist_reason':  r['blacklist_reason'],
            'status':            r['status'],
            'nationality':       r['nationality'],
            'risk_score':        r['risk_score']
        })
    return api_response(data={'is_blacklist': False})


@border_patrol_bp.route('/register-refugee', methods=['POST'])
def register_refugee():
    data = request.get_json(silent=True) or {}
    required = ['name', 'nationality', 'force', 'entry_point', 'assigned_camp',
                'assigned_ngo', 'ngo_message', 'registered_by']
    for f in required:
        if not data.get(f):
            return api_error(f'Field required: {f}')

    if len(data['ngo_message'].strip()) < 50:
        return api_error('NGO message must be at least 50 characters')

    provisional_id = _gen_provisional_id(data['force'])
    entity_id      = f"BMS-REG-{random.randint(10000,99999)}"
    reg_id         = f"REG-{random.randint(100000,999999)}"
    passport_no    = data.get('passport_no') or f"TEMP-{random.randint(1000,9999)}"

    help_tags = ','.join([t for t in [
        'Medical'           if data.get('needs_medical') else '',
        'Shelter'           if data.get('needs_shelter') else '',
        'Legal Aid'         if data.get('needs_legal') else '',
        'Child Protection'  if data.get('needs_child') else '',
        'Education'         if data.get('needs_education') else '',
    ] if t])

    ngo_assignment_id = f"NGA-{random.randint(100000,999999)}"

    db = get_db()
    try:
        # Upsert entity
        db.execute("""
            INSERT OR IGNORE INTO entities
              (id, name, passport_no, nationality, type, entry_point, status,
               risk_score, is_blacklist, last_seen, medical_needs, dob, gender,
               visit_reason, assigned_camp, assigned_ngo, help_tags, officer_notes,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
        """, (
            entity_id, data['name'], passport_no, data['nationality'],
            'Refugee', data['entry_point'], 'Provisional', 10, 0,
            data.get('medical_needs','None'),
            data.get('dob'), data.get('gender'),
            'Seeking Asylum', data['assigned_camp'], data['assigned_ngo'],
            help_tags, data.get('officer_notes','')
        ))

        db.execute("""
            INSERT INTO refugee_registrations
              (id, entity_id, registered_by, force, entry_point, assigned_camp,
               assigned_ngo, help_tags, ngo_message, provisional_id, registration_date, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),'Active')
        """, (
            reg_id, entity_id, data['registered_by'], data['force'],
            data['entry_point'], data['assigned_camp'], data['assigned_ngo'],
            help_tags, data['ngo_message'], provisional_id
        ))

        db.execute("""
            INSERT INTO ngo_assignments
              (id, refugee_registration_id, ngo_id, ngo_name, message, status, created_at)
            VALUES (?,?,?,?,?,'Pending',datetime('now'))
        """, (
            ngo_assignment_id, reg_id,
            data.get('ngo_id', 'NGO-001'), data['assigned_ngo'],
            data['ngo_message']
        ))

        # Status timeline: Registered
        db.execute("""
            INSERT INTO refugee_status_log (provisional_id, stage, updated_by)
            VALUES (?, 'registered', ?)
        """, (provisional_id, data['registered_by']))
        
        # Status timeline: Assigned to NGO (if immediately assigned)
        if data.get('assigned_ngo'):
            db.execute("""
                INSERT INTO refugee_status_log (provisional_id, stage, updated_by)
                VALUES (?, 'assigned_to_ngo', ?)
            """, (provisional_id, data['registered_by'] or 'System'))

        db.commit()
    except Exception as e:
        db.close()
        return api_error(f'Database error: {str(e)}', 500)
    finally:
        db.close()

    return api_response(data={
        'provisional_id':  provisional_id,
        'registration_id': reg_id,
        'entity_id':       entity_id
    }, message='Refugee registered successfully')


@border_patrol_bp.route('/refugees', methods=['GET'])
def list_refugees():
    force = request.args.get('force', '')
    limit = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    db = get_db()
    try:
        rows = db.execute("""
            SELECT rr.provisional_id, e.name, e.nationality, e.assigned_camp, rr.processed,
                   e.assigned_ngo, rr.status, rr.registration_date, rr.force,
                   rr.entry_point, e.help_tags, e.medical_needs
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            WHERE (? = '' OR rr.force = ?)
            ORDER BY rr.registration_date DESC
            LIMIT ? OFFSET ?
        """, (force, force, limit, offset)).fetchall()

        total = db.execute("""
            SELECT COUNT(*) as c FROM refugee_registrations rr
            WHERE (? = '' OR rr.force = ?)
        """, (force, force)).fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'items': [dict(r) for r in rows],
        'total': total
    })
