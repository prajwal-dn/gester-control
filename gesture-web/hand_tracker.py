"""Hand detection that works with old MediaPipe (mp.solutions) and new MediaPipe (Tasks API)."""
import os, time
import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE, "hand_landmarker.task")
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
             "hand_landmarker/float16/1/hand_landmarker.task")
CONNECTIONS = [(0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),(5,9),(9,10),(10,11),(11,12),
               (9,13),(13,14),(14,15),(15,16),(13,17),(17,18),(18,19),(19,20),(0,17)]

_detect = None
_failed = False
_last_ts = 0


def _get_detector():
    global _detect
    if _detect is not None:
        return _detect
    import mediapipe as mp
    if hasattr(mp, "solutions"):
        hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.6,
                                         min_tracking_confidence=0.5)

        def detect(rgb):
            r = hands.process(rgb)
            out = []
            for lm, h in zip(r.multi_hand_landmarks or [], r.multi_handedness or []):
                out.append((h.classification[0].label, [(p.x, p.y) for p in lm.landmark]))
            return out
    else:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        if not os.path.exists(MODEL_PATH):
            import urllib.request
            print("Downloading hand model (one time)...")
            urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        opts = vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO, num_hands=2,
            min_hand_detection_confidence=0.6, min_tracking_confidence=0.5)
        lm = vision.HandLandmarker.create_from_options(opts)

        def detect(rgb):
            global _last_ts
            _last_ts = max(_last_ts + 1, int(time.monotonic() * 1000))
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            r = lm.detect_for_video(img, _last_ts)
            return [(h[0].category_name, [(p.x, p.y) for p in pts])
                    for pts, h in zip(r.hand_landmarks, r.handedness)]
    _detect = detect
    return _detect


def find_hands(frame, which="both"):
    """frame must already be mirrored (selfie view). Returns [(label, [(x, y) x 21])], x/y in 0..1.
    which = 'left' | 'right' | 'both'."""
    global _failed
    if _failed:
        return []
    try:
        hands = _get_detector()(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    except Exception as e:
        _failed = True
        print("Hand tracking disabled:", e)
        print("Fix: pip install -U mediapipe, and download", MODEL_URL, "to", MODEL_PATH)
        return []
    if which != "both":
        hands = [h for h in hands if h[0].lower() == which]
    return hands


def draw_hands(frame, hands, color=(191, 212, 45)):
    h, w = frame.shape[:2]
    for label, pts in hands:
        px = [(int(x * w), int(y * h)) for x, y in pts]
        for a, b in CONNECTIONS:
            cv2.line(frame, px[a], px[b], color, 3, cv2.LINE_AA)
        for p in px:
            cv2.circle(frame, p, 5, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.putText(frame, label, (px[0][0] - 20, px[0][1] + 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)
    return frame
