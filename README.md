# Gesture Control Suite

Gesture Control Suite is a modern, web-browser-based intelligent application that translates real-time hand movements into powerful interactions. Driven by Python, Flask, and MediaPipe hand tracking, this suite fully replaces standard peripherals and creates new paradigms for accessibility.

**Key Features:**

* **Virtual Mouse Control:** Seamlessly drive your system cursor purely through hand motion. Perform left/right clicks, dragging, and scrolling organically via gestures. Smooth predictive logic ensures jitter-free pointing.
* **Air Writing Canvas:** Turn empty air into your personal whiteboard. Index finger draws; make a fist to erase specific sections locally; hold the fist for 1.5 seconds to wipe the entire board. Supports dynamic colors, customizable brush thickness, fully independent two-handed simultaneous drawing, and saving composited screenshots directly to your device.
* **Sign Language Recognition:** Decode static shapes (A, B, D, F, I, L, V, W, Y) and dynamic motion strokes (J and Z) natively. An onboard `RandomForestClassifier` system allows anyone to "Teach" the system personalized signs or whole words directly from the UI within a handful of seconds, saving them to your custom dictionary `signs_dataset.json`.
* **Face Masks:** Live dynamic augmented-reality masks utilizing highly optimized FaceMesh pipelines overlaid on the webcam feed.

## Technology Stack

* **Backend Engine:** Flask (Python) with a robust multi-threaded server routing scheme bridging browser interactions to OS controls.
* **Computer Vision:** MediaPipe's lightweight, rapid inference engine for 21-point hand tracking execution, driven by `cv2` (OpenCV).
* **Machine Learning:** `scikit-learn` drives the personalized one-shot "Teach Sign" architecture securely via locally hosted Random Forests.
* **Automation:** `pyautogui` connects python predictions into hard-OS level macro interactions and mouse events.
* **Frontend:** Minimal, crisp Vanilla CSS and JS designed for highly-responsive feedback and beautiful UI/UX that requires zero complex front-end installations.

## Quick Start
1. Ensure your camera is accessible and functional.
2. Clone the repository and navigate clearly into the directory.
3. Install the engine dependencies into your working Python environment:
```bash
pip install -r requirements.txt
```
4. Start the backend local routing daemon:
```bash
python server.py
```
5. Navigate directly to the provided local domain inside any modern browser (default: `http://127.0.0.1:5000`) and grant webcam permissions to dive in!

## Architecture

This application moved from a rigid monolithic Python GUI application into a headless web-driven architecture. 
* **`server.py`:** Main entry orchestrator for parsing web-socket and POST actions.
* **`hand_tracker.py`**: A modularized vision wrap that abstracts old vs new Mediapipe versions effortlessly.
* **`sign_model.py`:** Handles real-time spatial transformations (invariant scale logic) and model predictions for signs.
* **`air_canvas.py`:** Stateful tracking of independent 2D vectors generated from temporal fingertip tracking for multi-hand drawing.
* **`face_masks.py`:** Simple API for mapping 3D augmented meshes over real-world faces.
