# 🐾 PAWS Mission Control Console — SIH Presentation & Technical Briefing

> **Smart India Hackathon (SIH) Context Document**  
> *Complete architecture, UI design, Supabase database contract, AI vision pipeline, and hardware integration boundaries.*

---

## 1. High-Level Concept (What is PAWS?)

**PAWS (Pathfinder Autonomous Rescue Quadruped)** is an AI-assisted search-and-rescue quadruped robot engineered for extreme disaster environments (earthquake collapses, urban debris, industrial chemical leaks, and low-visibility disaster zones).

The **PAWS Console** is the web-based mission control application utilized by disaster response operators and field rescue teams. It delivers real-time 2D tactical maps, sensor telemetry, live camera streams with AI human detection, and an explainable **AI Survivor Fusion Score**.

---

## 2. UI & Screen Layout (Panel-by-Panel Breakdown)

The console UI is optimized for high-stress disaster field operations, supporting two dynamic visual modes: **Field Ops Dark Mode** (default for low-light rescue command tents) and **High-Contrast Light Mode** (for direct sunlight field deployment).

### 👑 Header & Operator Toolbar
* **Operator Context**: Displays the active logged-in operator (e.g., `Jash`) and the robot unit ID (`PAWS-01`, Firmware `v2.9`).
* **Mission Flow Controls**: `START MISSION`, `PAUSE MISSION`, `RESUME`, and `END MISSION` state buttons.
* **LIVE ↔ DEMO Toggle**: Instant one-click switch between live hardware streams and the built-in disaster scenario simulator.
* **Theme Switcher**: Instant toggle between Dark and Light themes with pre-paint theme persistence (zero visual flash on reload).
* **Field Link QR Generator**: Generates an instant, HMAC-signed QR code letting field rescuers on mobile devices view a live, read-only status map without needing login credentials.

---

### 🔝 Top Row (Compact Mission Overview — 340px)

1. **Live Camera & YOLO AI Vision Panel**
   * Displays the real-time camera stream from an **ESP32-CAM** mounted on the robot quadruped.
   * Overlays bounding boxes around detected survivors in real time.
   * Displays detection labels (e.g., `PERSON 87% CONFIDENCE`), frame indices, and connection status (`LIVE`, `SIMULATED`, or `OFFLINE`).

2. **Survivor Search AI Fusion Score Panel**
   * Computes an **overall Survivor Score (0% to 100%)** by fusing multiple sensor modalities rather than relying solely on visual detection.
   * **Survivor Likelihood**: Fuses human visual detection + acoustic peak volume + IR thermopile heat differential.
   * **Environmental Hazard**: Evaluates toxic gas PPM (LPG/Smoke) and ambient temperature.
   * **Terrain Accessibility**: Monitors ground clearance (<120mm warning), body tilt (>28° slope warning), and radio link quality.
   * **Explainable AI**: Displays plain-English justifications (e.g., *"Thermal hotspot detected + human shape confirmed by YOLO"*).

3. **2D Tactical Map & Odometry Trail**
   * **Real-time Path**: Plots the robot’s exact movement path in centimeters $(X, Y)$ and heading angle ($\text{degrees}^\circ$).
   * **PAWS Map Marker**: Custom glowing PAWS logo badge with a cyan ring and dark backing disc visible on both dark and light map styles.
   * **Interactive Controls**: Drag-to-pan, zoom in/out, and reset view.
   * **Gas Hazard Heatmap**: Overlays dynamic colored hazard rings where toxic gas concentrations spike.
   * **Survivor Pin Drops**: Automatically drops a tactical pin when a survivor location is identified.
   * **Display Re-Anchor**: Allows the operator to rebase the visual $(0,0)$ origin on the map display without resetting physical motor encoders.

4. **Live Activity & Event Feed**
   * Chronological audit log recording sensor spikes, survivor alerts, mission state transitions, and operator commands with high-precision timestamps.

---

### 📊 Middle Row (Sensor Telemetry Cards — 310px)

Every sensor panel displays live numerical readings, status badges (`LIVE`, `WARM-UP`, `NO SENSOR`, `N/A`), and sparkline trend graphs:

1. **GAS Sensor (MQ Series)**: Measures LPG & Smoke PPM with color-coded Air Quality Index (AQI) bands (*Good, Moderate, Unhealthy, Hazardous*). Includes a `WARM-UP` countdown indicator.
2. **SOUND Sensor (Acoustic Amplitude)**: Displays sound intensity in decibels (dB) and peak amplitude. *(Note: Measures sound volume only, not speech/voice recognition).*
3. **SONAR & LASER (Obstacle Clearance)**: 3-way Sonar (Left, Center, Right in cm) + Laser Time-of-Flight distance ranger for narrow gap navigation.
4. **IMU & ATTITUDE (Robot Stability)**: Pitch, Roll, and Yaw angles with steep slope warnings ($>28^\circ$).
5. **THERMAL IR Thermopile**: Measures target surface temperature, ambient room temperature, and temperature differential ($\Delta T$). Highlights thermal hotspots.
6. **CLIMATE (DHT11)**: Ambient temperature ($^\circ\text{C}$) and Relative Humidity ($\% \text{RH}$) tracking.
7. **PIR Motion Sensor**: Passive Infrared motion detection events and event frequency.
8. **SYSTEM & LINK**: Signal strength (RSSI in dBm), network ping latency, and telemetry packet frequency.
9. **BATTERY**: Displayed honestly as `N/A` (Hardware battery voltage monitoring is under active hardware development).

---

### 🕹️ Bottom Row (Command Bar — 280px)
* Command dispatch tools: **E-STOP (Emergency Stop)**, **Pause Walk**, **Return to Base**, and **Manual Override**.
* Audit trail logging command issuer, confirmation status, and timestamps.

---

## 3. Supabase Database & Realtime Data Pipeline

The application uses **Supabase (PostgreSQL + Realtime WebSockets)** for backend persistence and live data synchronization.

### 🌐 Supabase Configuration
* **Project URL**: `https://ryawnxdgglctvkxvhyyc.supabase.co`
* **Anon Key**: `sb_publishable_YaTAIfsLcQc6Vwv5bLouOw_DziUjyxD`
* **Realtime Protocol**: WebSockets push telemetry and detection updates directly to the web UI within **1 to 2 seconds**.

### 🗄️ Database Tables & Schema
1. `telemetry`: Stores incoming quadruped telemetry uploads every 2 seconds (37 total fields including gas, thermal, distance, IMU, coordinates). Uses a single active row (`id=1`) updated via database triggers for instant UI responsiveness.
2. `detections`: Stores YOLO AI vision detections from the camera (`label`: `person` or `none`, `confidence`: `0.87`, `ts`: timestamp).
3. `mission_state`: Tracks mission status (`SEARCHING`, `PAUSED`, `ENDED`), total duration, and active operator details.
4. `fusion_weights`: Stores operator-customized weights for computing survivor scores.
5. `commands`: Audit table logging all operator commands dispatched to the robot.

---

## 4. Hardware vs. UI Boundaries (Honesty for Hackathon Judges)

When presenting to judges, maintain these clear technical boundaries:

| Component | Current Implementation | Technical Explanation |
| :--- | :--- | :--- |
| **Quadruped Firmware** | Open-Loop Transmission (v2.9) | Robot walks on boot (3s delay) and uploads telemetry every 2s via HTTP POST. It does not read back commands from Supabase yet. UI displays full command flow for future integration. |
| **YOLO AI Vision** | Laptop Python Integration | YOLO (`detect_human.py`) runs on the operator's laptop, reads the ESP32-CAM stream, and posts detection results to Supabase `detections`. |
| **Map Re-Anchor** | UI Display Rebase | Re-anchoring updates the visual $(0,0)$ origin on the screen map display without re-calibrating physical motor encoders. |
| **Multi-Robot Identity** | UI Dropdown Ready | The UI allows selecting `PAWS-01` or `PAWS-02`. Multi-robot database schema is ready for future fleet deployment. |
| **Battery Status** | Displayed as `N/A` | Hardware voltage monitoring circuit is planned for v3.0, so the UI displays `N/A` instead of placeholder percentages. |

---

## 5. Built-in Disaster Simulator (Demo-Day Backup)

* **Guaranteed Reliability**: If Wi-Fi fails or hardware loses power on demo day, clicking the **DEMO** toggle runs an onboard continuous simulation loop.
* **Scenario Features**: Simulates recurring survivor discovery events every ~60 seconds, toxic gas leaks, sound spikes, and walking odometry so the presentation never stops or breaks.

---

## 6. Key UI Engineering Accomplishments

1. **RGB Design Token System**: Solved CSS variable token rendering issues in SVGs/charts using custom `rgb(var(--name))` helpers so graphs, sparklines, and maps render in vivid colors in both Light and Dark modes.
2. **Pre-Paint Theme Persistence**: Custom inline `<head>` script reads user theme preferences (`paws-theme-v2`) before rendering, eliminating visual dark/light flickering.
3. **Compact Resolution Layout**: Text rows locked to 18px height so telemetry values never overlap across laptop screen resolutions (1440x900, 1080p, 4K).

---

## 🤖 Ready-to-Copy Prompt for AI Tools

Copy and paste the block below into any AI model (ChatGPT, Claude, Gemini, etc.) to give it full context on the PAWS project:

