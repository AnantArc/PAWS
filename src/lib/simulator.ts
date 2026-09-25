import type { ConsoleStore } from "@/lib/store/types";
import type { ConsoleState } from "@/lib/types";
import type { TelemetryPayload } from "@/lib/contract";
import { TelemetryPayloadSchema } from "@/lib/contract";
import { DETECT_RANGE_M, GAS_POCKET, OBSTACLES, distanceM, nearestSurvivor } from "@/lib/world";

/**
 * ROBOT SIMULATOR (demo mode only)
 * ---------------------------------
 * Pretends to be PAWS: walks a continuous loop around an 8 m × 7 m floor,
 * streams sound dB / gas ppm / thermal / sonar / IMU / DHT climate / PIR /
 * odometry through the EXACT same ingest path the real firmware uses, and
 * answers operator commands (E-STOP, resume, re-anchor) with a believable
 * delivery/ack lifecycle.
 *
 * WORLD-DRIVEN, NOT CLOCK-DRIVEN: every reading is a function of where the
 * robot actually is on the floor (src/lib/world.ts). When it walks within
 * range of a survivor, the camera sees a person, the microphone hears them,
 * the thermopile picks up body heat and the PIR trips — all in the same tick,
 * because they are all reacting to the same physical cause. Gas rises as the
 * robot enters the leak plume and clears as it leaves; the forward ranger dips
 * at the debris. Walk away and every signal decays honestly.
 *
 * LOOP MODE (demo-day requirement): the robot NEVER stops, so it meets a
 * survivor roughly once a minute and the score keeps rising and falling.
 */

const SPEED = 0.42; // m per tick-second (walking pace)
const LOOP: Array<[number, number]> = [
  [0, 0],
  [0, 3.5],
  [2.6, 3.4], // debris squeeze
  [3.4, 5.6], // survivor A
  [0.6, 5.4],
  [-1.2, 3.1], // survivor B (inside the gas pocket)
  [-1.1, 0.6], // debris squeeze on the way home
];

export class Simulator {
  private store: ConsoleStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private pos = { x: 0, y: 0, heading: 0, drift: 0.2 };
  private moving = true;
  private seg = 0;
  private soundBase = 0.07;
  private peakHold = 0.12;
  private peakDbHold = 48;
  private gasPpm = 140;
  private objectC = 25.6;
  private frameId = 0;
  private lastFrameTick = 0;
  private mode = "search";
  private pirEvents = 0;
  private lastPir = -1;
  /** Survivor currently inside sensor range + ticks since the robot arrived. */
  private inRange = false;
  private encounterTick = 0;

  constructor(store: ConsoleStore, initial: ConsoleState) {
    this.store = store;
  }

  start() {
    const tickMs = Number(process.env.SIM_TICK_MS ?? 1000);
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- tick
  private async tick() {
    const state = await this.store.getState();
    const mission = state.mission;

    // Commands: walk the lifecycle
    await this.processCommands(state);

    // Mission ended or paused -> freeze the robot & scenario
    if (mission.status === "ended" || mission.status === "paused") return;

    this.tickCount += 1;

    // Movement (paused or E-STOPed -> hold position)
    const estopHeld = state.commands.some((c) => c.current === "acknowledged" && c.type === "estop");
    if (mission.status === "running" && this.moving && !estopHeld) {
      this.step();
    }

    // ---- World-driven survival scenario ------------------------------------
    // Every channel below reacts to WHERE THE ROBOT ACTUALLY IS. One person
    // inside sensor range drives camera + microphone + thermopile + PIR in the
    // same tick, so corroboration in the fusion score is real, not staged.
    const here = { xM: this.pos.x, yM: this.pos.y };
    const near = nearestSurvivor(here);
    const inRange = !!near && near.distanceM <= DETECT_RANGE_M;

    if (inRange && !this.inRange) {
      // Arrival: the person calls out and starts moving.
      this.encounterTick = 0;
      this.pirEvents += 2;
      this.lastPir = 0;
      this.soundSpike(0.82, 84);
    }
    if (inRange) {
      this.encounterTick += 1;
      if (this.encounterTick % 3 === 0) this.soundSpike(0.76, 78); // repeated calls for help
    }
    this.inRange = inRange;
    if (this.lastPir >= 0) this.lastPir += 1;

    // Sensors
    const payload = await this.buildPayload();
    void this.store.ingest(payload);

    // camera every 2 ticks (frames are consumed by the detection provider;
    // the panel shows the simulated-grid placeholder in demo mode)
    if (this.tickCount - this.lastFrameTick >= 2) {
      this.lastFrameTick = this.tickCount;
      this.frameId += 1;
      void this.store.ingest({
        deviceId: "paws-01",
        ts: Date.now(),
        seq: this.tickCount,
        camera: { frameId: this.frameId, ts: Date.now(), hasFrame: true, width: 640, height: 480, jpegBytes: 30000 },
      });
    }
  }

  private soundSpike(amp: number, db: number) {
    this.peakHold = amp;
    this.peakDbHold = db;
  }

  private step() {
    const [tx, ty] = LOOP[(this.seg + 1) % LOOP.length];
    const dx = tx - this.pos.x;
    const dy = ty - this.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) {
      this.seg = (this.seg + 1) % LOOP.length;
      return;
    }
    const stepLen = Math.min(SPEED, dist);
    this.pos.x += (dx / dist) * stepLen;
    this.pos.y += (dy / dist) * stepLen;
    this.pos.heading = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = +Y
    if (this.pos.heading < 0) this.pos.heading += 360;
    // IMU+odometry drift grows honestly over time (capped)
    this.pos.drift = Math.min(1.4, Math.round((0.2 + this.tickCount * 0.012) * 10) / 10);
  }

  private async buildPayload(): Promise<TelemetryPayload> {
    const now = Date.now();
    // sound: baseline + noise; spikes decay the peak hold back down
    const noise = Math.random() * 0.02;
    const peakNow = this.peakHold; // capture BEFORE decay so the event rule sees the spike
    const peakDbNow = this.peakDbHold;
    const amp = Math.min(1, this.soundBase + noise + (peakNow > 0.12 ? peakNow * 0.35 : 0));
    const db = Math.min(
      110,
      Math.max(38, Math.round((48 + noise * 60 + (peakNow > 0.12 ? (peakDbNow - 48) : 0)) * 10) / 10)
    );
    if (this.peakHold > 0.12) this.peakHold = Math.max(0.12, this.peakHold - 0.28);
    if (this.peakDbHold > 48) this.peakDbHold = Math.max(48, this.peakDbHold - 6);
    // Gas: a fixed pocket — the plume rises as the robot walks in and clears
    // as it leaves. No random spikes out of nowhere.
    const here = { xM: this.pos.x, yM: this.pos.y };
    const plume = Math.max(0, 1 - distanceM(here, GAS_POCKET) / GAS_POCKET.radiusM);
    const targetPpm = GAS_POCKET.basePpm + plume * (GAS_POCKET.peakPpm - GAS_POCKET.basePpm);
    this.gasPpm += (targetPpm - this.gasPpm) * 0.35; // cloud fills / clears with a lag
    const gasPpm = this.gasPpm + (Math.random() - 0.5) * 30;

    // Thermal: first-order lag toward body heat while someone is in range, back
    // toward ambient once the robot walks away (a real thermopile does not
    // teleport its reading).
    const objectTarget = this.inRange ? 36 : 25.6;
    this.objectC += (objectTarget - this.objectC) * 0.45 + (Math.random() - 0.5) * 0.3;
    const objectC = this.objectC;
    const ambientC = 24.6 + (Math.random() - 0.5) * 0.6;

    // Clearance: an open corridor that narrows where debris is mapped.
    let frontCm = Math.round(160 + Math.random() * 70 + Math.sin(this.tickCount / 3) * 12);
    for (const ob of OBSTACLES) {
      if (distanceM(here, ob) <= ob.rangeM) {
        frontCm = Math.min(frontCm, ob.clearanceCm + Math.round((Math.random() - 0.5) * 12));
      }
    }
    const leftCm = Math.round(120 + Math.random() * 220);
    const rightCm = Math.round(110 + Math.random() * 200);

    const payload = {
      deviceId: "paws-01",
      ts: now,
      seq: this.tickCount,
      heartbeat: true,
      sound: {
        amp: Math.round(amp * 100) / 100,
        baseline: Math.round(this.soundBase * 100) / 100,
        peak: Math.round(peakNow * 100) / 100,
        db,
        band: db >= 76 ? "LOUD" : db >= 62 ? "MODERATE" : db >= 48 ? "QUIET" : "SILENT",
        peakDb: Math.round(peakDbNow * 10) / 10,
        heardAt: now,
      },
      gas: {
        ppm: Math.round(gasPpm),
        adc: Math.round(Math.min(4095, Math.max(0, (gasPpm / 2000) * 4095))),
        smoke: Math.round(gasPpm * 0.42),
        aqiBand: gasPpm >= 900 ? "VERY POOR" : gasPpm >= 600 ? "POOR" : gasPpm >= 300 ? "MODERATE" : "GOOD",
        warming: false,
        heardAt: now,
      },
      thermal: {
        objectC: Math.round(objectC * 10) / 10,
        ambientC: Math.round(ambientC * 10) / 10,
        deltaC: Math.round((objectC - ambientC) * 10) / 10,
        zone: objectC - ambientC >= 1.5 && objectC >= 28 && objectC <= 40 ? "HUMAN HEAT" : "NORMAL",
        heardAt: now,
      },
      distance: {
        // forward scan nominal, tight dip near survivor spots
        mm: Math.round(Math.min(2000, Math.max(30, frontCm * 10 + (Math.random() - 0.5) * 60))),
        status: "valid",
        source: "vl53l0x",
        cm: frontCm,
        cmLeft: leftCm,
        cmRight: rightCm,
        state: frontCm < 25 ? "STOP" : frontCm < 60 ? "NEAR" : "CLEAR",
        laserState: "IN RANGE",
        match: "YES",
        heardAt: now,
      },
      tilt: {
        pitchDeg: Math.round(Math.sin(this.tickCount / 1.7) * 2.4 * 10) / 10,
        rollDeg: Math.round(Math.cos(this.tickCount / 2.1) * 2.0 * 10) / 10,
        attitude: "LEVEL",
        headingDeg: Math.round(this.pos.heading),
        heardAt: now,
      },
      climate: {
        tempC: Math.round((27.4 + Math.sin(this.tickCount / 9) * 0.4 + (Math.random() - 0.5) * 0.3) * 10) / 10,
        humidityPct: Math.round((61 + Math.sin(this.tickCount / 12) * 2 + (Math.random() - 0.5) * 1.5) * 10) / 10,
        band: "COMFORT",
        heardAt: now,
      },
      pir: {
        state: this.lastPir >= 0 && this.lastPir < 6 ? "MOTION" : "IDLE",
        total: this.pirEvents,
        perMin: Math.min(8, this.pirEvents),
        lastSecs: this.lastPir,
        heardAt: now,
      },
      position: {
        xM: Math.round(this.pos.x * 100) / 100,
        yM: Math.round(this.pos.y * 100) / 100,
        headingDeg: Math.round(this.pos.heading * 10) / 10,
        driftM: this.pos.drift,
        mode: "estimated_imu_odometry",
        origin: { xM: 0, yM: 0, setAt: (await this.store.getState()).mission.origin.setAt },
        heardAt: now,
      },
    } as TelemetryPayload;

    // Always validate against the real contract — the simulator must NEVER
    // be able to produce a payload the firmware could not.
    const parsed = TelemetryPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new Error(`Simulator produced invalid payload: ${parsed.error.message}`);
    return parsed.data;
  }

  // ------------------------------------------------------------- commands
  private async processCommands(state: ConsoleState) {
    const pending = state.commands.filter((c) => c.current === "queued");
    for (const cmd of pending) {
      void this.store.updateCommandStage(cmd.id, "delivered", "packet received by robot");
      setTimeout(() => {
        void this.store.updateCommandStage(cmd.id, "acknowledged", "command accepted");
        setTimeout(() => {
          switch (cmd.type) {
            case "estop":
              this.moving = false;
              void this.store.updateCommandStage(cmd.id, "done", "motors halted — robot holding position");
              break;
            case "resume":
              this.moving = true;
              void this.store.updateCommandStage(cmd.id, "done", "mission resumed — walking");
              break;
            case "re_anchor":
              // Store rebases the display (origin moves to the robot) directly
              void this.store.updateCommandStage(cmd.id, "done", "new origin anchored at current position");
              break;
            case "deploy_payload":
              void this.store.updateCommandStage(cmd.id, "done", "Survivor's Kit released at current coordinates");
              break;
            case "set_mode":
              this.mode = cmd.params.mode ?? "search";
              void this.store.updateCommandStage(cmd.id, "done", `mode set to ${this.mode}`);
              break;
          }
        }, 900);
      }, 700);
    }
  }
}
