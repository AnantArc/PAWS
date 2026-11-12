#!/usr/bin/env python3
"""
Robot Eyes — human detector (matched to your team's Supabase `detections` table)
=================================================================================

Reads the ESP32-CAM MJPEG stream, runs YOLO person-only detection, and
writes rows into the team's `detections` table (id, label, confidence, ts):

    human in frame ->  INSERT {label: 'person', confidence: 0.xx}
    nobody         ->  INSERT {label: 'none',   confidence: 0.0}

When it writes:
  * every state CHANGE (human appeared / left), and
  * a heartbeat every HEARTBEAT_SEC seconds, so the NEWEST row always
    reflects the current state and `ts` stays fresh (the frontend can
    tell a live detector from a dead one).

The YOLO model is restricted to the person class only — cars, dogs,
bicycles etc. are never considered.

SETUP
  1. pip install -r requirements.txt
  2. edit .env (only the camera URL is missing)
  3. python detect_human.py

First run downloads yolov8n.pt (~6 MB) automatically.

TIPS
  --show              live window with boxes (tuning only, never sent)
  --conf 0.5          stricter "definitely a human"
  --camera-url x.mp4  test the detector without the robot
"""

import argparse
import os
import time

import cv2
from supabase import create_client
from ultralytics import YOLO


# ---------------- tuning knobs ----------------
ON_FRAMES = 3     # consecutive person-frames before reporting "person"
OFF_FRAMES = 10   # consecutive empty-frames before reporting "none"
PERSON_CLASS = 0  # COCO class 0 == person (the ONLY class we look at)
# ----------------------------------------------


def load_env(path=".env"):
    """Tiny .env loader (no extra dependency)."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_args():
    load_env()
    p = argparse.ArgumentParser(description="Robot Eyes human detector")
    p.add_argument("--camera-url", default=os.environ.get("ROBOT_EYES_CAMERA_URL", ""),
                   help="MJPEG stream, e.g. http://192.168.1.42:81/stream")
    p.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL", ""))
    p.add_argument("--supabase-key", default=os.environ.get("SUPABASE_KEY", ""))
    p.add_argument("--table", default=os.environ.get("SUPABASE_TABLE", "detections"))
    p.add_argument("--human-label", default=os.environ.get("HUMAN_LABEL", "person"))
    p.add_argument("--no-human-label", default=os.environ.get("NO_HUMAN_LABEL", "none"))
    p.add_argument("--heartbeat-sec", type=float,
                   default=float(os.environ.get("HEARTBEAT_SEC", "15")))
    p.add_argument("--model", default="yolov8n.pt")
    p.add_argument("--conf", type=float, default=0.40)
    p.add_argument("--show", action="store_true",
                   help="live window with boxes (tuning only — never sent anywhere)")
    return p.parse_args()


def main():
    args = parse_args()
    if not args.camera_url or not args.supabase_url or not args.supabase_key:
        raise SystemExit(
            "Missing config: fill in .env (camera URL + Supabase) "
            "or pass --camera-url / --supabase-url / --supabase-key."
        )

    print(f"Loading model: {args.model} (first run downloads it)...")
    model = YOLO(args.model)
    supa = create_client(args.supabase_url, args.supabase_key)
    print(f"Watching:  {args.camera_url}")
    print(f"Writing:   table='{args.table}'   human='{args.human_label}'   "
          f"clear='{args.no_human_label}'   (person conf >= {args.conf})")

    def now_iso():
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def send(label, conf):
        try:
            supa.table(args.table).insert(
                {
                    "label": label,
                    "confidence": round(float(conf), 3),
                    "ts": now_iso(),
                }
            ).execute()
            print(f"[supabase] {label:<8} conf={conf:0.2f}")
        except Exception as e:
            print(f"[supabase] write FAILED: {e}")

    human = False        # current debounced state
    last_conf = 0.0      # last seen person confidence
    last_heartbeat = 0.0
    stream_up = False

    cap = cv2.VideoCapture(args.camera_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    pos_streak = 0
    neg_streak = 0
    t_last = time.time()
    frames = 0

    try:
        # announce ourselves so the frontend immediately has a fresh row
        send(args.no_human_label, 0.0)
        last_heartbeat = time.time()

        while True:
            ok, frame = cap.read()
            now = time.time()

            if not ok or frame is None:
                if stream_up:
                    print("[stream] LOST - waiting for the camera...")
                stream_up = False
                time.sleep(2.0)
                if not cap.isOpened():
                    print("[stream] reopening capture...")
                    cap.release()
                    cap = cv2.VideoCapture(args.camera_url, cv2.CAP_FFMPEG)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue

            if not stream_up:
                print("[stream] connected")
                stream_up = True

            # ---- detect (person = COCO class 0, the only class considered) ----
            results = model(frame, classes=[PERSON_CLASS], conf=args.conf, verbose=False)
            boxes = results[0].boxes

            if len(boxes) > 0:
                best_conf = float(boxes.conf.max())
                last_conf = best_conf
                pos_streak += 1
                neg_streak = 0
                if not human and pos_streak >= ON_FRAMES:
                    human = True
                    send(args.human_label, best_conf)
            else:
                neg_streak += 1
                pos_streak = 0
                if human and neg_streak >= OFF_FRAMES:
                    human = False
                    send(args.no_human_label, 0.0)

            # ---- heartbeat: newest row always reflects the current state ----
            if now - last_heartbeat >= args.heartbeat_sec:
                last_heartbeat = now
                send(args.human_label if human else args.no_human_label,
                     last_conf if human else 0.0)

            frames += 1
            if frames % 50 == 0:
                fps = 50 / max(now - t_last, 1e-6)
                t_last = now
                frames = 0
                print(f"[detect] ~{fps:.1f} fps   state: {'HUMAN' if human else 'clear'}")

            if args.show:
                img = results[0].plot()
                cv2.imshow("Robot Eyes", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

    except KeyboardInterrupt:
        print("\nStopping (Ctrl+C)... the frontend will go 'stale' once ts ages out.")
    finally:
        cap.release()
        if args.show:
            cv2.destroyAllWindows()
        print("Done.")


if __name__ == "__main__":
    main()
