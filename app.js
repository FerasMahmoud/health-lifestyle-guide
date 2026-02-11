// ============================================
// MyLife v2 — SPA Controller
// Navigation, data binding, chat, settings
// ============================================

const App = (() => {
  let currentPage = 'dashboard';
  let chatHistory = [];
  let healthData = {};
  let currentRange = '7d';
  let chatLoaded = false;

  const PAGES = ['dashboard', 'plans', 'trends', 'chat', 'settings'];
  const METRIC_IDS = ['val-steps', 'val-hr', 'val-sleep', 'val-calories', 'val-weight', 'val-hrv'];
  const CHART_IDS = ['chart-weight', 'chart-steps', 'chart-hr', 'chart-sleep', 'chart-calories'];
  const $ = id => document.getElementById(id);

  // ---- Helpers ----
  function fmt(n) {
    if (n == null || n === '' || isNaN(n)) return '--';
    return Number(n).toLocaleString();
  }
  function fmtDate(iso) {
    if (!iso) return 'Never';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
  function last(arr) { return arr?.length ? arr[arr.length - 1] : null; }
  function lastN(arr, n, key) {
    return arr?.length ? arr.slice(-n).map(r => parseFloat(r[key]) || 0) : [];
  }

  // ---- Router ----
  function navigate(page) {
    if (!PAGES.includes(page)) return;
    currentPage = page;
    PAGES.forEach(p => {
      $(`page-${p}`)?.classList.toggle('page--active', p === page);
      $(`nav-${p}`)?.classList.toggle('active', p === page);
    });
    ({ dashboard: loadDashboard, plans: loadPlans, trends: loadTrends,
       chat: loadChat, settings: loadSettings })[page]?.();
  }

  // ---- Toast ----
  function toast(msg, dur = 3000) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('toast--visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('toast--visible'), dur);
  }

  // ---- Dashboard ----
  async function loadDashboard() {
    METRIC_IDS.forEach(id => $(id)?.classList.add('skeleton'));

    // Show cached data instantly
    try {
      const c = { steps: await Data.idbGetAll('steps'), heart: await Data.idbGetAll('heart'),
                   sleep: await Data.idbGetAll('sleep'), weight: await Data.idbGetAll('weight') };
      if (c.steps.length || c.heart.length) updateMetrics(c);
    } catch {}

    // Fetch fresh
    try {
      healthData = await Data.syncAll(30);
      updateMetrics(healthData);
    } catch (e) { console.warn('Sync failed:', e.message); }

    METRIC_IDS.forEach(id => $(id)?.classList.remove('skeleton'));
    loadAIInsights();

    const sync = await Data.getLastSync();
    const el = $('last-sync');
    if (el) el.textContent = sync ? `Last synced: ${fmtDate(sync)}` : 'Last synced: --';
  }

  function updateMetrics(data) {
    const s = last(data.steps), h = last(data.heart);
    const sl = last(data.sleep), w = last(data.weight);

    $('val-steps').textContent   = s ? fmt(s.steps) : '--';
    $('val-hr').textContent      = h ? fmt(h.avg_hr) + ' bpm' : '--';
    $('val-sleep').textContent   = sl ? parseFloat(sl.duration_hrs).toFixed(1) + ' hrs' : '--';
    $('val-calories').textContent = s ? fmt(s.active_calories) : '--';
    $('val-weight').textContent  = w ? parseFloat(w.weight_kg).toFixed(1) + ' kg' : '--';
    $('val-hrv').textContent     = h ? fmt(h.hrv) + ' ms' : '--';

    const spark = (id, arr, key, color) => {
      const v = lastN(arr, 7, key);
      if (v.length >= 2) Charts.sparkline(id, v, color);
    };
    spark('sparkline-steps',    data.steps,  'steps',          '#4facfe');
    spark('sparkline-hr',       data.heart,  'avg_hr',         '#f87171');
    spark('sparkline-sleep',    data.sleep,  'duration_hrs',   '#a855f7');
    spark('sparkline-calories', data.steps,  'active_calories', '#fb923c');
    spark('sparkline-weight',   data.weight, 'weight_kg',      '#34d399');
    spark('sparkline-hrv',      data.heart,  'hrv',            '#fbbf24');
  }

  async function loadAIInsights() {
    const el = $('ai-summary');
    try {
      const ins = await Data.aiInsights();
      Charts.healthScore('health-score-ring', parseFloat(ins.score) || 0);
      if (!el) return;
      const obs = ins.observations || [], recs = ins.recommendations || [];
      let html = '<h3>AI Summary</h3>';
      html += ins.summary ? `<p>${ins.summary}</p>` : obs.map(o => `<p>${o}</p>`).join('');
      if (recs.length) html += '<ul>' + recs.map(r => `<li>${r}</li>`).join('') + '</ul>';
      el.innerHTML = html;
    } catch {
      Charts.healthScore('health-score-ring', 0);
      if (el) el.innerHTML = '<h3>AI Summary</h3><p class="text-muted">Connect to AI in Settings to get health insights</p>';
    }
  }

  // ---- Plans ----
  async function loadPlans() {
    const types = ['workout', 'meal', 'sleep'];
    const render = rows => types.forEach(t => renderPlan(`plan-${t}`, rows.filter(r => r.type === t).pop()));
    try { render(await Data.idbGetAll('plans')); } catch {}
    try { render(await Data.fetchSheet('plans', 30)); } catch {}
  }

  async function regeneratePlan(type) {
    const el = $(`plan-${type}`);
    if (el) el.innerHTML = '<p class="skeleton">Generating plan...</p>';
    try {
      const res = await Data.aiPlan(type);
      const p = res.plan || res;
      renderPlan(`plan-${type}`, { content: p.content || p.items?.join('\n') || JSON.stringify(p) });
      toast('Plan updated!');
    } catch (e) {
      if (el) el.innerHTML = `<p class="text-muted">Failed: ${e.message}</p>`;
      toast('Plan generation failed');
    }
  }

  function renderPlan(id, plan) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = plan?.content ? simpleMarkdown(plan.content) : '<p class="text-muted">Tap regenerate to create a plan</p>';
  }

  function simpleMarkdown(text) {
    if (!text) return '';
    const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return text.split('\n').map(l => {
      l = l.trim();
      if (!l) return '<br>';
      if (l.startsWith('### ')) return `<h5>${esc(l.slice(4))}</h5>`;
      if (l.startsWith('## '))  return `<h4>${esc(l.slice(3))}</h4>`;
      if (l.startsWith('# '))   return `<h3>${esc(l.slice(2))}</h3>`;
      if (/^[-*] /.test(l))     return `<li>${bold(esc(l.slice(2)))}</li>`;
      if (/^\d+\.\s/.test(l))   return `<li>${bold(esc(l.replace(/^\d+\.\s/, '')))}</li>`;
      return `<p>${bold(esc(l))}</p>`;
    }).join('\n').replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  }

  // ---- Trends ----
  async function loadTrends() {
    const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[currentRange] || 30;
    CHART_IDS.forEach(id => Charts.destroy(id));
    try {
      healthData = await Data.syncAll(days);
      renderTrendCharts(healthData);
    } catch {
      try {
        const c = { steps: await Data.idbGetAll('steps'), heart: await Data.idbGetAll('heart'),
                     sleep: await Data.idbGetAll('sleep'), weight: await Data.idbGetAll('weight') };
        renderTrendCharts(c);
      } catch {}
    }
  }

  function renderTrendCharts({ steps, heart, sleep, weight }) {
    if (weight?.length)
      Charts.line('chart-weight', weight.map(r => r.date), weight.map(r => parseFloat(r.weight_kg) || 0),
        { labels: ['Weight (kg)'], colors: ['#a855f7'] });
    if (steps?.length)
      Charts.bar('chart-steps', steps.map(r => r.date), steps.map(r => parseInt(r.steps) || 0),
        { color: '#4facfe', label: 'Steps' });
    if (heart?.length)
      Charts.line('chart-hr', heart.map(r => r.date),
        [heart.map(r => parseFloat(r.avg_hr) || 0), heart.map(r => parseFloat(r.resting_hr) || 0)],
        { labels: ['Avg HR', 'Resting HR'], colors: ['#f87171', '#fb923c'] });
    if (sleep?.length)
      Charts.line('chart-sleep', sleep.map(r => r.date), sleep.map(r => parseFloat(r.duration_hrs) || 0),
        { labels: ['Sleep (hrs)'], colors: ['#a855f7'] });
    if (steps?.length)
      Charts.line('chart-calories', steps.map(r => r.date),
        [steps.map(r => parseInt(r.active_calories) || 0), steps.map(r => parseInt(r.resting_calories) || 0)],
        { labels: ['Active', 'Resting'], colors: ['#fb923c', '#fbbf24'] });
  }

  // ---- Chat ----
  function loadChat() {
    if (!chatLoaded) {
      addMessage('assistant', 'Hi! I\'m your health coach. Ask me anything about your health data, fitness, sleep, or nutrition.');
      chatLoaded = true;
    }
    $('chat-input')?.focus();
  }

  function addMessage(role, text) {
    const c = $('chat-messages');
    if (!c) return;
    const b = document.createElement('div');
    b.className = `chat-bubble chat-bubble--${role === 'user' ? 'user' : 'ai'}`;
    b.textContent = text;
    c.appendChild(b);
    c.scrollTop = c.scrollHeight;
  }

  function showTyping() {
    const c = $('chat-messages');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'chat-bubble chat-bubble--ai typing-indicator';
    t.id = 'typing-indicator';
    t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    c.appendChild(t);
    c.scrollTop = c.scrollHeight;
  }

  async function sendMessage(text) {
    if (!text?.trim()) return;
    text = text.trim();
    addMessage('user', text);
    chatHistory.push({ role: 'user', content: text });

    const input = $('chat-input'), btn = $('chat-send');
    if (input) input.value = '';
    if (btn) btn.disabled = true;
    showTyping();

    try {
      const res = await Data.aiChat(text, chatHistory.slice(-20));
      $('typing-indicator')?.remove();
      const reply = res.response || res.message || 'Sorry, no response received.';
      addMessage('assistant', reply);
      chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      $('typing-indicator')?.remove();
      addMessage('assistant', 'Error: ' + (e.message || 'Could not reach AI. Check Settings.'));
    }
    if (btn) btn.disabled = false;
    input?.focus();
  }

  // ---- Settings ----
  async function loadSettings() {
    const url = $('input-api-url');
    if (url) url.value = Data.API_URL || '';

    const prov = $('select-ai-provider');
    if (prov) prov.value = localStorage.getItem('mylife_ai_provider') || 'gemini';

    const key = $('input-api-key');
    if (key) key.value = '';

    const sync = await Data.getLastSync();
    const sEl = $('settings-last-sync');
    if (sEl) sEl.textContent = sync ? `Last synced: ${fmtDate(sync)}` : 'Last synced: --';

    try {
      const p = await Data.getProfile();
      if (p.name)   $('input-name').value = p.name;
      if (p.age)    $('input-age').value = p.age;
      if (p.height) $('input-height').value = p.height;
    } catch {}

    const st = $('ai-test-status');
    if (st) { st.textContent = ''; st.style.color = ''; }
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-tab').forEach(tab =>
      tab.addEventListener('click', () => tab.dataset.page && navigate(tab.dataset.page)));

    // Plan regen
    document.querySelectorAll('[id^="btn-regen-"]').forEach(btn =>
      btn.addEventListener('click', () => regeneratePlan(btn.dataset.type || btn.id.replace('btn-regen-', ''))));

    // Trend range
    $('trend-range-selector')?.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn?.dataset.range) return;
      $('trend-range-selector').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      loadTrends();
    });

    // Chat
    $('chat-send')?.addEventListener('click', () => sendMessage($('chat-input')?.value));
    $('chat-input')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendMessage(e.target.value); }
    });
    document.querySelectorAll('.btn--quick').forEach(btn =>
      btn.addEventListener('click', () => btn.dataset.question && sendMessage(btn.dataset.question)));

    // Settings: Save URL
    $('btn-save-url')?.addEventListener('click', () => {
      const v = $('input-api-url')?.value?.trim();
      if (v) { Data.API_URL = v; toast('API URL saved!'); }
      else toast('Please enter a valid URL');
    });

    // Settings: Test AI
    $('btn-test-ai')?.addEventListener('click', async () => {
      const s = $('ai-test-status'), btn = $('btn-test-ai');
      if (s) { s.textContent = 'Testing...'; s.style.color = ''; }
      btn.disabled = true;
      try {
        const r = await Data.aiTest();
        if (s) { s.textContent = 'OK - ' + (r.response || 'AI is working!'); s.style.color = '#34d399'; }
      } catch (e) {
        if (s) { s.textContent = 'Failed - ' + (e.message || 'Error'); s.style.color = '#f87171'; }
      }
      btn.disabled = false;
    });

    // Settings: Save AI config
    $('btn-save-ai')?.addEventListener('click', async () => {
      const prov = $('select-ai-provider')?.value;
      const key = $('input-api-key')?.value?.trim();
      if (prov) localStorage.setItem('mylife_ai_provider', prov);
      try { await Data.aiSetup(prov, key); toast('AI configuration saved!'); }
      catch (e) { toast('Failed to save: ' + (e.message || 'Unknown error')); }
    });

    // Settings: Save profile
    $('btn-save-profile')?.addEventListener('click', async () => {
      try {
        await Data.saveProfile({
          name: $('input-name')?.value || '', age: $('input-age')?.value || '',
          height: $('input-height')?.value || ''
        });
        toast('Profile saved!');
      } catch { toast('Failed to save profile'); }
    });

    // Settings: Force sync
    $('btn-force-sync')?.addEventListener('click', async () => {
      const btn = $('btn-force-sync');
      btn.disabled = true;
      toast('Syncing...');
      try {
        healthData = await Data.syncAll(30);
        toast('Sync complete!');
        loadSettings();
        if (currentPage === 'dashboard') loadDashboard();
      } catch (e) { toast('Sync failed: ' + (e.message || 'Unknown error')); }
      btn.disabled = false;
    });

    // Settings: Clear cache
    $('btn-clear-cache')?.addEventListener('click', async () => {
      try {
        for (const s of Object.keys(Data.SHEETS)) await Data.idbClear(s);
        toast('Cache cleared!');
      } catch { toast('Failed to clear cache'); }
    });

    // Collapsible sections
    document.querySelectorAll('.collapsible__header').forEach(h =>
      h.addEventListener('click', () => h.closest('.collapsible')?.classList.toggle('collapsible--open')));
  }

  // ---- Init ----
  async function init() {
    bindEvents();
    navigate('dashboard');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { navigate, toast, sendMessage };
})();
