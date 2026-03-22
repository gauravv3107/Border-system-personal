from flask import Blueprint, jsonify, request, session
from database import api_response, api_error, get_db
import hashlib

auth_bp = Blueprint('auth', __name__)

# Simulated users — in production this would be a DB table
USERS = {
    'border_patrol': {'password': 'patrol123', 'role': 'authority', 'subRole': 'border_patrol'},
    'sea_marshall':  {'password': 'sea123',    'role': 'authority', 'subRole': 'sea_marshall'},
    'immigration':   {'password': 'imm123',    'role': 'authority', 'subRole': 'immigration_officer'},
    'ngo_user':      {'password': 'ngo123',    'role': 'ngo'},
    'refugee':       {'password': 'ref123',    'role': 'refugee'},
    # Accept any credentials for demo
    'demo':          {'password': 'demo',      'role': 'authority', 'subRole': 'border_patrol'},
}


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id', '').strip()
    password = data.get('password', '').strip()
    role     = data.get('role', 'authority')
    sub_role = data.get('sub_role', '')
    force    = data.get('force', '')

    # Demo mode: accept any non-empty credentials
    if not user_id or not password:
        return api_error('user_id and password are required', 400)

    session_data = {
        'user_id':  user_id,
        'role':     role,
        'sub_role': sub_role,
        'force':    force,
        'name':     f"Officer {user_id[:8].upper()}",
        'logged_in': True
    }
    return api_response(data=session_data, message='Login successful')


@auth_bp.route('/logout', methods=['POST'])
def logout():
    return api_response(message='Logged out successfully')


@auth_bp.route('/ngo-login', methods=['POST'])
def ngo_login():
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()

    if not email or not password:
        return api_error('Email and password are required', 400)

    db = get_db()
    try:
        user = db.execute(
            "SELECT * FROM users WHERE email = ? AND password = ? AND role IN ('ngo_admin', 'ngo_worker')",
            (email, password)
        ).fetchone()

        if user:
            ngo = db.execute("SELECT status FROM ngos WHERE id = ?", (user['ngo_id'],)).fetchone()
            if ngo and ngo['status'] == 'pending':
                return api_error('Your NGO application is pending approval by Border Control Admins', 403)
            if ngo and ngo['status'] == 'deactivated':
                return api_error('Your NGO access has been deactivated', 403)

            session_data = {
                'token': f"ngo_token_{user['id']}",
                'role': user['role'],
                'ngo_id': user['ngo_id'],
                'name': user['name']
            }
            return api_response(data=session_data, message='NGO Login successful')
        else:
            return api_error('Invalid email or password', 401)
    finally:
        db.close()


@auth_bp.route('/session', methods=['GET'])
def get_session():
    return api_response(data={'logged_in': True})


@auth_bp.route('/ngo-apply', methods=['POST'])
def ngo_apply():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    if not name or not email or not password:
        return api_error('NGO Name, email, and password are required', 400)
    
    db = get_db()
    try:
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return api_error('Email is already registered', 400)
        
        cursor = db.execute("""
            INSERT INTO ngos (name, focus_area, contact_person, contact_email, max_capacity, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        """, (name, data.get('focus_area', ''), data.get('contact_person', ''), email, int(data.get('max_capacity', 100) or 100)))
        ngo_id = cursor.lastrowid
        
        db.execute("""
            INSERT INTO users (name, email, password, role, ngo_id)
            VALUES (?, ?, ?, 'ngo_admin', ?)
        """, (f"{name} Admin", email, password, ngo_id))
        
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
        
    return api_response(message="Application submitted successfully. Pending Admin approval.", status=201)
