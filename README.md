# Gesture Control: new web UI

Plain HTML/CSS/JS (no framework, no support.js). Works in any browser.

## Run
```
pip install -r requirements.txt
python server.py
```
Open http://localhost:5000

## Files
- `ui/` the new UI (home page + app screen): `index.html`, `styles.css`, `app.js`
- `server.py` serves the UI, streams the camera (`/video_feed`) and exposes a small API
- `face_masks.py` face masks that track every face (put transparent PNGs in `masks/`)

## Connect your existing code (2 hooks in server.py)
1. `handle_mouse(frame, hands, smoothing)` call your mouse-control code. `hands` is left/right/both. Use `smooth()` with `SMOOTH_ALPHA[smoothing]` for a smooth cursor.
2. `handle_sign(frame, hands)` call your sign recogniser. Call `add_letter('A')` when a letter is stable and `note_hand_seen(True/False)` each frame. Lowering the hand for 1.5 s adds one space automatically. The Add space button also works.

## API used by the UI
- `GET /video_feed` MJPEG camera stream
- `POST /api/state` {mode, hands, smoothing, masksOn, maskIndex}
- `GET /api/sign` -> {text}; `POST /api/sign/action` {action: space|backspace|clear}
- `GET /api/masks` -> list of PNGs found in `masks/`

## Face masks
- Masks are the images in `masks/` (PNG, WebP or JPG). Transparent PNGs look best. Included: cat_hat, cat_silly, cat_sunglasses.
- Masks are shown as the full picture (no cut-out). `masks/masks.json` says where the face sits in each picture (centre x/y and face width as fractions). New images without an entry are treated as one big face; add an entry to fine-tune.
- To add more, drop images in `masks/` and restart. They show up in the mask picker automatically.
- Each face on camera gets a mask that follows it (position, size and head tilt). Up to 4 faces.
- New MediaPipe versions need a small face model. It downloads once on first use (needs internet) and is saved as `face_landmarker.task`. If it can't download, get it from the URL printed in the console and put it next to `server.py`.

## Folders
- `design-reference/` the Claude Design mockups (.dc.html). They only open inside Claude Design and are not part of the app.

## Notes
- Only one program can use the webcam. Do not run the old OpenCV window (`main.py`) at the same time as `server.py`.
- Full screen uses the browser Full Screen API (button on the camera, or F11).
