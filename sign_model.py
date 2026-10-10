"""Teach-your-own signs: record hand samples, train a small classifier, recognise letters or words.

Flow:  start_recording("A") -> add_sample(...) is called for every camera frame until TARGET samples
       -> train() -> predict(...) returns (label, confidence) for new frames.
Labels can be letters (A..Z) or whole words/phrases (HELLO, THANK YOU).
Works for one hand per sign (use the Left or Right hand setting while teaching).
"""
import json
import os
import re
import threading
import time

import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DATA_FILE = os.path.join(DATA_DIR, "signs_dataset.json")
MODEL_FILE = os.path.join(DATA_DIR, "sign_model.joblib")
MIN_CONFIDENCE = 0.6      # below this the frame is ignored
TARGET = 60               # samples captured per recording
MIN_PER_SIGN = 10         # smallest number of samples a sign needs before it is trained

_lock = threading.Lock()
_samples = {}             # label -> list of [session_id, features]
_model = None
_info = {"trained": False, "accuracy": None, "samples": 0, "classes": [], "message": "Not trained yet."}
rec = {"label": None, "count": 0, "session": 0}


# ---------- features ----------
def features(hand_label, pts):
    """pts = 21 (x, y) points, 0..1. Position and size are removed, so the hand can be anywhere.
    Left hands are mirrored so one model fits both hands. Rotation is kept (P and Q point down)."""
    p = np.array(pts, dtype=float)
    if str(hand_label).lower() == "left":
        p[:, 0] = 1.0 - p[:, 0]
    p = p - p[0]                                           # wrist at the origin
    scale = float(np.hypot(p[9][0], p[9][1])) or 1e-6      # wrist -> middle finger base
    p = p / scale
    tips = p[[4, 8, 12, 16, 20]]
    d_tips = [float(np.hypot(*(tips[i] - tips[j]))) for i in range(5) for j in range(i + 1, 5)]
    d_wrist = np.hypot(tips[:, 0], tips[:, 1]).tolist()
    return np.concatenate([p[1:].ravel(), d_tips, d_wrist]).tolist()


def clean_label(text):
    t = re.sub(r"[^A-Za-z0-9 '\-]", "", str(text or "")).strip().upper()
    return re.sub(r"\s+", " ", t)[:20]


# ---------- recording ----------
def start_recording(label):
    label = clean_label(label)
    if not label:
        return False
    with _lock:
        rec["label"], rec["count"], rec["session"] = label, 0, int(time.time())
    return True


def stop_recording():
    with _lock:
        rec["label"] = None
    _save_dataset()


def add_sample(hand_label, pts):
    """Call once per camera frame while rec['label'] is set."""
    with _lock:
        label = rec["label"]
        if not label:
            return
        _samples.setdefault(label, []).append([rec["session"], features(hand_label, pts)])
        rec["count"] += 1
        done = rec["count"] >= TARGET
        if done:
            rec["label"] = None
    if done:
        _save_dataset()


def delete_label(label):
    label = clean_label(label)
    with _lock:
        _samples.pop(label, None)
    _save_dataset()


# ---------- training ----------
def train():
    """Train on everything recorded. Returns {"ok": bool, "message": str}."""
    global _model
    from sklearn.ensemble import RandomForestClassifier
    import joblib
    with _lock:
        labels = [l for l, v in _samples.items() if len(v) >= MIN_PER_SIGN]
        X = np.array([s[1] for l in labels for s in _samples[l]], dtype=float)
        y = np.array([l for l in labels for _ in _samples[l]])
        g = np.array([s[0] for l in labels for s in _samples[l]])
    if len(labels) < 2:
        return {"ok": False, "message": f"Record at least 2 signs first (each needs {MIN_PER_SIGN}+ samples)."}
    acc = None
    sessions = len(set(g.tolist()))
    if sessions >= 3:      # test on whole recordings the model has not seen, so the score is honest
        from sklearn.model_selection import GroupKFold, cross_val_score
        try:
            acc = float(cross_val_score(RandomForestClassifier(n_estimators=100, random_state=0, n_jobs=-1),
                                        X, y, groups=g, cv=GroupKFold(n_splits=min(5, sessions))).mean())
        except Exception:
            acc = None
    clf = RandomForestClassifier(n_estimators=200, random_state=0, n_jobs=-1).fit(X, y)
    os.makedirs(DATA_DIR, exist_ok=True)
    joblib.dump(clf, MODEL_FILE)
    with _lock:
        _model = clf
        _info.update(trained=True, accuracy=acc, samples=int(len(y)), classes=sorted(labels),
                     message=f"Trained on {len(y)} samples for {len(labels)} signs.")
    return {"ok": True, "message": _info["message"]}


def predict(hand_label, pts):
    """Returns (label or None, confidence)."""
    m = _model
    if m is None:
        return None, 0.0
    proba = m.predict_proba(np.array([features(hand_label, pts)]))[0]
    i = int(proba.argmax())
    return (str(m.classes_[i]), float(proba[i])) if proba[i] >= MIN_CONFIDENCE else (None, float(proba[i]))


def status():
    with _lock:
        return {"labels": {l: len(v) for l, v in sorted(_samples.items())},
                "recording": rec["label"], "count": rec["count"], "target": TARGET,
                "trained": _info["trained"], "accuracy": _info["accuracy"], "samples": _info["samples"],
                "classes": list(_info["classes"]), "message": _info["message"]}


# ---------- storage ----------
def _save_dataset():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with _lock:
            data = {l: v for l, v in _samples.items()}
        with open(DATA_FILE, "w") as fh:
            json.dump(data, fh)
    except Exception as e:
        print("Could not save sign dataset:", e)


def load():
    """Load the saved dataset and model (called once at start-up)."""
    global _model
    try:
        with open(DATA_FILE) as fh:
            data = json.load(fh)
        with _lock:
            _samples.update({l: v for l, v in data.items()})
    except Exception:
        pass
    try:
        import joblib
        m = joblib.load(MODEL_FILE)
        _model = m
        _info.update(trained=True, classes=sorted(str(c) for c in m.classes_),
                     samples=sum(len(v) for v in _samples.values()), message="Loaded saved model.")
    except Exception:
        pass


load()
