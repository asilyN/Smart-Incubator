// serial.js - talks to the Arduino over USB serial, or simulates it.
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const BAUD = 9600;
const RETRY_MS = 5000;     // how often to look for the Arduino again
const SIM_MS = 2000;       // simulated reading interval
const CONFIRM_MS = 3000;   // max wait for the Arduino to confirm a light command

function start({ onStatus, onReading, onLightError }) {
  let port = null;
  let mode = 'simulation';             // 'arduino' | 'simulation'
  let simTimer = null;
  let pendingTimer = null;
  let last = { temperature: 37.5, humidity: 55, light: false };

  const setMode = (m, detail = '') => { mode = m; onStatus({ mode: m, detail }); };
  const emit = (data, source) => onReading({ ...data, source, ts: Date.now() });

  // ---- Simulation: random walk around realistic incubator values ----
  function startSim() {
    if (simTimer) return;
    setMode('simulation', 'No Arduino found. Showing simulated data.');
    simTimer = setInterval(() => {
      const target = last.light ? 38.2 : 36.8;           // the bulb warms the box
      last.temperature += (target - last.temperature) * 0.15 + (Math.random() - 0.5) * 0.2;
      last.humidity = Math.min(70, Math.max(40, last.humidity + (Math.random() - 0.5) * 2));
      emit({ temperature: +last.temperature.toFixed(1), humidity: Math.round(last.humidity), light: last.light }, 'simulation');
    }, SIM_MS);
  }
  const stopSim = () => { clearInterval(simTimer); simTimer = null; };

  // ---- Arduino connection ----
  async function findPath() {
    if (process.env.SERIAL_PORT) return process.env.SERIAL_PORT;   // e.g. COM3 or /dev/ttyUSB0
    const ports = await SerialPort.list();
    const hit = ports.find(p => /arduino|wch|ch340|ftdi|usb serial/i.test(`${p.manufacturer} ${p.friendlyName}`));
    return hit && hit.path;
  }

  async function connect() {
    if (port) return;
    let path;
    try { path = await findPath(); } catch (e) { path = null; }
    if (!path) { startSim(); return setTimeout(connect, RETRY_MS); }

    const p = new SerialPort({ path, baudRate: BAUD }, err => {
      if (err) { startSim(); setTimeout(connect, RETRY_MS); }
    });
    const parser = p.pipe(new ReadlineParser({ delimiter: '\n' }));

    p.on('open', () => { port = p; stopSim(); setMode('arduino', `Connected on ${path}`); });
    parser.on('data', line => {
      try {
        const d = JSON.parse(line.trim());   // {"temperature":37.5,"humidity":55,"light":true}
        last = { temperature: d.temperature, humidity: d.humidity, light: !!d.light };
        clearTimeout(pendingTimer);          // any report confirms the light state
        emit(last, 'arduino');
      } catch (e) { console.warn('Ignored bad serial line:', line); }
    });
    let handled = false;
    const lost = () => {
      if (handled) return; handled = true;
      port = null; startSim(); setTimeout(connect, RETRY_MS);
    };
    p.on('close', lost);
    p.on('error', err => { console.error('Serial error:', err.message); lost(); });
  }

  // ---- Light command from the dashboard ----
  function setLight(on) {
    if (mode === 'simulation') {
      setTimeout(() => { last.light = on; emit(last, 'simulation'); }, 600);
      return;
    }
    port.write(on ? 'LIGHT_ON\n' : 'LIGHT_OFF\n', err => {
      if (err) onLightError('Could not send the command to the Arduino.');
    });
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => onLightError('The Arduino did not confirm the change.'), CONFIRM_MS);
  }

  connect();
  return { setLight };
}

module.exports = { start };
