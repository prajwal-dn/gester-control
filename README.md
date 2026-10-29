# Gesture Control Suite

Gesture Control Suite is a modern, web-browser-based intelligent application that translates real-time hand movements into powerful interactions. Driven by Python, Flask, and MediaPipe hand tracking, this suite fully replaces standard peripherals and creates new paradigms for accessibility.

**Key Features:**

* **Air Writing Canvas:** Turn empty air into your personal whiteboard. Index finger draws; make a fist to erase specific sections locally; hold the fist for 1.5 seconds to wipe the entire board. Supports dynamic colors, customizable brush thickness, fully independent simultaneous drawing, and saving composited screenshots directly to your device.
* **Sign Language Recognition:** Decode static shapes (A, B, D, F, I, L, V, W, Y) and dynamic motion strokes (J and Z) natively into full sentences with automatic spacing. An onboard machine learning system allows anyone to "Teach" the system personalized signs or whole words directly in the browser within seconds.
* **AR Face Masks:** Live dynamic augmented-reality masks utilizing optimized 3D FaceMesh pipelines overlaid on the webcam feed with natural head tilt, scale, and rotation tracking.

## Technology Stack

* **Computer Vision & ML:** MediaPipe (Hands & FaceMesh) executing real-time landmark inference in the browser via WebAssembly and WebGL.
* **Frontend:** Modern Vanilla CSS and JavaScript designed for instant, high-frame-rate interaction and beautiful UI/UX with zero build step required.
* **Deployment Ready:** Configured for one-click deployment on Netlify.

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
