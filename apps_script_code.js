/**
 * MyLife v2 — Google Apps Script Backend
 * ========================================
 * This file is NOT served in the PWA. It is reference code you copy into the
 * Google Apps Script editor (script.google.com).
 *
 * SETUP INSTRUCTIONS:
 *   1. Go to https://script.google.com and create a new project.
 *   2. Delete the default Code.gs contents and paste this entire file.
 *   3. Click Deploy > New deployment.
 *      - Type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   4. Authorize when prompted, then copy the deployment URL.
 *   5. In the MyLife PWA, go to Settings and paste the deployment URL.
 *   6. Get a free Gemini API key from https://ai.google.dev
 *   7. In the PWA Settings, choose "Gemini" as AI provider and enter the key.
 *      (Alternatively, use Claude or Pollinations — Pollinations needs no key.)
 *
 * SPREADSHEET:
 *   The script uses the active spreadsheet bound to the project, or the first
 *   spreadsheet it can find in your Drive. Sheets are auto-created if missing.
 */

// ---------------------------------------------------------------------------
// Sheet column definitions
// ---------------------------------------------------------------------------
var SHEET_COLUMNS = {
  steps:       ['date', 'steps', 'distance_km', 'flights_climbed', 'active_calories', 'resting_calories'],
  heart:       ['date', 'avg_hr', 'resting_hr', 'hrv', 'blood_oxygen'],
  sleep:       ['date', 'bedtime', 'wake_time', 'duration_hrs', 'quality'],
  weight:      ['date', 'weight_kg', 'body_fat', 'muscle_mass', 'bmi'],
  plans:       ['date', 'type', 'content', 'ai_model'],
  chat:        ['date', 'role', 'message'],
  ai_insights: ['date', 'score', 'summary', 'model'],
  profile:     ['key', 'value']
};

// ---------------------------------------------------------------------------
// Routing — GET and POST
// ---------------------------------------------------------------------------
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    var params = e.parameter || {};
    var action = params.action || '';

    // For POST with JSON body, merge into params
    if (e.postData && e.postData.type === 'application/json') {
      var body = JSON.parse(e.postData.contents);
      for (var k in body) {
        if (body.hasOwnProperty(k)) params[k] = body[k];
      }
      action = params.action || action;
    }

    var result;
    switch (action) {
      case 'read':
        result = readSheet(params.sheet, parseInt(params.days, 10) || 30);
        break;
      case 'write':
        result = writeRow(params.sheet, params.data || params);
        break;
      case 'ai_insights':
        result = getAIInsights(params.date || todayStr());
        break;
      case 'ai_plan':
        result = generatePlan(params.type || 'workout');
        break;
      case 'ai_chat':
        result = chat(params.message, params.history || []);
        break;
      case 'ai_setup':
        result = setupAI(params.provider, params.apiKey);
        break;
      case 'save_profile':
        result = saveProfile(params.data || params);
        break;
      case 'ping':
        result = { ok: true, ts: new Date().toISOString() };
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack });
  }
}

function jsonResponse(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ---------------------------------------------------------------------------
// Spreadsheet helpers
// ---------------------------------------------------------------------------
function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // Fallback: find or create a spreadsheet called "MyLife Data"
    var files = DriveApp.getFilesByName('MyLife Data');
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create('MyLife Data');
    }
  }
  return ss;
}

function getOrCreateSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var cols = SHEET_COLUMNS[name];
    if (cols) {
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
      sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    }
  }
  return sheet;
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// read / write
// ---------------------------------------------------------------------------
function readSheet(name, days) {
  if (!name || !SHEET_COLUMNS[name]) {
    return { error: 'Invalid sheet name: ' + name };
  }
  var sheet = getOrCreateSheet(name);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { rows: [] };

  var headers = data[0];
  var rows = [];
  var cutoff = null;

  if (days && days > 0) {
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
  }

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    // Filter by date if the sheet has a date column
    if (cutoff && row.date) {
      var rowDate = new Date(row.date);
      if (rowDate < cutoff) continue;
    }
    rows.push(row);
  }
  return { rows: rows };
}

function writeRow(name, data) {
  if (!name || !SHEET_COLUMNS[name]) {
    return { error: 'Invalid sheet name: ' + name };
  }
  var sheet = getOrCreateSheet(name);
  var cols = SHEET_COLUMNS[name];
  var rowArr = [];
  for (var i = 0; i < cols.length; i++) {
    var val = data[cols[i]];
    rowArr.push(val !== undefined && val !== null ? val : '');
  }
  // Auto-fill date if missing
  if (cols[0] === 'date' && !rowArr[0]) {
    rowArr[0] = todayStr();
  }
  sheet.appendRow(rowArr);
  return { success: true, row: rowArr };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function saveProfile(data) {
  var sheet = getOrCreateSheet('profile');
  // Clear existing data (keep header)
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'action' || k === 'sheet') continue; // skip routing params
    sheet.appendRow([k, data[k]]);
  }
  return { success: true };
}

function readProfile() {
  var sheet = getOrCreateSheet('profile');
  var data = sheet.getDataRange().getValues();
  var profile = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) profile[data[i][0]] = data[i][1];
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Health data context builder
// ---------------------------------------------------------------------------
function buildHealthContext(days) {
  days = days || 7;
  var parts = [];

  // Steps
  var stepsData = readSheet('steps', days).rows || [];
  if (stepsData.length > 0) {
    var stepVals = stepsData.map(function(r) { return r.steps || 0; });
    var avgSteps = Math.round(stepVals.reduce(function(a, b) { return a + b; }, 0) / stepVals.length);
    parts.push('Steps (last ' + stepsData.length + ' days): ' + stepVals.join(', ') + ' — avg ' + avgSteps);
  }

  // Heart
  var heartData = readSheet('heart', days).rows || [];
  if (heartData.length > 0) {
    var last = heartData[heartData.length - 1];
    var hrLine = 'Heart Rate: avg ' + (last.avg_hr || '?') + ' bpm, resting ' + (last.resting_hr || '?') + ' bpm';
    if (last.hrv) hrLine += ', HRV ' + last.hrv + 'ms';
    if (last.blood_oxygen) hrLine += ', SpO2 ' + last.blood_oxygen + '%';
    parts.push(hrLine);
  }

  // Sleep
  var sleepData = readSheet('sleep', days).rows || [];
  if (sleepData.length > 0) {
    var durations = sleepData.map(function(r) { return parseFloat(r.duration_hrs) || 0; });
    var avgSleep = (durations.reduce(function(a, b) { return a + b; }, 0) / durations.length).toFixed(1);
    var qualities = sleepData.map(function(r) { return parseInt(r.quality, 10) || 0; }).filter(function(q) { return q > 0; });
    var qRange = qualities.length > 0 ? Math.min.apply(null, qualities) + '-' + Math.max.apply(null, qualities) : 'N/A';
    parts.push('Sleep: avg ' + avgSleep + ' hrs, quality range ' + qRange);
  }

  // Weight
  var weightData = readSheet('weight', days).rows || [];
  if (weightData.length > 0) {
    var lastW = weightData[weightData.length - 1];
    var wLine = 'Weight: ' + (lastW.weight_kg || '?') + ' kg';
    if (lastW.body_fat) wLine += ', body fat ' + lastW.body_fat + '%';
    if (lastW.bmi) wLine += ', BMI ' + lastW.bmi;
    if (weightData.length >= 2) {
      var firstW = parseFloat(weightData[0].weight_kg) || 0;
      var lastWkg = parseFloat(lastW.weight_kg) || 0;
      if (firstW > 0 && lastWkg > 0) {
        var diff = (lastWkg - firstW).toFixed(1);
        wLine += ', trend ' + (diff > 0 ? '+' : '') + diff + ' kg over ' + weightData.length + ' days';
      }
    }
    parts.push(wLine);
  }

  if (parts.length === 0) {
    return 'No health data recorded yet.';
  }
  return 'Recent Health Data:\n' + parts.join('\n');
}

// ---------------------------------------------------------------------------
// AI provider setup
// ---------------------------------------------------------------------------
function setupAI(provider, apiKey) {
  var props = PropertiesService.getScriptProperties();
  if (provider) props.setProperty('ai_provider', provider);
  if (apiKey) props.setProperty('ai_api_key', apiKey);
  return { success: true, provider: provider || props.getProperty('ai_provider') || 'gemini' };
}

// ---------------------------------------------------------------------------
// AI call dispatcher
// ---------------------------------------------------------------------------
function callAI(prompt, systemPrompt) {
  var props = PropertiesService.getScriptProperties();
  var provider = props.getProperty('ai_provider') || 'gemini';
  var apiKey = props.getProperty('ai_api_key') || '';

  switch (provider) {
    case 'claude':
      return callClaude(prompt, systemPrompt, apiKey);
    case 'pollinations':
      return callPollinations(prompt, systemPrompt);
    default:
      return callGemini(prompt, systemPrompt, apiKey);
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
function callGemini(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error('Gemini API key not configured. Go to Settings in the app.');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  var body = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error('Gemini error: ' + (json.error.message || JSON.stringify(json.error)));
  if (!json.candidates || !json.candidates[0]) throw new Error('Gemini returned no candidates.');

  return json.candidates[0].content.parts[0].text;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
function callClaude(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error('Claude API key not configured. Go to Settings in the app.');

  var url = 'https://api.anthropic.com/v1/messages';
  var body = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error('Claude error: ' + (json.error.message || JSON.stringify(json.error)));
  if (!json.content || !json.content[0]) throw new Error('Claude returned no content.');

  return json.content[0].text;
}

// ---------------------------------------------------------------------------
// Pollinations (free, no API key needed)
// ---------------------------------------------------------------------------
function callPollinations(prompt, systemPrompt) {
  var url = 'https://text.pollinations.ai/';
  var messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ messages: messages, model: 'openai' }),
    muteHttpExceptions: true
  });

  return resp.getContentText();
}

// ---------------------------------------------------------------------------
// AI Insights
// ---------------------------------------------------------------------------
function getAIInsights(date) {
  var context = buildHealthContext(7);
  if (context === 'No health data recorded yet.') {
    return { score: 0, observations: ['No health data available yet.'], recommendations: ['Start logging your daily steps, sleep, and heart rate.'] };
  }

  var systemPrompt = 'You are a friendly health coach. Analyze the user\'s health data and respond with ONLY valid JSON (no markdown, no code fences). ' +
    'Format: {"score": <1-10>, "observations": ["...", "..."], "recommendations": ["...", "..."]}. ' +
    'Score 1-3 = needs attention, 4-6 = average, 7-9 = good, 10 = excellent. ' +
    'Give 2-4 observations and 2-4 actionable recommendations.';

  var prompt = 'Here is my health data for analysis:\n\n' + context + '\n\nDate: ' + date;

  try {
    var raw = callAI(prompt, systemPrompt);
    // Strip markdown fences if present
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    var result = JSON.parse(raw);

    // Store insight
    var props = PropertiesService.getScriptProperties();
    var model = props.getProperty('ai_provider') || 'gemini';
    writeRow('ai_insights', {
      date: date,
      score: result.score,
      summary: JSON.stringify(result.observations),
      model: model
    });

    return result;
  } catch (err) {
    return { score: 0, observations: ['AI analysis failed: ' + err.message], recommendations: ['Try again later or check your AI provider settings.'] };
  }
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------
function generatePlan(type) {
  var context = buildHealthContext(7);
  var profile = readProfile();
  var profileStr = '';
  var keys = Object.keys(profile);
  if (keys.length > 0) {
    profileStr = '\n\nUser profile:\n';
    for (var i = 0; i < keys.length; i++) {
      profileStr += '- ' + keys[i] + ': ' + profile[keys[i]] + '\n';
    }
  }

  var systemPrompts = {
    workout: 'You are a certified personal trainer. Create a detailed workout plan for today based on the user\'s health data. ' +
      'Include warm-up, main exercises (sets x reps), and cool-down. Adapt intensity to their fitness level. ' +
      'Respond with ONLY valid JSON: {"title": "...", "content": "..."} where content is the full plan as a readable string with newlines.',
    meal: 'You are a sports nutritionist. Create a full day meal plan (breakfast, snack, lunch, snack, dinner) based on the user\'s health data and goals. ' +
      'Include approximate calories and macros per meal. ' +
      'Respond with ONLY valid JSON: {"title": "...", "content": "..."} where content is the full plan as a readable string with newlines.',
    sleep: 'You are a sleep specialist. Create a personalized sleep optimization plan based on the user\'s recent sleep data. ' +
      'Include evening routine, sleep environment tips, and morning routine. ' +
      'Respond with ONLY valid JSON: {"title": "...", "content": "..."} where content is the full plan as a readable string with newlines.'
  };

  var sysPr = systemPrompts[type] || systemPrompts.workout;
  var prompt = context + profileStr + '\n\nGenerate a ' + type + ' plan for today (' + todayStr() + ').';

  try {
    var raw = callAI(prompt, sysPr);
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    var plan = JSON.parse(raw);

    var props = PropertiesService.getScriptProperties();
    var model = props.getProperty('ai_provider') || 'gemini';
    writeRow('plans', {
      date: todayStr(),
      type: type,
      content: plan.content,
      ai_model: model
    });

    return { plan: plan };
  } catch (err) {
    return { error: 'Plan generation failed: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
function chat(message, history) {
  if (!message) return { error: 'No message provided.' };

  var context = buildHealthContext(7);
  var systemPrompt = 'You are a knowledgeable and supportive health coach named MyLife AI. ' +
    'You have access to the user\'s health data below. Use it to give personalized advice. ' +
    'Be concise but helpful. If asked about something outside health/fitness/nutrition/sleep, ' +
    'politely redirect to health topics.\n\n' + context;

  // Build multi-turn prompt for providers that support it
  var props = PropertiesService.getScriptProperties();
  var provider = props.getProperty('ai_provider') || 'gemini';

  var aiResponse;
  try {
    if (provider === 'gemini') {
      aiResponse = callGeminiChat(message, history, systemPrompt, props.getProperty('ai_api_key'));
    } else if (provider === 'claude') {
      aiResponse = callClaudeChat(message, history, systemPrompt, props.getProperty('ai_api_key'));
    } else {
      // Pollinations: flatten history into single prompt
      var flatHistory = '';
      if (history && history.length > 0) {
        for (var i = 0; i < history.length; i++) {
          flatHistory += (history[i].role === 'user' ? 'User' : 'Assistant') + ': ' + history[i].message + '\n';
        }
      }
      aiResponse = callPollinations(flatHistory + 'User: ' + message, systemPrompt);
    }
  } catch (err) {
    aiResponse = 'Sorry, I encountered an error: ' + err.message;
  }

  // Store both user message and response
  writeRow('chat', { date: todayStr(), role: 'user', message: message });
  writeRow('chat', { date: todayStr(), role: 'assistant', message: aiResponse });

  return { response: aiResponse };
}

// ---------------------------------------------------------------------------
// Gemini multi-turn chat
// ---------------------------------------------------------------------------
function callGeminiChat(message, history, systemPrompt, apiKey) {
  if (!apiKey) throw new Error('Gemini API key not configured.');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  var contents = [];

  // Add conversation history
  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      var role = history[i].role === 'user' ? 'user' : 'model';
      contents.push({ role: role, parts: [{ text: history[i].message }] });
    }
  }

  // Add current message
  contents.push({ role: 'user', parts: [{ text: message }] });

  var body = { contents: contents };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error('Gemini: ' + (json.error.message || JSON.stringify(json.error)));
  return json.candidates[0].content.parts[0].text;
}

// ---------------------------------------------------------------------------
// Claude multi-turn chat
// ---------------------------------------------------------------------------
function callClaudeChat(message, history, systemPrompt, apiKey) {
  if (!apiKey) throw new Error('Claude API key not configured.');

  var url = 'https://api.anthropic.com/v1/messages';
  var messages = [];

  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      messages.push({
        role: history[i].role === 'user' ? 'user' : 'assistant',
        content: history[i].message
      });
    }
  }
  messages.push({ role: 'user', content: message });

  var body = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error('Claude: ' + (json.error.message || JSON.stringify(json.error)));
  return json.content[0].text;
}
