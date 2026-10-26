<<<<<<< HEAD
# Smart-Incubator
Embedded Project, smart monitoring incubator.
=======
# Smart Egg Incubator Dashboard

Single-page desktop dashboard: Arduino (USB serial) → Node.js → Socket.io → HTML/CSS/JS.

## Run
```bash
cd backend
npm install
npm start
```
Open http://localhost:3000

- **No Arduino connected:** the backend runs in **Simulation Mode** (shown in the header and labelled "Simulated" on each reading). It checks for an Arduino every 5 seconds and switches over automatically.
- **Arduino connected:** the port is auto-detected. To force one:
  - Windows: `set SERIAL_PORT=COM3 && npm start`
  - macOS/Linux: `SERIAL_PORT=/dev/ttyUSB0 npm start`
- Close the Arduino IDE Serial Monitor or XOD upload first; only one program can hold the port.

## Serial protocol (9600 baud, newline-terminated)
- Arduino → backend, every ~2 s and right after each command:
  `{"temperature":37.5,"humidity":55,"light":true}`
- Backend → Arduino: `LIGHT_ON` or `LIGHT_OFF`

The dashboard shows the light as "pending" until the Arduino reports its state, and shows an error if no report arrives within 3 seconds.

## Arduino firmware
Your current XOD program likely does not read USB commands, so it needs changes. Minimal sketch (DHT22 on pin 2, relay on pin 7; set `ACTIVE_LOW` to match your relay board):
```cpp
#include <DHT.h>
#define RELAY 7
#define ACTIVE_LOW true
DHT dht(2, DHT22);          // use DHT11 if that is your sensor
bool light = false;
unsigned long last = 0;

void apply() { digitalWrite(RELAY, (light != ACTIVE_LOW) ? HIGH : LOW); }
void report() {
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (isnan(t) || isnan(h)) return;
  Serial.print("{\"temperature\":"); Serial.print(t, 1);
  Serial.print(",\"humidity\":"); Serial.print((int)h);
  Serial.print(",\"light\":"); Serial.print(light ? "true" : "false");
  Serial.println("}");
}
void setup() { Serial.begin(9600); pinMode(RELAY, OUTPUT); apply(); dht.begin(); }
void loop() {
  if (Serial.available()) {
    String c = Serial.readStringUntil('\n'); c.trim();
    if (c == "LIGHT_ON") light = true;
    else if (c == "LIGHT_OFF") light = false;
    else return;
    apply(); report();
  }
  if (millis() - last >= 2000) { last = millis(); report(); }
}
```

## Notes
- Incubation start date and duration are saved in the browser's localStorage.
- Temperature: Low < 36.5°C, Normal 36.5-38.5°C, High > 38.5°C, Critical > 40°C.
- Desktop layout only (no responsive styles yet).

## Structure
```
backend/  server.js (Express + Socket.io), serial.js (SerialPort + simulation)
frontend/ index.html, style.css, script.js
```
>>>>>>> 7b75ba5 (initial commit)
