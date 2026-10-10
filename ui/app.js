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
  const MODES = ['mouse', 'sign', 'air', 'mask'];
  const PEN_COLORS = ['#FFFFFF', '#2DD4BF', '#FBBF24', '#FB7185', '#3B82F6', '#10B981', '#A855F7', '#EF4444'];

  // ---------- state ----------
  const defaults = { mode: 'mouse', hands: 'right', smoothing: 'balanced', masksOn: true, maskIndex: 0, theme: 'teal', help: true, airColor: 1, airSize: 'medium' };
  const state = Object.assign({}, defaults, load());
  let text = '';
  let masks = [];
  let backendUp = false;
  let pollTimer = null;
  let camOn = false;

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
    if (h.startsWith('#app') || h === '#guide') {
      const m = h.split('/')[1];
      if (MODES.includes(m)) state.mode = m;
      if (h === '#guide') state.mode = 'sign';
      show('app');
      if (camOn) startFeed(); else stopFeed();
      api('/api/camera', { on: camOn }).catch(() => {});
      render(); pushState(); startPolling();
      if (h === '#guide') openGuide();
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
    $('#boxAir').classList.toggle('hidden', state.mode !== 'air');
    $('#boxMask').classList.toggle('hidden', state.mode !== 'mask');
    $$('#penColors button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === state.airColor)));
    const eraserBtn = $('#eraserBtn');
    if (eraserBtn) {
        eraserBtn.setAttribute('aria-pressed', String(state.airColor === 8));
        if (state.airColor === 8) {
            eraserBtn.classList.add('primary');
            eraserBtn.classList.remove('ghost');
        } else {
            eraserBtn.classList.remove('primary');
            eraserBtn.classList.add('ghost');
        }
    }
    $$('#sizeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === state.airSize)));
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
      air: ['Air writing: how to use', [
        ['Point to write', 'Raise only your index finger. Move it to draw on the camera.'],
        ['Fist to erase', 'Make a fist to rub out. Hold it for 1.5 seconds to clear everything.'],
        ['Any other pose lifts the pen', 'Open your hand to move without drawing.']]],
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

  // ---------- sign guide ----------
  let signs = [];
  function renderSigns(filter) {
    signs.forEach((s) => { if (taught.includes(s.letter)) s.supported = true; });
    const grid = $('#signGrid'); grid.textContent = '';
    const q = (filter || '').trim().toLowerCase();
    const list = signs.filter((s) => !q || s.letter.toLowerCase().includes(q) || s.how.toLowerCase().includes(q));
    if (!list.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = signs.length ? 'No match. Try another letter.' : 'The sign list could not be loaded.';
      grid.appendChild(e); return;
    }
    list.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'sign' + (s.supported === false ? ' unsupported' : '');
      const l = document.createElement('div'); l.className = 'sign-letter'; l.textContent = s.letter;
      const p = document.createElement('p'); p.textContent = s.how;
      card.append(l, p);
      if (s.moves) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'Moves'; card.appendChild(b); }
      if (s.supported === false) { const n = document.createElement('span'); n.className = 'not-yet'; n.textContent = 'Not yet recognised by this app.'; card.appendChild(n); }
      grid.appendChild(card);
    });
  }
  function openGuide() { const d = $('#guide'); if (d && !d.open) d.showModal(); }
  function closeGuide() { const d = $('#guide'); if (d && d.open) d.close(); if (location.hash === '#guide') history.replaceState(null, '', '#app/sign'); }
  function wireGuide() {
    fetch('signs.json').then((r) => r.json()).then((d) => { signs = d; renderSigns(''); }).catch(() => renderSigns(''));
    $('#guideBtn').addEventListener('click', openGuide);
    $('#guideBtn2').addEventListener('click', openGuide);
    $('#guideClose').addEventListener('click', closeGuide);
    $('#guide').addEventListener('click', (e) => { if (e.target === $('#guide')) closeGuide(); });
    $('#guide').addEventListener('close', () => { if (location.hash === '#guide') history.replaceState(null, '', '#app/sign'); });
    $('#guideSearch').addEventListener('input', (e) => renderSigns(e.target.value));
    $$('.guide-tabs button').forEach((b) => b.addEventListener('click', () => {
      $$('.guide-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#tabLetters').hidden = b.dataset.tab !== 'letters';
      $('#tabControls').hidden = b.dataset.tab !== 'controls';
      $('#tabTips').hidden = b.dataset.tab !== 'tips';
    }));
  }

  // ---------- teach signs ----------
  let teachTimer = null;
  let taught = [];
  function renderTeach(st) {
    const box = $('#teachChips'); box.textContent = '';
    const names = Object.keys(st.labels);
    if (!names.length) { const e = document.createElement('span'); e.className = 'muted'; e.textContent = 'Nothing yet. Record your first sign above.'; box.appendChild(e); }
    names.forEach((l) => {
      const chip = document.createElement('span'); chip.className = 'tchip';
      chip.append(l + ' ');
      const n = document.createElement('small'); n.textContent = st.labels[l]; chip.appendChild(n);
      const x = document.createElement('button'); x.textContent = '\u00D7'; x.setAttribute('aria-label', 'Delete ' + l);
      x.addEventListener('click', () => api('/api/teach/delete', { label: l }).then(pollTeach).catch(() => {}));
      chip.appendChild(x); box.appendChild(chip);
    });
    const rec = st.recording;
    $('#teachBarWrap').hidden = !rec;
    $('#teachBar').style.width = Math.round((st.count / st.target) * 100) + '%';
    $('#teachRecord').disabled = !!rec;
    $('#teachStop').hidden = !rec;
    $('#teachMsg').textContent = rec ? 'Recording ' + rec + ': ' + st.count + ' of ' + st.target + '. Hold the sign and move a little. Samples only count while your hand is in view.' : '';
    let r = st.trained ? 'Trained on ' + st.samples + ' samples for ' + st.classes.length + ' signs.' : 'Not trained yet.';
    if (st.trained) r += st.accuracy != null ? ' Check on recordings it had not seen: ' + Math.round(st.accuracy * 100) + '% right.' : ' Record each sign 3 times to get an accuracy check.';
    if ($('#teachResult').dataset.keep !== '1') $('#teachResult').textContent = r;
    taught = st.classes || [];
    if (typeof renderSigns === 'function') renderSigns($('#guideSearch') ? $('#guideSearch').value : '');
  }
  function pollTeach() { return api('/api/teach/status').then(renderTeach).catch(() => {}); }
  function openTeach() {
    state.mode = 'sign'; render(); pushState();
    pollTeach(); clearInterval(teachTimer); teachTimer = setInterval(pollTeach, 500);
    $('#teach').showModal();
  }
  function closeTeach() { clearInterval(teachTimer); const d = $('#teach'); if (d.open) d.close(); }
  function wireTeach() {
    $('#teachLetters').append(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => { const o = document.createElement('option'); o.value = ch; return o; }));
    $('#teachBtn').addEventListener('click', openTeach);
    $('#teachClose').addEventListener('click', closeTeach);
    $('#teach').addEventListener('close', () => clearInterval(teachTimer));
    $('#teachRecord').addEventListener('click', () => {
      const label = $('#teachLabel').value.trim();
      if (!label) { $('#teachMsg').textContent = 'Type a letter or a word first.'; return; }
      $('#teachResult').dataset.keep = '0';
      api('/api/teach/record', { label }).then(pollTeach).catch(() => { $('#teachMsg').textContent = 'Could not start recording. Is the server running?'; });
    });
    $('#teachStop').addEventListener('click', () => api('/api/teach/stop', {}).then(pollTeach).catch(() => {}));
    $('#teachTrain').addEventListener('click', () => {
      const b = $('#teachTrain'); b.disabled = true; $('#teachResult').dataset.keep = '1'; $('#teachResult').textContent = 'Training...';
      api('/api/teach/train', {}).then((r) => { $('#teachResult').dataset.keep = '0'; if (!r.ok) { $('#teachResult').dataset.keep = '1'; $('#teachResult').textContent = r.message; } return pollTeach(); })
        .catch(() => { $('#teachResult').textContent = 'Training failed. Check the server console.'; })
        .finally(() => { b.disabled = false; });
    });
  }

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

    // Air writing controls
    $('#penColors').append(...PEN_COLORS.map((c, i) => {
      const b = document.createElement('button'); b.dataset.i = i; b.setAttribute('aria-label', 'Pen colour ' + (i + 1));
      b.innerHTML = `<span style="background:${c}"></span>`;
      b.addEventListener('click', () => { state.airColor = i; render(); pushState(); });
      return b;
    }));
    $('#eraserBtn').addEventListener('click', () => { state.airColor = 8; render(); pushState(); });
    $$('#sizeSeg button').forEach((b) => b.addEventListener('click', () => { state.airSize = b.dataset.size; render(); pushState(); }));
    $('#airClear').addEventListener('click', () => { api('/api/air/clear', {}).catch(() => {}); });

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
  wireGuide();
  wireTeach();
  doodleDemo();
  document.body.dataset.theme = state.theme;
  route();
})();
