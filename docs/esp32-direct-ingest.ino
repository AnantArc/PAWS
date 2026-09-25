/* ============================================================
 * PAWS — ESP32 DIRECT INGEST (Supabase, URL + anon key only)
 * SIH 2026 · PS 26223
 *
 * What you need from Supabase (Project Settings → API):
 *   SUPABASE_URL   e.g. https://ryawnxdglc.tvkxhhyc.supabase.co
 *   SUPABASE_ANON  the anon public key  (safe on hardware)
 *
 * Device token: 'paws-device-token' by default (see the
 * public.device_tokens table — one UPDATE changes it).
 *
 * POSTs every SECONDS to:
 *   {URL}/rest/v1/rpc/device_ingest
 * Body: {"payload": {"deviceToken":"...", "telemetry":{...}}}
 *
 * The console's catch-up processor turns each stored row into
 * scores, detections, trail points and feed events — the ESP32
 * only ever sends raw sensor data. No service key on the device.
 * ============================================================ */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ---- network ------------------------------------------------------
const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";

// ---- Supabase -----------------------------------------------------
const char* SUPABASE_URL  = "https://ryawnxdglc.tvkxhhyc.supabase.co";
const char* SUPABASE_ANON = "YOUR_SUPABASE_ANON_KEY";
const char* DEVICE_TOKEN  = "paws-device-token";   // matches device_tokens table
const char* DEVICE_ID     = "paws-01";

// ---- sensors (replace with your real reads) ------------------------
float readGasPpm()   { return 120.0 + random(0, 40); }             // MQ-2 calibration
float readObjTempC() { return 25.5 + random(-5, 5) / 10.0; }       // MLX90614
float readAmp()      { return 0.05 + random(0, 30) / 1000.0; }     // mic amplitude 0..1
float readPitchDeg() { return 0.0; }                                // MPU-6050
float readRollDeg()  { return 0.0; }
float posX = 0.0, posY = 0.0, heading = 0.0, drift = 0.2;           // IMU + odometry

unsigned long lastSent = 0;
const unsigned long INTERVAL_MS = 1000;
uint32_t seq = 0;
uint32_t frameId = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nWiFi connected");
}

void loop() {
  if (millis() - lastSent < INTERVAL_MS) return;
  lastSent = millis();
  seq++; frameId++;
  posX += 0.42; posY += 0.05;               // walk demo (replace with odometry)
  heading = (heading + 2.0) > 360 ? 0 : heading + 2.0;
  drift = min(1.4, drift + 0.01);
  sendTelemetry();
}

void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  DynamicJsonDocument doc(2048);            // wrap: {payload:{deviceToken,telemetry}}
  JsonObject payload = doc.createNestedObject("payload");
  payload["deviceToken"] = DEVICE_TOKEN;

  JsonObject t = payload.createNestedObject("telemetry");
  t["deviceId"] = DEVICE_ID;
  t["ts"]       = (long long)esp_timer_get_time() / 1000LL;   // ms epoch (NTP-sync for wall time)
  t["seq"]      = seq;

  JsonObject sound = t.createNestedObject("sound");
  sound["amp"]      = readAmp();
  sound["baseline"] = 0.07;
  sound["peak"]     = 0.12;
  sound["heardAt"]  = (long long)esp_timer_get_time() / 1000LL;

  JsonObject gas = t.createNestedObject("gas");
  gas["ppm"]     = readGasPpm();
  gas["adc"]     = 1300;
  gas["heardAt"] = (long long)esp_timer_get_time() / 1000LL;

  JsonObject thermal = t.createNestedObject("thermal");
  thermal["objectC"]  = readObjTempC();
  thermal["ambientC"] = 25.4;
  thermal["heardAt"]  = (long long)esp_timer_get_time() / 1000LL;

  JsonObject distance = t.createNestedObject("distance");
  distance["mm"]     = 420;
  distance["status"] = "valid";
  distance["source"] = "vl53l0x";
  distance["heardAt"] = (long long)esp_timer_get_time() / 1000LL;

  JsonObject tilt = t.createNestedObject("tilt");
  tilt["pitchDeg"] = readPitchDeg();
  tilt["rollDeg"]  = readRollDeg();
  tilt["heardAt"]  = (long long)esp_timer_get_time() / 1000LL;

  JsonObject pos = t.createNestedObject("position");
  pos["xM"]        = posX;
  pos["yM"]        = posY;
  pos["headingDeg"] = heading;
  pos["driftM"]     = drift;
  pos["mode"]       = "estimated_imu_odometry";
  JsonObject origin = pos.createNestedObject("origin");
  origin["xM"]    = 0;
  origin["yM"]    = 0;
  origin["setAt"] = (long long)esp_timer_get_time() / 1000LL;
  pos["heardAt"]  = (long long)esp_timer_get_time() / 1000LL;

  JsonObject cam = t.createNestedObject("camera");
  cam["frameId"]   = frameId;
  cam["ts"]        = (long long)esp_timer_get_time() / 1000LL;
  cam["hasFrame"]  = true;
  cam["width"]     = 640;
  cam["height"]    = 480;
  cam["jpegBytes"] = 30000;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(String(SUPABASE_URL) + "/rest/v1/rpc/device_ingest");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON);
  http.addHeader("Prefer", "return=minimal");

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("POST #%u → %d  %s\n", seq, code, resp.c_str());
}

/* --------------------------------------------------------------------
 * NOTES
 *  - Any sensor can be omitted from the JSON — the console shows an
 *    honest "NOT INSTALLED" state for it.
 *  - Invalid payloads are still stored (raw audit row) but skipped by
 *    the scoring pipeline — nothing breaks.
 *  - The console picks the row up on its next 2 s poll, so expect the
 *    panels to move ~1–2 s behind the robot. A Realtime channel upgrade
 *    (schema hooks events/trail/telemetry) removes even that.
 *  - Commands (E-STOP etc.) stay with the console/operator session —
 *    the device is a write-only reporter by design.
 * ------------------------------------------------------------------*/
