/*
 * PAWS v1.2  CODE v5.2
 * 12-DOF robo-dog (3 joints x 4 legs) + sweeping sensor head
 * Hardware: ESP32 DevKit + PCA9685 (16-ch PWM) + 12x MG90S + 1x SG90
 * 
 * NAVIGATION + MAP BUILD v5.2:
 *   - CLEAN OLED pages: no overlap, no garbled text
 *   - Pages change every 2 seconds
 *   - Ready message shown for 3 seconds after WiFi connection
 *   - Header: PAWS (left) | Battery icon + % | WiFi bars (right)
 *   - ToF distance is used for map points only; ultrasonic alone controls navigation
 *   - MLX90614 object and ambient temperature are read and displayed
 *   - Battery raw ADC debug on Serial Monitor
 *   - Servos NOT locked by battery reading
 *   - ESP32-CAM WiFi communication: light on signal → happy buzzer + Supabase alert
 * 
 * REQUIRED HARDWARE: Voltage divider on GPIO23:
 *   Battery (+) --- 10K --- 10K --- 10K --- GPIO23 --- 10K --- GND
 *   Tap between R3 and R4 goes to GPIO23. Ratio = 4.0
 * 
 * PCA9685 CHANNEL MAP:
 *   ch0  FL hip abd   ch4  FR hip abd   ch8  BL hip abd   ch12 BR hip abd
 *   ch1  FL hip flex  ch5  FR hip flex  ch9  BL hip flex  ch13 BR hip flex
 *   ch2  FL knee      ch6  FR knee      ch10 BL knee      ch14 BR knee
 *   ch15 SG90 sensor head sweep
 * 
 * I2C: SDA=GPIO21, SCL=GPIO22 | PCA9685 addr 0x40 | OLED 0x3C |
 *      VL53L0X 0x29 | MLX90614 0x5A
 */

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_VL53L0X.h>
#include <Adafruit_MLX90614.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <time.h>
#include <esp_system.h>

// ==================== USER SETTINGS ====================

const char* WIFI_SSID     = "PAWS";
const char* WIFI_PASSWORD = "prabhjyot04";

const char* SUPABASE_URL  = "https://ryawnxdgglctvkxvhyyc.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5YXdueGRnZ2xjdHZreHZoeXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MjQ3MDksImV4cCI6MjEwNDMwMDcwOX0.Bo_FMCGGMDwZJzijCuTNhp8XRgBhLYEjzzBbJY_D66U";

// ESP32-CAM settings (for WiFi communication)
const char* ESP32_CAM_IP    = "192.168.1.100";  // <-- CHANGE THIS to your ESP32-CAM IP
const uint16_t ESP32_CAM_PORT = 80;

// Power / brownout settings
const bool   HANG_MODE           = true;
const float  BAT_MAX_V           = 12.6f;
const float  BAT_MIN_V           = 8.4f;
const float  DIVIDER_RATIO       = 4.0f;
const uint8_t SERVO_SOFTSTART_MS = 300;
const uint16_t LEG_STAGGER_MS    = 25;

// Timing
const uint32_t SENSOR_READ_MS   = 2000;
const uint32_t SUPABASE_UPLOAD_MS = 2000;
const uint32_t OLED_PAGE_MS     = 2000;  // pages change every 2 seconds
const uint32_t READY_INTRO_MS   = 3000;  // show ready message for 3 seconds
const uint32_t NAV_RANGE_MS     = 250;
const uint32_t MAP_POSE_UPLOAD_MS = 3000; // Send a path point every few seconds to limit WiFi stalls.

// Calibrate these by measuring a known walk and turn on your actual robot.
const float ESTIMATED_CM_PER_GAIT_CYCLE = 5.0f;
const float ESTIMATED_DEG_PER_TURN_CYCLE = 30.0f;
const float NAV_OBSTACLE_CM = 20.0f;
const float NAV_CLEAR_CM = 25.0f;
const uint32_t PAN_SETTLE_MS = 350;
const int PAN_CENTER_ANGLE = 90;
const int PAN_LEFT_ANGLE = 135;
const int PAN_RIGHT_ANGLE = 45;
const float MAP_MAX_OBSTACLE_CM = 250.0f;

const char* SUPABASE_MAP_TABLE = "paws_map_points";

// ==================== PINS ====================

const int PIN_DHT          = 25;
const int PIN_ULTRA_TRIG   = 5;
const int PIN_ULTRA_ECHO   = 18;
const int PIN_BUZZER       = 14;
const int PIN_MQ2          = 34;
const int PIN_MIC          = 35;
const int PIN_BAT_MON      = 23;

// MQ-2 settings: adjust AO ratio if an external divider is used.
const float MQ2_SENSOR_VC = 5.0f;
const float MQ2_ADC_TO_SENSOR_RATIO = 1.0f; // 2.0 for a 2:1 AO voltage divider
const float MQ2_CLEAN_AIR_FACTOR = 9.83f;
const float MQ2_LPG_MIN_CURVE_PPM = 300.0f;
const float MQ2_SMOKE_MIN_CURVE_PPM = 200.0f;
const float MQ2_MAX_CURVE_PPM = 10000.0f;

// ==================== PCA9685 CHANNELS ====================

const uint8_t CH_FL_HIP_ABD  = 0;
const uint8_t CH_FL_HIP_FLEX = 1;
const uint8_t CH_FL_KNEE     = 2;
const uint8_t CH_FR_HIP_ABD  = 4;
const uint8_t CH_FR_HIP_FLEX = 5;
const uint8_t CH_FR_KNEE     = 6;
const uint8_t CH_BL_HIP_ABD  = 8;
const uint8_t CH_BL_HIP_FLEX = 9;
const uint8_t CH_BL_KNEE     = 10;
const uint8_t CH_BR_HIP_ABD  = 12;
const uint8_t CH_BR_HIP_FLEX = 13;
const uint8_t CH_BR_KNEE     = 14;
const uint8_t CH_SENSOR_SWEEP= 15;

const uint8_t HIP_ABD_CH[4]  = { CH_FL_HIP_ABD,  CH_FR_HIP_ABD,  CH_BL_HIP_ABD,  CH_BR_HIP_ABD };
const uint8_t HIP_FLEX_CH[4] = { CH_FL_HIP_FLEX, CH_FR_HIP_FLEX, CH_BL_HIP_FLEX, CH_BR_HIP_FLEX };
const uint8_t KNEE_CH[4]     = { CH_FL_KNEE,     CH_FR_KNEE,     CH_BL_KNEE,     CH_BR_KNEE };

// ==================== SERVO CALIBRATION ====================

const float SERVO_MIN_US = 500;
const float SERVO_MAX_US = 2400;
const uint32_t PWM_FREQ  = 50;

const float HIP_ABD_NEUTRAL[4]  = { 90.0f, 90.0f, 90.0f, 90.0f };
const float HIP_FLEX_NEUTRAL[4] = { 90.0f, 90.0f, 90.0f, 90.0f };
const float KNEE_NEUTRAL[4]     = { 90.0f, 90.0f, 90.0f, 90.0f };

const int8_t HIP_ABD_DIR[4]  = { +1, -1, +1, -1 };
const int8_t HIP_FLEX_DIR[4] = { +1, -1, +1, -1 };
const int8_t KNEE_DIR[4]     = { +1, -1, +1, -1 };

const float HIP_ABD_TRIM[4]  = { 0.0f, 0.0f, 0.0f, 0.0f };
const float HIP_FLEX_TRIM[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
const float KNEE_TRIM[4]     = { 0.0f, 0.0f, 0.0f, 0.0f };

// ==================== GAIT CONSTANTS ====================

const float HANG_HIP_SWING  = 12.0f;
const float HANG_KNEE_LIFT  = 30.0f;
const float HANG_STEP_DELAY = 400;
const float GROUND_HIP_SWING = 18.0f;
const float GROUND_KNEE_LIFT = 45.0f;
const float GROUND_STEP_DELAY = 250;

const float HIP_ABD_OFFSET  = 6.0f;
const uint32_t SERVO_UPDATE_MS = 20;
const float OBSTACLE_STOP_CM = 20.0f;

// ==================== GLOBAL OBJECTS ====================

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
DHT dht(PIN_DHT, DHT11);
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool tofOk = false;
bool mlxOk = false;

WiFiClientSecure wifiClient;
WiFiClient esp32CamClient;  // For ESP32-CAM communication
HTTPClient http;
bool wifiConnected = false;
String wifiStatusText = "DISCONNECTED";
int lastHttpCode = 0;
bool wifiBuzzerPlayed = false;

float dhtTempC   = 0.0f;
float dhtHumPct  = 0.0f;
bool  dhtOk      = false;
float laserMm    = 0.0f;
float ultraCm    = 0.0f;
float ultraLastGoodCm = 0.0f;
int   ultraBadReads = 0;
float mlxObjC    = 0.0f;
float mlxAmbC    = 0.0f;
int   mq2Raw     = 0;
float mq2AirRsProxy = 0.0f;
float mq2SensorVolts = 0.0f;
float mq2LpgPpm = 0.0f;
float mq2SmokePpm = 0.0f;
int   micRaw     = 0;
float micDb      = 0.0f;

// Battery variables
float batVoltage = 0.0f;
int   batPct     = 100;
int   estRunMin  = 0;
int   batRawAdc  = 0;

// ESP32-CAM signal
bool esp32CamLightOn = false;
unsigned long lastCamCheck = 0;
String lastAlertedErrors = "";
unsigned long lastErrorAlertTime = 0;

// Timing
unsigned long lastSensorRead = 0;
unsigned long lastUpload     = 0;
unsigned long lastOledPage   = 0;
unsigned long lastStepTime   = 0;
unsigned long lastSweep      = 0;
unsigned long lastScroll     = 0;

int oledPage = 0;
int totalPages = 9;  // 9 pages including ESP32-CAM

// Scroll state
String scrollText = "PAWS READY TO GO!   ";
int scrollPos = 0;
bool introDone = false;
unsigned long introStartTime = 0;
bool bootGaitTest = false;

// Gait
enum GaitState { GAIT_STOP, GAIT_FORWARD, GAIT_BACKWARD, GAIT_TURN_LEFT, GAIT_TURN_RIGHT };
GaitState currentGait = GAIT_STOP;
int stepPhase = 0;

enum NavigationState { NAV_FORWARD, NAV_BACKUP, NAV_SCAN_LEFT, NAV_SCAN_RIGHT, NAV_TURN, NAV_BLOCKED };
NavigationState navigationState = NAV_FORWARD;
float estimatedXcm = 0.0f;
float estimatedYcm = 0.0f;
float estimatedHeadingDeg = 0.0f;  // 0 degrees is the boot direction (+Y).
float leftClearanceCm = 0.0f;
float rightClearanceCm = 0.0f;
float navRangeCm = 0.0f;
int turnDirection = 0;  // -1 left, +1 right.
int mapPointIndex = 0;
String mapSessionId = "";
bool mapOriginUploaded = false;
unsigned long lastPoseMapUpload = 0;
unsigned long lastNavRangeRead = 0;
unsigned long navStateStarted = 0;
unsigned long lastTurnCheck = 0;
unsigned long lastHeadCommand = 0;

String lastError = "NONE";
bool servoError[4] = { false, false, false, false };
bool batteryAlertSent = false;

// ==================== BUZZER HELPERS ====================

void toneBuzzer(int freq, int durationMs) {
  if (freq <= 0) { delay(durationMs); return; }
  tone(PIN_BUZZER, freq);
  delay(durationMs);
  noTone(PIN_BUZZER);
  delay(30);
}

void playHappyBootTune() {
  toneBuzzer(523, 200);
  toneBuzzer(659, 200);
  toneBuzzer(784, 200);
  toneBuzzer(1047, 300);
}

void playCountdownTune() {
  for (int i = 5; i >= 1; i--) {
    int noteFreq = 300 + (5 - i) * 150;
    toneBuzzer(noteFreq, 300);
    delay(200);
  }
}

void playWifiConnectedTune() {
  toneBuzzer(659, 200);
  toneBuzzer(784, 200);
  toneBuzzer(1047, 200);
  toneBuzzer(1318, 400);
}

void playWifiDisconnectedTune() {
  toneBuzzer(300, 400);
  delay(50);
  toneBuzzer(200, 600);
}

void playCautionTune() {
  toneBuzzer(400, 300);
  delay(50);
  toneBuzzer(300, 500);
}

// Happy buzzer for ESP32-CAM light signal
void playEsp32CamHappyTune() {
  toneBuzzer(523, 150); // C
  toneBuzzer(659, 150); // E
  toneBuzzer(784, 150); // G
  toneBuzzer(1047, 300);// C high
}

// ==================== BATTERY HELPERS ====================

float readBatteryVoltage() {
  int raw = analogRead(PIN_BAT_MON);
  batRawAdc = raw;
  float v = raw * (3.3f / 4095.0f) * DIVIDER_RATIO;
  if (v < 0) v = 0;
  if (v > 20) v = 20;
  return v;
}

int voltageToPercentage(float v) {
  if (v >= BAT_MAX_V) return 100;
  if (v <= BAT_MIN_V) return 0;
  return (int)((v - BAT_MIN_V) / (BAT_MAX_V - BAT_MIN_V) * 100.0f);
}

int estimateRuntimeMinutes(int pct) {
  if (pct <= 0) return 0;
  return (pct * 180) / 100;
}

bool batteryTooLow() {
  return batRawAdc > 0 && batVoltage > 0 && batVoltage <= BAT_MIN_V;
}

// ==================== SERVO HELPERS ====================

float angleToPulse(float angle) {
  angle = constrain(angle, 0, 180);
  float us = SERVO_MIN_US + (angle / 180.0f) * (SERVO_MAX_US - SERVO_MIN_US);
  return (us / 20000.0f) * 4096.0f;
}

void setServo(uint8_t channel, float angle) {
  angle = constrain(angle, 0, 180);
  uint16_t pulse = (uint16_t)angleToPulse(angle);
  pwm.setPWM(channel, 0, pulse);
}

void setLegAngles(int leg, float abd, float flex, float knee) {
  setServo(HIP_ABD_CH[leg],  HIP_ABD_NEUTRAL[leg]  + HIP_ABD_DIR[leg]  * (abd  + HIP_ABD_TRIM[leg]));
  setServo(HIP_FLEX_CH[leg], HIP_FLEX_NEUTRAL[leg] + HIP_FLEX_DIR[leg] * (flex + HIP_FLEX_TRIM[leg]));
  setServo(KNEE_CH[leg],     KNEE_NEUTRAL[leg]     + KNEE_DIR[leg]     * (knee + KNEE_TRIM[leg]));
}

void neutralAllLegs() {
  for (int leg = 0; leg < 4; leg++) {
    setLegAngles(leg, 0.0f, 0.0f, 0.0f);
  }
}

void softStartServos() {
  // Stagger all 12 leg servos so they do not start drawing current together.
  for (int leg = 0; leg < 4; leg++) {
    setServo(HIP_ABD_CH[leg], HIP_ABD_NEUTRAL[leg]);
    delay(40);
    setServo(HIP_FLEX_CH[leg], HIP_FLEX_NEUTRAL[leg]);
    delay(40);
    setServo(KNEE_CH[leg], KNEE_NEUTRAL[leg]);
    delay(40);
  }
}
void testAllServoChannels() {
  // Small, sequential movement to confirm every PCA9685 servo channel responds.
  const uint8_t channels[13] = {0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, CH_SENSOR_SWEEP};
  for (int i = 0; i < 13; i++) {
    setServo(channels[i], 80);
    delay(120);
    setServo(channels[i], 100);
    delay(120);
    setServo(channels[i], 90);
    delay(120);
  }
}
// ==================== SENSORS ====================

float mq2RsProxyFromPinVolts(float pinVolts) {
  // The load resistor cancels when comparing current Rs against the clean-air Rs.
  float sensorVolts = pinVolts * MQ2_ADC_TO_SENSOR_RATIO;
  if (sensorVolts <= 0.01f || sensorVolts >= MQ2_SENSOR_VC) return 0.0f;
  return (MQ2_SENSOR_VC / sensorVolts) - 1.0f;
}

int readMq2AverageRaw() {
  const int sampleCount = 16;
  uint32_t total = 0;
  uint32_t totalMilliVolts = 0;
  for (int i = 0; i < sampleCount; i++) {
    total += analogRead(PIN_MQ2);
    totalMilliVolts += analogReadMilliVolts(PIN_MQ2);
    delay(2);
  }
  mq2SensorVolts = (totalMilliVolts / (float)sampleCount) / 1000.0f;
  return (int)(total / sampleCount);
}

void calibrateMq2CleanAir() {
  // Run at boot in clean air after the MQ-2 heater has warmed up.
  uint32_t totalMilliVolts = 0;
  const int sampleCount = 64;
  for (int i = 0; i < sampleCount; i++) {
    totalMilliVolts += analogReadMilliVolts(PIN_MQ2);
    delay(20);
  }
  mq2SensorVolts = (totalMilliVolts / (float)sampleCount) / 1000.0f;
  mq2AirRsProxy = mq2RsProxyFromPinVolts(mq2SensorVolts);
  Serial.print("MQ2 clean-air ADC baseline: ");
  Serial.println(analogRead(PIN_MQ2));
}

float mq2RsOverR0() {
  float currentRsProxy = mq2RsProxyFromPinVolts(mq2SensorVolts);
  if (mq2AirRsProxy <= 0.0f || currentRsProxy <= 0.0f) return 0.0f;
  return (currentRsProxy / mq2AirRsProxy) * MQ2_CLEAN_AIR_FACTOR;
}

float mq2ToLpgPpm() {
  float ratio = mq2RsOverR0();
  if (ratio <= 0.0f) return 0.0f;
  // Typical MQ-2 LPG curve fit: ppm = 574.25 * (Rs/R0)^-2.222.
  float ppm = 574.25f * powf(ratio, -2.222f);
  if (ppm < MQ2_LPG_MIN_CURVE_PPM) return 0.0f;
  return constrain(ppm, MQ2_LPG_MIN_CURVE_PPM, MQ2_MAX_CURVE_PPM);
}

float mq2ToSmokePpm() {
  float ratio = mq2RsOverR0();
  if (ratio <= 0.0f) return 0.0f;
  // Log-log fit through typical MQ-2 smoke curve points (200ppm, Rs/R0=3.4;
  // 10000ppm, Rs/R0=0.6). This is an estimate, not an independent gas reading.
  const float logPpm = 2.3f + (log10f(ratio) - 0.53f) / -0.44f;
  float ppm = powf(10.0f, logPpm);
  if (ppm < MQ2_SMOKE_MIN_CURVE_PPM) return 0.0f;
  return constrain(ppm, MQ2_SMOKE_MIN_CURVE_PPM, MQ2_MAX_CURVE_PPM);
}
float measureMicDb() {
  const int sampleCount = 400;
  double sum = 0.0;
  double sumSquares = 0.0;

  for (int i = 0; i < sampleCount; i++) {
    int sample = analogRead(PIN_MIC);
    sum += sample;
    sumSquares += (double)sample * sample;
    delayMicroseconds(200);
  }

  double mean = sum / sampleCount;
  double variance = (sumSquares / sampleCount) - (mean * mean);
  if (variance < 0.0) variance = 0.0;

  float rms = sqrt(variance);
  if (rms < 1.0f) return 0.0f;

  // Relative level only until calibrated with a sound meter.
  const float MIC_CALIBRATION_OFFSET_DB = 0.0f;
  return MIC_CALIBRATION_OFFSET_DB + 20.0f * log10f(rms);
}

float measureUltrasonicRawCm() {
  digitalWrite(PIN_ULTRA_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_ULTRA_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_ULTRA_TRIG, LOW);
  long duration = pulseIn(PIN_ULTRA_ECHO, HIGH, 30000);
  float cm = duration * 0.0343f / 2.0f;
  return (cm > 0.0f && cm < 500.0f) ? cm : 0.0f;
}

void updateUltrasonicState(float rawCm) {
  if (rawCm > 0.0f) {
    ultraCm = rawCm;
    ultraLastGoodCm = rawCm;
    ultraBadReads = 0;
  } else {
    ultraBadReads++;
    ultraCm = (ultraBadReads < 3) ? ultraLastGoodCm : 0.0f;
  }
}

float measureToFCm() {
  if (!tofOk) {
    laserMm = 0.0f;
    return 0.0f;
  }
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);
  if (measure.RangeStatus == 4 || measure.RangeMilliMeter == 0 || measure.RangeMilliMeter > 2000) {
    laserMm = 0.0f;
    return 0.0f;
  }
  laserMm = measure.RangeMilliMeter;
  return laserMm / 10.0f;
}

float readFrontRangeCm() {
  // Navigation must use the panning ultrasonic sensor only.
  float sonar = measureUltrasonicRawCm();
  updateUltrasonicState(sonar);
  return sonar;
}

float scanUltrasonicSide(int edgeAngle, float &closestCm, float &closestBearingDeg) {
  closestCm = 0.0f;
  closestBearingDeg = 0.0f;
  uint8_t validSamples = 0;
  float total = 0.0f;
  const int step = (edgeAngle >= PAN_CENTER_ANGLE) ? 10 : -10;
 //float total = 0.0f;

  for (int angle = PAN_CENTER_ANGLE; ; angle += step) {
    int sampleAngle = angle;
    if ((step > 0 && sampleAngle > edgeAngle) || (step < 0 && sampleAngle < edgeAngle)) {
      sampleAngle = edgeAngle;
    }

    setServo(CH_SENSOR_SWEEP, sampleAngle);
    delay(80); // Let the pan servo settle before taking the ultrasonic sample.
    float cm = measureUltrasonicRawCm();
    if (cm > 0.0f) {
      total += cm;
      validSamples++;
      if (closestCm <= 0.0f || cm < closestCm) {
        closestCm = cm;
        // Map convention: +X is right, so leftward pan angles are negative bearings.
        closestBearingDeg = PAN_CENTER_ANGLE - sampleAngle;
      }
    }

    if (sampleAngle == edgeAngle) break;
    if ((step > 0 && sampleAngle + step > edgeAngle) ||
        (step < 0 && sampleAngle + step < edgeAngle)) {
      angle = edgeAngle - step; // The loop increment lands exactly on the edge next.
    }
  }

  return (validSamples > 0) ? total / validSamples : 0.0f;
}

void recordObstacle(float rangeCm, float sensorBearingDeg);

void readAllSensors() {
  batVoltage = readBatteryVoltage();
  batPct = voltageToPercentage(batVoltage);
  estRunMin = estimateRuntimeMinutes(batPct);

  Serial.print("BAT: raw=");
  Serial.print(batRawAdc);
  Serial.print(" volt=");
  Serial.print(batVoltage, 2);
  Serial.print(" pct=");
  Serial.println(batPct);

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    dhtTempC = t;
    dhtHumPct = h;
    dhtOk = true;
  } else {
    dhtOk = false;
  }

  // VL53L0X readings are retained for map/telemetry only; never used by navigation.
  float tofMapCm = measureToFCm();
  if (tofMapCm > 0.0f && tofMapCm <= MAP_MAX_OBSTACLE_CM) {
    recordObstacle(tofMapCm, 0.0f);
  }
  updateUltrasonicState(measureUltrasonicRawCm());

  if (mlxOk) {
    float objectC = mlx.readObjectTempC();
    float ambientC = mlx.readAmbientTempC();
    if (!isnan(objectC)) mlxObjC = objectC;
    if (!isnan(ambientC)) mlxAmbC = ambientC;
  }
  mq2Raw = readMq2AverageRaw();
  mq2LpgPpm = mq2ToLpgPpm();
  mq2SmokePpm = mq2ToSmokePpm();
  micRaw = analogRead(PIN_MIC);  // Raw value for diagnostics.
  micDb = measureMicDb();
}

// ==================== ESP32-CAM COMMUNICATION ====================

void checkEsp32CamLightSignal() {
  unsigned long now = millis();
  if (now - lastCamCheck < 10000) return;  // Check every 10 seconds.
  lastCamCheck = now;

  if (!wifiConnected) return;

  // Try to connect to ESP32-CAM and check if light is on
  // ESP32-CAM should serve a simple page: /light_status returns "ON" or "OFF"
  if (esp32CamClient.connect(ESP32_CAM_IP, ESP32_CAM_PORT)) {
    esp32CamClient.print("GET /light_status HTTP/1.1\r\n");
    esp32CamClient.print("Host: ");
    esp32CamClient.print(ESP32_CAM_IP);
    esp32CamClient.print("\r\nConnection: close\r\n\r\n");

    unsigned long timeout = millis() + 500;
    while (esp32CamClient.available() == 0 && millis() < timeout) {
      delay(10);
    }

    String response = "";
    while (esp32CamClient.available()) {
      response += char(esp32CamClient.read());
    }

    if (response.indexOf("ON") >= 0 && !esp32CamLightOn) {
      esp32CamLightOn = true;
      playEsp32CamHappyTune();
      sendInstantAlert(
        "CAM_LIGHT_ON",
        "PAWS: CAM LIGHT ON",
        "ESP32-CAM light activated in dark environment.",
        "high"
      );
      Serial.println("ESP32-CAM: Light ON signal received");
    } else if (response.indexOf("OFF") >= 0) {
      esp32CamLightOn = false;
    }

    esp32CamClient.stop();
  }
}

// ==================== OLED HELPERS ====================

void drawBatteryIcon(int x, int y, int pct) {
  display.drawRect(x, y, 24, 12, SSD1306_WHITE);
  display.drawRect(x + 24, y + 3, 4, 6, SSD1306_WHITE);
  int fillW = (22 * pct) / 100;
  if (fillW > 0) {
    display.fillRect(x + 1, y + 1, fillW, 10, SSD1306_WHITE);
  }
}

void drawWifiBars(int x, int y, bool connected) {
  if (!connected) {
    display.drawRect(x, y + 8, 3, 4, SSD1306_WHITE);
    display.drawRect(x + 5, y + 4, 3, 8, SSD1306_WHITE);
    display.drawRect(x + 10, y, 3, 12, SSD1306_WHITE);
    return;
  }
  display.fillRect(x, y + 8, 3, 4, SSD1306_WHITE);
  display.fillRect(x + 5, y + 4, 3, 8, SSD1306_WHITE);
  display.fillRect(x + 10, y, 3, 12, SSD1306_WHITE);
}

void drawHeader(int pct, bool wifiConn) {
    display.clearDisplay();  // Start each page with a clean buffer.
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("PAWS");
  
  drawBatteryIcon(62, 0, pct);
  display.setCursor(88, 2);
  display.print(pct);
  display.print("%");
  
  drawWifiBars(110, 0, wifiConn);
}

// ==================== OLED PAGES ====================

void oledInit() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found");
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(3);
    display.setCursor(34, 16);
    display.println("PAWS");
    display.setTextSize(1);
    display.setCursor(48, 48);
    display.println("CODE v5.2");
    display.display();
    delay(1500);
  }
}

void drawCountdown(int num) {
  display.clearDisplay();
  display.setTextSize(3);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(56, 16);
  display.println(num);
  display.setTextSize(1);
  display.setCursor(36, 52);
  display.println("Starting...");
  display.display();
}

void drawScrollIntro() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(4, 24);
  display.println("PAWS READY TO GO!");
  display.display();
}
void drawPageBattery() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("BATTERY");
  display.println("-------");
  display.print("Volt: ");
  display.print(batVoltage, 2);
  display.println(" V");
  display.print("Pct:  ");
  display.print(batPct);
  display.println(" %");
  display.print("Run:  ");
  display.print(estRunMin);
  display.println(" min");
  display.print("Raw:  ");
  display.println(batRawAdc);
  display.display();
}

void drawPageUltrasonic() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("ULTRASONIC");
  display.println("---------");
  display.print("Dist: ");
  if (ultraCm > 0) {
    display.print(ultraCm, 1);
    display.println(" cm");
  } else {
    display.println("-- cm");
  }
  display.print("Head: SCANNING");
  display.display();
}

void drawPageLaser() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("TOF MAP ONLY");
  display.println("------------");
  display.print("Map range: ");
  if (laserMm > 0) {
    display.print(laserMm, 1);
    display.println(" mm");
    display.print("      ");
    display.print(laserMm / 10.0f, 1);
    display.println(" cm");
  } else {
    display.println("-- mm");
  }
  display.display();
}

void drawPageTemperature() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("MLX90614 TEMP");
  display.println("-------------");
  if (mlxOk) {
    display.print("Object: ");
    display.print(mlxObjC, 1);
    display.println(" C");
    display.print("Ambient: ");
    display.print(mlxAmbC, 1);
    display.println(" C");
  } else {
    display.println("MLX NOT FOUND");
  }
  display.display();
}

void drawPageHumidity() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("HUMIDITY");
  display.println("-------");
  if (dhtOk) {
    display.print("Hum: ");
    display.print(dhtHumPct, 0);
    display.println(" %");
  } else {
    display.println("NO SENSOR");
  }
  display.display();
}

void drawPageGas() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("GAS / SMOKE");
  display.print("LPG: ");
  display.print(mq2LpgPpm, 0);
  display.println(" ppm");
  display.print("Smoke: ");
  display.print(mq2SmokePpm, 0);
  display.println(" ppm");
  display.print("MQ2 ADC: ");
  display.println(mq2Raw);
  display.display();
}
void drawPageSound() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("SOUND");
  display.println("-----");
  float db = micDb;
  display.print("Mic: ");
  display.println(micRaw);
  display.print("Rel level: ");
  display.print(db, 1);
  display.println(" dB*");
  display.display();
}

void drawPageEsp32Cam() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("ESP32-CAM");
  display.println("---------");
  display.print("IP: ");
  display.println(ESP32_CAM_IP);
  display.print("Light: ");
  display.println(esp32CamLightOn ? "ON  " : "OFF ");
  display.print("WiFi: ");
  display.println(wifiConnected ? "OK  " : "DOWN");
  display.display();
}

void drawPageWifi() {
  drawHeader(batPct, wifiConnected);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println("WIFI & SERVER");
  display.println("-------------");
  display.print("WiFi: ");
  display.println(wifiConnected ? "CONNECTED" : "DISCONNECTED");
  display.print("HTTP: ");
  if (lastHttpCode == 200) {
    display.println("200 OK");
  } else if (lastHttpCode > 0) {
    display.print(lastHttpCode);
    display.println(" ERR");
  } else {
    display.println("--");
  }
  display.print("Supa: ");
  display.println(wifiConnected ? "ONLINE" : "OFFLINE");
  display.display();
}

// ==================== WIFI / SUPABASE ====================

void connectWiFi() {
  wifiClient.setInsecure();
  WiFi.setSleep(true);  // Enable modem sleep to reduce average WiFi current.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);  // Lower radio peak current; range may decrease.
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    wifiStatusText = "CONNECTED";
    Serial.println("\nWiFi connected");
    Serial.print("IP: "); Serial.println(WiFi.localIP());
    // Skip the long connection tune: its buzzer load overlaps the WiFi current spike.
    wifiBuzzerPlayed = false;
  } else {
    wifiConnected = false;
    wifiStatusText = "DISCONNECTED";
    Serial.println("\nWiFi failed");
    if (!wifiBuzzerPlayed) {
      playWifiDisconnectedTune();
      wifiBuzzerPlayed = true;
    }
  }
}

void uploadToSupabase() {
  if (!wifiConnected) {
    lastHttpCode = 0;
    return;
  }

  String url = String(SUPABASE_URL) + "/rest/v1/telemetry";
  http.begin(wifiClient, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "resolution=merge-duplicates, return=minimal");

  float db = micDb;
  float lpg = mq2LpgPpm;
  float smoke = mq2SmokePpm;

  String payload = "{\"id\":1,";
  payload += "\"temperature_c\":" + String(dhtOk ? dhtTempC : -1000, 1) + ",";
  payload += "\"humidity_pct\":"  + String(dhtOk ? dhtHumPct : -1000, 1) + ",";
  payload += "\"laser_distance_mm\":" + String(laserMm, 1) + ",";
  payload += "\"ultrasonic_cm\":" + String(ultraCm > 0 ? ultraCm : -1, 1) + ",";
  payload += "\"object_temp_c\":" + String(mlxObjC, 1) + ",";
  payload += "\"ambient_temp_c\":" + String(mlxAmbC, 1) + ",";
  payload += "\"mq2_raw\":" + String(mq2Raw) + ",";
  payload += "\"lpg_ppm\":" + String(lpg, 0) + ",";
  payload += "\"smoke_ppm\":" + String(smoke, 0) + ",";
  payload += "\"mic_raw\":" + String(micRaw) + ",";
  payload += "\"mic_db\":" + String(db, 1) + ",";
  payload += "\"gait_state\":" + String((int)currentGait) + ",";
  payload += "\"hang_mode\":" + String(HANG_MODE ? "true" : "false") + ",";
  payload += "\"battery_voltage\":" + String(batVoltage, 2) + ",";
  payload += "\"battery_pct\":" + String(batPct) + ",";
  payload += "\"est_runtime_min\":" + String(estRunMin) + ",";
  payload += "\"cam_light_on\":" + String(esp32CamLightOn ? "true" : "false") + ",";
  payload += "\"error_text\":\"" + lastError + "\"";
  payload += "}";

  int code = http.POST(payload);
  lastHttpCode = code;

  if (code > 0) {
    Serial.print("Supabase OK: "); Serial.println(code);
    if (code >= 400) {
      lastError = "HTTP_" + String(code);
    } else {
      lastError = "NONE";
    }
  } else {
    Serial.print("Supabase fail: "); Serial.println(code);
    lastError = "SUPABASE_FAIL";
    wifiConnected = false;
    wifiStatusText = "DISCONNECTED";
  }
  http.end();
}

void sendInstantAlert(String alertType, String title, String message, String severity) {
  if (!wifiConnected) return;

  String url = String(SUPABASE_URL) + "/rest/v1/alerts";
  http.begin(wifiClient, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  String epayload = "{";
  epayload += "\"alert_type\":\"" + alertType + "\",";
  epayload += "\"severity\":\"" + severity + "\",";
  epayload += "\"title\":\"" + title + "\",";
  epayload += "\"message\":\"" + message + "\",";
  epayload += "\"robot_id\":\"PAWS_V1\",";
  epayload += "\"gait_state\":" + String((int)currentGait) + ",";
  epayload += "\"error_text\":\"" + message + "\"";
  epayload += "}";

  int code = http.POST(epayload);
  if (code > 0) {
    Serial.print("Alert OK: "); Serial.println(code);
  } else {
    Serial.print("Alert fail: "); Serial.println(code);
  }
  http.end();
}

void sendBatteryAlert() {
  sendInstantAlert(
    "BATTERY_LOW",
    "PAWS: BATTERY_LOW",
    "Battery low 8.4V. Motors stopped.",
    "critical"
  );
  batteryAlertSent = true;
}

void sendWifiAlert() {
  sendInstantAlert(
    "WIFI_DISCONNECTED",
    "PAWS: WIFI_DROPPED",
    "WiFi connection lost.",
    "high"
  );
}

void normalizeEstimatedHeading() {
  while (estimatedHeadingDeg >= 180.0f) estimatedHeadingDeg -= 360.0f;
  while (estimatedHeadingDeg < -180.0f) estimatedHeadingDeg += 360.0f;
}

void postMapPoint(const char* eventType, float obstacleRangeCm = -1.0f,
                  float sensorBearingDeg = 0.0f) {
  if (!wifiConnected || mapSessionId.length() == 0) return;
  // Pose rows are intentionally throttled; obstacle and origin rows are sent immediately.
  if (strcmp(eventType, "pose") == 0 && millis() - lastPoseMapUpload < MAP_POSE_UPLOAD_MS) return;
  int thisPoint = mapPointIndex++;

  float obstacleX = 0.0f;
  float obstacleY = 0.0f;
  if (obstacleRangeCm > 0.0f) {
    float worldBearingRad = radians(estimatedHeadingDeg + sensorBearingDeg);
    obstacleX = estimatedXcm + obstacleRangeCm * sinf(worldBearingRad);
    obstacleY = estimatedYcm + obstacleRangeCm * cosf(worldBearingRad);
  }

  String payload = "{";
  payload += "\"robot_id\":\"PAWS_V1\",\"session_id\":\"" + mapSessionId + "\",";
  payload += "\"point_index\":" + String(thisPoint) + ",";
  payload += "\"event_type\":\"" + String(eventType) + "\",";
  payload += "\"x_cm\":" + String(estimatedXcm, 1) + ",";
  payload += "\"y_cm\":" + String(estimatedYcm, 1) + ",";
  payload += "\"heading_deg\":" + String(estimatedHeadingDeg, 1) + ",";
  payload += "\"sensor_bearing_deg\":" + String(sensorBearingDeg, 1) + ",";
  if (obstacleRangeCm > 0.0f) {
    payload += "\"obstacle_range_cm\":" + String(obstacleRangeCm, 1) + ",";
    payload += "\"obstacle_x_cm\":" + String(obstacleX, 1) + ",";
    payload += "\"obstacle_y_cm\":" + String(obstacleY, 1);
  } else {
    payload += "\"obstacle_range_cm\":null,\"obstacle_x_cm\":null,\"obstacle_y_cm\":null";
  }
  payload += "}";

  String url = String(SUPABASE_URL) + "/rest/v1/" + SUPABASE_MAP_TABLE;
  http.begin(wifiClient, url);
  http.setTimeout(500);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  int code = http.POST(payload);
  if (code < 200 || code >= 300) {
    Serial.print("Map upload HTTP error: "); Serial.println(code);
  }
  http.end();
  if (strcmp(eventType, "pose") == 0) lastPoseMapUpload = millis();
}

void recordObstacle(float rangeCm, float sensorBearingDeg) {
  if (rangeCm > 0.0f && rangeCm <= MAP_MAX_OBSTACLE_CM) {
    postMapPoint("obstacle", rangeCm, sensorBearingDeg);
  }
}

void updateEstimatedPoseForGaitCycle() {
  float headingRad = radians(estimatedHeadingDeg);
  switch (currentGait) {
    case GAIT_FORWARD:
      estimatedXcm += ESTIMATED_CM_PER_GAIT_CYCLE * sinf(headingRad);
      estimatedYcm += ESTIMATED_CM_PER_GAIT_CYCLE * cosf(headingRad);
      postMapPoint("pose");
      break;
    case GAIT_BACKWARD:
      estimatedXcm -= ESTIMATED_CM_PER_GAIT_CYCLE * sinf(headingRad);
      estimatedYcm -= ESTIMATED_CM_PER_GAIT_CYCLE * cosf(headingRad);
      postMapPoint("pose");
      break;
    case GAIT_TURN_LEFT:
      estimatedHeadingDeg -= ESTIMATED_DEG_PER_TURN_CYCLE;
      normalizeEstimatedHeading();
      postMapPoint("pose");
      break;
    case GAIT_TURN_RIGHT:
      estimatedHeadingDeg += ESTIMATED_DEG_PER_TURN_CYCLE;
      normalizeEstimatedHeading();
      postMapPoint("pose");
      break;
    default:
      break;
  }
}

// ==================== ERROR DIAGNOSIS ====================

void checkErrors() {
  String errors = "";

  if (!dhtOk)            errors += "DHT_FAIL";
  if (!tofOk)            { if (errors.length() > 0) errors += "; "; errors += "TOF_MAP_FAIL"; }
  if (!mlxOk)            { if (errors.length() > 0) errors += "; "; errors += "MLX90614_FAIL"; }
  if (ultraCm <= 0 && ultraBadReads >= 5) { if (errors.length() > 0) errors += "; "; errors += "SONAR_FAIL"; }
  if (!wifiConnected)    { if (errors.length() > 0) errors += "; "; errors += "WIFI_DROPPED"; }
  if (lastHttpCode > 0 && lastHttpCode >= 400) {
    if (errors.length() > 0) errors += "; ";
    errors += "HTTP_" + String(lastHttpCode);
  }

  for (int i = 0; i < 4; i++) {
    if (servoError[i]) {
      if (errors.length() > 0) errors += "; ";
      errors += "SERVO_L" + String(i) + "_FAULT";
    }
  }

  if (errors.length() == 0) errors = "NONE";
  lastError = errors;

  unsigned long now = millis();
  if (wifiConnected && errors != "NONE" &&
      (errors != lastAlertedErrors || now - lastErrorAlertTime >= 60000)) {
    sendInstantAlert(
      "SYSTEM_ERROR",
      "PAWS: " + errors,
      errors,
      "high"
    );
    lastAlertedErrors = errors;
    lastErrorAlertTime = millis();
  } else if (errors == "NONE") {
    lastAlertedErrors = "";
  }
}

// ==================== GAIT MOVEMENTS ====================

float getSwing()   { return HANG_MODE ? HANG_HIP_SWING  : GROUND_HIP_SWING; }
float getKneeLift(){ return HANG_MODE ? HANG_KNEE_LIFT : GROUND_KNEE_LIFT; }
unsigned long getStepDelay() { return HANG_MODE ? HANG_STEP_DELAY : GROUND_STEP_DELAY; }

void stopRobot() {
  currentGait = GAIT_STOP;
  stepPhase = 0;
  lastStepTime = millis();
  neutralAllLegs();
}

void walkForward() {
  if (ultraCm > 0 && ultraCm < OBSTACLE_STOP_CM) {
    playCautionTune();
    currentGait = GAIT_STOP;
    neutralAllLegs();
    lastError = "OBSTACLE_STOP";
    return;
  }
  currentGait = GAIT_FORWARD;
}

void walkBackward() {
  currentGait = GAIT_BACKWARD;
}

void turnLeft() {
  currentGait = GAIT_TURN_LEFT;
}

void turnRight() {
  currentGait = GAIT_TURN_RIGHT;
}

void beginSideScan() {
  stopRobot();
  navigationState = NAV_SCAN_LEFT;
  navStateStarted = millis();
  setServo(CH_SENSOR_SWEEP, PAN_LEFT_ANGLE);
}

void updateNavigation() {
  unsigned long now = millis();

  if (navigationState == NAV_SCAN_LEFT) {
    currentGait = GAIT_STOP;
    if (now - navStateStarted >= PAN_SETTLE_MS) {
      float closestLeftCm, closestLeftBearingDeg;
      leftClearanceCm = scanUltrasonicSide(PAN_LEFT_ANGLE, closestLeftCm, closestLeftBearingDeg);
      if (closestLeftCm > 0.0f) {
        recordObstacle(closestLeftCm, closestLeftBearingDeg);
      }
      navigationState = NAV_SCAN_RIGHT;
      navStateStarted = now;
      setServo(CH_SENSOR_SWEEP, PAN_CENTER_ANGLE);
    }
    return;
  }

  if (navigationState == NAV_SCAN_RIGHT) {
    currentGait = GAIT_STOP;
    if (now - navStateStarted >= PAN_SETTLE_MS) {
      float closestRightCm, closestRightBearingDeg;
      rightClearanceCm = scanUltrasonicSide(PAN_RIGHT_ANGLE, closestRightCm, closestRightBearingDeg);
      if (closestRightCm > 0.0f) {
        recordObstacle(closestRightCm, closestRightBearingDeg);
      }

      if (leftClearanceCm <= 0.0f && rightClearanceCm <= 0.0f) {
        navigationState = NAV_BLOCKED;
        stopRobot();
        Serial.println("Navigation stopped: no valid side scan readings");
        return;
      }

      if (leftClearanceCm < NAV_CLEAR_CM && rightClearanceCm < NAV_CLEAR_CM) {
        navigationState = NAV_BLOCKED;
        stopRobot();
        Serial.println("Navigation stopped: both sides are still blocked");
        return;
      }

      turnDirection = (rightClearanceCm > leftClearanceCm) ? +1 : -1;
      navigationState = NAV_TURN;
      navStateStarted = now;
      lastNavRangeRead = 0;
      setServo(CH_SENSOR_SWEEP, PAN_CENTER_ANGLE);
      if (turnDirection > 0) turnRight(); else turnLeft();
    }
    return;
  }

  if (navigationState == NAV_BLOCKED) {
    stopRobot();
    return;
  }

  if (now - lastNavRangeRead >= NAV_RANGE_MS) {
    setServo(CH_SENSOR_SWEEP, PAN_CENTER_ANGLE);
    navRangeCm = readFrontRangeCm();
    lastNavRangeRead = now;
  }

  switch (navigationState) {
    case NAV_FORWARD:
      if (navRangeCm <= 0.0f) {
        stopRobot();
        navigationState = NAV_BLOCKED;
        Serial.println("Navigation stopped: no front range reading");
      } else if (navRangeCm <= NAV_OBSTACLE_CM) {
        stopRobot();
        recordObstacle(navRangeCm, 0.0f);
        navigationState = NAV_BACKUP;
        navStateStarted = now;
        Serial.println("Obstacle ahead: reversing");
      } else {
        currentGait = GAIT_FORWARD;
      }
      break;

    case NAV_BACKUP:
      if (navRangeCm <= 0.0f) {
        stopRobot();
        navigationState = NAV_BLOCKED;
        Serial.println("Navigation stopped: lost front range while reversing");
      } else if (navRangeCm >= NAV_CLEAR_CM) {
        stopRobot();
        beginSideScan();
        Serial.println("Clearance reached: scanning left and right");
      } else if (now - navStateStarted > 10000) {
        stopRobot();
        navigationState = NAV_BLOCKED;
        Serial.println("Navigation stopped: reverse timeout");
      } else {
        currentGait = GAIT_BACKWARD;
      }
      break;

    case NAV_TURN:
      if (navRangeCm >= NAV_CLEAR_CM) {
        stopRobot();
        navigationState = NAV_FORWARD;
        currentGait = GAIT_FORWARD;
        navStateStarted = now;
        Serial.println("New direction clear: moving forward");
      } else {
        if (turnDirection > 0) turnRight(); else turnLeft();
      }
      break;

    default:
      break;
  }
}

void updateGait() {
  if (currentGait == GAIT_STOP) return;

  unsigned long now = millis();
  if (now - lastStepTime < getStepDelay()) return;
  lastStepTime = now;

  float swing = getSwing();
  float kneeLift = getKneeLift();

  bool pairA = (stepPhase % 2 == 0);
  int legs[2];
  if (pairA) { legs[0] = 0; legs[1] = 3; }
  else       { legs[0] = 1; legs[1] = 2; }

  for (int i = 0; i < 2; i++) {
    int leg = legs[i];
    delay(LEG_STAGGER_MS);

    float abd = 0.0f;
    float flex = 0.0f;
    float knee = 0.0f;

    switch (currentGait) {
      case GAIT_FORWARD:
        if (stepPhase % 4 == 0) { knee = kneeLift; flex = 0; }
        else if (stepPhase % 4 == 1) { knee = kneeLift; flex = swing; }
        else if (stepPhase % 4 == 2) { knee = 0;     flex = swing; }
        else                         { knee = 0;     flex = -swing/2; }
        break;
      case GAIT_BACKWARD:
        if (stepPhase % 4 == 0) { knee = kneeLift; flex = 0; }
        else if (stepPhase % 4 == 1) { knee = kneeLift; flex = -swing; }
        else if (stepPhase % 4 == 2) { knee = 0;     flex = -swing; }
        else                         { knee = 0;     flex = swing/2; }
        break;
      case GAIT_TURN_LEFT:
        {
          float multL = (leg == 0 || leg == 2) ? 0.5f : 1.5f;
          if (stepPhase % 4 == 0) { knee = kneeLift; flex = 0; }
          else if (stepPhase % 4 == 1) { knee = kneeLift; flex = swing * multL; }
          else if (stepPhase % 4 == 2) { knee = 0;     flex = swing * multL; }
          else                         { knee = 0;     flex = -swing * multL / 2; }
        }
        break;
      case GAIT_TURN_RIGHT:
        {
          float multR = (leg == 1 || leg == 3) ? 0.5f : 1.5f;
          if (stepPhase % 4 == 0) { knee = kneeLift; flex = 0; }
          else if (stepPhase % 4 == 1) { knee = kneeLift; flex = swing * multR; }
          else if (stepPhase % 4 == 2) { knee = 0;     flex = swing * multR; }
          else                         { knee = 0;     flex = -swing * multR / 2; }
        }
        break;
      default: break;
    }

    abd = HIP_ABD_OFFSET;
    setLegAngles(leg, abd, flex, knee);
  }

  stepPhase = (stepPhase + 1) % 4;
  if (stepPhase == 0) updateEstimatedPoseForGaitCycle();
}

// ==================== ULTRASONIC FAST SCAN ====================

int sweepPos = 2;
int sweepDir = 1;

void fastUltrasonicScan() {
  unsigned long now = millis();
  if (now - lastSweep < 20) return;
  lastSweep = now;

  setServo(CH_SENSOR_SWEEP, sweepPos);
  sweepPos += sweepDir * 5;

  if (sweepPos >= 178) sweepDir = -1;
  if (sweepPos <= 2)   sweepDir = +1;
}

// ==================== SETUP ====================

void setup() {
  Serial.begin(115200);
  delay(500);
  mapSessionId = String((uint32_t)esp_random(), HEX);
  Serial.println("\n=== PAWS v1.2 CODE v5.2 ===");

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_ULTRA_TRIG, OUTPUT);
  pinMode(PIN_ULTRA_ECHO, INPUT);
  pinMode(PIN_MQ2, INPUT);
  pinMode(PIN_MIC, INPUT);
  pinMode(PIN_BAT_MON, INPUT);

  analogReadResolution(12);

  playHappyBootTune();

  Wire.begin(21, 22);  // Start the shared I2C bus before the PCA9685 and OLED.
  Wire.beginTransmission(0x40);
  uint8_t pcaI2cStatus = Wire.endTransmission();
  if (pcaI2cStatus == 0) Serial.println("PCA9685 found at 0x40");
  else Serial.println("ERROR: PCA9685 not responding at 0x40");

  pwm.begin();
  pwm.setPWMFreq(PWM_FREQ);
  delay(10);

  softStartServos();
  neutralAllLegs();
  testAllServoChannels();
  neutralAllLegs();

  setServo(CH_SENSOR_SWEEP, 90);
  delay(200);

  dht.begin();
  tofOk = lox.begin();
  Serial.println(tofOk ? "VL53L0X ready (map-only)" : "VL53L0X not found (map points unavailable)");
  mlxOk = mlx.begin(0x5A, &Wire);
  Serial.println(mlxOk ? "MLX90614 ready" : "MLX90614 not found");

  oledInit();

  calibrateMq2CleanAir();
  readAllSensors();

  Serial.println("Countdown before movement...");
  for (int i = 5; i >= 1; i--) {
    drawCountdown(i);
    int noteFreq = 300 + (5 - i) * 150;
    toneBuzzer(noteFreq, 300);
    Serial.print("Countdown: "); Serial.println(i);
    delay(200);
  }

  connectWiFi();

  lastSensorRead = millis();
  lastUpload = millis();
  lastStepTime = millis();
  lastSweep = millis();
  lastScroll = millis();
  introStartTime = millis();

  Serial.println("PAWS ready.");
}

// ==================== LOOP ====================

void loop() {
  unsigned long now = millis();

  // Hold the ready message for exactly three seconds after WiFi setup.
  if (!introDone) {
    if (now - introStartTime >= READY_INTRO_MS) {
      introDone = true;
      oledPage = 0;
      lastOledPage = now;
      stepPhase = 0;
      lastStepTime = now;
      navigationState = NAV_FORWARD;
      navRangeCm = 0.0f;
      lastNavRangeRead = 0;
      setServo(CH_SENSOR_SWEEP, PAN_CENTER_ANGLE);
      display.clearDisplay();
      display.display();
    } else {
      drawScrollIntro();
      fastUltrasonicScan();  // Start the panning servo during the ready screen.
      currentGait = GAIT_STOP;
    }
    delay(20);
    return;
  }

  // Run navigation and gait updates before potentially blocking network work.
  if (wifiConnected && !mapOriginUploaded) {
    postMapPoint("origin");
    mapOriginUploaded = true;
  }
  updateNavigation();

  // Check ESP32-CAM light signal
  checkEsp32CamLightSignal();

  // Low battery is reported, but it no longer commands the servos to stop.
  if (batteryTooLow()) {
    if (!batteryAlertSent) sendBatteryAlert();
    lastError = "BATTERY_LOW";
  } else {
    batteryAlertSent = false;
  }
  // Sensors every 2 seconds
  if (now - lastSensorRead >= SENSOR_READ_MS) {
    readAllSensors();
    lastSensorRead = now;
  }

  // Upload every 2 seconds
  if (now - lastUpload >= SUPABASE_UPLOAD_MS) {
    uploadToSupabase();
    lastUpload = now;
  }

  // WiFi reconnect + buzzer on disconnect
  if (wifiConnected && WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    wifiStatusText = "DISCONNECTED";
    if (!wifiBuzzerPlayed) {
      playWifiDisconnectedTune();
      wifiBuzzerPlayed = true;
    }
    sendWifiAlert();
    lastError = "WIFI_DROPPED";
    connectWiFi();
  } else if (!wifiConnected && WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    wifiStatusText = "CONNECTED";
    wifiBuzzerPlayed = false;
    // Skip the long connection tune: its buzzer load overlaps the WiFi current spike.
  }

  checkErrors();

  // OLED page cycle every 2 seconds
  if (now - lastOledPage >= OLED_PAGE_MS) {
    oledPage = (oledPage + 1) % totalPages;
    lastOledPage = now;
  }

  // Draw current page
  switch (oledPage) {
    case 0: drawPageBattery(); break;
    case 1: drawPageUltrasonic(); break;
    case 2: drawPageLaser(); break;
    case 3: drawPageTemperature(); break;
    case 4: drawPageHumidity(); break;
    case 5: drawPageGas(); break;
    case 6: drawPageSound(); break;
    case 7: drawPageEsp32Cam(); break;
    case 8: drawPageWifi(); break;
  }

  updateGait();

  delay(SERVO_UPDATE_MS);
}


