// script.js - dashboard logic (vanilla JS + Socket.io client).
// Socket events are unchanged: status, reading, light:set, light:error.
const $ = id => document.getElementById(id);
const socket = io();

/* ===== Settings you can edit ===== */
const CONFIG = {
  TEMP_TARGET: 37.5, TEMP_MIN: 36.5, TEMP_MAX: 38.5, TEMP_CRITICAL: 40, TEMP_RANGE: [30, 42],
  HUM_MIN: 50, HUM_MAX: 60, HUM_RANGE: [20, 90],
  HISTORY_MINUTES: 30,
  // Relay polarity. true = when the Arduino reports light:true the bulb is physically OFF
  // (matches your current working setup). Fix polarity in ONE place only: this flag OR the
  // sketch's RELAY_ACTIVE_LOW. If you flash the sketch with RELAY_ACTIVE_LOW = true, set this to false.
  ARDUINO_LIGHT_INVERTED: true
};

let mode = 'off';          // 'arduino' | 'simulation' | 'off'
let source = null;         // source of the latest reading
let lightOn = null;        // light state exactly as reported by the backend (null = unknown)
let pending = false, pendingFrom = null, pendingTimer = null;
let lastReadingAt = 0;
const hist = [];           // {ts, v} temperature readings received in this session

const fmtTime = t => new Date(t).toLocaleTimeString();
const fmtDate = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const pct = (v, [a, b]) => Math.min(100, Math.max(0, (v - a) / (b - a) * 100));
// What the operator should see (physical state)
const shownOn = () => lightOn === null ? null : (CONFIG.ARDUINO_LIGHT_INVERTED && source === 'arduino') ? !lightOn : lightOn;

function setBadge(el, text, cls) { el.textContent = text; el.className = 'badge ' + cls; }
function setSt(id, text, cls) { const el = $(id); el.textContent = text; el.closest('li').dataset.s = cls; }

/* ---------- Clock + sensor freshness (one 1-second timer) ---------- */
function tick() {
  $('clock').textContent = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
  const fresh = lastReadingAt && Date.now() - lastReadingAt < 7000;
  const s = fresh ? (source === 'simulation' ? ['Simulated', 'warn'] : ['Active', 'good']) : ['Unavailable', 'off'];
  setSt('stSensor', ...s); setSt('stHum', ...s);
}
tick(); setInterval(tick, 1000);

/* ---------- Connection ---------- */
socket.on('connect_error', () => setMode('off'));
socket.on('disconnect', () => setMode('off'));
socket.on('status', s => setMode(s.mode));

function setMode(m) {
  mode = m;
  const label = { arduino: 'Connected', simulation: 'Simulation Mode', off: 'Disconnected' }[m];
  const cls = { arduino: 'good', simulation: 'warn', off: 'off' }[m];
  $('connPill').className = 'pill ' + cls;
  $('connText').textContent = label;
  setSt('stConn', label, cls);
  if (m === 'off') { lightOn = null; pending = false; clearTimeout(pendingTimer); }
  renderLight();
}

/* ---------- Live readings ---------- */
socket.on('reading', r => {
  if (r.source !== source) { hist.length = 0; source = r.source; }   // never mix simulated and real history
  lastReadingAt = r.ts;
  const src = r.source === 'arduino' ? 'Arduino' : 'Simulated';
  renderTemp(r.temperature);
  renderHumidity(r.humidity);
  ['temp', 'hum'].forEach(k => { $(k + 'Src').textContent = src; $(k + 'Time').textContent = fmtTime(r.ts); });
  setSt('stTime', fmtTime(r.ts), 'good');

  hist.push({ ts: r.ts, v: r.temperature });
  const cutoff = r.ts - CONFIG.HISTORY_MINUTES * 60000;
  while (hist.length && hist[0].ts < cutoff) hist.shift();
  $('chartSrc').textContent = src;
  drawChart();

  lightOn = r.light;
  // A report that differs from the state at click time is the confirmation
  if (pending && r.light !== pendingFrom) {
    pending = false; clearTimeout(pendingTimer);
    $('lightMsg').className = 'msg';
    $('lightMsg').textContent = `Light turned ${shownOn() ? 'ON' : 'OFF'}.`;
  }
  renderLight();
});

function renderTemp(t) {
  const C = CONFIG;
  $('tempVal').textContent = t.toFixed(1);
  const [txt, cls] = t > C.TEMP_CRITICAL ? ['Critical', 'bad'] : t > C.TEMP_MAX ? ['Above Target', 'warn']
                   : t < C.TEMP_MIN ? ['Below Target', 'warn'] : ['Normal', 'good'];
  setBadge($('tempBadge'), txt, cls);
  $('tempAlert').hidden = t <= C.TEMP_CRITICAL;
  $('tempMarker').style.left = `calc(${pct(t, C.TEMP_RANGE)}% - 3px)`;
}

function renderHumidity(h) {
  const C = CONFIG;
  $('humVal').textContent = Math.round(h);
  const [txt, cls] = h > C.HUM_MAX ? ['Above Target', 'warn'] : h < C.HUM_MIN ? ['Below Target', 'warn'] : ['Normal', 'good'];
  setBadge($('humBadge'), txt, cls);
  $('humMarker').style.left = `calc(${pct(h, C.HUM_RANGE)}% - 3px)`;
}

/* ---------- Temperature history chart (plain SVG, no library) ---------- */
function drawChart() {
  const W = 640, H = 220, L = 40, R = 12, T = 12, B = 28;
  const now = Date.now(), span = CONFIG.HISTORY_MINUTES * 60000, t0 = now - span;
  const vals = hist.map(p => p.v);
  const lo = Math.floor(Math.min(CONFIG.TEMP_TARGET - 2, ...vals));
  const hi = Math.ceil(Math.max(CONFIG.TEMP_TARGET + 2, ...vals));
  const x = ts => L + (ts - t0) / span * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let s = '';
  for (let i = 0; i <= 4; i++) {                       // horizontal grid + temperature labels
    const v = lo + (hi - lo) * i / 4;
    s += `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}°</text>`;
  }
  for (let i = 0; i <= 5; i++) {                       // time labels
    const ts = t0 + span * i / 5;
    s += `<text class="tx" x="${x(ts)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`;
  }
  s += `<line class="tg" x1="${L}" x2="${W - R}" y1="${y(CONFIG.TEMP_TARGET)}" y2="${y(CONFIG.TEMP_TARGET)}"/>`;
  s += `<text class="tx" x="${W - R}" y="${y(CONFIG.TEMP_TARGET) - 5}" text-anchor="end">Target ${CONFIG.TEMP_TARGET}°</text>`;
  if (hist.length) {
    s += `<polyline class="ln" points="${hist.map(p => `${x(p.ts).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`;
    const last = hist[hist.length - 1];
    s += `<circle class="pt" cx="${x(last.ts)}" cy="${y(last.v)}" r="4"/>`;
  }
  $('chart').innerHTML = s;
}

/* ---------- Heating light ---------- */
$('lightBtn').addEventListener('click', () => {
  pending = true; pendingFrom = lightOn;
  $('lightMsg').className = 'msg';
  $('lightMsg').textContent = 'Waiting for the incubator to confirm...';
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { if (pending) showLightError('No confirmation received.'); }, 4000);
  renderLight();
  socket.emit('light:set', !lightOn);   // backend forwards LIGHT_ON / LIGHT_OFF
});

socket.on('light:error', showLightError);
function showLightError(msg) {          // never pretend the light changed
  pending = false; clearTimeout(pendingTimer);
  $('lightMsg').className = 'msg error';
  $('lightMsg').textContent = msg + ' The light state is unchanged.';
  renderLight();
}

function renderLight() {
  const on = shownOn();
  const label = on === null ? 'Unknown' : on ? 'ON' : 'OFF';
  $('bulbWrap').className = 'bulb ' + (on === null ? 'unk' : on ? 'on' : 'off');
  $('lightState').textContent = label;
  setSt('stLight', label, on ? 'good' : 'off');
  const btn = $('lightBtn');
  btn.textContent = pending ? 'Waiting for confirmation...' : on ? 'Turn Light OFF' : 'Turn Light ON';
  btn.classList.toggle('pending', pending);
  btn.disabled = pending || mode === 'off' || on === null;
}

/* ---------- Incubation tracker (saved in localStorage) ---------- */
const KEY_START = 'incubator.startDate', KEY_DUR = 'incubator.duration';
const DAY = 86400000;
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function renderTracker() {
  const startStr = localStorage.getItem(KEY_START);
  const dur = parseInt(localStorage.getItem(KEY_DUR)) || 21;
  $('durInput').value = dur;
  if (!startStr) {
    $('dayVal').textContent = 'Not started'; $('dayOf').textContent = ''; $('progPct').textContent = '';
    $('progBar').style.width = '0';
    $('startTxt').textContent = 'Not started'; $('hatchTxt').textContent = '-'; $('leftTxt').textContent = '-';
    setBadge($('stInc'), 'Not started', 'off');
    return;
  }
  const start = midnight(new Date(startStr + 'T00:00:00'));
  const day = Math.floor((midnight(new Date()) - start) / DAY) + 1;   // start date = Day 1
  const done = day > dur, notYet = day < 1;
  const progress = Math.min(100, Math.max(0, (day - 1) / dur * 100));
  $('dayVal').textContent = notYet ? 'Starts soon' : done ? 'Hatch day' : `Day ${day}`;
  $('dayOf').textContent = notYet || done ? '' : `of ${dur}`;
  $('progPct').textContent = Math.round(progress) + '% complete';
  $('progBar').style.width = progress + '%';
  $('startTxt').textContent = fmtDate(start);
  $('hatchTxt').textContent = fmtDate(new Date(start.getTime() + dur * DAY));
  $('leftTxt').textContent = Math.max(0, dur - day + 1) + ' days';
  setBadge($('stInc'), done ? 'Completed' : notYet ? 'Not started' : 'In progress', done ? 'good' : notYet ? 'off' : 'warn');
}

$('setStart').addEventListener('click', () => {
  if (!$('startInput').value) return alert('Pick a start date first.');
  localStorage.setItem(KEY_START, $('startInput').value);
  renderTracker();
});
$('durInput').addEventListener('change', () => {
  const v = Math.min(60, Math.max(1, parseInt($('durInput').value) || 21));
  localStorage.setItem(KEY_DUR, v); renderTracker();
});
$('newCycle').addEventListener('click', () => {
  if (!confirm('Start a new cycle? This clears the current start date.')) return;
  localStorage.removeItem(KEY_START); renderTracker();
});

/* ---------- Startup ---------- */
(function initGauges() {
  const C = CONFIG;
  $('tempGauge').style.setProperty('--lo', pct(C.TEMP_MIN, C.TEMP_RANGE) + '%');
  $('tempGauge').style.setProperty('--hi', pct(C.TEMP_MAX, C.TEMP_RANGE) + '%');
  $('humGauge').style.setProperty('--lo', pct(C.HUM_MIN, C.HUM_RANGE) + '%');
  $('humGauge').style.setProperty('--hi', pct(C.HUM_MAX, C.HUM_RANGE) + '%');
  $('tLo').textContent = C.TEMP_RANGE[0] + '°'; $('tHi').textContent = C.TEMP_RANGE[1] + '°';
  $('hLo').textContent = C.HUM_RANGE[0] + '%'; $('hHi').textContent = C.HUM_RANGE[1] + '%';
  $('tempTarget').textContent = `Target ${C.TEMP_TARGET}°C (normal ${C.TEMP_MIN}-${C.TEMP_MAX}°C)`;
  $('humTarget').textContent = `Ideal ${C.HUM_MIN}-${C.HUM_MAX}% RH`;
})();
$('startInput').valueAsDate = new Date();
renderTracker();
setInterval(renderTracker, 60000);   // rolls over at midnight
drawChart();
setMode('off');