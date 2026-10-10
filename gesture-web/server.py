"""Web UI backend for Gesture Control.

Run:  pip install flask opencv-python mediapipe numpy
      python server.py        ->  open http://localhost:5000

The UI (ui/) talks to this file. Plug your EXISTING gesture code into the three
hook functions marked HOOK below. Everything else already works.
"""
import os, threading, time
import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory

import face_masks
import pyautogui
import hand_tracker
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE, "ui"), static_url_path="")

lock = threading.Lock()
state = {"mode": "mouse", "hands": "right", "smoothing": "balanced", "masksOn": True, "maskIndex": 0}
sentence = {"text": ""}
SMOOTH_ALPHA = {"calm": 0.15, "balanced": 0.35, "quick": 0.7}   # 0..1, higher = faster cursor

cap = None
camera_on = True
cap_lock = threading.Lock()

def get_cap():
    """Open the webcam on demand. Returns None while the camera is switched off."""
    global cap
    with cap_lock:
        if not camera_on:
            return None
        if cap is None:
            try:
                cap = cv2.VideoCapture(0)
                if not cap.isOpened():
                    cap.release()
                    cap = None
            except Exception as e:
                print("Error opening camera:", e)
                cap = None
        return cap

def release_camera():
    """Close the webcam (the camera light goes off)."""
    global cap
    with cap_lock:
        if cap is not None:
            cap.release()
            cap = None


# ---------- helpers your hooks can use ----------
def smooth(prev, new, alpha):
    """Exponential smoothing for the cursor position. prev/new are (x, y); prev may be None."""
    if prev is None:
        return new
    return (prev[0] + alpha * (new[0] - prev[0]), prev[1] + alpha * (new[1] - prev[1]))

_last_hand_time = time.time()
_added_since_space = False

def add_letter(ch):
    """Call when a sign letter is confirmed. Letters are appended; spaces are separate."""
    global _added_since_space
    with lock:
        sentence["text"] += ch.upper()
    _added_since_space = True

def note_hand_seen(seen):
    """Call every frame in sign mode. Lowering the hand for 1.5 s adds ONE space."""
    global _last_hand_time, _added_since_space
    now = time.time()
    if seen:
        _last_hand_time = now
    elif _added_since_space and now - _last_hand_time > 1.5:
        with lock:
            if sentence["text"] and not sentence["text"].endswith(" "):
                sentence["text"] += " "
        _added_since_space = False


# ---------- HOOKS: connect your existing code here ----------
_prev = None
_pinching = False

def handle_mouse(frame, hands, smoothing):
    global _prev, _pinching
    found = hand_tracker.find_hands(frame, hands)
    hand_tracker.draw_hands(frame, found)
    if not found:
        _prev = None
        return frame
    want = "right" if hands == "both" else hands
    pointer = next((h for h in found if h[0].lower() == want), found[0])
    clicker = next((h for h in found if h[0].lower() == "left"), None) if hands == "both" else pointer
    sw, sh = pyautogui.size()
    tip = pointer[1][8]                                   # index fingertip
    x = float(np.interp(tip[0], (0.15, 0.85), (0, sw - 1)))
    y = float(np.interp(tip[1], (0.15, 0.85), (0, sh - 1)))
    _prev = smooth(_prev, (x, y), SMOOTH_ALPHA[smoothing])
    cx = max(0, min(sw - 1, int(round(_prev[0]))))
    cy = max(0, min(sh - 1, int(round(_prev[1]))))
    pyautogui.moveTo(cx, cy)

    h, w = frame.shape[:2]
    pt_px = (int(tip[0] * w), int(tip[1] * h))
    cv2.circle(frame, pt_px, 10, (0, 230, 255), 2, cv2.LINE_AA)

    if clicker:                                           # pinch = click
        p = clicker[1]
        size = np.hypot(p[0][0] - p[9][0], p[0][1] - p[9][1]) or 1e-6
        pinch = np.hypot(p[4][0] - p[8][0], p[4][1] - p[8][1]) / size < 0.25
        if pinch and not _pinching:
            pyautogui.click()
        _pinching = pinch
        if pinch:
            c_thumb = (int(p[4][0] * w), int(p[4][1] * h))
            c_idx = (int(p[8][0] * w), int(p[8][1] * h))
            cv2.circle(frame, c_thumb, 12, (60, 255, 100), -1, cv2.LINE_AA)
            cv2.circle(frame, c_idx, 12, (60, 255, 100), -1, cv2.LINE_AA)
            cv2.putText(frame, "CLICK", (24, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (60, 255, 100), 2, cv2.LINE_AA)
    return frame

# Starter vocabulary from gesture suite sign classifier
RULE_SIGNS = {
    (0, 0, 0, 0, 0): "A",
    (1, 1, 1, 1, 1): "B",
    (0, 1, 1, 0, 0): "V",
    (0, 1, 0, 0, 0): "D",
    (1, 0, 0, 0, 1): "Y",
    (1, 1, 0, 0, 1): "I LOVE YOU",
    (0, 0, 0, 0, 1): "I",
    (1, 1, 1, 0, 0): "3",
    (1, 1, 0, 0, 0): "L",
    (0, 1, 1, 1, 0): "W",
}

def get_fingers(pts):
    d4_17 = np.hypot(pts[4][0] - pts[17][0], pts[4][1] - pts[17][1])
    d3_17 = np.hypot(pts[3][0] - pts[17][0], pts[3][1] - pts[17][1])
    d4_5 = np.hypot(pts[4][0] - pts[5][0], pts[4][1] - pts[5][1])
    thumb = 1 if (d4_17 > d3_17 * 1.05 and d4_5 > 0.08) else 0

    fingers = [thumb]
    for tip, pip in [(8, 6), (12, 10), (16, 14), (20, 18)]:
        d_tip_wrist = np.hypot(pts[tip][0] - pts[0][0], pts[tip][1] - pts[0][1])
        d_pip_wrist = np.hypot(pts[pip][0] - pts[0][0], pts[pip][1] - pts[0][1])
        extended = 1 if (pts[tip][1] < pts[pip][1] and d_tip_wrist > d_pip_wrist) else 0
        fingers.append(extended)
    return tuple(fingers)

def classify_hand_sign(pts):
    f = get_fingers(pts)
    return RULE_SIGNS.get(f)

_cand, _count = None, 0

def confirm_letter(letter, need=12):
    """Adds a letter only after it stays the same for `need` frames."""
    global _cand, _count
    if letter != _cand:
        _cand, _count = letter, 0
    _count += 1
    if letter and _count == need:
        add_letter(letter)

def handle_sign(frame, hands):
    found = hand_tracker.find_hands(frame, hands)
    hand_tracker.draw_hands(frame, found)
    note_hand_seen(bool(found))
    letter = None
    if found:
        want = "right" if hands == "both" else hands
        primary = next((h for h in found if h[0].lower() == want), found[0])
        letter = classify_hand_sign(primary[1])
        progress = min(12, _count)
        txt = f"Sign: {letter} ({progress}/12)" if letter else "Sign: ..."
        col = (80, 255, 160) if letter else (160, 180, 200)
        cv2.putText(frame, txt, (24, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.85, col, 2, cv2.LINE_AA)
    confirm_letter(letter)
    return frame

def process_frame(frame, st):
    frame = cv2.flip(frame, 1)
    if st["mode"] == "mouse":
        frame = handle_mouse(frame, st["hands"], st["smoothing"])
    elif st["mode"] == "sign":
        frame = handle_sign(frame, st["hands"])
    elif st["mode"] == "mask" and st["masksOn"]:
        frame = face_masks.apply_masks(frame, st["maskIndex"])      # already done for you
    return frame


# ---------- video stream ----------
def placeholder(msg):
    img = np.zeros((480, 640, 3), np.uint8)
    cv2.putText(img, msg, (30, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
    return img

def frames():
    while True:
        c = get_cap()
        ok, frame = c.read() if (c is not None and c.isOpened()) else (False, None)
        if not ok:
            frame = placeholder("Camera is off" if not camera_on else "Camera not available")
            time.sleep(0.2)
        else:
            with lock:
                st = dict(state)
            try:
                frame = process_frame(frame, st)
            except Exception as e:   # never let one bad frame kill the stream
                print("frame error:", e)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"

@app.route("/video_feed")
def video_feed():
    return Response(frames(), mimetype="multipart/x-mixed-replace; boundary=frame")


# ---------- API used by the UI ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/state", methods=["GET", "POST"])
def api_state():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        with lock:
            if data.get("mode") in ("mouse", "sign", "mask"): state["mode"] = data["mode"]
            if data.get("hands") in ("left", "right", "both"): state["hands"] = data["hands"]
            if data.get("smoothing") in SMOOTH_ALPHA: state["smoothing"] = data["smoothing"]
            if isinstance(data.get("masksOn"), bool): state["masksOn"] = data["masksOn"]
            if isinstance(data.get("maskIndex"), int) and data["maskIndex"] >= 0: state["maskIndex"] = data["maskIndex"]
    with lock:
        return jsonify(state)

@app.route("/api/camera", methods=["GET", "POST"])
def api_camera():
    global camera_on
    if request.method == "POST":
        data = request.get_json(silent=True, force=True) or {}
        if isinstance(data.get("on"), bool):
            camera_on = data["on"]
            if not camera_on:
                release_camera()
    return jsonify({"on": camera_on})

@app.route("/api/sign")
def api_sign():
    with lock:
        return jsonify(sentence)

@app.route("/api/sign/action", methods=["POST"])
def api_sign_action():
    action = (request.get_json(silent=True) or {}).get("action")
    with lock:
        t = sentence["text"]
        if action == "space" and t and not t.endswith(" "): t += " "
        elif action == "backspace": t = t[:-1]
        elif action == "clear": t = ""
        sentence["text"] = t
        return jsonify(sentence)

@app.route("/api/masks")
def api_masks():
    files = face_masks.mask_files()
    return jsonify({"masks": [{"name": os.path.splitext(os.path.basename(f))[0].replace("_", " ").title(),
                               "url": "/masks/" + os.path.basename(f)} for f in files]})

@app.route("/masks/<path:name>")
def mask_file(name):
    return send_from_directory(face_masks.MASK_DIR, name)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
