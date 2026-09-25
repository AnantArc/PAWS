#!/usr/bin/env node
/**
 * SEED INGEST — Supabase-mode live demo without the robot.
 * ------------------------------------------------------------------
 * Post-disaster Autonomous Walking Scout · SIH 2026 · PS 26223
 *
 * Walks a simulated PAWS around a loop and POSTs the EXACT telemetry
 * payload the ESP32 firmware will send (same contract, validated by
 * /api/ingest). Useful to verify a Supabase-mode deployment end-to-end:
 *
 *   node scripts/seed-ingest.js                 # http://localhost:3000
 *   node scripts/seed-ingest.js --url https://console.example.com --token my-token
 *
 * Options:
 *   --url <base>      console base URL         (default http://localhost:3000)
 *   --token <tok>     x-device-token header    (default paws-device-token)
 *   --tick <ms>       payload cadence          (default 1000)
 *   --seconds <n>     stop after n seconds     (default 0 = run forever)
 *
 * Type-checked against the same Zod schema the server uses — if this
 * script can't send it, the real firmware can't either.
 */

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const TOKEN = arg("token", "paws-device-token");
const TICK_MS = Number(arg("tick", "1000"));
const SECONDS = Number(arg("seconds", "0"));

const DEVICE_ID = "paws-01";
const SPEED = 0.42; // m per tick

// 8 m × 7 m loop — same shape the Local Demo Mode simulator walks.
const LOOP = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 7],
  [4, 7],
  [0, 7],
];

let seq = 0;
let seg = 0;
let pos = { x: 0, y: 0, heading: 0 };
let drift = 0.2;
let frameId = 0;
let gasPpm = 120;
let objectC = 25.5;
const missionOrigin = { xM: 0, yM: 0, setAt: Date.now() };

// ---- scripted events (mirror the Local Demo simulator's script) --------
function scripted(tick) {
  const e = {};
  if (tick === 8) e.soundSpike = 0.84;
  if (tick === 9) e.soundSpike = 0.72;
  if (tick === 30) e.soundSpike = 0.78;
  if (tick === 20) e.gas = 640;
  if (tick === 30) e.gas = 920;
  if (tick === 40) e.gas = 1180;
  if (tick === 95) e.gas = 240;
  if (tick === 27) e.objectC = 34.2; // body-heat-adjacent warm object
  if (tick === 30) e.objectC = 35.9;
  if (tick === 34) e.objectC = 26.1;
  if (tick === 58) e.objectC = 33.8;
  if (tick === 62) e.objectC = 35.1;
  if (tick === 66) e.objectC = 25.8;
  return e;
}

function step() {
  const [tx, ty] = LOOP[(seg + 1) % LOOP.length];
  const dx = tx - pos.x;
  const dy = ty - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.08) {
    seg = (seg + 1) % LOOP.length;
    return;
  }
  const stepLen = Math.min(SPEED, dist);
  pos.x += (dx / dist) * stepLen;
  pos.y += (dy / dist) * stepLen;
  pos.heading = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (pos.heading < 0) pos.heading += 360;
  drift = Math.min(1.4, Math.round((0.2 + seq * 0.012) * 10) / 10);
}

function payload(tick) {
  const now = Date.now();
  const s = scripted(tick);
  if (s.gas !== undefined) gasPpm = s.gas;
  if (s.objectC !== undefined) objectC = s.objectC;

  step();
  const baseline = 0.07;
  const amp = s.soundSpike !== undefined ? s.soundSpike : 0.05 + Math.random() * 0.05;
  const peak = s.soundSpike !== undefined ? s.soundSpike : Math.max(0.12, amp * 1.4);

  return {
    deviceId: DEVICE_ID,
    ts: now,
    seq,
    sound: { amp, baseline, peak: Math.round(peak * 100) / 100, heardAt: now },
    gas: { ppm: gasPpm, adc: Math.round((gasPpm / 20000) * 4095), heardAt: now },
    thermal: { objectC, ambientC: 25.4, heardAt: now },
    distance: { mm: 400 + Math.round(Math.random() * 80), status: "valid", source: "vl53l0x", heardAt: now },
    tilt: { pitchDeg: Math.round(Math.sin(seq / 6) * 30) / 10, rollDeg: Math.round(Math.cos(seq / 5) * 25) / 10, heardAt: now },
    position: {
      xM: Math.round(pos.x * 10) / 10,
      yM: Math.round(pos.y * 10) / 10,
      headingDeg: Math.round(pos.heading),
      driftM: drift,
      mode: "estimated_imu_odometry",
      origin: missionOrigin,
      heardAt: now,
    },
    // Camera: one frame per tick → provider sees frameId 14,15,16,62,63…
    camera: {
      frameId: ++frameId,
      ts: now,
      hasFrame: true,
      width: 640,
      height: 480,
      jpegBytes: 30000,
    },
  };
}

async function main() {
  console.log(`SEED INGEST → ${BASE}/api/ingest  (device ${DEVICE_ID}, token ${TOKEN ? "✓ set" : "⚠ missing"})`);
  console.log(`tick ${TICK_MS} ms · ${SECONDS ? `auto-stop after ${SECONDS}s` : "run forever (Ctrl+C to stop)"}\n`);
  const started = Date.now();

  while (SECONDS === 0 || Date.now() - started < SECONDS * 1000) {
    seq += 1;
    const body = payload(seq);
    try {
      const res = await fetch(`${BASE}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": TOKEN },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`✗ HTTP ${res.status} — ${data.error ?? "bad request"}`);
        if (res.status === 401) {
          console.error("  Check INGEST_DEVICE_TOKEN in the .env on the server.");
          process.exit(1);
        }
        if (res.status === 422) {
          console.error("  Payload rejected by the contract — fix the script payload.");
          process.exit(1);
        }
      } else if (seq % 5 === 0 || seq < 3) {
        console.log(
          `✓ #${String(seq).padStart(3)}  pos (${body.position.xM.toFixed(1)}, ${body.position.yM.toFixed(1)}) m  ` +
            `gas ${Math.round(body.gas.ppm)} ppm  obj ${body.thermal.objectC.toFixed(1)}°C  frame ${body.camera.frameId}`
        );
      }
    } catch (err) {
      console.error(`✗ network — ${err.message} (is the console running?)`);
      if (SECONDS === 0) process.exit(1);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  console.log(`\nDone — ${seq} payloads sent. Open the console to see the mission.`);
}

void main();
