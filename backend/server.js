// server.js - serves the frontend and relays data between Arduino and browser.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const serial = require('./serial');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Remember the latest state so a new browser tab gets data immediately
let lastStatus = { mode: 'simulation', detail: 'Starting...' };
let lastReading = null;

const link = serial.start({
  onStatus:     s => { lastStatus = s; io.emit('status', s); },
  onReading:    r => { lastReading = r; io.emit('reading', r); },
  onLightError: msg => io.emit('light:error', msg)
});

io.on('connection', socket => {
  socket.emit('status', lastStatus);
  if (lastReading) socket.emit('reading', lastReading);
  // The dashboard asks for a light change; the confirmed state returns via 'reading'
  socket.on('light:set', on => link.setLight(!!on));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
