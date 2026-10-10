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
  const MODES = ['mouse', 'sign', 'mask'];

  // ---------- state ----------
  const defaults = { mode: 'mouse', hands: 'right', smoothing: 'balanced', masksOn: true, maskIndex: 0, theme: 'teal', help: true };
  const state = Object.assign({}, defaults, load());
  let text = '';
  let masks = [];
  let backendUp = false;
  let pollTimer = null;
  let camOn = true;

  function load() { try { return JSON.parse(localStorage.getItem('gc-state') || '{}'); } catch { return {}; } }
  function save() { try { localStorage.setItem('gc-state', JSON.stringify(state)); } catch { /* ignore */ } }
  function api(path, body) {
    return fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function pushState() { save(); api('/api/state', state).then(() => { backendUp = true; }).catch(() => { backendUp = false; }); }

  // ---------- routing ----------
  function route() {
    const h = location.hash || '#home';
    if (h.startsWith('#app')) {
      const m = h.split('/')[1];
      if (MODES.includes(m)) state.mode = m;
      show('app');
      if (camOn) startFeed(); else stopFeed();
      api('/api/camera', { on: camOn }).catch(() => {});
      render(); pushState(); startPolling();
    } else {
      show('home'); stopFeed(); stopPolling();
      api('/api/camera', { on: false }).catch(() => {});   // release the webcam light on the home page
      const el = h.length > 1 && h !== '#home' ? document.getElementById(h.slice(1)) : null;
      if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
    }
  }
  function show(id) { $('#home').classList.toggle('hidden', id !== 'home'); $('#app').classList.toggle('hidden', id !== 'app'); }
  window.addEventListener('hashchange', route);

  // ---------- camera feed ----------
  function startFeed() {
    const img = $('#feed');
    img.onload = () => { img.hidden = false; $('#noFeed').hidden = true; backendUp = true; };
    img.onerror = () => { img.hidden = true; $('#noFeed').hidden = false; };
    img.src = '/video_feed?t=' + Date.now();
  }
  function stopFeed() { const img = $('#feed'); img.removeAttribute('src'); img.hidden = true; $('#noFeed').hidden = false; renderCamera(); }
  function setCamera(on) {
    camOn = on;
    api('/api/camera', { on }).catch(() => {});
    if (on) startFeed(); else stopFeed();
    render();
  }
  function renderCamera() {
    $('#noFeedText').textContent = camOn ? 'Camera preview appears here when the backend is running.' : 'Camera is off';
    $('#camBtn').textContent = camOn ? 'Turn camera off' : 'Turn camera on';
    $('#camBtn').setAttribute('aria-pressed', String(camOn));
    $('#camBtn').classList.toggle('primary', !camOn);
    $('#camBtn').classList.toggle('ghost', camOn);
    $('#barCam').textContent = camOn ? 'Camera off' : 'Camera on';
    $('#barCam').classList.toggle('off', !camOn);
    $('#status').classList.toggle('off', !camOn);
  }

  // ---------- render ----------
  function render() {
    document.body.dataset.theme = state.theme;
    $$('#swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === state.theme)));
    $$('.modes [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $$('.stage-bar [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    $$('#handSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hands === state.hands)));
    $$('#smoothSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.smooth === state.smoothing)));

    $('#boxHands').classList.toggle('hidden', state.mode === 'mask');
    $('#boxMouse').classList.toggle('hidden', state.mode !== 'mouse');
    $('#boxSign').classList.toggle('hidden', state.mode !== 'sign');
    $('#boxMask').classList.toggle('hidden', state.mode !== 'mask');
    $('#barSpace').hidden = state.mode !== 'sign';

    const handsLabel = state.hands === 'both' ? 'Both hands' : state.hands === 'left' ? 'Left hand' : 'Right hand';
    $('#statusText').textContent = camOn ? 'Camera on · ' + (state.mode === 'mask' ? (state.masksOn ? 'Masks on' : 'Masks off') : handsLabel) : 'Camera off';
    renderCamera();

    renderHelp(); renderSentence(); renderMasks();
    const sw = $('#maskSwitch'); sw.setAttribute('aria-checked', String(state.masksOn));
    $('#maskState').textContent = state.masksOn ? 'On: masks are shown' : 'Off: no masks shown';
    $('#helpBtn').setAttribute('aria-pressed', String(state.help));
    $('#help').classList.toggle('hidden', !state.help);
  }

  function renderHelp() {
    const both = state.hands === 'both';
    const sets = {
      mouse: ['Mouse mode: how to use', both
        ? [['Right hand moves', 'Point your index finger. The ring follows it.'], ['Left hand clicks', 'Pinch thumb and index finger of your left hand to click.'], ['Keep both hands in view', 'Both hands should stay inside the camera view.']]
        : [['Raise one finger', `Point your ${state.hands} index finger at the camera. The ring follows it.`], ['Pinch to click', 'Touch thumb and index finger together, then release.'], ['Keep your hand in frame', 'Stay inside the camera view with good light.']]],
      sign: ['Sign language: how to use', [
        [both ? 'Show a letter with one or both hands' : 'Show one letter', both ? 'Some letters need two hands. Keep both inside the camera view.' : 'Hold your hand steady in front of the camera.'],
        ['Wait for the letter', 'It is added to your sentence when it stays stable.'],
        ['Add a space', 'Press Add space between words so they stay separate.']]],
      mask: ['Face masks: how to use', [
        ['Turn masks on', 'Use the switch. Anyone who steps into view gets a mask.'],
        ['Pick a mask', 'Tap a mask to change it. The change shows right away.'],
        ['Move freely', 'The mask follows your face when you move or tilt your head.']]]
    };
    const [title, steps] = sets[state.mode];
    $('#help').innerHTML = `<h3>${title}</h3>` + steps.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('');
  }

  function renderSentence() {
    const words = text.split(' ').filter(Boolean);
    const box = $('#sentence'); box.textContent = '';
    words.forEach((w) => { const s = document.createElement('span'); s.className = 'w'; s.textContent = w; box.appendChild(s); });
    const c = document.createElement('span'); c.className = 'caret'; box.appendChild(c);
    $('#wordCount').textContent = words.length + (words.length === 1 ? ' word' : ' words');
  }

  function renderMasks() {
    const grid = $('#maskGrid'); grid.textContent = '';
    const list = masks.length ? masks : [1, 2, 3, 4].map((n) => ({ name: 'Mask ' + n, url: null }));
    list.forEach((m, i) => {
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', String(i === state.maskIndex));
      if (m.url) { const im = document.createElement('img'); im.src = m.url; im.alt = ''; b.appendChild(im); }
      else { const ph = document.createElement('span'); ph.className = 'ph'; ph.textContent = 'Image'; b.appendChild(ph); }
      const l = document.createElement('span'); l.textContent = m.name; b.appendChild(l);
      b.addEventListener('click', () => { state.maskIndex = i; state.masksOn = true; render(); pushState(); });
      grid.appendChild(b);
    });
  }

  // ---------- sign sentence ----------
  function localApply(action) {
    if (action === 'space') { if (text && !text.endsWith(' ')) text += ' '; }
    else if (action === 'backspace') text = text.slice(0, -1);
    else if (action === 'clear') text = '';
  }
  function signAction(action) {
    api('/api/sign/action', { action }).then((r) => { text = r.text; renderSentence(); })
      .catch(() => { localApply(action); renderSentence(); });
  }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (state.mode !== 'sign') return;
      api('/api/sign').then((r) => { if (r.text !== text) { text = r.text; renderSentence(); } }).catch(() => {});
    }, 400);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ---------- wiring ----------
  function wire() {
    $('#swatches').append(...THEMES.map((t) => {
      const b = document.createElement('button'); b.dataset.theme = t.id; b.setAttribute('aria-label', t.label + ' accent');
      b.innerHTML = `<span style="background:${t.color}"></span>`;
      b.addEventListener('click', () => { state.theme = t.id; render(); save(); });
      return b;
    }));
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; render(); pushState(); }));
    $$('#handSeg button').forEach((b) => b.addEventListener('click', () => { state.hands = b.dataset.hands; render(); pushState(); }));
    $$('#smoothSeg button').forEach((b) => b.addEventListener('click', () => { state.smoothing = b.dataset.smooth; render(); pushState(); }));
    $('#maskSwitch').addEventListener('click', () => { state.masksOn = !state.masksOn; render(); pushState(); });
    $('#helpBtn').addEventListener('click', () => { state.help = !state.help; render(); save(); });
    $('#spaceBtn').addEventListener('click', () => signAction('space'));
    $('#barSpace').addEventListener('click', () => signAction('space'));
    $('#backBtn').addEventListener('click', () => signAction('backspace'));
    $('#clearBtn').addEventListener('click', () => signAction('clear'));

    const stage = $('#stage');
    const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (stage.requestFullscreen) stage.requestFullscreen(); };
    $('#fsBtn').addEventListener('click', toggleFs);
    $('#camBtn').addEventListener('click', () => setCamera(!camOn));
    $('#barCam').addEventListener('click', () => setCamera(!camOn));
    window.addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/camera', new Blob([JSON.stringify({ on: false })], { type: 'application/json' })); } catch { /* ignore */ } });
    $('#barExit').addEventListener('click', () => document.exitFullscreen && document.exitFullscreen());
    document.addEventListener('fullscreenchange', () => { $('#fsBtn').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });

    api('/api/masks').then((r) => { masks = r.masks || []; if (state.maskIndex >= masks.length) state.maskIndex = 0; renderMasks(); }).catch(() => {});
  }


  // ---------- home hero: typing sticker row, restarts with the hand drawing ----------
  function doodleDemo() {
    const row = $('#demoChips'); if (!row) return;
    const seq = 'HELLO WORLD'.split('');
    let timers = [];
    const run = () => {
      timers.forEach(clearTimeout); timers = [];
      $$('.chip', row).forEach((n) => n.remove());
      seq.forEach((ch, i) => timers.push(setTimeout(() => {
        const b = document.createElement('b');
        b.className = 'chip' + (ch === ' ' ? ' space' : '');
        b.textContent = ch === ' ' ? 'space' : ch;
        b.style.setProperty('--r', (Math.random() * 8 - 4).toFixed(1) + 'deg');
        row.appendChild(b);
      }, 3200 + i * 420)));
    };
    run();
    const line = $('.hand-line');
    if (line) line.addEventListener('animationiteration', run);
  }

  wire();
  doodleDemo();
  document.body.dataset.theme = state.theme;
  route();
})();
