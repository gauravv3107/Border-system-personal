/* config.js — Global constants and shared helpers */
const API_BASE = '';  // Flask serves frontend, so same origin

const FORCE_SLUGS = {
  'BSF': 'bsf',
  'ITBP': 'itbp',
  'SSB': 'ssb',
  'Assam Rifles': 'assam-rifles',
  'CISF': 'cisf'
};

const FORCE_CODES = { 'BSF':'BSF','ITBP':'ITBP','SSB':'SSB','Assam Rifles':'AR','CISF':'CISF' };

const CAMP_COORDS = {
  'Zokhawthar, Mizoram':       [23.3652, 93.3855],
  'Matia Transit Camp, Assam': [26.1618, 90.6264],
  'Champhai, Mizoram':         [23.4560, 93.3290],
  'Coopers Camp, West Bengal': [23.1777, 88.5735],
  'EPDP Colony, Delhi':        [28.5395, 77.2476],
  'Mandapam Camp, Tamil Nadu': [9.2810,  79.1576],
  'Shaheen Nagar, Hyderabad':  [17.3100, 78.4860]
};

const CAMP_CAPACITY = {
  'Zokhawthar, Mizoram':       5000,
  'Matia Transit Camp, Assam': 3500,
  'Champhai, Mizoram':         8000,
  'Coopers Camp, West Bengal': 11000,
  'EPDP Colony, Delhi':        2000,
  'Mandapam Camp, Tamil Nadu': 10000,
  'Shaheen Nagar, Hyderabad':  1500
};

const FORCE_CAMPS = {
  'BSF':          ['Coopers Camp, West Bengal','Matia Transit Camp, Assam'],
  'ITBP':         ['EPDP Colony, Delhi'],
  'SSB':          ['Matia Transit Camp, Assam','Coopers Camp, West Bengal'],
  'Assam Rifles': ['Zokhawthar, Mizoram','Champhai, Mizoram','Matia Transit Camp, Assam'],
  'CISF':         ['EPDP Colony, Delhi','Mandapam Camp, Tamil Nadu','Shaheen Nagar, Hyderabad']
};

const ENTRY_POINTS_BY_FORCE = {
  'BSF':          ['Attari-Wagah, Punjab','Petrapole Land Port','Dawki-Tamabil, Meghalaya'],
  'ITBP':         ['Shipkila Pass','Nathu La Pass, Sikkim','Chang La, Ladakh'],
  'SSB':          ['Raxaul-Birgunj, Bihar','Sunauli-Bhairahawa, UP','Jaigaon-Phuentsholing, WB'],
  'Assam Rifles': ['Moreh-Tamu, Manipur','Zokhawthar, Mizoram','Champhai'],
  'CISF':         ['IGI Airport, Delhi','CSIA Mumbai','KIA Bengaluru','NSCBI Kolkata','Chennai International Airport']
};

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options
    });
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    return { success: false, message: err.message };
  }
}

function getSession() {
  try { return JSON.parse(sessionStorage.getItem('dbms_session') || '{}'); }
  catch { return {}; }
}

function formatDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return str; }
}

function formatDateTime(str) {
  if (!str) return '—';
  try {
    let dStr = str;
    if (typeof dStr === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(dStr)) {
      dStr = dStr.replace(' ', 'T') + 'Z';
    }
    return new Date(dStr).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  catch { return str; }
}
