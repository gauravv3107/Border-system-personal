-- ==============================================================
-- DBMS v1.0 — Schema + Seed Data (350 entities)
-- ==============================================================

CREATE TABLE IF NOT EXISTS entities (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    passport_no        TEXT UNIQUE,
    nationality        TEXT NOT NULL,
    type               TEXT NOT NULL CHECK(type IN ('Traveler','Refugee','Migrant')),
    entry_point        TEXT,
    status             TEXT DEFAULT 'Pending'
                       CHECK(status IN ('Verified','Flagged','Pending','Denied','Provisional','Inactive')),
    risk_score         INTEGER DEFAULT 0 CHECK(risk_score BETWEEN 0 AND 100),
    is_blacklist       INTEGER DEFAULT 0,
    blacklist_reason   TEXT,
    last_seen          TEXT,
    medical_needs      TEXT DEFAULT 'None',
    photo_seed         TEXT,
    dob                TEXT,
    gender             TEXT,
    income_declaration TEXT,
    visit_reason       TEXT,
    proof_of_address   TEXT,
    assigned_camp      TEXT,
    assigned_ngo       TEXT,
    help_tags          TEXT,
    officer_notes      TEXT,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refugee_registrations (
    id                TEXT PRIMARY KEY,
    entity_id         TEXT REFERENCES entities(id),
    registered_by     TEXT NOT NULL,
    force             TEXT NOT NULL,
    entry_point       TEXT,
    assigned_camp     TEXT,
    assigned_ngo      TEXT,
    help_tags         TEXT,
    ngo_message       TEXT,
    provisional_id    TEXT UNIQUE,
    registration_date TEXT DEFAULT (datetime('now')),
    status            TEXT DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS incidents (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    severity     TEXT CHECK(severity IN ('Low','Medium','High','Critical')),
    location     TEXT,
    description  TEXT,
    reported_by  TEXT,
    vessel_imo   TEXT,
    entity_id    TEXT,
    status       TEXT DEFAULT 'Open'
                 CHECK(status IN ('Open','Under Review','Resolved','Escalated')),
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ngo_assignments (
    id                       TEXT PRIMARY KEY,
    refugee_registration_id  TEXT REFERENCES refugee_registrations(id),
    ngo_id                   TEXT NOT NULL,
    ngo_name                 TEXT NOT NULL,
    message                  TEXT,
    status                   TEXT DEFAULT 'Pending'
                             CHECK(status IN ('Pending','Acknowledged','In Progress','Completed')),
    created_at               TEXT DEFAULT (datetime('now')),
    acknowledged_at          TEXT
);

CREATE TABLE IF NOT EXISTS vessel_status (
    imo        TEXT PRIMARY KEY,
    status     TEXT DEFAULT 'CLEARED',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vessels (
    imo               TEXT PRIMARY KEY,
    vessel_name       TEXT NOT NULL,
    vessel_type       TEXT NOT NULL,
    country_of_origin TEXT,
    flag_state        TEXT NOT NULL,
    cargo             TEXT,
    gross_tonnage     INTEGER,
    destination_port  TEXT,
    eta               TEXT,
    last_port         TEXT,
    captain           TEXT,
    crew_count        TEXT,
    status            TEXT DEFAULT 'CLEARED',
    is_flagged        INTEGER DEFAULT 0,
    flag_reason       TEXT,
    movement_status   TEXT DEFAULT 'APPROACHING',
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entities_passport    ON entities(passport_no);
CREATE INDEX IF NOT EXISTS idx_entities_blacklist   ON entities(is_blacklist);
CREATE INDEX IF NOT EXISTS idx_entities_type        ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_status      ON entities(status);

-- ==============================================================
-- DEMO ENTRIES (DO NOT MODIFY ORDER OR VALUES)
-- ==============================================================

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X01','Vikram Singh','Z8892104','Indian','Traveler',
  'IGI Airport, Delhi','Verified',12,0,NULL,'2026-03-12 14:20','None',
  'vikram','1988-03-15','Male','₹85,000/month','Business — Tech Conference',
  'H-42, Sector 15, Noida, UP 201301',NULL,NULL,NULL,NULL,
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-994','Amina Al-Sayed','TEMP-8821','Syrian','Refugee',
  'Petrapole Land Port','Flagged',78,1,
  'Document Inconsistency - Flagged by INTERPOL',
  '2026-03-11 09:45','Asthma Medication',
  'amina','1993-07-22','Female',NULL,'Seeking Asylum',NULL,
  'Coopers Camp, West Bengal','Bengal Refugee Support Network',
  'Medical,Shelter',
  'Documents show passport number mismatch with INTERPOL database. Hold for secondary screening.',
  datetime('now'),datetime('now')
);

-- ==============================================================
-- BLACKLISTED ENTRIES (2-15)
-- ==============================================================

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X087','Li Wei Chen','CN-8830021','Chinese','Traveler',
  'JNPT, Navi Mumbai','Flagged',95,1,
  'Suspected Human Trafficking Network - Red Notice INTERPOL',
  '2026-03-10 22:30','None','liwei','1979-11-12','Male',
  'USD 8,000/month','Business',
  '24 Huangpu Rd, Pudong, Shanghai 200120',NULL,NULL,NULL,
  'INTERPOL Red Notice. Do not allow entry. Detain and notify NIA.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-023','Abdul Karim Hassan','TEMP-0023','Afghan','Refugee',
  'Moreh-Tamu, Manipur','Flagged',92,1,
  'Known Extremist Organization Links - Banned Entry',
  '2026-03-09 04:15','None','karim','1985-06-03','Male',
  NULL,'Seeking Asylum',NULL,
  'Zokhawthar, Mizoram','Northeast Refugee Aid Collective',
  'Shelter',
  'NIA confirmed extremist links. Banned from entry under UAPA. Detain immediately.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X156','Yusuf Ibrahim Malik','PK-7710044','Pakistani','Traveler',
  'Attari-Wagah, Punjab','Flagged',88,1,
  'Fraudulent Passport - Multiple Identity Documents',
  '2026-03-08 11:20','None','yusuf','1991-03-28','Male',
  'USD 4,500/month','Tourism',
  '12 Gulberg III, Lahore, Pakistan',NULL,NULL,NULL,
  'FIA Pakistan confirms passport PK-7710044 is fraudulent. Three other identity docs found.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-041','Noor Bibi','TEMP-0041','Rohingya','Refugee',
  'Petrapole Land Port','Flagged',81,1,
  'Forged UNHCR Documentation - Under Investigation',
  '2026-03-07 19:00','Diabetes Medication','noor','1999-08-15','Female',
  NULL,'Seeking Asylum',NULL,
  'Coopers Camp, West Bengal','Bengal Refugee Support Network',
  'Medical,Legal Aid',
  'UNHCR Dhaka confirms registration ID on card is unrecognised. Investigation ongoing.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X203','Sergei Volkov','RU-4421009','Russian','Traveler',
  'CSIA Mumbai','Flagged',90,1,
  'Criminal Warrant - Fraud & Money Laundering - Interpol',
  '2026-03-06 08:45','None','volkov','1974-02-17','Male',
  'USD 12,000/month','Business',
  'Leninsky Prospekt 42, Moscow 119049',NULL,NULL,NULL,
  'Interpol warrant issued by Europol. Russian oligarch wanted for €2.4B fraud. Detain.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-067','Ko Aung Myat','TEMP-0067','Myanmar','Refugee',
  'Moreh-Tamu, Manipur','Flagged',86,1,
  'Arms Procurement Links - NSA Watch List',
  '2026-03-05 22:00','None','koaung','1983-12-01','Male',
  NULL,'Seeking Asylum',NULL,
  'Zokhawthar, Mizoram','Northeast Refugee Aid Collective',
  'Shelter',
  'RAW intelligence: linked to arms procurement network operating from Myanmar. NSA watch list.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X118','Fatima Zahra Al-Rashidi','SA-0033481','Saudi Arabian','Traveler',
  'IGI Airport, Delhi','Flagged',91,1,
  'Terrorist Financing Suspicion - Flagged by RAW',
  '2026-03-04 16:30','None','fatima','1989-05-20','Female',
  'USD 9,000/month','Tourism',
  'King Fahd District, Riyadh 12271, KSA',NULL,NULL,NULL,
  'RAW intelligence indicates links to proscribed charity front funding extremist networks.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-089','Mohammad Salim Chowdhury','TEMP-0089','Bangladeshi','Refugee',
  'Dawki-Tamabil, Meghalaya','Flagged',75,1,
  'Repeat Illegal Entry - 3rd Attempt',
  '2026-03-03 06:00','None','salim','1990-07-11','Male',
  NULL,'Economic Migration',NULL,
  'Matia Transit Camp, Assam',NULL,
  'Shelter',
  'Third unauthorised border crossing attempt. Deported twice previously. BSF alert active.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X291','Zhang Wei','CN-5512837','Chinese','Traveler',
  'KIA Bengaluru','Flagged',87,1,
  'Corporate Espionage Suspect - CISF Alert',
  '2026-03-02 13:15','None','zhangwei','1982-09-05','Male',
  'USD 11,000/month','Business',
  '88 Zhongguancun Ave, Haidian, Beijing 100080',NULL,NULL,NULL,
  'CISF intel: targeted DRDO-linked aerospace firms in Bengaluru. Espionage suspected.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-112','Priya Devi Koirala','TEMP-0112','Nepali','Refugee',
  'Raxaul-Birgunj, Bihar','Flagged',72,1,
  'Fraudulent Asylum Claim - Deported 2024',
  '2026-03-01 09:30','None','priyad','1994-04-18','Female',
  NULL,'Seeking Asylum',NULL,
  'Matia Transit Camp, Assam',NULL,
  'Legal Aid',
  'Previously granted refugee status found to be fraudulent. Deported March 2024. Re-entry attempt.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X332','Hassan Al-Farouq','JO-2287441','Jordanian','Traveler',
  'CSIA Mumbai','Flagged',93,1,
  'Drug Trafficking - Narcotics Control Bureau Alert',
  '2026-02-28 20:00','None','hassan','1977-01-30','Male',
  'USD 6,000/month','Business',
  'Al-Abdali District, Amman 11110, Jordan',NULL,NULL,NULL,
  'NCB alert: Al-Farouq linked to Iranian narcotics ring. Previous conviction in UAE 2019.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-REF-078','Soe Moe Kyaw','TEMP-0078','Myanmar','Refugee',
  'Moreh-Tamu, Manipur','Flagged',84,1,
  'Rohingya Extremist Links - NSCN Watch List',
  '2026-02-27 03:45','None','soem','1988-10-22','Male',
  NULL,'Seeking Asylum',NULL,
  'Champhai, Mizoram','Mizoram Christian Service',
  'Shelter',
  'Intelligence Directorate links to Rohingya Solidarity Organisation. NSCN watch list entry.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X044','Deepak Narayan Rao','IN-7743120','Indian','Traveler',
  'NSCBI Kolkata','Flagged',79,1,
  'Money Laundering - Interpol Blue Notice',
  '2026-02-26 11:00','None','deepak','1971-12-08','Male',
  '₹4,50,000/month','Business',
  'F-12, Ballygunge Place, Kolkata 700019',NULL,NULL,NULL,
  'ED India and Interpol Blue Notice. Linked to hawala network moving funds to Dubai.',
  datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO entities VALUES (
  'BMS-2026-X199','Aarav Mehta Shah','IN-5502841','Indian','Traveler',
  'IGI Airport, Delhi','Flagged',77,1,
  'Document Forgery - Passport Fraud Division Alert',
  '2026-02-25 15:20','None','aarav','1996-08-30','Male',
  '₹1,20,000/month','Business',
  'A-304, Powai, Mumbai 400076',NULL,NULL,NULL,
  'Passport Fraud Division: IN-5502841 has altered date of birth. Original: 1976.',
  datetime('now'),datetime('now')
);
