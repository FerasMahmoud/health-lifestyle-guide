// ============================================
// MyLife v2 — Data Sync Engine
// Google Sheets backend + IndexedDB offline cache
// ============================================

const Data = (() => {
  // ---- Configuration ----
  let API_URL = localStorage.getItem('mylife_api_url') || '';

  const SHEETS = {
    steps:       ['date', 'steps', 'distance_km', 'flights_climbed', 'active_calories', 'resting_calories'],
    heart:       ['date', 'avg_hr', 'resting_hr', 'hrv', 'blood_oxygen'],
    sleep:       ['date', 'bedtime', 'wake_time', 'duration_hrs', 'quality'],
    weight:      ['date', 'weight_kg', 'body_fat', 'muscle_mass', 'bmi'],
    plans:       ['date', 'type', 'content', 'ai_model'],
    chat:        ['date', 'role', 'message'],
    ai_insights: ['date', 'score', 'summary', 'model'],
    profile:     ['key', 'value']
  };

  // ---- IndexedDB ----
  const DB_NAME = 'mylife-db';
  const DB_VERSION = 2;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        for (const sheet of Object.keys(SHEETS)) {
          if (!d.objectStoreNames.contains(sheet)) {
            d.createObjectStore(sheet, { keyPath: 'id', autoIncrement: true });
          }
        }
        if (!d.objectStoreNames.contains('sync_meta')) {
          d.createObjectStore('sync_meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function idbPut(store, data) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      if (Array.isArray(data)) {
        s.clear();
        data.forEach(row => s.put(row));
      } else {
        s.put(data);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function idbGetAll(store) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function idbClear(store) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  }

  // ---- API helpers ----
  async function apiGet(action, params = {}) {
    if (!API_URL) throw new Error('API URL not configured');
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async function apiPost(action, body = {}) {
    if (!API_URL) throw new Error('API URL not configured');
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // ---- Sheet operations ----
  async function fetchSheet(sheetName, days = 30) {
    try {
      const data = await apiGet('read', { sheet: sheetName, days: days });
      const rows = (data.rows || []).map((r, i) => ({ ...r, id: i + 1 }));
      await idbPut(sheetName, rows);
      return rows;
    } catch (e) {
      console.warn(`Fetch ${sheetName} failed, using cache:`, e.message);
      return idbGetAll(sheetName);
    }
  }

  async function pushRow(sheetName, rowData) {
    try {
      await apiPost('write', { sheet: sheetName, row: rowData });
      return true;
    } catch (e) {
      console.error(`Push to ${sheetName} failed:`, e.message);
      return false;
    }
  }

  // ---- Convenience: get today's date string ----
  function today() {
    return new Date().toISOString().split('T')[0];
  }

  // ---- Sync all health data ----
  async function syncAll(days = 30) {
    const results = {};
    const sheets = ['steps', 'heart', 'sleep', 'weight'];
    await Promise.all(sheets.map(async s => {
      results[s] = await fetchSheet(s, days);
    }));
    await idbPut('sync_meta', { key: 'last_sync', value: new Date().toISOString() });
    return results;
  }

  // ---- Get last sync time ----
  async function getLastSync() {
    try {
      const d = await openDB();
      return new Promise((resolve) => {
        const tx = d.transaction('sync_meta', 'readonly');
        const req = tx.objectStore('sync_meta').get('last_sync');
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  // ---- AI endpoints ----
  async function aiInsights(date) {
    return apiGet('ai_insights', { date: date || today() });
  }

  async function aiPlan(type) {
    return apiPost('ai_plan', { type });
  }

  async function aiChat(message, history = []) {
    return apiPost('ai_chat', { message, history });
  }

  async function aiSetup(provider, apiKey) {
    return apiPost('ai_setup', { provider, apiKey });
  }

  async function aiTest() {
    return apiPost('ai_chat', { message: 'Say "Hello! AI is working." in under 10 words.', history: [] });
  }

  // ---- Profile ----
  async function getProfile() {
    try {
      const data = await fetchSheet('profile', 999);
      const profile = {};
      data.forEach(r => { if (r.key) profile[r.key] = r.value; });
      return profile;
    } catch {
      return {};
    }
  }

  async function saveProfile(profileObj) {
    return apiPost('save_profile', profileObj);
  }

  // ---- Public API ----
  return {
    get API_URL() { return API_URL; },
    set API_URL(url) { API_URL = url; localStorage.setItem('mylife_api_url', url); },
    SHEETS,
    fetchSheet,
    pushRow,
    syncAll,
    getLastSync,
    aiInsights,
    aiPlan,
    aiChat,
    aiSetup,
    aiTest,
    getProfile,
    saveProfile,
    today,
    idbGetAll,
    idbClear
  };
})();
