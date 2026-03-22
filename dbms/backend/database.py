import sqlite3
import os
from flask import jsonify
from datetime import datetime, timezone

DB_PATH   = os.path.join(os.path.dirname(__file__), 'dbms.sqlite')
SEED_PATH = os.path.join(os.path.dirname(__file__), 'seed_data.sql')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


def init_db():
    conn = get_db()
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entities'"
    ).fetchone()
    if not tables:
        with open(SEED_PATH, 'r', encoding='utf-8') as f:
            conn.executescript(f.read())
        conn.commit()

    # Run column migrations — SQLite does not support ADD COLUMN IF NOT EXISTS
    # so we catch OperationalError when the column already exists.
    # Make sure entities has the necessary columns (migration)
    cursor = conn.execute("PRAGMA table_info(entities)")
    columns = [row['name'] for row in cursor.fetchall()]
    if 'visa_status' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN visa_status TEXT DEFAULT 'None'")
    if 'passport_photo' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN passport_photo TEXT")
    if 'language_preference' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN language_preference TEXT DEFAULT 'en'")
    if 'family_id' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN family_id TEXT DEFAULT NULL")
    if 'visa_expiry_date' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN visa_expiry_date TEXT")
    if 'expiry_warning_days' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN expiry_warning_days INTEGER DEFAULT 30")
    if 'investigation_flag' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN investigation_flag INTEGER DEFAULT 0")
    if 'investigation_notes' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN investigation_notes TEXT")
    if 'registered_by_unit' not in columns:
        conn.execute("ALTER TABLE entities ADD COLUMN registered_by_unit TEXT DEFAULT 'Unknown'")
    conn.commit()

    # Create refugee status timeline table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS refugee_status_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provisional_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT
        )
    """)
    conn.commit()

    # Create appeals table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS appeals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refugee_id INTEGER,
            provisional_id TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'open',
            response_notes TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    
    cursor = conn.execute("PRAGMA table_info(appeals)")
    a_cols = [row['name'] for row in cursor.fetchall()]
    if a_cols and 'refugee_id' not in a_cols:
        conn.execute("ALTER TABLE appeals ADD COLUMN refugee_id INTEGER")
        conn.commit()

    # Create family declarations table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS family_declarations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provisional_id TEXT NOT NULL,
            declared_member_name TEXT,
            declared_member_age INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    # Create app_settings table for configurable values
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.commit()


    # Create alerts table if it doesn't exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            type         TEXT    NOT NULL DEFAULT 'system',
            message      TEXT    NOT NULL,
            severity     TEXT    NOT NULL DEFAULT 'info',
            triggered_by TEXT,
            read         INTEGER NOT NULL DEFAULT 0,
            timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    # Create ngos table if it doesn't exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ngos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            focus_area TEXT,
            contact_person TEXT,
            contact_email TEXT,
            max_capacity INTEGER DEFAULT 0,
            current_count INTEGER DEFAULT 0,
            lat REAL,
            lng REAL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    if conn.execute("SELECT COUNT(*) as c FROM ngos").fetchone()['c'] == 0:
        ngos_json_path = os.path.join(os.path.dirname(__file__), 'ngos.json')
        if os.path.exists(ngos_json_path):
            import json
            with open(ngos_json_path, 'r', encoding='utf-8') as f:
                ngo_data = json.load(f)
                seen_names = set()
                for force, list_n in ngo_data.items():
                    for ngo in list_n:
                        if ngo['name'] not in seen_names:
                            seen_names.add(ngo['name'])
                            areas = ", ".join(ngo.get('specializations', []))
                            # Default seeded to approved, with an initial capacity to avoid 0 div
                            conn.execute("""
                                INSERT INTO ngos (name, focus_area, contact_email, max_capacity, status)
                                VALUES (?, ?, ?, ?, 'approved')
                            """, (ngo['name'], areas, ngo.get('contact',''), 100))
    conn.commit()

    # Vessel clearance migration
    cursor = conn.execute("PRAGMA table_info(vessels)")
    v_columns = [row['name'] for row in cursor.fetchall()]
    if v_columns:  # Vessels table might be dynamically created from script
        cols_to_add = [
            ("health_clearance", "INTEGER DEFAULT 1"),
            ("health_clearance_by", "TEXT"),
            ("health_clearance_at", "DATETIME"),
            ("customs_clearance", "INTEGER DEFAULT 1"),
            ("customs_clearance_by", "TEXT"),
            ("customs_clearance_at", "DATETIME"),
            ("departed_at", "TEXT")
        ]
        
        for col_name, col_type in cols_to_add:
            try:
                conn.execute(f"ALTER TABLE vessels ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass
        conn.commit()

        # Fix existing records
        conn.execute("UPDATE vessels SET health_clearance = 1 WHERE health_clearance IS NULL OR health_clearance = 0")
        conn.execute("UPDATE vessels SET customs_clearance = 1 WHERE customs_clearance IS NULL OR customs_clearance = 0")
        conn.commit()

    # Create vessel_clearance_log table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS vessel_clearance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vessel_id TEXT NOT NULL,
            clearance_type TEXT NOT NULL,
            granted INTEGER,
            officer_id TEXT,
            notes TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    
    # Prompt 6: Migration for case_status in ngo_assignments
    cursor = conn.execute("PRAGMA table_info(ngo_assignments)")
    na_cols = [row['name'] for row in cursor.fetchall()]
    if na_cols and 'case_status' not in na_cols:
        conn.execute("ALTER TABLE ngo_assignments ADD COLUMN case_status TEXT DEFAULT 'active'")
        conn.commit()
    if na_cols and 'aid_given' not in na_cols:
        conn.execute("ALTER TABLE ngo_assignments ADD COLUMN aid_given INTEGER DEFAULT 0")
        conn.commit()
    if na_cols and 'medical_review_done' not in na_cols:
        conn.execute("ALTER TABLE ngo_assignments ADD COLUMN medical_review_done INTEGER DEFAULT 0")
        conn.commit()

    cursor = conn.execute("PRAGMA table_info(refugee_registrations)")
    rr_cols = [row['name'] for row in cursor.fetchall()]
    if rr_cols and 'processed' not in rr_cols:
        conn.execute("ALTER TABLE refugee_registrations ADD COLUMN processed TEXT DEFAULT 'at camp'")
        conn.commit()

    
    # Prompt 10 tables: users, resource_requests, aid_distribution
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'ngo_worker',
            ngo_id INTEGER
        )
    """)
    conn.commit()
    
    # Migration just in case the users table was already created manually
    cursor = conn.execute("PRAGMA table_info(users)")
    u_columns = [row['name'] for row in cursor.fetchall()]
    if u_columns:
        if 'role' not in u_columns:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'ngo_worker'")
        if 'ngo_id' not in u_columns:
            conn.execute("ALTER TABLE users ADD COLUMN ngo_id INTEGER")
        conn.commit()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS resource_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ngo_id INTEGER NOT NULL,
            request_type TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'open',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS aid_distribution (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refugee_id TEXT NOT NULL,
            worker_id INTEGER NOT NULL,
            ngo_id INTEGER NOT NULL,
            aid_type TEXT NOT NULL,
            description TEXT,
            date TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    conn.close()



def api_response(data=None, message="OK", success=True, status=200):
    return jsonify({
        "success": success,
        "data": data,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }), status


def api_error(message, status=400):
    return api_response(data=None, message=message, success=False, status=status)
