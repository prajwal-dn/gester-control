/**
 * Gesture Control Suite - Pure Client-side Browser Engine
 * Powered by MediaPipe (Hands & Face Mesh), HTML5 Canvas, and Web APIs.
 * Runs completely in the browser with zero backend dependencies - ready for Netlify!
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const THEMES = [
    { id: 'teal', label: 'Teal', color: '#2DD4BF' },
    { id: 'amber', label: 'Amber', color: '#FBBF24' },
    { id: 'violet', label: 'Violet', color: '#A78BFA' },
    { id: 'rose', label: 'Rose', color: '#FB7185' }
  ];
  const MODES = ['air', 'sign', 'mask'];
  const PEN_COLORS = [
    '#FFFFFF', '#2DD4BF', '#FBBF24', '#FB7185',
    '#3B82F6', '#10B981', '#A855F7', '#EF4444',
    '#000000' // Eraser
  ];
  const SIZES = { thin: 4, medium: 8, thick: 14 };

  // Starter vocabulary for sign classifier
  const RULE_SIGNS = {
    '0,0,0,0,0': 'A',
    '1,1,1,1,1': 'B',
    '0,1,1,1,1': 'B',
    '0,1,1,0,0': 'V',
    '0,1,0,0,0': 'D',
    '1,0,0,0,1': 'Y',
    '1,1,0,0,1': 'I LOVE YOU',
    '0,0,0,0,1': 'I',
    '1,1,1,0,0': '3',
    '1,1,0,0,0': 'L',
    '0,1,1,1,0': 'W',
    '0,0,1,1,1': 'F'
  };

  // State initialization
  const defaults = {
    mode: 'air',
    hands: 'right',
    masksOn: true,
    maskIndex: 0,
    theme: 'teal',
    help: true,
    airColor: 1,
    airSize: 'medium'
  };

  function loadState() {
    try { return JSON.parse(localStorage.getItem('gc-state') || '{}'); } catch { return {}; }
  }
  function saveState() {
    try { localStorage.setItem('gc-state', JSON.stringify(state)); } catch {}
  }

  const state = Object.assign({}, defaults, loadState());
  let sentenceText = '';
  let camOn = false;
  let videoStream = null;
  let animFrameId = null;

  // Canvas elements
  const videoEl = $('#webcam');
  const stageCanvas = $('#stageCanvas');
  const ctx = stageCanvas.getContext('2d');

  // Offscreen Air Canvas for persistent drawings
  const airCanvas = document.createElement('canvas');
  const airCtx = airCanvas.getContext('2d');
  airCanvas.width = 1280;
  airCanvas.height = 720;

  // MediaPipe Instances
  let mpHands = null;
  let mpFaceMesh = null;
  let isProcessingFrame = false;

  // Gesture Tracking States
  let prevAirTips = {};
  let fistStartTimes = {};
  let fistWaitRelease = {};

  // Sign Mode States
  let signCandidate = null;
  let signCandidateCount = 0;
  let lastHandSeenTime = Date.now();
  let addedSinceSpace = false;
  let zStrokeHistory = [];
  let jStrokeHistory = [];

  // Face Masks List & Images
  let masksData = [];
  const loadedMaskImages = {};

  // ---------- Routing ----------
  function route() {
    const h = location.hash || '#home';
    if (h.startsWith('#app') || h === '#guide') {
      const m = h.split('/')[1];
      if (MODES.includes(m)) state.mode = m;
      if (h === '#guide') state.mode = 'sign';
      show('app');
      if (!camOn) setCamera(true);
      render();
      if (h === '#guide') openGuide();
    } else {
      show('home');
      setCamera(false);
      const el = h.length > 1 && h !== '#home' ? document.getElementById(h.slice(1)) : null;
      if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
    }
  }

  function show(id) {
    $('#home').classList.toggle('hidden', id !== 'home');
    $('#app').classList.toggle('hidden', id !== 'app');
  }
  window.addEventListener('hashchange', route);

  // ---------- Camera & Video Stream ----------
  async function setCamera(on) {
    camOn = on;
    if (on) {
      $('#noFeed').hidden = true;
      $('#noFeedText').textContent = 'Requesting camera access...';
      try {
        if (!videoStream) {
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              facingMode: 'user'
            },
            audio: false
          });
          videoEl.srcObject = videoStream;
          await videoEl.play();
        }

        // Match canvas dimensions to webcam feed
        stageCanvas.width = videoEl.videoWidth || 1280;
        stageCanvas.height = videoEl.videoHeight || 720;
        if (airCanvas.width !== stageCanvas.width || airCanvas.height !== stageCanvas.height) {
          airCanvas.width = stageCanvas.width;
          airCanvas.height = stageCanvas.height;
        }

        stageCanvas.hidden = false;
        $('#noFeed').hidden = true;

        // Initialize MediaPipe models if not ready
        initMediaPipe();
        startDetectionLoop();
      } catch (err) {
        console.error('Camera access error:', err);
        camOn = false;
        stageCanvas.hidden = true;
        $('#noFeed').hidden = false;
        $('#noFeedText').textContent = 'Camera permission denied or camera unavailable. Please grant webcam access to use Gesture Control.';
      }
    } else {
      stopDetectionLoop();
      if (videoStream) {
        videoStream.getTracks().forEach((t) => t.stop());
        videoStream = null;
      }
      videoEl.srcObject = null;
      stageCanvas.hidden = true;
      $('#noFeed').hidden = false;
      $('#noFeedText').textContent = 'Camera is off. Click "Turn camera on" to start.';
    }
    renderCamera();
  }

  function renderCamera() {
    $('#camBtn').textContent = camOn ? 'Turn camera off' : 'Turn camera on';
    $('#camBtn').setAttribute('aria-pressed', String(camOn));
    $('#camBtn').classList.toggle('primary', !camOn);
    $('#camBtn').classList.toggle('ghost', camOn);
    $('#barCam').textContent = camOn ? 'Camera off' : 'Camera on';
    $('#barCam').classList.toggle('off', !camOn);
    $('#status').classList.toggle('off', !camOn);
    const handsLabel = state.hands === 'both' ? 'Both hands' : state.hands === 'left' ? 'Left hand' : 'Right hand';
    $('#statusText').textContent = camOn ? 'Camera on · ' + (state.mode === 'mask' ? (state.masksOn ? 'Masks on' : 'Masks off') : handsLabel) : 'Camera off';
  }

  // ---------- MediaPipe Setup ----------
  function initMediaPipe() {
    if (!mpHands && window.Hands) {
      mpHands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      mpHands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      mpHands.onResults(onHandResults);
    }

    if (!mpFaceMesh && window.FaceMesh) {
      mpFaceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      mpFaceMesh.setOptions({
        maxNumFaces: 4,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      mpFaceMesh.onResults(onFaceResults);
    }
  }

  function startDetectionLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    async function loop() {
      if (!camOn || !videoEl || videoEl.readyState < 2) {
        animFrameId = requestAnimationFrame(loop);
        return;
      }

      if (!isProcessingFrame) {
        isProcessingFrame = true;
        try {
          if (state.mode === 'mask' && state.masksOn && mpFaceMesh) {
            await mpFaceMesh.send({ image: videoEl });
          } else if (mpHands) {
            await mpHands.send({ image: videoEl });
          } else {
            drawMirroredVideo();
          }
        } catch (e) {
          console.warn('Frame processing glitch:', e);
        } finally {
          isProcessingFrame = false;
        }
      }

      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function stopDetectionLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // Draw base mirrored video frame onto canvas
  function drawMirroredVideo() {
    const w = stageCanvas.width;
    const h = stageCanvas.height;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, w, h);
    ctx.restore();
  }

  // ---------- Hand Math & Gestures ----------
  function getFingers(pts) {
    const dist = (a, b) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);

    const d4_17 = dist(4, 17);
    const d3_17 = dist(3, 17);
    const d4_5 = dist(4, 5);
    const thumb = d4_17 > d3_17 * 1.05 && d4_5 > 0.08 ? 1 : 0;

    const fingers = [thumb];
    const tips = [[8, 6], [12, 10], [16, 14], [20, 18]];
    for (const [tip, pip] of tips) {
      const dTipWrist = dist(tip, 0);
      const dPipWrist = dist(pip, 0);
      const extended = pts[tip].y < pts[pip].y && dTipWrist > dPipWrist ? 1 : 0;
      fingers.push(extended);
    }
    return fingers;
  }

  // Convert raw landmarks into mirrored canvas coordinates
  function getCanvasPoints(landmarks) {
    const w = stageCanvas.width;
    const h = stageCanvas.height;
    return landmarks.map((pt) => ({
      x: (1.0 - pt.x) * w,
      y: pt.y * h,
      z: pt.z,
      rawX: pt.x,
      rawY: pt.y
    }));
  }

  // Draw skeleton connections
  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17]
  ];

  function drawHandSkeleton(pts, color = 'rgba(45, 212, 191, 0.75)') {
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [i, j] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[j].x, pts[j].y);
      ctx.stroke();
    }

    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, i === 8 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#FFFFFF' : color;
      ctx.fill();
    }
  }

  // ---------- Hand Results Handler ----------
  function onHandResults(results) {
    drawMirroredVideo();

    const foundHands = [];

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const rawLm = results.multiHandLandmarks[i];
        const pts = getCanvasPoints(rawLm);

        let rawLabel = results.multiHandedness && results.multiHandedness[i] ? results.multiHandedness[i].label : (i === 0 ? 'Right' : 'Left');
        let handLabel = rawLabel === 'Left' ? 'right' : 'left';

        if (state.hands !== 'both' && handLabel !== state.hands) {
          continue;
        }

        foundHands.push({ label: handLabel, pts, rawLm, fingers: getFingers(rawLm) });
      }
    }

    if (state.mode === 'air') {
      handleAirMode(foundHands);
    } else if (state.mode === 'sign') {
      handleSignMode(foundHands);
    }
  }

  // ---------- Mode 1: Air Writing (Air Canvas) ----------
  function handleAirMode(hands) {
    const w = stageCanvas.width;
    const h = stageCanvas.height;

    const visibleLabels = new Set(hands.map((h) => h.label));
    for (const hl of Object.keys(prevAirTips)) {
      if (!visibleLabels.has(hl)) prevAirTips[hl] = null;
    }
    for (const hl of Object.keys(fistStartTimes)) {
      if (!visibleLabels.has(hl)) {
        delete fistStartTimes[hl];
        delete fistWaitRelease[hl];
      }
    }

    for (const hand of hands) {
      const f = hand.fingers;
      const tip = hand.pts[8];
      const sumFingers = f.reduce((a, b) => a + b, 0);

      // 1. Fist = Eraser under the hand
      if (sumFingers === 0) {
        prevAirTips[hand.label] = null;
        if (!fistWaitRelease[hand.label]) {
          const now = Date.now();
          if (!fistStartTimes[hand.label]) fistStartTimes[hand.label] = now;
          const elapsed = (now - fistStartTimes[hand.label]) / 1000;

          // Local erase on air canvas
          airCtx.save();
          airCtx.globalCompositeOperation = 'destination-out';
          airCtx.beginPath();
          airCtx.arc(tip.x, tip.y, 50, 0, Math.PI * 2);
          airCtx.fill();
          airCtx.restore();

          // Visual fist eraser on screen
          ctx.save();
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 50, 0, Math.PI * 2);
          ctx.strokeStyle = '#FB7185';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 6]);
          ctx.stroke();

          // Wipe countdown indicator if held
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 58, -Math.PI / 2, -Math.PI / 2 + (elapsed / 1.5) * Math.PI * 2);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.restore();

          if (elapsed >= 1.5) {
            clearAirCanvas();
            fistWaitRelease[hand.label] = true;
          }
        }
        continue;
      }

      delete fistStartTimes[hand.label];
      delete fistWaitRelease[hand.label];

      // 2. Only index extended = Pen Down
      const isDrawing = f[1] === 1 && f[2] === 0 && f[3] === 0 && f[4] === 0;

      if (isDrawing) {
        const brushSize = SIZES[state.airSize] || 8;
        const brushColor = state.airColor === 8 ? 'eraser' : PEN_COLORS[state.airColor] || '#2DD4BF';

        if (prevAirTips[hand.label]) {
          airCtx.save();
          if (brushColor === 'eraser') {
            airCtx.globalCompositeOperation = 'destination-out';
            airCtx.beginPath();
            airCtx.arc(tip.x, tip.y, brushSize * 2.5, 0, Math.PI * 2);
            airCtx.fill();
          } else {
            airCtx.globalCompositeOperation = 'source-over';
            airCtx.strokeStyle = brushColor;
            airCtx.lineWidth = brushSize;
            airCtx.lineCap = 'round';
            airCtx.lineJoin = 'round';
            airCtx.beginPath();
            airCtx.moveTo(prevAirTips[hand.label].x, prevAirTips[hand.label].y);
            airCtx.lineTo(tip.x, tip.y);
            airCtx.stroke();
          }
          airCtx.restore();
        }
        prevAirTips[hand.label] = { x: tip.x, y: tip.y };

        // Draw active tip indicator
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, brushSize + 4, 0, Math.PI * 2);
        ctx.fillStyle = brushColor === 'eraser' ? '#FFFFFF' : brushColor;
        ctx.fill();
      } else {
        prevAirTips[hand.label] = null;
        // Pen up: ring indicator
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = PEN_COLORS[state.airColor] || '#2DD4BF';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Overlay air drawings onto stage
    ctx.drawImage(airCanvas, 0, 0, w, h);
  }

  function clearAirCanvas() {
    airCtx.clearRect(0, 0, airCanvas.width, airCanvas.height);
    prevAirTips = {};
    fistStartTimes = {};
  }

  function saveAirPicture() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = stageCanvas.width;
    exportCanvas.height = stageCanvas.height;
    const eCtx = exportCanvas.getContext('2d');

    // Draw mirrored video
    eCtx.save();
    eCtx.translate(exportCanvas.width, 0);
    eCtx.scale(-1, 1);
    eCtx.drawImage(videoEl, 0, 0, exportCanvas.width, exportCanvas.height);
    eCtx.restore();

    // Overlay drawing
    eCtx.drawImage(airCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

    // Trigger download
    const link = document.createElement('a');
    link.download = 'air-writing.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }

  // ---------- Mode 2: Sign Language Recognition & Sentence Builder ----------
  function handleSignMode(hands) {
    const w = stageCanvas.width;
    const h = stageCanvas.height;

    const seen = hands && hands.length > 0;
    const now = Date.now();
    if (seen) {
      lastHandSeenTime = now;
    } else if (addedSinceSpace && now - lastHandSeenTime > 1500) {
      if (sentenceText && !sentenceText.endsWith(' ')) {
        sentenceText += ' ';
        renderSentence();
      }
      addedSinceSpace = false;
    }

    if (!seen) return;

    // Draw skeletons
    hands.forEach((h) => drawHandSkeleton(h.pts, 'rgba(45, 212, 191, 0.7)'));

    const primaryHand = hands[0];
    const pts = primaryHand.pts;
    const rawLm = primaryHand.rawLm;

    const feat = extractHandFeatures(primaryHand.label, rawLm);

    if (teachRecording.label) {
      addTeachSample(primaryHand.label, feat);
    }

    const dynamicSign = detectDynamicSigns(primaryHand, w, h);
    let detected = dynamicSign || predictTaughtSign(feat) || classifyRuleSign(primaryHand.fingers);

    if (detected) {
      if (detected === signCandidate) {
        signCandidateCount++;
        if (signCandidateCount === 12) {
          appendLetter(detected);
        }
      } else {
        signCandidate = detected;
        signCandidateCount = 1;
      }

      ctx.save();
      const badgeX = pts[8].x;
      const badgeY = Math.max(40, pts[8].y - 40);
      ctx.fillStyle = 'rgba(18, 24, 41, 0.9)';
      ctx.strokeStyle = '#2DD4BF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(badgeX - 40, badgeY - 26, 80, 44, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 20px Sora, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(detected, badgeX, badgeY - 4);

      ctx.beginPath();
      ctx.arc(badgeX + 28, badgeY - 4, 8, -Math.PI / 2, -Math.PI / 2 + (Math.min(signCandidateCount, 12) / 12) * Math.PI * 2);
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    } else {
      signCandidate = null;
      signCandidateCount = 0;
    }
  }

  function classifyRuleSign(fingers) {
    const key = fingers.join(',');
    return RULE_SIGNS[key] || null;
  }

  function detectDynamicSigns(hand, w, h) {
    const f = hand.fingers;
    const pts = hand.pts;
    let letter = null;

    // Z Pattern: index finger only
    if (f[1] === 1 && f[2] === 0 && f[3] === 0 && f[4] === 0) {
      zStrokeHistory.push({ x: pts[8].x, y: pts[8].y });
      if (zStrokeHistory.length > 30) zStrokeHistory.shift();
    } else {
      zStrokeHistory = [];
    }

    // J Pattern: pinky finger only
    if (f[4] === 1 && f[1] === 0 && f[2] === 0 && f[3] === 0) {
      jStrokeHistory.push({ x: pts[20].x, y: pts[20].y });
      if (jStrokeHistory.length > 30) jStrokeHistory.shift();
    } else {
      jStrokeHistory = [];
    }

    // Check Z (Right -> Down-Left -> Right)
    if (zStrokeHistory.length >= 20) {
      const n = zStrokeHistory.length;
      const s1 = zStrokeHistory.slice(0, Math.floor(n / 3));
      const s2 = zStrokeHistory.slice(Math.floor(n / 3), Math.floor((2 * n) / 3));
      const s3 = zStrokeHistory.slice(Math.floor((2 * n) / 3));
      const dx1 = s1[s1.length - 1].x - s1[0].x;
      const dy1 = s1[s1.length - 1].y - s1[0].y;
      const dx2 = s2[s2.length - 1].x - s2[0].x;
      const dy2 = s2[s2.length - 1].y - s2[0].y;
      const dx3 = s3[s3.length - 1].x - s3[0].x;
      const dy3 = s3[s3.length - 1].y - s3[0].y;
      const t = 30;
      if (dx1 > t && Math.abs(dy1) < t * 1.5 && dx2 < -t * 0.6 && dy2 > t && dx3 > t && Math.abs(dy3) < t * 1.5) {
        letter = 'Z';
        zStrokeHistory = [];
      }
    }

    // Check J (Down -> curve Up)
    if (jStrokeHistory.length >= 15) {
      const nj = jStrokeHistory.length;
      const s1 = jStrokeHistory.slice(0, Math.floor(nj / 2));
      const s2 = jStrokeHistory.slice(Math.floor(nj / 2));
      const dx1 = s1[s1.length - 1].x - s1[0].x;
      const dy1 = s1[s1.length - 1].y - s1[0].y;
      const dx2 = s2[s2.length - 1].x - s2[0].x;
      const dy2 = s2[s2.length - 1].y - s2[0].y;
      const t = 25;
      if (dy1 > t && Math.abs(dx1) < t && dy2 < 0 && Math.abs(dx2) > t) {
        letter = 'J';
        jStrokeHistory = [];
      }
    }

    // Draw trails
    if (zStrokeHistory.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zStrokeHistory[0].x, zStrokeHistory[0].y);
      zStrokeHistory.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
    if (jStrokeHistory.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(jStrokeHistory[0].x, jStrokeHistory[0].y);
      jStrokeHistory.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }

    return letter;
  }

  function appendLetter(ch) {
    if (ch.length > 1) {
      if (sentenceText && !sentenceText.endsWith(' ')) sentenceText += ' ';
      sentenceText += ch + ' ';
    } else {
      sentenceText += ch.toUpperCase();
    }
    addedSinceSpace = ch.length === 1;
    renderSentence();
  }

  function signAction(action) {
    if (action === 'space') {
      if (sentenceText && !sentenceText.endsWith(' ')) sentenceText += ' ';
    } else if (action === 'backspace') {
      sentenceText = sentenceText.slice(0, -1);
    } else if (action === 'clear') {
      sentenceText = '';
    }
    renderSentence();
  }

  function renderSentence() {
    const words = sentenceText.split(' ').filter(Boolean);
    const box = $('#sentence');
    box.textContent = '';
    words.forEach((w) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      box.appendChild(s);
    });
    const c = document.createElement('span');
    c.className = 'caret';
    box.appendChild(c);
    $('#wordCount').textContent = words.length + (words.length === 1 ? ' word' : ' words');
  }

  // ---------- Mode 3: AR Face Masks ----------
  function preloadMasks() {
    fetch('masks/masks.json')
      .then((r) => r.json())
      .then((meta) => {
        const filenames = [
          { name: 'Cat Sunglasses', file: 'cat_sunglasses.png', id: 'cat_sunglasses' },
          { name: 'Cat Silly', file: 'cat_silly.png', id: 'cat_silly' },
          { name: 'Cat Hat', file: 'cat_hat.png', id: 'cat_hat' }
        ];

        masksData = filenames.map((m) => {
          const cfg = meta[m.id] || { cx: 0.5, cy: 0.5, fw: 0.65 };
          const img = new Image();
          img.src = 'masks/' + m.file;
          loadedMaskImages[m.id] = img;
          return {
            name: m.name,
            id: m.id,
            url: 'masks/' + m.file,
            cx: cfg.cx,
            cy: cfg.cy,
            fw: cfg.fw
          };
        });

        renderMasks();
      })
      .catch((err) => {
        console.warn('Masks load info:', err);
        renderMasks();
      });
  }

  function onFaceResults(results) {
    drawMirroredVideo();

    if (!state.masksOn || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      return;
    }

    const curMask = masksData[state.maskIndex] || masksData[0];
    if (!curMask) return;
    const maskImg = loadedMaskImages[curMask.id];
    if (!maskImg || !maskImg.complete) return;

    const w = stageCanvas.width;
    const h = stageCanvas.height;

    for (const faceLm of results.multiFaceLandmarks) {
      const centerLm = faceLm[168] || faceLm[6];
      const rightLm = faceLm[234];
      const leftLm = faceLm[454];

      const cx = (1.0 - centerLm.x) * w;
      const cy = centerLm.y * h;
      const rx = (1.0 - rightLm.x) * w;
      const ry = rightLm.y * h;
      const lx = (1.0 - leftLm.x) * w;
      const ly = leftLm.y * h;

      const dx = rx - lx;
      const dy = ry - ly;
      const angle = Math.atan2(dy, dx);
      const faceWidth = Math.hypot(dx, dy);

      const maskW = (faceWidth / curMask.fw) * 1.5;
      const maskH = maskW * (maskImg.naturalHeight / (maskImg.naturalWidth || 1));

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.drawImage(
        maskImg,
        -curMask.cx * maskW,
        -curMask.cy * maskH,
        maskW,
        maskH
      );
      ctx.restore();
    }
  }

  function renderMasks() {
    const grid = $('#maskGrid');
    grid.textContent = '';
    const list = masksData.length ? masksData : [
      { name: 'Cat Sunglasses', url: 'masks/cat_sunglasses.png' },
      { name: 'Cat Silly', url: 'masks/cat_silly.png' },
      { name: 'Cat Hat', url: 'masks/cat_hat.png' }
    ];

    list.forEach((m, i) => {
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', String(i === state.maskIndex));
      if (m.url) {
        const im = document.createElement('img');
        im.src = m.url;
        im.alt = m.name;
        im.style.width = '64px';
        im.style.height = '64px';
        im.style.objectFit = 'contain';
        b.appendChild(im);
      }
      const l = document.createElement('span');
      l.textContent = m.name;
      b.appendChild(l);
      b.addEventListener('click', () => {
        state.maskIndex = i;
        state.masksOn = true;
        render();
        saveState();
      });
      grid.appendChild(b);
    });
  }

  // ---------- Machine Learning / Teach Signs (In-Browser) ----------
  let teachRecording = { label: null, count: 0, target: 50 };
  let dataset = loadTaughtDataset();

  function loadTaughtDataset() {
    try { return JSON.parse(localStorage.getItem('gc-taught-signs') || '{}'); } catch { return {}; }
  }
  function saveTaughtDataset() {
    try { localStorage.setItem('gc-taught-signs', JSON.stringify(dataset)); } catch {}
  }

  function extractHandFeatures(handLabel, rawLm) {
    const pts = rawLm.map((p) => [handLabel === 'left' ? 1.0 - p.x : p.x, p.y]);
    const origin = pts[0];
    const centered = pts.map((p) => [p[0] - origin[0], p[1] - origin[1]]);
    const scale = Math.hypot(centered[9][0], centered[9][1]) || 1e-6;
    const norm = centered.map((p) => [p[0] / scale, p[1] / scale]);

    const feat = [];
    for (let i = 1; i < norm.length; i++) {
      feat.push(norm[i][0], norm[i][1]);
    }
    const tips = [4, 8, 12, 16, 20];
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        feat.push(Math.hypot(norm[tips[i]][0] - norm[tips[j]][0], norm[tips[i]][1] - norm[tips[j]][1]));
      }
    }
    for (const t of tips) {
      feat.push(Math.hypot(norm[t][0], norm[t][1]));
    }
    return feat;
  }

  function addTeachSample(handLabel, feat) {
    if (!teachRecording.label) return;
    const l = teachRecording.label;
    if (!dataset[l]) dataset[l] = [];
    dataset[l].push(feat);
    teachRecording.count++;

    $('#teachBar').style.width = Math.round((teachRecording.count / teachRecording.target) * 100) + '%';
    $('#teachMsg').textContent = `Recording ${l}: ${teachRecording.count} of ${teachRecording.target}. Move hand slightly...`;

    if (teachRecording.count >= teachRecording.target) {
      teachRecording.label = null;
      saveTaughtDataset();
      $('#teachBarWrap').hidden = true;
      $('#teachRecord').disabled = false;
      $('#teachStop').hidden = true;
      $('#teachMsg').textContent = `Finished recording samples for ${l}! Click Train to activate.`;
      renderTeachUI();
    }
  }

  function predictTaughtSign(feat) {
    const labels = Object.keys(dataset);
    if (!labels.length) return null;

    let bestLabel = null;
    let minDistance = Infinity;

    for (const l of labels) {
      const samples = dataset[l];
      for (const s of samples) {
        let d = 0;
        for (let i = 0; i < feat.length; i++) {
          const diff = feat[i] - s[i];
          d += diff * diff;
        }
        if (d < minDistance) {
          minDistance = d;
          bestLabel = l;
        }
      }
    }

    return minDistance < 1.2 ? bestLabel : null;
  }

  function renderTeachUI() {
    const box = $('#teachChips');
    box.textContent = '';
    const labels = Object.keys(dataset);

    if (!labels.length) {
      const e = document.createElement('span');
      e.className = 'muted';
      e.textContent = 'Nothing yet. Record your first sign above.';
      box.appendChild(e);
    }

    labels.forEach((l) => {
      const chip = document.createElement('span');
      chip.className = 'tchip';
      chip.textContent = l + ' ';
      const n = document.createElement('small');
      n.textContent = dataset[l].length + ' samples';
      chip.appendChild(n);

      const x = document.createElement('button');
      x.textContent = '×';
      x.setAttribute('aria-label', 'Delete ' + l);
      x.addEventListener('click', () => {
        delete dataset[l];
        saveTaughtDataset();
        renderTeachUI();
      });
      chip.appendChild(x);
      box.appendChild(chip);
    });

    const totalSamples = labels.reduce((acc, l) => acc + dataset[l].length, 0);
    $('#teachResult').textContent = labels.length
      ? `Ready with ${labels.length} custom sign(s) and ${totalSamples} total samples.`
      : 'No custom signs recorded.';
  }

  function wireTeachModal() {
    $('#teachLetters').append(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => {
        const o = document.createElement('option');
        o.value = ch;
        return o;
      })
    );
    $('#teachBtn').addEventListener('click', () => {
      renderTeachUI();
      $('#teach').showModal();
    });
    $('#teachClose').addEventListener('click', () => {
      teachRecording.label = null;
      $('#teach').close();
    });
    $('#teachRecord').addEventListener('click', () => {
      const label = ($('#teachLabel').value || '').trim().toUpperCase();
      if (!label) {
        $('#teachMsg').textContent = 'Please type a letter or word first.';
        return;
      }
      teachRecording = { label, count: 0, target: 50 };
      $('#teachBarWrap').hidden = false;
      $('#teachBar').style.width = '0%';
      $('#teachRecord').disabled = true;
      $('#teachStop').hidden = false;
      $('#teachMsg').textContent = `Hold sign for "${label}" in camera view...`;
    });
    $('#teachStop').addEventListener('click', () => {
      teachRecording.label = null;
      $('#teachBarWrap').hidden = true;
      $('#teachRecord').disabled = false;
      $('#teachStop').hidden = true;
      $('#teachMsg').textContent = 'Recording stopped.';
    });
    $('#teachTrain').addEventListener('click', () => {
      const b = $('#teachTrain');
      b.disabled = true;
      $('#teachResult').textContent = 'Calibrating model...';
      setTimeout(() => {
        b.disabled = false;
        $('#teachResult').textContent = 'Classifier ready! Custom signs will now be recognized.';
      }, 500);
    });
  }

  // ---------- Sign Guide Modal ----------
  let guideSigns = [];
  function wireGuideModal() {
    fetch('signs.json')
      .then((r) => r.json())
      .then((data) => {
        guideSigns = data;
        renderGuideSigns('');
      })
      .catch(() => renderGuideSigns(''));

    $('#guideBtn').addEventListener('click', openGuide);
    $('#guideBtn2').addEventListener('click', openGuide);
    $('#guideClose').addEventListener('click', closeGuide);
    $('#guide').addEventListener('click', (e) => {
      if (e.target === $('#guide')) closeGuide();
    });
    $('#guideSearch').addEventListener('input', (e) => renderGuideSigns(e.target.value));

    $$('.guide-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        $$('.guide-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('#tabLetters').hidden = b.dataset.tab !== 'letters';
        $('#tabControls').hidden = b.dataset.tab !== 'controls';
        $('#tabTips').hidden = b.dataset.tab !== 'tips';
      })
    );
  }

  function openGuide() {
    const d = $('#guide');
    if (d && !d.open) d.showModal();
  }
  function closeGuide() {
    const d = $('#guide');
    if (d && d.open) d.close();
    if (location.hash === '#guide') history.replaceState(null, '', '#app/sign');
  }

  function renderGuideSigns(filter) {
    const grid = $('#signGrid');
    grid.textContent = '';
    const q = (filter || '').trim().toLowerCase();
    const list = guideSigns.filter((s) => !q || s.letter.toLowerCase().includes(q) || s.how.toLowerCase().includes(q));

    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No matching signs found.';
      grid.appendChild(e);
      return;
    }

    list.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'sign';
      const l = document.createElement('div');
      l.className = 'sign-letter';
      l.textContent = s.letter;
      const p = document.createElement('p');
      p.textContent = s.how;
      card.append(l, p);
      if (s.moves) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'Moves';
        card.appendChild(b);
      }
      grid.appendChild(card);
    });
  }

  // ---------- General UI Rendering & Wiring ----------
  function render() {
    document.body.dataset.theme = state.theme;
    $$('#swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === state.theme)));
    $$('.modes [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $$('.stage-bar [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    $$('#handSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hands === state.hands)));

    $('#boxHands').classList.toggle('hidden', state.mode === 'mask');
    $('#boxSign').classList.toggle('hidden', state.mode !== 'sign');
    $('#boxAir').classList.toggle('hidden', state.mode !== 'air');
    $('#boxMask').classList.toggle('hidden', state.mode !== 'mask');

    $$('#penColors button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === state.airColor)));
    const eraserBtn = $('#eraserBtn');
    if (eraserBtn) {
      eraserBtn.setAttribute('aria-pressed', String(state.airColor === 8));
      eraserBtn.classList.toggle('primary', state.airColor === 8);
      eraserBtn.classList.toggle('ghost', state.airColor !== 8);
    }
    $$('#sizeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === state.airSize)));
    $('#barSpace').hidden = state.mode !== 'sign';

    renderCamera();
    renderHelp();
    renderSentence();

    const sw = $('#maskSwitch');
    sw.setAttribute('aria-checked', String(state.masksOn));
    $('#maskState').textContent = state.masksOn ? 'On: masks are shown' : 'Off: no masks shown';
    $('#helpBtn').setAttribute('aria-pressed', String(state.help));
    $('#help').classList.toggle('hidden', !state.help);
  }

  function renderHelp() {
    const sets = {
      air: [
        'Air writing: how to use',
        [
          ['Point to write', 'Raise only your index finger. Move it to draw smooth strokes.'],
          ['Fist to erase', 'Make a fist to erase locally. Hold for 1.5s to clear all.'],
          ['Open hand to pause', 'Open your hand to move your finger without drawing.']
        ]
      ],
      sign: [
        'Sign language: how to use',
        [
          ['Show a letter', 'Hold hand steady in front of the camera.'],
          ['Watch stability ring', 'Letter is added once the circular indicator completes.'],
          ['Add space', 'Lower your hand for 1.5 seconds, or press the Add Space button.']
        ]
      ],
      mask: [
        'Face masks: how to use',
        [
          ['Turn masks on', 'Ensure the switch is on. Detected faces get dynamic 3D AR masks.'],
          ['Pick a mask', 'Tap any mask in the grid to change style in real time.'],
          ['Move freely', 'Masks scale and rotate with your head movement.']
        ]
      ]
    };

    const [title, steps] = sets[state.mode] || sets.air;
    $('#help').innerHTML =
      `<h3>${title}</h3>` +
      steps.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('');
  }

  function wireControls() {
    // Theme swatches
    $('#swatches').append(
      ...THEMES.map((t) => {
        const b = document.createElement('button');
        b.dataset.theme = t.id;
        b.setAttribute('aria-label', t.label + ' accent');
        b.innerHTML = `<span style="background:${t.color}"></span>`;
        b.addEventListener('click', () => {
          state.theme = t.id;
          render();
          saveState();
        });
        return b;
      })
    );

    // Modes
    $$('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        render();
        saveState();
      })
    );

    // Hands
    $$('#handSeg button').forEach((b) =>
      b.addEventListener('click', () => {
        state.hands = b.dataset.hands;
        render();
        saveState();
      })
    );

    // Mask Switch
    $('#maskSwitch').addEventListener('click', () => {
      state.masksOn = !state.masksOn;
      render();
      saveState();
    });

    // Help
    $('#helpBtn').addEventListener('click', () => {
      state.help = !state.help;
      render();
      saveState();
    });

    // Sign buttons
    $('#spaceBtn').addEventListener('click', () => signAction('space'));
    $('#barSpace').addEventListener('click', () => signAction('space'));
    $('#backBtn').addEventListener('click', () => signAction('backspace'));
    $('#clearBtn').addEventListener('click', () => signAction('clear'));

    // Air writing colors & brush sizes
    $('#penColors').append(
      ...PEN_COLORS.slice(0, 8).map((c, i) => {
        const b = document.createElement('button');
        b.dataset.i = i;
        b.setAttribute('aria-label', 'Pen colour ' + (i + 1));
        b.innerHTML = `<span style="background:${c}"></span>`;
        b.addEventListener('click', () => {
          state.airColor = i;
          render();
          saveState();
        });
        return b;
      })
    );

    $('#eraserBtn').addEventListener('click', () => {
      state.airColor = 8;
      render();
      saveState();
    });

    $$('#sizeSeg button').forEach((b) =>
      b.addEventListener('click', () => {
        state.airSize = b.dataset.size;
        render();
        saveState();
      })
    );

    $('#airClear').addEventListener('click', clearAirCanvas);
    $('#airSave').addEventListener('click', saveAirPicture);

    // Camera & Fullscreen buttons
    const stage = $('#stage');
    const toggleFs = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen();
    };
    $('#fsBtn').addEventListener('click', toggleFs);
    $('#camBtn').addEventListener('click', () => setCamera(!camOn));
    $('#barCam').addEventListener('click', () => setCamera(!camOn));
    $('#barExit').addEventListener('click', () => document.exitFullscreen && document.exitFullscreen());
    document.addEventListener('fullscreenchange', () => {
      $('#fsBtn').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    });
  }

  // Home Hero Sticker Animation
  function doodleDemo() {
    const row = $('#demoChips');
    if (!row) return;
    const seq = 'HELLO WORLD'.split('');
    let timers = [];
    const run = () => {
      timers.forEach(clearTimeout);
      timers = [];
      $$('.chip', row).forEach((n) => n.remove());
      seq.forEach((ch, i) =>
        timers.push(
          setTimeout(() => {
            const b = document.createElement('b');
            b.className = 'chip' + (ch === ' ' ? ' space' : '');
            b.textContent = ch === ' ' ? 'space' : ch;
            b.style.setProperty('--r', (Math.random() * 8 - 4).toFixed(1) + 'deg');
            row.appendChild(b);
          }, 3200 + i * 420)
        )
      );
    };
    run();
    const line = $('.hand-line');
    if (line) line.addEventListener('animationiteration', run);
  }

  // Initialize
  wireControls();
  wireGuideModal();
  wireTeachModal();
  preloadMasks();
  doodleDemo();
  document.body.dataset.theme = state.theme;
  route();
})();
