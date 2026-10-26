// script.js - dashboard logic. Vanilla JS + Socket.io client.
const $ = id => document.getElementById(id);
const socket = io();

let mode = 'off';          // 'arduino' | 'simulation' | 'off'
let lightOn = null;        // confirmed state (null = unknown)
let pending = false;       // waiting for Arduino confirmation
let lastReadingAt = 0;
const fmtTime = t => new Date(t).toLocaleTimeString();
const fmtDate = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/* ---------- Clock ---------- */
setInterval(() => { $('clock').textContent = new Date().toLocaleString(); }, 1000);

/* ---------- Connection ---------- */
socket.on('connect_error', () => setMode('off'));
socket.on('disconnect', () => setMode('off'));
socket.on('status', s => setMode(s.mode));

function setMode(m) {
  mode = m;
  const label = { arduino: 'Connected', simulation: 'Simulation Mode', off: 'Disconnected' }[m];
  $('connPill').className = 'pill ' + m;
  $('connText').textContent = label;
  $('stConn').textContent = label;
  $('stConn').className = m === 'arduino' ? 'good' : m === 'simulation' ? 'warn' : 'bad';
  if (m === 'off') { lightOn = null; pending = false; }
  renderLight();
}

/* ---------- Live readings ---------- */
socket.on('reading', r => {
  lastReadingAt = r.ts;
  const src = r.source === 'arduino' ? 'Arduino' : 'Simulated';
  renderTemp(r.temperature);
  renderHumidity(r.humidity);
  ['temp', 'hum'].forEach(k => { $(k + 'Src').textContent = src; $(k + 'Time').textContent = fmtTime(r.ts); });
  $('stTime').textContent = fmtTime(r.ts);
  // A report from the Arduino is the confirmed light state
  if (pending) { $('lightMsg').className = 'msg'; $('lightMsg').textContent = `Light turned ${r.light ? 'ON' : 'OFF'}.`; }
  pending = false;
  lightOn = r.light;
  renderLight();
});

// Mark the sensor unavailable when data stops arriving
setInterval(() => {
  const ok = lastReadingAt && Date.now() - lastReadingAt < 7000;
  $('stSensor').textContent = ok ? 'Active' : 'Unavailable';
  $('stSensor').className = ok ? 'good' : 'bad';
}, 1000);

function renderTemp(t) {
  $('tempVal').textContent = t.toFixed(1);
  const [txt, cls] = t > 40 ? ['Critical', 'critical'] : t > 38.5 ? ['High', 'high'] : t < 36.5 ? ['Low', 'low'] : ['Normal', 'normal'];
  $('tempBadge').textContent = txt; $('tempBadge').className = 'badge ' + cls;
  $('tempAlert').hidden = t <= 40;
  $('tempMarker').style.left = `calc(${Math.min(1, Math.max(0, (t - 30) / 12)) * 100}% - 3px)`;
}

function renderHumidity(h) {
  $('humVal').textContent = Math.round(h);
  const [txt, cls] = h < 50 ? ['Low', 'low'] : h > 60 ? ['High', 'high'] : ['Ideal', 'normal'];
  $('humBadge').textContent = txt; $('humBadge').className = 'badge ' + cls;
  $('humMarker').style.left = `calc(${Math.min(100, Math.max(0, h))}% - 3px)`;
}

/* ---------- Heating light ---------- */
$('lightBtn').addEventListener('click', () => {
  pending = true;
  $('lightMsg').className = 'msg';
  $('lightMsg').textContent = 'Waiting for the incubator to confirm...';
  renderLight();
  socket.emit('light:set', !lightOn);   // backend forwards LIGHT_ON / LIGHT_OFF
});

socket.on('light:error', msg => {        // never pretend the light changed
  pending = false;
  $('lightMsg').className = 'msg error';
  $('lightMsg').textContent = msg + ' The light state is unchanged.';
  renderLight();
});

function renderLight() {
  $('bulb').classList.toggle('on', lightOn === true);
  $('lightState').textContent = lightOn === null ? 'Unknown' : lightOn ? 'ON' : 'OFF';
  $('stLight').textContent = $('lightState').textContent;
  const btn = $('lightBtn');
  btn.textContent = pending ? 'Waiting...' : lightOn ? 'Turn Light OFF' : 'Turn Light ON';
  btn.classList.toggle('pending', pending);
  btn.disabled = pending || mode === 'off' || lightOn === null;
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
    $('dayVal').textContent = 'Day -'; $('progBar').style.width = '0';
    $('startTxt').textContent = 'Not started'; $('hatchTxt').textContent = '-'; $('leftTxt').textContent = '-';
    $('stInc').textContent = 'Not started'; $('stInc').className = 'warn';
    return;
  }
  const start = midnight(new Date(startStr + 'T00:00:00'));
  const day = Math.floor((midnight(new Date()) - start) / DAY) + 1;   // start date = Day 1
  const done = day > dur, notYet = day < 1;
  $('dayVal').textContent = notYet ? 'Starts soon' : done ? 'Hatch day!' : `Day ${day}`;
  $('progBar').style.width = Math.min(100, Math.max(0, (day - 1) / dur * 100)) + '%';
  $('startTxt').textContent = fmtDate(start);
  $('hatchTxt').textContent = fmtDate(new Date(start.getTime() + dur * DAY));
  $('leftTxt').textContent = Math.max(0, dur - day + 1) + ' days';
  $('stInc').textContent = done ? 'Completed' : notYet ? 'Not started' : 'In progress';
  $('stInc').className = done ? 'good' : notYet ? 'warn' : '';
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
$('startInput').valueAsDate = new Date();
renderTracker();
setInterval(renderTracker, 60000);   // rolls over at midnight
setMode('off');
