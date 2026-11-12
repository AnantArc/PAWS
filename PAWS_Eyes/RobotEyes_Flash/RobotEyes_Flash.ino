/*
Robot Eyes — ESP32-CAM MJPEG streamer + FLASHLIGHT + PAWS ROBO-DOG BRIDGE
Board: AI-Thinker ESP32-CAM (OV2640 / OV3660 sensor)

PORTS & ENDPOINTS:
  Port 80 (PAWS Dog Health & Status):
    http://<device-ip>:80/light_status -> returns "ON" or "OFF" (plain text for PAWS Robo-Dog)
    http://<device-ip>:80/              -> camera health check

  Port 81 (Multi-Client Video Stream & LED Control):
    http://<device-ip>:81/stream        -> multi-client MJPEG live stream (up to 4 clients at once)
    http://<device-ip>:81/led           -> JSON status {"mode":"auto","on":true,"ambient":45}
    http://<device-ip>:81/led/on        -> force flashlight ON
    http://<device-ip>:81/led/off       -> force flashlight OFF
    http://<device-ip>:81/led/auto      -> AUTO mode (ambient light sensing)
    http://<device-ip>:81/light_status  -> returns "ON" or "OFF"

WHAT THIS VERSION INCLUDES:
 1. Full PAWS v3.9 Robo-Dog Compatibility:
    - Provides /light_status endpoint on Port 80 & 81 returning "ON" / "OFF".
    - When the camera turns its flash on in the dark, the dog plays its happy tune and sends Supabase alerts!
    - Wi-Fi SSID & Password matched to PAWS network ("PAWS" / "prabhjyot04").
 2. Multi-Client Live Streaming:
    - Custom raw TCP server on port 81 (up to 4 viewers at once: UI, YOLO detector, phone browser).
 3. Automatic Flashlight Control (GPIO 4):
    - Ambient sensing decodes JPEG DC luminance in memory (< 50 -> ON, > 90 -> OFF).
    - Polarity flippable live via serial 'p' command without re-flashing.
 4. Reliability:
    - CAMERA_GRAB_LATEST, double frame-buffer in PSRAM, Wi-Fi watchdog, brownout disable.
*/

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include "esp_timer.h"
#include "img_converters.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_system.h"
#include "lwip/sockets.h"

// ============ FILL THESE IN (MATCHED TO PAWS ROBO-DOG) ============
const char *WIFI_SSID     = "PAWS";         // must be 2.4 GHz
const char *WIFI_PASSWORD = "prabhjyot04";
// ==================================================================

// ---------- AI-Thinker camera pin map (do not change) ----------
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ---------- Flashlight (onboard white flash LED) ----------
#define FLASH_LED_GPIO 4
#define FLASH_LED_ACTIVE_LOW 1

// Keep in sync with config.frame_size (QVGA = 320x240)
#define STREAM_W 320
#define STREAM_H 240

// AUTO-mode thresholds (average frame brightness, 0-255)
#define AUTO_CHECK_MS      2000
#define AMBIENT_ON_BELOW   50   // below this -> flash ON
#define AMBIENT_OFF_ABOVE  90   // above this -> flash OFF (hysteresis gap prevents flicker)
#define BLINK_CHECK_MS     10000
#define BLINK_MS           400  // brief blink-off to verify true room ambient
#define TARGET_FPS         10

httpd_handle_t stream_httpd = NULL;

// ---- LED state ----
// led_mode: 0 = forced OFF, 1 = forced ON, 2 = AUTO
static volatile int      led_mode = 2;
static volatile bool     led_phys_on = false;
static volatile bool     flash_active_low = (FLASH_LED_ACTIVE_LOW != 0);
static volatile uint16_t led_ambient = 0; // last raw brightness reading
static volatile int16_t  led_gain = 0;    // glow the LED itself adds

static void setLed(bool on) {
  if (led_phys_on == on) return;
  led_phys_on = on;
  bool wantLow = flash_active_low ? !on : on;
  digitalWrite(FLASH_LED_GPIO, wantLow ? LOW : HIGH);
  Serial.printf("[led] %s\n", on ? "ON" : "OFF");
}

// ---- Ambient light measurement ----
static volatile bool ambient_decode_ok = false;

static uint16_t measureAmbient() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { ambient_decode_ok = false; return 0; }

  size_t jpg_len = fb->len;
  uint8_t *jpg = (uint8_t *)malloc(jpg_len);
  if (!jpg) {
    esp_camera_fb_return(fb);
    ambient_decode_ok = false;
    return 0;
  }
  memcpy(jpg, fb->buf, jpg_len);
  esp_camera_fb_return(fb);

  const size_t sw = STREAM_W / 4;
  const size_t sh = STREAM_H / 4;
  uint8_t *rgb = (uint8_t *)malloc(sw * sh * 2);
  if (rgb && jpg2rgb565(jpg, jpg_len, rgb, JPEG_IMAGE_SCALE_1_4)) {
    const uint16_t *px = (const uint16_t *)rgb;
    uint32_t sum = 0;
    for (size_t i = 0; i < sw * sh; i++) {
      uint16_t v = px[i];
      int r8 = ((v >> 11) & 0x1F) << 3;
      int g8 = ((v >> 5) & 0x3F) << 2;
      int b8 = (v & 0x1F) << 3;
      sum += (r8 * 299 + g8 * 587 + b8 * 114) / 1000;
    }
    free(rgb);
    free(jpg);
    ambient_decode_ok = true;
    return (uint16_t)(sum / (sw * sh));
  }
  free(rgb);
  free(jpg);
  ambient_decode_ok = false;
  return 0;
}

static void ambientTask(void *pv) {
  uint32_t decode_fail = 0;
  vTaskDelay(pdMS_TO_TICKS(5000));
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(AUTO_CHECK_MS));
    if (led_mode != 2) continue; // only AUTO reacts to light

    uint16_t amb = measureAmbient();
    led_ambient = amb;
    if (!ambient_decode_ok) {
      decode_fail++;
      Serial.printf("[led] ambient decode FAILED (%u/3)\n", decode_fail);
      if (decode_fail >= 3) {
        Serial.println("[led] 3 decode failures - switching AUTO off.");
        led_mode = 0;
        setLed(false);
        return;
      }
      continue;
    }
    decode_fail = 0;

    if (!led_phys_on) {
      if (amb < AMBIENT_ON_BELOW) {
        setLed(true);
        vTaskDelay(pdMS_TO_TICKS(800));
        uint16_t after = measureAmbient();
        if (ambient_decode_ok) {
          led_gain = (int16_t)(after > amb ? after - amb : 0);
        }
        Serial.printf("[led] AUTO: dark (amb=%u), flash ON, led_gain=%d\n", amb, led_gain);
      }
    } else {
      int32_t est = (int32_t)amb - led_gain;
      if (est > AMBIENT_OFF_ABOVE) {
        setLed(false);
        led_gain = 0;
        Serial.printf("[led] AUTO: bright (amb~%d), flash OFF\n", est);
        continue;
      }

      static uint32_t last_verified = 0;
      if (millis() - last_verified > BLINK_CHECK_MS) {
        last_verified = millis();
        setLed(false);
        vTaskDelay(pdMS_TO_TICKS(BLINK_MS));
        uint16_t true_amb = measureAmbient();
        if (!ambient_decode_ok) {
          if (led_mode == 2) setLed(true);
          continue;
        }
        led_ambient = true_amb;
        if (true_amb > AMBIENT_OFF_ABOVE) {
          led_gain = 0;
          Serial.printf("[led] AUTO: bright (verified amb=%u), flash OFF\n", true_amb);
        } else {
          led_gain = (int16_t)(amb > true_amb ? amb - true_amb : 0);
          if (led_mode == 2) setLed(true);
          Serial.printf("[led] AUTO: still dim (verified amb=%u), flash stays ON, gain=%d\n",
                        true_amb, led_gain);
        }
      }
    }
  }
}

// =======================================================================
// ---- Raw TCP stream + LED server on :81 (MULTI-CLIENT) ----
// =======================================================================
#define MAX_STREAM_CLIENTS 4

#define PART_BOUNDARY "1234567890000000000987654321"
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";
static const char *STREAM_RESPONSE =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: multipart/x-mixed-replace;boundary=" PART_BOUNDARY "\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Cache-Control: no-store, no-cache, must-revalidate\r\n"
    "Connection: close\r\n\r\n";
static const char *R404 = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
static const char *R503 = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

static volatile uint32_t s_frame_count = 0;
static int g_stream_clients[MAX_STREAM_CLIENTS] = { -1, -1, -1, -1 };

static bool sendAll(int fd, const uint8_t *data, size_t len) {
  size_t off = 0;
  while (off < len) {
    fd_set wset;
    FD_ZERO(&wset);
    FD_SET(fd, &wset);
    struct timeval tv = { 2, 0 };
    int r = select(fd + 1, NULL, &wset, NULL, &tv);
    if (r <= 0) return false;
    int n = send(fd, (const char *)data + off, len - off, 0);
    if (n <= 0) return false;
    off += (size_t)n;
  }
  return true;
}

static void handleLed(int cfd, const char *path) {
  if (strcmp(path, "/led/on") == 0) {
    led_mode = 1;
    setLed(true);
  } else if (strcmp(path, "/led/off") == 0) {
    led_mode = 0;
    setLed(false);
  } else if (strcmp(path, "/led/auto") == 0) {
    led_mode = 2;
  }
  char body[96];
  int blen = snprintf(body, sizeof(body),
    "{\"mode\":\"%s\",\"on\":%s,\"ambient\":%u}",
    led_mode == 0 ? "off" : (led_mode == 1 ? "on" : "auto"),
    led_phys_on ? "true" : "false",
    led_ambient);
  char resp[192];
  int n = snprintf(resp, sizeof(resp),
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
    "Access-Control-Allow-Origin: *\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", blen);
  sendAll(cfd, (const uint8_t *)resp, n);
  sendAll(cfd, (const uint8_t *)body, blen);
  close(cfd);
}

static void handleLightStatus(int cfd) {
  const char *body = led_phys_on ? "ON\n" : "OFF\n";
  int blen = strlen(body);
  char resp[160];
  int n = snprintf(resp, sizeof(resp),
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
    "Access-Control-Allow-Origin: *\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", blen);
  sendAll(cfd, (const uint8_t *)resp, n);
  sendAll(cfd, (const uint8_t *)body, blen);
  close(cfd);
}

static void streamClientTask(void *arg) {
  int cfd = (int)(intptr_t)arg;
  int slot = -1;
  for (int i = 0; i < MAX_STREAM_CLIENTS; i++)
    if (g_stream_clients[i] == cfd) { slot = i; break; }

  for (;;) {
    char probe;
    if (recv(cfd, &probe, 1, MSG_PEEK | MSG_DONTWAIT) == 0) break;

    int64_t t0 = esp_timer_get_time();
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      for (int attempt = 0; !fb && attempt < 10; attempt++) {
        vTaskDelay(pdMS_TO_TICKS(50));
        fb = esp_camera_fb_get();
      }
      if (!fb) {
        Serial.println("Stream: capture failed after retries — client will reconnect");
        break;
      }
    }
    char part_buf[64];
    size_t hlen = snprintf(part_buf, sizeof(part_buf), STREAM_PART, fb->len);
    bool ok = sendAll(cfd, (const uint8_t *)STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (ok) ok = sendAll(cfd, (const uint8_t *)part_buf, hlen);
    if (ok) ok = sendAll(cfd, fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (ok) s_frame_count++;
    if (!ok) break;

    int64_t rem = 1000000LL / TARGET_FPS - (esp_timer_get_time() - t0);
    while (rem > 0) {
      vTaskDelay(pdMS_TO_TICKS(2));
      rem -= 2000;
    }
  }
  if (slot >= 0) g_stream_clients[slot] = -1;
  close(cfd);
  vTaskDelete(NULL);
}

static void streamServerTask(void *pv) {
  int lfd = socket(AF_INET, SOCK_STREAM, 0);
  int opt = 1;
  setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(81);
  addr.sin_addr.s_addr = INADDR_ANY;
  if (bind(lfd, (struct sockaddr *)&addr, sizeof(addr)) != 0 || listen(lfd, 5) != 0) {
    Serial.println("Stream server: bind to :81 FAILED");
    close(lfd);
    vTaskDelete(NULL);
    return;
  }
  Serial.println("Stream server listening on :81 (up to 4 clients at once)");

  char req[384];
  for (;;) {
    int cfd = accept(lfd, NULL, NULL);
    if (cfd < 0) { vTaskDelay(pdMS_TO_TICKS(50)); continue; }

    struct timeval tv = { 2, 0 };
    setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    size_t total = 0;
    bool timeout = false;
    uint32_t start = millis();
    while (total < sizeof(req) - 1) {
      int n = recv(cfd, req + total, sizeof(req) - 1 - total, 0);
      if (n < 0) { timeout = true; break; }
      if (n == 0) break;
      total += (size_t)n;
      req[total] = 0;
      if (strstr(req, "\r\n\r\n")) break;
      if (millis() - start > 4000) { timeout = true; break; }
    }
    if (timeout || total < 5) { close(cfd); continue; }

    char path[64] = "";
    if (strncmp(req, "GET ", 4) == 0) {
      const char *p = req + 4;
      const char *e = strchr(p, ' ');
      if (e && (size_t)(e - p) < sizeof(path)) {
        strncpy(path, p, (size_t)(e - p));
        path[e - p] = 0;
      }
    }

    if (strcmp(path, "/stream") == 0) {
      int slot = -1;
      for (int i = 0; i < MAX_STREAM_CLIENTS; i++)
        if (g_stream_clients[i] == -1) { slot = i; break; }
      if (slot < 0) {
        sendAll(cfd, (const uint8_t *)R503, strlen(R503));
        close(cfd);
        Serial.println("Stream: max 4 clients reached — rejected one");
        continue;
      }
      g_stream_clients[slot] = cfd;
      if (!sendAll(cfd, (const uint8_t *)STREAM_RESPONSE, strlen(STREAM_RESPONSE))) {
        g_stream_clients[slot] = -1;
        close(cfd);
        continue;
      }
      xTaskCreate(streamClientTask, "mjpeg", 6144, (void *)(intptr_t)cfd, 2, NULL);
    } else if (strncmp(path, "/led", 4) == 0) {
      handleLed(cfd, path);
    } else if (strcmp(path, "/light_status") == 0) {
      handleLightStatus(cfd);
    } else {
      sendAll(cfd, (const uint8_t *)R404, strlen(R404));
      close(cfd);
    }
  }
}

// =======================================================================
// ---- HTTP Endpoints on Port 80 (PAWS Robo-Dog Status Server) ----
// =======================================================================

// GET / -> Health check
static esp_err_t index_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/plain");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_sendstr(req, "Robot Eyes OK. Stream at :81/stream, Status at :80/light_status");
  return ESP_OK;
}

// GET /light_status -> Exact endpoint called by PAWS checkEsp32CamLightSignal()
static esp_err_t light_status_handler(httpd_req_t *req) {
  const char *status = led_phys_on ? "ON\n" : "OFF\n";
  httpd_resp_set_type(req, "text/plain");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_sendstr(req, status);
  return ESP_OK;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  config.lru_purge_enable = true;

  httpd_uri_t index_uri = {
    .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL
  };

  httpd_uri_t light_status_uri = {
    .uri = "/light_status", .method = HTTP_GET, .handler = light_status_handler, .user_ctx = NULL
  };

  // :80 = Status server for PAWS Robo-Dog
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &index_uri);
    httpd_register_uri_handler(stream_httpd, &light_status_uri);
    Serial.println("PAWS Bridge listening on :80 (/light_status)");
  }

  // :81 = Multi-client MJPEG stream + LED controls (raw TCP sockets)
  xTaskCreate(streamServerTask, "stream81", 4096, NULL, 2, NULL);
}

// =======================================================================
// ---- SETUP & LOOP ----
// =======================================================================

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(200);
  Serial.setDebugOutput(false);

  esp_reset_reason_t reason = esp_reset_reason();
  Serial.print("Reset reason code: ");
  Serial.println((int)reason);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 15;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 15;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return;
  }
  Serial.println("Camera init OK (PSRAM: " + String(psramFound() ? "yes" : "no") + ")");

  sensor_t *s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }

  // --- Flashlight pin ---
  pinMode(FLASH_LED_GPIO, OUTPUT);
  setLed(false);

  // Background task: ambient light checks in AUTO mode
  xTaskCreate(ambientTask, "ambient", 16384, NULL, 3, NULL);
  Serial.printf("Flashlight: AUTO mode (LED pin %d, %s)\n",
                FLASH_LED_GPIO, flash_active_low ? "active-low" : "active-high");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Wi-Fi connected! IP address: ");
  Serial.println(WiFi.localIP());
  Serial.print("Wi-Fi RSSI: ");
  Serial.println(WiFi.RSSI());

  WiFi.setSleep(false);

  startCameraServer();

  Serial.println("==================================================");
  Serial.print("Stream ready:       http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/stream");
  Serial.print("PAWS Light Status:  http://");
  Serial.print(WiFi.localIP());
  Serial.println(":80/light_status");
  Serial.println("==================================================");
}

void loop() {
  delay(1000);

  // Wi-Fi watchdog
  static uint32_t last_reconnect = 0;
  static bool was_connected = true;
  static uint32_t reconnect_count = 0;
  bool connected = (WiFi.status() == WL_CONNECTED);

  if (connected) {
    if (!was_connected) {
      reconnect_count++;
      Serial.printf("Wi-Fi RECONNECTED #%u  IP: %s  RSSI: %d dBm\n",
                    reconnect_count, WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
    }
    was_connected = connected;
  } else if (millis() - last_reconnect > 5000) {
    last_reconnect = millis();
    Serial.println("Wi-Fi down - attempting reconnect...");
    WiFi.reconnect();
  }

  // Stats line
  uint32_t fps = s_frame_count;
  s_frame_count = 0;
  Serial.printf("Stream: ~%u FPS | LED: %s (%s, amb=%u) | wifi: %s | freeHeap: %u KB\n",
                fps,
                led_phys_on ? "ON" : "off",
                led_mode == 0 ? "off" : (led_mode == 1 ? "on" : "auto"),
                led_ambient,
                connected ? "up" : "DOWN",
                ESP.getFreeHeap() / 1024);

  // Serial commands
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'f' || c == 'F') {
      setLed(!led_phys_on);
      led_mode = led_phys_on ? 1 : 0;
      Serial.println("[led] manual toggle");
    } else if (c == 'p' || c == 'P') {
      flash_active_low = !flash_active_low;
      bool wantLow = flash_active_low ? !led_phys_on : led_phys_on;
      digitalWrite(FLASH_LED_GPIO, wantLow ? LOW : HIGH);
      Serial.printf("[led] polarity flipped -> now %s\n",
                    flash_active_low ? "active-low" : "active-high");
    } else if (c == 'a' || c == 'A') {
      led_mode = 2;
      Serial.println("[led] AUTO mode");
    } else if (c == 's' || c == 'S') {
      Serial.printf("[led] mode=%s led=%s polarity=%s ambient=%u gain=%d\n",
                    led_mode == 0 ? "off" : (led_mode == 1 ? "on" : "auto"),
                    led_phys_on ? "ON" : "off",
                    flash_active_low ? "active-low" : "active-high",
                    led_ambient, led_gain);
    }
  }
}
