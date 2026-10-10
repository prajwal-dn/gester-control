"""Face masks: place a transparent PNG on every detected face and keep it tracking."""
import glob, json, math, os, time
import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
MASK_DIR = os.path.join(BASE, "masks")
MODEL_PATH = os.path.join(BASE, "face_landmarker.task")
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/"
             "face_landmarker/float16/1/face_landmarker.task")
_detect = None
_masks = None
_failed = False
_last_ts = 0


def mask_files():
    exts = ("png", "webp", "jpg", "jpeg")
    return sorted(f for e in exts for f in glob.glob(os.path.join(MASK_DIR, f"*.{e}")))


def _load():
    """Load masks as BGRA (images without transparency are kept as they are).
    masks/masks.json (optional) says where the face sits inside each picture:
    {"name": {"cx": 0.5, "cy": 0.4, "fw": 0.6}}  = face centre x/y and face width, as fractions of the picture."""
    global _masks
    if _masks is None:
        meta = {}
        try:
            with open(os.path.join(MASK_DIR, "masks.json")) as fh:
                meta = json.load(fh)
        except Exception:
            pass
        _masks = []
        for f in mask_files():
            m = cv2.imread(f, cv2.IMREAD_UNCHANGED)
            if m is None:
                continue
            if m.ndim == 2:
                m = cv2.cvtColor(m, cv2.COLOR_GRAY2BGRA)
            elif m.shape[2] == 3:
                m = cv2.cvtColor(m, cv2.COLOR_BGR2BGRA)
            d = meta.get(os.path.splitext(os.path.basename(f))[0], {})
            _masks.append({"img": m, "cx": d.get("cx", 0.5), "cy": d.get("cy", 0.5), "fw": d.get("fw", 1.0)})
    return _masks


def _get_detector():
    """Works with old MediaPipe (mp.solutions) and new MediaPipe (Tasks API)."""
    global _detect
    if _detect is not None:
        return _detect
    import mediapipe as mp  # imported lazily so the rest of the app starts without it
    if hasattr(mp, "solutions"):
        fm = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=4, refine_landmarks=True,
            min_detection_confidence=0.5, min_tracking_confidence=0.5)

        def detect(rgb):
            r = fm.process(rgb)
            return [f.landmark for f in (r.multi_face_landmarks or [])]
    else:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        if not os.path.exists(MODEL_PATH):
            import urllib.request
            print("Downloading face model (one time)...")
            urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        opts = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO, num_faces=4)
        lm = vision.FaceLandmarker.create_from_options(opts)

        def detect(rgb):
            global _last_ts
            _last_ts = max(_last_ts + 1, int(time.monotonic() * 1000))
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            return lm.detect_for_video(img, _last_ts).face_landmarks
    _detect = detect
    return _detect


def _overlay(frame, mask, cx, cy, width, angle, anchor=(0.5, 0.5)):
    """Draw the whole picture, scaled to `width`, rotated by `angle`, so that its `anchor`
    point (fractions of the picture) lands on (cx, cy)."""
    h, w = mask.shape[:2]
    scale = width / w
    m = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    mh, mw = m.shape[:2]
    M = cv2.getRotationMatrix2D((mw / 2, mh / 2), -angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(mh * sin + mw * cos), int(mh * cos + mw * sin)
    M[0, 2] += nw / 2 - mw / 2
    M[1, 2] += nh / 2 - mh / 2
    ax, ay = anchor[0] * mw, anchor[1] * mh
    px, py = M[0, 0] * ax + M[0, 1] * ay + M[0, 2], M[1, 0] * ax + M[1, 1] * ay + M[1, 2]
    m = cv2.warpAffine(m, M, (nw, nh), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    x1, y1 = int(round(cx - px)), int(round(cy - py))
    fh, fw = frame.shape[:2]
    a1, b1, a2, b2 = max(x1, 0), max(y1, 0), min(x1 + nw, fw), min(y1 + nh, fh)
    if a1 >= a2 or b1 >= b2:
        return
    m = m[b1 - y1:b2 - y1, a1 - x1:a2 - x1]
    alpha = m[:, :, 3:4] / 255.0
    roi = frame[b1:b2, a1:a2]
    frame[b1:b2, a1:a2] = (alpha * m[:, :, :3] + (1 - alpha) * roi).astype(np.uint8)


def apply_masks(frame, start_index=0):
    """Draw a mask on every face. Face n uses mask (start_index + n). Returns the frame."""
    global _failed
    masks = _load()
    if not masks or _failed:
        return frame
    try:
        faces = _get_detector()(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    except Exception as e:      # missing model, no internet, bad install...
        _failed = True
        print("Face masks disabled:", e)
        print("Fix: pip install -U mediapipe, and download", MODEL_URL, "to", MODEL_PATH)
        return frame
    h, w = frame.shape[:2]
    for n, lm in enumerate(faces):
        p = lambda i: (lm[i].x * w, lm[i].y * h)
        (lx, ly), (rx, ry) = p(33), p(263)      # outer eye corners
        (tx, ty), (bx, by) = p(10), p(152)      # forehead, chin
        angle = math.degrees(math.atan2(ry - ly, rx - lx))
        face_w = math.hypot(rx - lx, ry - ly) * 1.9          # the person's face width in pixels
        mk = masks[(start_index + n) % len(masks)]
        _overlay(frame, mk["img"], (tx + bx) / 2, (ty + by) / 2, face_w / mk["fw"], angle, (mk["cx"], mk["cy"]))
    return frame
