(() => {
  'use strict';

  // Must match game.js
  const C = { CX: 500, CY: 500, R: 440, GOAL_HALF: 0.3, POST_R: 9, CAR_R: 21, BALL_R: 17, WIN: 5 };
  const GOAL_ANGLES = [Math.PI, 0];
  const N = GOAL_ANGLES.length;
  const COLORS = ['#ff4d6d', '#3fa9ff'];
  const INTERP = 80; // ms of render delay for smooth interpolation

  const $ = (s) => document.querySelector(s);
  const socket = io();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  let lobby = null;
  let mySlot = -1;

  // ---------------------------------------------------------------- screens
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'game') resize();
  }

  // ---------------------------------------------------------------- home
  const nameInput = $('#name');
  const codeInput = $('#code');
  const homeErr = $('#homeErr');
  nameInput.value = store.get('turbogoal.name') || '';
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) codeInput.value = roomParam.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  function myName() {
    const n = nameInput.value.trim().slice(0, 12) || 'Player';
    store.set('turbogoal.name', n);
    return n;
  }

  $('#createBtn').onclick = () => {
    initAudio();
    homeErr.textContent = '';
    socket.emit('create', { name: myName() }, (res) => { if (!res.ok) homeErr.textContent = res.error; });
  };
  $('#joinBtn').onclick = () => {
    initAudio();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) { homeErr.textContent = 'Enter the 4-letter room code'; return; }
    homeErr.textContent = '';
    socket.emit('join', { name: myName(), code }, (res) => { if (!res.ok) homeErr.textContent = res.error; });
  };
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.length === 4 ? $('#joinBtn') : $('#createBtn')).click(); });

  // ---------------------------------------------------------------- lobby
  socket.on('lobby', (l) => {
    lobby = l;
    mySlot = l.players.findIndex((p) => p && p.id === socket.id);
    renderLobby();
    hudKey = '';
    if (l.phase === 'lobby') { show('lobby'); snaps.length = 0; latest = null; }
    else show('game');
  });

  socket.on('disconnect', () => {
    lobby = null;
    show('home');
    homeErr.textContent = 'Disconnected from server. Reconnecting…';
  });
  socket.on('connect', () => { if (homeErr.textContent.startsWith('Disconnected')) homeErr.textContent = ''; });

  function renderLobby() {
    $('#roomCode').textContent = lobby.code;
    const list = $('#players');
    list.innerHTML = '';
    for (let s = 0; s < N; s++) {
      const p = lobby.players[s];
      const li = document.createElement('li');
      li.className = 'slot' + (p ? ' filled' : '');
      li.style.setProperty('--c', COLORS[s]);
      const dot = document.createElement('span'); dot.className = 'car-dot';
      const nm = document.createElement('span'); nm.className = 'pname';
      nm.textContent = p ? p.name : 'Waiting for player…';
      li.append(dot, nm);
      if (p && p.id === lobby.host) li.append(pill('HOST'));
      if (p && p.id === socket.id) li.append(pill('YOU'));
      list.append(li);
    }
    const count = lobby.players.filter(Boolean).length;
    const isHost = lobby.host === socket.id;
    const btn = $('#startBtn');
    btn.hidden = !isHost;
    btn.disabled = count < N;
    btn.textContent = count < N ? 'Waiting for opponent…' : 'Start match!';
    $('#waitMsg').textContent = isHost ? (count < N ? 'Share the code with your opponent' : '') : 'Waiting for host to start…';
  }

  function pill(text) {
    const s = document.createElement('span');
    s.className = 'pill';
    s.textContent = text;
    return s;
  }

  $('#startBtn').onclick = () => { initAudio(); socket.emit('start'); };
  $('#againBtn').onclick = () => socket.emit('start');
  $('#copyBtn').onclick = async () => {
    const url = `${location.origin}/?room=${lobby.code}`;
    try { await navigator.clipboard.writeText(url); $('#copyBtn').textContent = 'Copied!'; }
    catch { prompt('Share this link:', url); }
    setTimeout(() => { $('#copyBtn').textContent = 'Copy link'; }, 1500);
  };
  function leave() {
    socket.emit('leave');
    lobby = null;
    snaps.length = 0;
    latest = null;
    $('#overlay').hidden = true;
    show('home');
  }
  $('#leaveBtn').onclick = leave;
  $('#overLeaveBtn').onclick = leave;

  // ---------------------------------------------------------------- input
  const keys = { u: false, d: false, l: false, r: false, b: false };
  const KEYMAP = {
    ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd',
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
    Space: 'b', ShiftLeft: 'b', ShiftRight: 'b',
  };
  function setKey(k, v) {
    if (keys[k] === v) return;
    keys[k] = v;
    socket.emit('input', keys);
  }
  const inGame = () => $('#game').classList.contains('active');
  window.addEventListener('keydown', (e) => {
    if (!inGame()) return;
    if (e.code === 'KeyM') { toggleMute(); return; }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    setKey(k, true);
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) setKey(k, false);
  });
  window.addEventListener('blur', () => Object.keys(keys).forEach((k) => setKey(k, false)));

  const isTouch = 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
  if (isTouch) document.body.classList.add('touch');
  document.querySelectorAll('#touch button').forEach((btn) => {
    const k = btn.dataset.k;
    const on = (e) => { e.preventDefault(); initAudio(); btn.classList.add('on'); setKey(k, true); };
    const off = (e) => { e.preventDefault(); btn.classList.remove('on'); setKey(k, false); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ---------------------------------------------------------------- audio
  let actx = null, master = null, engOsc = null, engGain = null, engFilter = null;
  let muted = store.get('turbogoal.muted') === '1';
  $('#muteBtn').textContent = muted ? '🔇' : '🔊';
  $('#muteBtn').onclick = toggleMute;

  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(actx.destination);
      engOsc = actx.createOscillator();
      engOsc.type = 'sawtooth';
      engFilter = actx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 500;
      engGain = actx.createGain();
      engGain.gain.value = 0;
      engOsc.connect(engFilter).connect(engGain).connect(master);
      engOsc.start();
    } catch { actx = null; }
  }
  function toggleMute() {
    muted = !muted;
    store.set('turbogoal.muted', muted ? '1' : '0');
    $('#muteBtn').textContent = muted ? '🔇' : '🔊';
    if (master) master.gain.value = muted ? 0 : 0.5;
  }
  function tone(freq, dur, type = 'square', vol = 0.15, slideTo = 0, delay = 0) {
    if (!actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(dur, vol, freq) {
    if (!actx) return;
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = actx.createGain();
    const t = actx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur);
  }

  // ---------------------------------------------------------------- network state
  const snaps = [];
  let latest = null;
  let offset = null;
  socket.on('state', (s) => {
    const est = s.t - Date.now();
    offset = offset === null ? est : offset + (est - offset) * 0.1;
    snaps.push(s);
    while (snaps.length > 40) snaps.shift();
    latest = s;
  });

  const lerp = (a, b, k) => a + (b - a) * k;
  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * k;
  }

  function sample() {
    if (!snaps.length) return null;
    const rt = Date.now() + offset - INTERP;
    let bi = snaps.findIndex((s) => s.t > rt);
    if (bi === -1) bi = snaps.length - 1;
    if (bi === 0) return { ball: snaps[0].b, cars: snaps[0].c };
    const A = snaps[bi - 1], B = snaps[bi];
    const k = Math.max(0, Math.min(1, (rt - A.t) / (B.t - A.t)));
    const cars = B.c.map((cb) => {
      const ca = A.c.find((c) => c[0] === cb[0]);
      if (!ca) return cb;
      return [cb[0], lerp(ca[1], cb[1], k), lerp(ca[2], cb[2], k), lerpAngle(ca[3], cb[3], k), cb[4], cb[5]];
    });
    // Don't interpolate the ball across a kickoff reset.
    const jump = Math.hypot(B.b[0] - A.b[0], B.b[1] - A.b[1]) > 120;
    const ball = jump ? B.b : [lerp(A.b[0], B.b[0], k), lerp(A.b[1], B.b[1], k)];
    return { ball, cars };
  }

  // ---------------------------------------------------------------- effects
  const particles = [];
  const skids = [];
  const ballTrail = [];
  let shake = 0;
  let ballRot = 0;
  let prevBall = null;
  const prevCars = {};

  function burst(x, y, n, colors, speed, life, size, gravity = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life, max: life, size: size * (0.5 + Math.random()),
        color: colors[(Math.random() * colors.length) | 0], g: gravity, rot: Math.random() * 6, confetti: gravity > 0,
      });
    }
  }

  socket.on('fx', ({ type, s }) => {
    if (type === 'hit') {
      noise(0.12, 0.25 + s * 0.5, 900 + s * 1500);
      tone(180 + s * 200, 0.08, 'triangle', 0.15 + s * 0.2, 90);
      if (prevBall && s > 0.3) burst(prevBall[0], prevBall[1], 6 + s * 12, ['#fff', '#dff'], 260 * s, 0.35, 3);
      if (s > 0.6) shake = Math.max(shake, 5 * s);
    } else if (type === 'bump') {
      noise(0.15, 0.3 + s * 0.3, 400);
      tone(90, 0.12, 'square', 0.1, 50);
      shake = Math.max(shake, 4 * s);
    } else if (type === 'wall' || type === 'post') {
      noise(0.08, 0.15 + s * 0.3, type === 'post' ? 3000 : 1200);
      if (type === 'post') tone(900, 0.2, 'sine', 0.15, 700);
    }
  });

  socket.on('goal', ({ conceder, scorer, own }) => {
    const names = lobby ? lobby.players.map((p) => (p ? p.name : '?')) : ['Red', 'Blue'];
    const color = scorer >= 0 ? COLORS[scorer] : '#ffffff';
    const banner = $('#banner');
    banner.style.setProperty('--c', color);
    banner.querySelector('.big').textContent = own ? 'OWN GOAL!' : 'GOAL!';
    banner.querySelector('.sub').textContent = own
      ? `${names[conceder]} scored on themselves 🙈`
      : scorer >= 0 ? `${names[scorer]} scores on ${names[conceder]}` : `${names[conceder]} concedes`;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');

    const g = GOAL_ANGLES[conceder];
    const gx = C.CX + Math.cos(g) * (C.R - 10), gy = C.CY + Math.sin(g) * (C.R - 10);
    burst(gx, gy, 140, [color, '#ffffff', COLORS[conceder], '#ffe066'], 700, 2.2, 7, 500);
    shake = 22;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'square', 0.12, 0, i * 0.09));
    noise(0.8, 0.3, 2500);
  });

  // ---------------------------------------------------------------- canvas
  const cv = $('#c');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let pitch = null;
  let pitchKey = '';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const top = 56, bottom = isTouch ? 110 : 44;
    const avail = Math.min(W, H - top - bottom);
    scale = Math.max(0.2, avail / 1000);
    ox = (W - 1000 * scale) / 2;
    oy = top + (H - top - bottom - 1000 * scale) / 2;
    pitchKey = '';
  }
  window.addEventListener('resize', resize);

  function activeSlots() {
    return lobby ? lobby.players.map((p) => !!p) : GOAL_ANGLES.map(() => true);
  }

  function buildPitch() {
    const act = activeSlots();
    const key = act.join() + scale + dpr;
    if (key === pitchKey) return;
    pitchKey = key;
    const px = Math.ceil(1000 * scale * dpr);
    pitch = document.createElement('canvas');
    pitch.width = pitch.height = px;
    const g = pitch.getContext('2d');
    g.scale(px / 1000, px / 1000);
    const { CX, CY, R, GOAL_HALF: H2 } = C;

    // Goal nets behind the wall
    for (let s = 0; s < N; s++) {
      if (!act[s]) continue;
      const a = GOAL_ANGLES[s];
      g.save();
      g.beginPath();
      g.arc(CX, CY, R + 44, a - H2, a + H2);
      g.arc(CX, CY, R, a + H2, a - H2, true);
      g.closePath();
      g.fillStyle = hexA(COLORS[s], 0.22);
      g.fill();
      g.clip();
      g.strokeStyle = hexA(COLORS[s], 0.45);
      g.lineWidth = 1.5;
      for (let t = -H2; t <= H2; t += 0.04) {
        g.beginPath();
        g.moveTo(CX + Math.cos(a + t) * R, CY + Math.sin(a + t) * R);
        g.lineTo(CX + Math.cos(a + t) * (R + 50), CY + Math.sin(a + t) * (R + 50));
        g.stroke();
      }
      for (let r = R + 11; r < R + 44; r += 11) {
        g.beginPath(); g.arc(CX, CY, r, a - H2, a + H2); g.stroke();
      }
      g.restore();
      g.beginPath();
      g.arc(CX, CY, R + 44, a - H2, a + H2);
      g.strokeStyle = COLORS[s];
      g.lineWidth = 5;
      g.shadowColor = COLORS[s];
      g.shadowBlur = 18;
      g.stroke();
      g.shadowBlur = 0;
    }

    // Grass with mowing stripes
    g.save();
    g.beginPath();
    g.arc(CX, CY, R, 0, Math.PI * 2);
    g.clip();
    const grad = g.createRadialGradient(CX, CY, 50, CX, CY, R);
    grad.addColorStop(0, '#3bb25a');
    grad.addColorStop(1, '#23803f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1000, 1000);
    g.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = CX - R; x < CX + R; x += 110) g.fillRect(x, 0, 55, 1000);

    // Each player's third, tinted in their color
    for (let s = 0; s < N; s++) {
      if (!act[s]) continue;
      const a = GOAL_ANGLES[s];
      g.beginPath();
      g.moveTo(CX, CY);
      g.arc(CX, CY, R, a - Math.PI / N, a + Math.PI / N);
      g.closePath();
      const tg = g.createRadialGradient(CX, CY, 0, CX, CY, R);
      tg.addColorStop(0, hexA(COLORS[s], 0));
      tg.addColorStop(1, hexA(COLORS[s], 0.22));
      g.fillStyle = tg;
      g.fill();
    }

    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 4;
    // Sector dividers
    g.setLineDash([14, 12]);
    for (const a of GOAL_ANGLES) {
      const d = a + Math.PI / N;
      g.beginPath();
      g.moveTo(CX + Math.cos(d) * 90, CY + Math.sin(d) * 90);
      g.lineTo(CX + Math.cos(d) * R, CY + Math.sin(d) * R);
      g.stroke();
    }
    g.setLineDash([]);
    // Center circle + spot
    g.beginPath(); g.arc(CX, CY, 90, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(CX, CY, 6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    // Goal boxes
    for (let s = 0; s < N; s++) {
      const a = GOAL_ANGLES[s];
      g.beginPath();
      g.arc(CX + Math.cos(a) * R, CY + Math.sin(a) * R, 135, 0, Math.PI * 2);
      g.stroke();
    }
    // Inner vignette
    const vg = g.createRadialGradient(CX, CY, R * 0.7, CX, CY, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = vg;
    g.fillRect(0, 0, 1000, 1000);
    g.restore();

    // Wall, with gaps where goals are
    const gaps = [];
    for (let s = 0; s < N; s++) if (act[s]) gaps.push(GOAL_ANGLES[s]);
    gaps.sort((x, y) => x - y);
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.strokeStyle = '#e6ecff';
    g.shadowColor = 'rgba(140,170,255,0.8)';
    g.shadowBlur = 24;
    if (!gaps.length) {
      g.beginPath(); g.arc(CX, CY, R + 7, 0, Math.PI * 2); g.stroke();
    } else {
      for (let i = 0; i < gaps.length; i++) {
        const from = gaps[i] + H2;
        const to = (i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + Math.PI * 2) - H2;
        g.beginPath(); g.arc(CX, CY, R + 7, from, to); g.stroke();
      }
    }
    g.shadowBlur = 0;

    // Posts
    for (let s = 0; s < N; s++) {
      if (!act[s]) continue;
      for (const sign of [-1, 1]) {
        const a = GOAL_ANGLES[s] + sign * H2;
        g.beginPath();
        g.arc(CX + Math.cos(a) * C.R, CY + Math.sin(a) * C.R, C.POST_R + 2, 0, Math.PI * 2);
        g.fillStyle = COLORS[s];
        g.shadowColor = COLORS[s];
        g.shadowBlur = 14;
        g.fill();
        g.shadowBlur = 0;
        g.lineWidth = 3;
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCar(x, y, a, color, isMe, now) {
    if (isMe) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.arc(x, y, 32 + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.25})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(-21, -10, 46, 28, 8); ctx.fill();
    // wheels
    ctx.fillStyle = '#15171c';
    for (const [wx, wy] of [[-14, -15], [10, -15], [-14, 10], [10, 10]]) { roundRect(wx, wy, 11, 5, 2); ctx.fill(); }
    // body
    ctx.fillStyle = color;
    roundRect(-23, -13, 46, 26, 8); ctx.fill();
    // highlight + racing stripe
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(-21, -12, 42, 9, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-23, -2.5, 46, 5);
    // cabin
    ctx.fillStyle = 'rgba(10,15,30,0.55)';
    roundRect(-10, -10, 18, 20, 5); ctx.fill();
    // windshield
    ctx.fillStyle = '#bfeaff';
    roundRect(4, -9, 6, 18, 3); ctx.fill();
    // lights
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(20, -11, 3, 6); ctx.fillRect(20, 5, 3, 6);
    ctx.fillStyle = '#ff3355';
    ctx.fillRect(-23, -11, 2, 5); ctx.fillRect(-23, 6, 2, 5);
    ctx.restore();
  }

  function drawBall(x, y) {
    // trail
    for (let i = 0; i < ballTrail.length; i++) {
      const t = ballTrail[i];
      const k = i / ballTrail.length;
      ctx.beginPath();
      ctx.arc(t[0], t[1], C.BALL_R * k * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${k * 0.18})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(x + 5, y + 7, C.BALL_R, C.BALL_R * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, C.BALL_R, 0, Math.PI * 2);
    const gr = ctx.createRadialGradient(-5, -6, 2, 0, 0, C.BALL_R);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#cfd6e6');
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.clip();
    ctx.rotate(ballRot);
    ctx.fillStyle = '#1c2233';
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 15, Math.sin(a) * 15, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, C.BALL_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- HUD
  let hudKey = '';
  let prevScores = [];
  function renderHud() {
    if (!lobby || !latest) return;
    const key = JSON.stringify([latest.s, lobby.players.map((p) => p && p.name)]);
    if (key === hudKey) return;
    hudKey = key;
    const hud = $('#hud');
    hud.innerHTML = '';
    for (let s = 0; s < N; s++) {
      const p = lobby.players[s];
      const chip = document.createElement('div');
      chip.className = 'chip' + (p ? '' : ' empty') + (s === mySlot ? ' me' : '');
      chip.style.setProperty('--c', COLORS[s]);
      const dot = document.createElement('span'); dot.className = 'dot';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = p ? p.name : '—';
      const sc = document.createElement('span'); sc.className = 's';
      sc.textContent = p && latest.s[s] !== null ? latest.s[s] : '';
      chip.append(dot, n, sc);
      if (prevScores[s] !== undefined && latest.s[s] > prevScores[s]) chip.classList.add('bump');
      hud.append(chip);
    }
    prevScores = latest.s.slice();
  }

  function showOver() {
    const scores = latest.s;
    let best = -1;
    for (let s = 0; s < N; s++) if (scores[s] !== null && (best < 0 || scores[s] > scores[best])) best = s;
    const names = lobby.players.map((p) => (p ? p.name : '—'));
    const wt = $('#winnerText');
    wt.textContent = best === mySlot ? 'You win! 🏆' : `${names[best]} wins! 🏆`;
    wt.style.color = COLORS[best];
    const list = $('#finalScores');
    list.innerHTML = '';
    GOAL_ANGLES.map((_, i) => i).filter((s) => lobby.players[s]).sort((a, b) => scores[b] - scores[a]).forEach((s) => {
      const li = document.createElement('li');
      li.className = 'slot filled';
      li.style.setProperty('--c', COLORS[s]);
      const dot = document.createElement('span'); dot.className = 'car-dot';
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = names[s];
      const sc = document.createElement('span'); sc.className = 'score-num'; sc.textContent = scores[s];
      li.append(dot, nm, sc);
      list.append(li);
    });
    const isHost = lobby.host === socket.id;
    $('#againBtn').hidden = !isHost;
    $('#againBtn').disabled = lobby.players.filter(Boolean).length < 2;
    $('#againWait').hidden = isHost;
    $('#overlay').hidden = false;
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, 0, i * 0.12));
  }

  // ---------------------------------------------------------------- main loop
  let lastFrame = performance.now();
  let lastCount = 0;
  let prevPhase = '';
  let goFlash = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!inGame() || !latest) {
      if (engGain) engGain.gain.value = 0;
      return;
    }

    // Phase transitions
    const ph = latest.ph;
    if (ph !== prevPhase) {
      if (ph === 'playing' && prevPhase === 'countdown') { goFlash = 0.8; tone(880, 0.35, 'square', 0.15); }
      if (ph === 'over') showOver();
      if (prevPhase === 'over') $('#overlay').hidden = true;
      if (ph === 'countdown') { skids.length = 0; ballTrail.length = 0; }
      prevPhase = ph;
    }
    if (ph === 'countdown') {
      const n = Math.ceil(latest.tm);
      if (n !== lastCount && n > 0) tone(440, 0.15, 'square', 0.12);
      lastCount = n;
    } else lastCount = 0;

    renderHud();
    const view = sample();
    if (!view) return;

    buildPitch();

    // Background
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#16224a');
    bg.addColorStop(1, '#070b18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // World transform with screen shake
    shake *= Math.pow(0.001, dt);
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sx), dpr * (oy + sy));
    ctx.drawImage(pitch, 0, 0, 1000, 1000);

    // Skid marks
    ctx.lineCap = 'round';
    for (let i = skids.length - 1; i >= 0; i--) {
      const k = skids[i];
      k.life -= dt / 3;
      if (k.life <= 0) { skids.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(20,30,20,${k.life * 0.35})`;
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(k[0], k[1]); ctx.lineTo(k[2], k[3]); ctx.stroke();
    }

    // Ball motion bookkeeping
    const [bx, by] = view.ball;
    if (prevBall) {
      const d = Math.hypot(bx - prevBall[0], by - prevBall[1]);
      if (d < 100) ballRot += d / C.BALL_R;
      const speed = d / Math.max(dt, 0.001);
      if (speed > 350 && d < 100) ballTrail.push([bx, by]);
      else if (ballTrail.length) ballTrail.shift();
      while (ballTrail.length > 10) ballTrail.shift();
    }
    prevBall = [bx, by];

    // Cars: derive velocity for skids, flames and engine pitch
    let mySpeed = 0;
    for (const c of view.cars) {
      const [slot, x, y, a, boosting] = c;
      const prev = prevCars[slot];
      if (prev) {
        const vx = (x - prev.x) / Math.max(dt, 0.001), vy = (y - prev.y) / Math.max(dt, 0.001);
        const speed = Math.hypot(vx, vy);
        const lat = Math.abs(-vx * Math.sin(a) + vy * Math.cos(a));
        if (slot === mySlot) mySpeed = speed;
        if (lat > 80 && speed > 140 && speed < 2000) {
          for (const side of [-10, 10]) {
            const rx = -14, cs = Math.cos(a), sn = Math.sin(a);
            const px = prev.x + rx * Math.cos(prev.a) - side * Math.sin(prev.a);
            const py = prev.y + rx * Math.sin(prev.a) + side * Math.cos(prev.a);
            const qx = x + rx * cs - side * sn, qy = y + rx * sn + side * cs;
            const seg = [px, py, qx, qy];
            seg.life = 1;
            skids.push(seg);
          }
          if (skids.length > 500) skids.splice(0, skids.length - 500);
        }
      }
      prevCars[slot] = { x, y, a };
      if (boosting) {
        for (let i = 0; i < 3; i++) {
          const spread = (Math.random() - 0.5) * 0.6;
          particles.push({
            x: x - Math.cos(a) * 24, y: y - Math.sin(a) * 24,
            vx: -Math.cos(a + spread) * (180 + Math.random() * 120), vy: -Math.sin(a + spread) * (180 + Math.random() * 120),
            life: 0.35, max: 0.35, size: 7 + Math.random() * 5,
            color: Math.random() < 0.5 ? '#ffb020' : '#ff5a1f', g: 0, flame: true,
          });
        }
      }
    }

    // Particles (under cars for flames)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx *= Math.pow(0.2, dt);
      p.vy *= p.confetti ? 1 : Math.pow(0.2, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      if (p.confetti) {
        p.rot += dt * 8;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.flame ? k : 1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (particles.length > 800) particles.splice(0, particles.length - 800);

    drawBall(bx, by);
    for (const c of view.cars) drawCar(c[1], c[2], c[3], COLORS[c[0]], c[0] === mySlot, now);

    // Name tags
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (const c of view.cars) {
      const p = lobby && lobby.players[c[0]];
      if (!p) continue;
      const label = c[0] === mySlot ? 'YOU' : p.name;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(label, c[1] + 1, c[2] - 34 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, c[1], c[2] - 34);
    }

    // Countdown / GO
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ph === 'countdown') {
      const n = Math.ceil(latest.tm);
      const frac = latest.tm - Math.floor(latest.tm);
      ctx.save();
      ctx.translate(C.CX, C.CY - 160);
      ctx.scale(1 + frac * 0.4, 1 + frac * 0.4);
      ctx.font = '120px "Russo One", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillText(n, 4, 6);
      ctx.fillStyle = '#fff';
      ctx.fillText(n, 0, 0);
      ctx.restore();
    } else if (goFlash > 0) {
      goFlash -= dt;
      ctx.globalAlpha = Math.max(0, goFlash / 0.8);
      ctx.font = '130px "Russo One", sans-serif';
      ctx.fillStyle = '#36e27a';
      ctx.fillText('GO!', C.CX, C.CY - 160);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';

    // Boost bar
    const mine = latest.c.find((c) => c[0] === mySlot);
    $('#boostFill').style.width = (mine ? mine[5] : 0) + '%';

    // Engine sound follows your car's speed
    if (engGain && actx) {
      const t = actx.currentTime;
      const target = ph === 'playing' || ph === 'goal' ? 0.05 + Math.min(mySpeed, 700) / 700 * 0.06 : 0;
      engGain.gain.setTargetAtTime(target, t, 0.1);
      engOsc.frequency.setTargetAtTime(55 + Math.min(mySpeed, 700) * 0.22, t, 0.08);
      engFilter.frequency.setTargetAtTime(400 + Math.min(mySpeed, 700) * 1.5, t, 0.1);
    }
  }
  requestAnimationFrame(frame);
})();
