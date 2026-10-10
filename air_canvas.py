"""Air writing: draw with the index fingertip on a canvas laid over the camera picture.

Index finger only  -> pen down (draws)      Fist -> erase under the hand
Hold fist 1.5 s    -> clear everything      Any other pose -> pen up
"""
import time
import cv2
import numpy as np

COLORS = [
    (255, 255, 255),  # white
    (191, 212, 45),   # teal
    (36, 191, 251),   # amber
    (133, 113, 251),  # rose
    (246, 130, 59),   # blue
    (129, 185, 16),   # green
    (247, 85, 168),   # purple
    (68, 68, 239),    # red
    (0, 0, 0)         # eraser
]
SIZES = {"thin": 4, "medium": 8, "thick": 14}


def fingers_up(pts):
    """[thumb, index, middle, ring, pinky] -> 1 if extended. pts = 21 (x, y) points, 0..1."""
    d = lambda a, b: np.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
    f = [1 if d(4, 17) > d(3, 17) else 0]
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        f.append(1 if pts[tip][1] < pts[pip][1] else 0)
    return f


class AirCanvas:
    def __init__(self):
        self.canvas = None
        self.prev = {}
        self.color = 1
        self.size = "medium"
        self._fist_start = {}
        self._wait_release = {}
        self.last_frame = None

    def _ensure(self, frame):
        h, w = frame.shape[:2]
        if self.canvas is None or self.canvas.shape[:2] != (h, w):
            self.canvas = np.zeros((h, w, 3), np.uint8)
            self.prev = {}
            self._fist_start = {}
            self._wait_release = {}

    def clear(self):
        if self.canvas is not None:
            self.canvas[:] = 0
        self.prev = {}
        self._fist_start = {}
        self._wait_release = {}

    def update(self, frame, found):
        """found = list of (hand_label, pts). Returns dict of hand_label -> pen state."""
        self._ensure(frame)
        self.last_frame = frame.copy()
        
        h, w = frame.shape[:2]
        states = {}
        
        visible_hands = set([h[0] for h in found]) if found else set()
        for hl in list(self.prev.keys()):
            if hl not in visible_hands:
                self.prev[hl] = None
        for hl in list(self._fist_start.keys()):
            if hl not in visible_hands:
                self._fist_start[hl] = None
                self._wait_release[hl] = False

        if not found:
            return states

        for hand_label, pts in found:
            f = fingers_up(pts)
            tip = (int(pts[8][0] * w), int(pts[8][1] * h))
            if sum(f) == 0:                                    # fist = eraser
                self.prev[hand_label] = None
                if self._wait_release.get(hand_label):
                    states[hand_label] = "erasing"
                    continue
                hull = cv2.convexHull(np.array([(int(x * w), int(y * h)) for x, y in pts], np.int32))
                cv2.fillPoly(self.canvas, [hull], (0, 0, 0))
                now = time.time()
                if self._fist_start.get(hand_label) is None:
                    self._fist_start[hand_label] = now
                elif now - self._fist_start[hand_label] > 1.5:             # held long enough: wipe everything
                    self.clear()
                    self._fist_start[hand_label] = None
                    self._wait_release[hand_label] = True
                states[hand_label] = "erasing"
                continue
            
            self._fist_start[hand_label] = None
            self._wait_release[hand_label] = False
            if f[1] == 1 and f[2] == 0 and f[3] == 0 and f[4] == 0:   # only index up = pen down
                if self.prev.get(hand_label) is not None:
                    cv2.line(self.canvas, self.prev[hand_label], tip, COLORS[self.color], SIZES[self.size], cv2.LINE_AA)
                self.prev[hand_label] = tip
                states[hand_label] = "drawing"
            else:
                self.prev[hand_label] = None
                states[hand_label] = "pen up"
                
        return states

    def overlay(self, frame):
        if self.canvas is None:
            return frame
        gray = cv2.cvtColor(self.canvas, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 10, 255, cv2.THRESH_BINARY)
        bg = cv2.bitwise_and(frame, frame, mask=cv2.bitwise_not(mask))
        fg = cv2.bitwise_and(self.canvas, self.canvas, mask=mask)
        return cv2.add(bg, fg)

    def marker(self, frame, found, states):
        """Pen cursor on the fingertip: filled while writing, a ring otherwise."""
        if not found:
            return
        h, w = frame.shape[:2]
        col = COLORS[self.color]
        for hand_label, pts in found:
            state = states.get(hand_label)
            tip = (int(pts[8][0] * w), int(pts[8][1] * h))
            if self.color == 8:  # Eraser marker
                if state == "drawing":
                    cv2.circle(frame, tip, SIZES[self.size] + 3, (255, 255, 255), 2, cv2.LINE_AA)
                    cv2.circle(frame, tip, SIZES[self.size] + 1, (0, 0, 0), -1, cv2.LINE_AA)
                else:
                    cv2.circle(frame, tip, 14, (200, 200, 200), 2, cv2.LINE_AA)
                    cv2.circle(frame, tip, 16, (0, 0, 0), 2, cv2.LINE_AA)
            else:
                if state == "drawing":
                    cv2.circle(frame, tip, SIZES[self.size] + 3, col, -1, cv2.LINE_AA)
                else:
                    cv2.circle(frame, tip, 14, col, 2, cv2.LINE_AA)

    def drawing_png(self):
        """Returns screenshot of the whole screen."""
        if self.last_frame is not None:
            out = self.overlay(self.last_frame)
        else:
            out = np.full((480, 640, 3), 255, np.uint8) if self.canvas is None else np.full(self.canvas.shape, 255, np.uint8)
        ok, buf = cv2.imencode(".png", out)
        return buf.tobytes()
