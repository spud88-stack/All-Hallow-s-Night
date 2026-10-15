'use strict';
// ---------------------------------------------------------------------------
// DOM UI: menus, settings, HUD, dialogue, intro and endings.
// ---------------------------------------------------------------------------
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let g = null, selKiller = 'myers';
  let menuAnim = null, endAnim = null;
  const msgs = [];
  let subT = 0, bigT = 0, hudT = 0, invHash = '';
  let dlgRes = null, dlgBusy = false;
  const store = {
    load() { try { return JSON.parse(localStorage.getItem('ahn_settings') || '{}'); } catch (e) { return {}; } },
    save(o) { try { localStorage.setItem('ahn_settings', JSON.stringify(o)); } catch (e) { /* ignore */ } },
  };
  const prefs = Object.assign({ master: 0.8, music: 0.7, sfx: 0.9, shake: true, grain: true, weather: true, brightness: 1, killer: 'myers', diff: 'normal' }, store.load());

  function init(game) {
    g = game;
    selKiller = prefs.killer in KILLERS || prefs.killer === 'random' ? prefs.killer : 'myers';
    $('difficulty').value = prefs.diff;
    applyPrefs();
    buildLineup();
    selectKiller(selKiller, true);
    window.addEventListener('keydown', (e) => {
      if ($('menu').classList.contains('hidden') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const i = ORDER.indexOf(selKiller);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') selectKiller(ORDER[(i + 1) % ORDER.length]);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') selectKiller(ORDER[(i + ORDER.length - 1) % ORDER.length]);
      else if (e.code === 'Enter') $('btn-start').click();
    });
    $('btn-start').onclick = () => { Sound.init(); Sound.play('ui'); prefs.killer = selKiller; prefs.diff = $('difficulty').value; store.save(prefs); g.newGame(selKiller === 'random' ? U.pick(Object.keys(KILLERS)) : selKiller, prefs.diff); };
    $('btn-settings').onclick = () => { Sound.init(); openSettings('menu'); };
    $('btn-howto').onclick = () => { show('howto'); hide('menu'); $('btn-howto-close').onclick = () => { hide('howto'); show('menu'); }; };
    $('btn-settings-close').onclick = closeSettings;
    $('btn-ai-test').onclick = testAI;
    $('btn-resume').onclick = () => g.resume();
    $('btn-pause-settings').onclick = () => openSettings('pause');
    $('btn-pause-howto').onclick = () => { hide('pause'); show('howto'); $('btn-howto-close').onclick = () => { hide('howto'); show('pause'); }; };
    $('btn-quit').onclick = () => g.toMenu();
    $('btn-retry').onclick = () => { hide('end'); g.newGame(g.profile.id, g.diffKey); };
    $('btn-menu').onclick = () => g.toMenu();
    $('dlg-close').onclick = closeDialog;
    $('dlg-send').onclick = sendDialog;
    $('dlg-input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendDialog(); if (e.key === 'Escape') closeDialog(); });
    $('dlg-input').addEventListener('keyup', (e) => e.stopPropagation());
    document.querySelectorAll('#settings input').forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
    // first interaction unlocks audio for menu music
    const unlock = () => { Sound.init(); Sound.menu(menuMusic()); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    updateAIBadge();
    showMenu();
  }
  function applyPrefs() {
    Sound.setVolumes({ master: prefs.master, music: prefs.music, sfx: prefs.sfx });
    Render.settings.shake = prefs.shake; Render.settings.grain = prefs.grain; Render.settings.weather = prefs.weather; Render.settings.brightness = prefs.brightness;
  }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  // ---------------- menu ----------------
  function menuMusic() { return selKiller === 'random' ? 'shape' : KILLERS[selKiller].music; }
  function records() { try { return JSON.parse(localStorage.getItem('ahn_records') || '{}'); } catch (e) { return {}; } }
  // ---------------- killer select: close-up spotlight + lineup ----------------
  const ORDER = Object.keys(KILLERS).concat(['random']);
  const KCOL = { myers: '#e2701f', jason: '#7fbf6a', ghostface: '#c8c8ff', freddy: '#e8503a', leatherface: '#d8c070', chucky: '#e8602a', random: '#b3161a' };
  const RANDOM_K = { name: 'Random', location: 'Anywhere', date: 'Any night', tagline: 'You won\'t know who until it\'s too late.', desc: 'Let fate decide who comes for you tonight. You won\'t find out until the intro.' };
  const feat = { trans: 0, blink: 0, nextBlink: 2.5, eye: 0, nextEye: 4, lunge: 0, nextLunge: 6, parts: [], flick: 1, glint: 0 };
  function buildLineup() {
    const wrap = $('lineup'); wrap.innerHTML = '';
    for (const id of ORDER) {
      const d = document.createElement('div');
      d.className = 'lu'; d.dataset.id = id; d.style.setProperty('--kc', KCOL[id]);
      const cv = document.createElement('canvas'); cv.width = 132; cv.height = 145;
      d.appendChild(cv);
      d.insertAdjacentHTML('beforeend', `<div class="nm">${(KILLERS[id] || RANDOM_K).name}</div>`);
      d.onclick = () => selectKiller(id);
      d.onmouseenter = () => { if (Sound.ready) Sound.play('click', { vol: 0.25 }); };
      wrap.appendChild(d);
      const c = cv.getContext('2d');
      const bg = c.createRadialGradient(66, 60, 10, 66, 70, 110); bg.addColorStop(0, '#1c1210'); bg.addColorStop(1, '#000');
      c.fillStyle = bg; c.fillRect(0, 0, 132, 145);
      if (id === 'random') { c.fillStyle = '#b3161a'; c.font = '86px Creepster'; c.textAlign = 'center'; c.fillText('?', 66, 108); }
      else Sprites.face(c, id, 66, 82, 132);
      const vg = c.createRadialGradient(66, 70, 30, 66, 70, 100); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.85)');
      c.fillStyle = vg; c.fillRect(0, 0, 132, 145);
    }
  }
  function records() { try { return JSON.parse(localStorage.getItem('ahn_records') || '{}'); } catch (e) { return {}; } }
  function menuMusic() { return selKiller === 'random' ? 'shape' : KILLERS[selKiller].music; }
  function selectKiller(id, silent) {
    if (id === selKiller && !silent) return;
    selKiller = id;
    feat.trans = silent ? 0.6 : 1; feat.parts.length = 0;
    if (!silent && Sound.ready) { Sound.play('stinger', { vol: 0.28 }); Sound.menu(menuMusic()); }
    const k = KILLERS[id] || RANDOM_K;
    $('feature').style.setProperty('--kc', KCOL[id]);
    const r = records()[id];
    const fill = (el, html) => { const e = $(el); e.innerHTML = html; e.classList.remove('reveal'); void e.offsetWidth; e.classList.add('reveal'); };
    fill('f-loc', `${k.location} — ${k.date}`);
    fill('f-name', k.name);
    fill('f-tag', `"${k.tagline}"`);
    fill('f-desc', k.desc);
    fill('f-rec', r ? `Escaped ${r.wins}× · Died ${r.deaths}×${r.best != null ? ' · Best escape ' + U.fmtClock(r.best) : ''}` : (KILLERS[id] ? 'You have never survived him.' : ''));
    document.querySelectorAll('.lu').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }

  // animated close-up, drawn every frame while the menu is open
  function drawFeature(t, dt) {
    const cv = $('feature-cv');
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d');
    const id = selKiller;
    feat.trans = Math.max(0, feat.trans - dt * 1.6);
    const tr = feat.trans;
    // ---- themed backdrop ----
    const BG = { myers: ['#140a06', '#000'], jason: ['#06120c', '#000'], ghostface: ['#0a0814', '#000'], freddy: ['#220806', '#050000'], leatherface: ['#1a140a', '#000'], chucky: ['#140a18', '#000'], random: ['#0a0a0a', '#000'] }[id];
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, BG[0]); bg.addColorStop(1, BG[1]);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    scene(c, id, W, H, t, dt);
    // ---- the face, close ----
    const fs = H * 1.08;
    const cx = W * (W > 760 ? 0.36 : 0.5) + tr * tr * W * 0.25, cy = H * 0.56;
    let sc = 1 + Math.sin(t * 1.4) * 0.012, rot = Math.sin(t * 0.55) * 0.02;
    if (id === 'myers') { const ph = (t % 9) / 9; rot += ph > 0.4 && ph < 0.85 ? 0.17 * Math.sin((ph - 0.4) / 0.45 * Math.PI) : 0; }
    if (id === 'ghostface') { feat.nextLunge -= dt; if (feat.nextLunge <= 0) { feat.nextLunge = U.rf(6, 10); feat.lunge = 1; } feat.lunge = Math.max(0, feat.lunge - dt * 2.2); sc += Math.sin(feat.lunge * Math.PI) * 0.12; }
    if (id === 'chucky') rot += Math.sin(t * 3.1) * 0.015;
    c.save();
    c.globalAlpha = 1 - tr * 0.85;
    c.translate(cx, cy); c.rotate(rot); c.scale(sc, sc);
    if (id === 'random') {
      const ids = Object.keys(KILLERS);
      const pid = ids[Math.floor(t * 2.5) % ids.length];
      c.globalAlpha *= 0.18 + Math.random() * 0.12;
      Sprites.face(c, pid, 0, 0, fs);
      c.globalAlpha = 1 - tr * 0.85;
      c.fillStyle = '#b3161a'; c.font = `${Math.round(fs * 0.6)}px Creepster`; c.textAlign = 'center'; c.fillText('?', U.rf(-3, 3), fs * 0.2 + U.rf(-3, 3));
    } else {
      Sprites.face(c, id, 0, 0, fs);
      faceExtras(c, id, fs, t, dt);
    }
    c.restore();
    // ---- flickering key light ----
    if (Math.random() < 0.03) feat.flick = Math.random() < 0.6 ? U.rf(0.15, 0.5) : 1;
    feat.flick = Math.min(1, feat.flick + dt * 1.8);
    const lx = cx - fs * 0.3 + Math.sin(t * 0.7) * 18, ly = cy - fs * 0.35;
    // grade the whole frame toward the killer's palette
    const TINT = { myers: '255,214,176', jason: '176,214,196', ghostface: '170,184,255', freddy: '255,150,120', leatherface: '255,214,150', chucky: '226,176,255', random: '220,200,200' }[id];
    c.globalCompositeOperation = 'multiply'; c.fillStyle = `rgb(${TINT})`; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over';
    const fl = 1 - feat.flick;
    const dark = c.createRadialGradient(lx, ly, fs * 0.05, cx + fs * 0.1, cy + fs * 0.1, fs * 0.8);
    dark.addColorStop(0, `rgba(0,0,0,${fl * 0.5})`); dark.addColorStop(0.3, `rgba(0,0,0,${0.18 + fl * 0.5})`); dark.addColorStop(0.62, `rgba(0,0,0,${0.62 + fl * 0.3})`); dark.addColorStop(1, 'rgba(0,0,0,0.96)');
    c.fillStyle = dark; c.fillRect(0, 0, W, H);
    // colored underlight
    c.globalCompositeOperation = 'lighter';
    const col = hexRGB(KCOL[id]);
    const ul = c.createRadialGradient(cx, H * 1.05, 0, cx, H * 1.05, H * 0.9);
    ul.addColorStop(0, `rgba(${col},${0.16 * feat.flick})`); ul.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = ul; c.fillRect(0, 0, W, H);
    // foreground particles
    for (let i = feat.parts.length - 1; i >= 0; i--) {
      const p = feat.parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) { feat.parts.splice(i, 1); continue; }
      const a = Math.min(1, p.life / p.max * 2);
      if (p.kind === 'ember' || p.kind === 'spark') { c.fillStyle = p.kind === 'spark' ? `rgba(255,230,140,${a})` : `rgba(255,${110 + Math.random() * 80},40,${a})`; c.fillRect(p.x, p.y, p.s, p.s); }
    }
    c.globalCompositeOperation = 'source-over';
    for (const p of feat.parts) if (p.kind === 'smoke' || p.kind === 'vapor') {
      const a = Math.min(1, p.life / p.max) * (p.kind === 'vapor' ? 0.22 : 0.35);
      c.fillStyle = p.kind === 'vapor' ? `rgba(210,215,230,${a})` : `rgba(30,28,26,${a})`;
      c.beginPath(); c.arc(p.x, p.y, p.s * (1 + (1 - p.life / p.max) * 2), 0, TAU); c.fill();
    }
    // ---- film: scanlines, grain, vignette, glitch ----
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    c.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < 160; i++) c.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    if (Math.random() < 0.12) { c.fillStyle = 'rgba(220,210,190,0.07)'; c.fillRect(Math.random() * W, 0, 1, H); }
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
    const gl = tr > 0.05 ? tr : Math.random() < 0.01 ? 0.4 : 0;
    if (gl) {
      for (let i = 0; i < 8 * gl; i++) { const y = Math.random() * H, h = U.rf(3, 30) * gl; c.drawImage(cv, 0, y, W, h, U.rf(-50, 50) * gl, y, W, h); }
      if (tr > 0.6) { c.fillStyle = `rgba(255,255,255,${(tr - 0.6) * 0.6})`; c.fillRect(0, 0, W, H); }
    }
  }
  function hexRGB(h) { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

  function scene(c, id, W, H, t, dt) {
    const P = feat.parts;
    c.fillStyle = '#020101';
    if (id === 'myers' || id === 'ghostface' || id === 'random') {
      c.fillStyle = 'rgba(220,200,170,0.6)'; c.beginPath(); c.arc(W * 0.62, H * 0.2, H * 0.08, 0, TAU); c.fill();
      c.fillStyle = 'rgba(10,6,6,0.7)'; c.beginPath(); c.arc(W * 0.62 + H * 0.025, H * 0.2 - H * 0.015, H * 0.075, 0, TAU); c.fill();
      c.fillStyle = '#030202';
      for (let i = 0; i < 5; i++) { const hx = i * W / 4 - 30, hy = H * 0.66, hw = W / 5; c.fillRect(hx, hy, hw, H); c.beginPath(); c.moveTo(hx - 10, hy); c.lineTo(hx + hw / 2, hy - H * 0.13); c.lineTo(hx + hw + 10, hy); c.fill();
        const on = Math.sin(i * 5.1 + Math.floor(t * 0.4)) > 0.2; if (on) { c.fillStyle = id === 'ghostface' ? 'rgba(120,150,255,0.35)' : 'rgba(230,150,60,0.35)'; c.fillRect(hx + hw * 0.35, hy + H * 0.06, H * 0.03, H * 0.04); c.fillStyle = '#030202'; } }
      if (Math.random() < 0.3) P.push({ kind: 'smoke', x: Math.random() * W, y: H * 0.95, vx: U.rf(10, 30), vy: U.rf(-8, -2), s: U.rf(14, 30), life: 4, max: 4 });
    } else if (id === 'jason') {
      for (let i = 0; i < 12; i++) { const x = i * W / 10 - 20 + Math.sin(t * 0.5 + i) * 3; c.beginPath(); c.moveTo(x - W * 0.05, H); c.lineTo(x, H * (0.25 + (i % 3) * 0.1)); c.lineTo(x + W * 0.05, H); c.fill(); }
      c.strokeStyle = 'rgba(150,170,200,0.25)'; c.lineWidth = 1; c.beginPath();
      for (let i = 0; i < 70; i++) { const x = (Math.random() * W * 1.2), y = Math.random() * H; c.moveTo(x, y); c.lineTo(x - 4, y + 16); } c.stroke();
    } else if (id === 'freddy') {
      c.fillStyle = '#1a0604'; for (let i = 0; i < 7; i++) c.fillRect(i * W / 6 - 10, 0, W * 0.025, H);
      c.fillRect(0, H * 0.28, W, H * 0.03); c.fillRect(0, H * 0.78, W, H * 0.04);
      const fg = c.createRadialGradient(W * 0.15, H, 0, W * 0.15, H, H * 0.9); fg.addColorStop(0, `rgba(255,80,20,${0.35 + Math.sin(t * 4) * 0.08})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = fg; c.fillRect(0, 0, W, H);
      if (Math.random() < 0.5) P.push({ kind: 'ember', x: Math.random() * W, y: H + 4, vx: U.rf(-15, 15), vy: U.rf(-40, -110), s: U.rf(1.5, 3), life: U.rf(2, 4), max: 4 });
      if (Math.random() < 0.15) P.push({ kind: 'smoke', x: Math.random() * W, y: H * 0.3, vx: U.rf(-5, 5), vy: U.rf(10, 25), s: U.rf(10, 22), life: 3, max: 3 });
    } else if (id === 'leatherface') {
      c.fillStyle = 'rgba(200,120,60,0.15)'; c.fillRect(0, H * 0.45, W, H * 0.1);
      c.fillStyle = '#050402'; c.fillRect(W * 0.62, H * 0.38, W * 0.22, H * 0.4); c.beginPath(); c.moveTo(W * 0.6, H * 0.4); c.lineTo(W * 0.73, H * 0.24); c.lineTo(W * 0.86, H * 0.4); c.fill();
      c.fillStyle = `rgba(230,160,60,${0.4 + Math.random() * 0.1})`; c.fillRect(W * 0.7, H * 0.5, H * 0.03, H * 0.04);
      c.strokeStyle = '#060502'; c.lineWidth = 3;
      for (let i = 0; i < 60; i++) { const x = i * W / 50, sw = Math.sin(t * 1.3 + i * 0.4) * 6; c.beginPath(); c.moveTo(x, H); c.quadraticCurveTo(x + sw * 0.5, H * 0.8, x + sw, H * (0.58 + (i % 4) * 0.03)); c.stroke(); }
      if (Math.random() < 0.25) P.push({ kind: 'smoke', x: W * U.rf(0.2, 0.5), y: H, vx: U.rf(-10, 10), vy: U.rf(-20, -40), s: U.rf(10, 24), life: 3.5, max: 3.5 });
      if (Math.random() < 0.08) for (let i = 0; i < 8; i++) P.push({ kind: 'spark', x: W * 0.4, y: H * 0.95, vx: U.rf(-90, 90), vy: U.rf(-160, -40), s: 2, life: 0.5, max: 0.5 });
    } else if (id === 'chucky') {
      const cols = ['#3a1010', '#10203a', '#30300c', '#2a103a'];
      for (let i = 0; i < 9; i++) { c.fillStyle = cols[i % 4]; const s = H * 0.11; c.fillRect(W * 0.55 + (i % 4) * s * 1.05, H - s * (1 + Math.floor(i / 4)) - 2, s, s); }
      for (let i = 0; i < 3; i++) { const x = W * (0.6 + i * 0.12), y = H * 0.25 + Math.sin(t * 0.8 + i * 2) * 10; c.strokeStyle = '#111'; c.beginPath(); c.moveTo(x, y + H * 0.06); c.lineTo(x + 3, y + H * 0.3); c.stroke(); c.fillStyle = ['#5a1010', '#10305a', '#5a5010'][i]; c.beginPath(); c.ellipse(x, y, H * 0.04, H * 0.05, 0, 0, TAU); c.fill(); }
      const sp = c.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, H); sp.addColorStop(0, `rgba(160,60,200,${0.12 + Math.sin(t * 2) * 0.04})`); sp.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sp; c.fillRect(0, 0, W, H);
    }
  }
  function faceExtras(c, id, s, t, dt) {
    const P = feat.parts;
    if (id === 'myers') {
      // something glints, deep in the sockets
      feat.nextEye -= dt; if (feat.nextEye <= 0) { feat.nextEye = U.rf(5, 9); feat.eye = 0.35; }
      if (feat.eye > 0) { feat.eye -= dt; c.fillStyle = `rgba(255,250,235,${Math.min(1, feat.eye * 5)})`; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * s * 0.155, -s * 0.03, s * 0.012, 0, TAU); c.fill(); } }
    } else if (id === 'jason') {
      if (Math.random() < 0.12 && Math.sin(t * 1.4) > 0.3) P.push({ kind: 'vapor', x: c.getTransform().e + U.rf(-10, 10), y: c.getTransform().f + s * 0.32, vx: U.rf(-15, 15), vy: U.rf(-25, -10), s: U.rf(6, 12), life: 1.6, max: 1.6 });
    } else if (id === 'freddy') {
      feat.glint = (feat.glint + dt * 0.6) % 1.6;
      if (feat.glint < 1) { const i = Math.floor(feat.glint * 4), f = feat.glint * 4 - i; const x = s * (0.38 + i * 0.07) * f + s * (0.4 + i * 0.05) * (1 - f), y = s * 0.36 + (-s * 0.15 - i * s * 0.03 - s * 0.36) * f;
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(x - 1, y - s * 0.03, 2, s * 0.06); c.fillRect(x - s * 0.03, y - 1, s * 0.06, 2); }
    } else if (id === 'chucky') {
      feat.nextBlink -= dt; if (feat.nextBlink <= 0) { feat.nextBlink = U.rf(2.5, 5); feat.blink = 0.14; }
      if (feat.blink > 0) { feat.blink -= dt; c.fillStyle = '#e8b890'; for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * s * 0.16, -s * 0.02, s * 0.11, s * 0.08, 0, 0, TAU); c.fill(); c.strokeStyle = '#7a4a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(sx * s * 0.06, -s * 0.01); c.lineTo(sx * s * 0.26, -s * 0.01); c.stroke(); } }
    }
  }
  function showMenu() {
    show('menu'); hide('hud'); hide('end'); hide('pause'); hide('dialog');
    if ($('lineup').children.length) selectKiller(selKiller, true);
    const cv = $('menu-bg'), c = cv.getContext('2d');
    let t0 = performance.now();
    const fogs = Array.from({ length: 30 }, () => ({ x: Math.random(), y: 0.55 + Math.random() * 0.45, r: U.rf(80, 220), v: U.rf(5, 20) }));
    const lv = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), s: U.rf(0.02, 0.06), r: Math.random() * 6 }));
    let flick = 1;
    function frame(now) {
      if ($('menu').classList.contains('hidden')) { menuAnim = null; return; }
      const t = (now - t0) / 1000;
      cv.width = window.innerWidth; cv.height = window.innerHeight;
      const W = cv.width, H = cv.height;
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#0a0606'); sky.addColorStop(0.6, '#140806'); sky.addColorStop(1, '#000');
      c.fillStyle = sky; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(220,200,170,0.85)'; c.beginPath(); c.arc(W * 0.82, H * 0.18, 46, 0, TAU); c.fill();
      c.fillStyle = 'rgba(10,6,6,0.6)'; c.beginPath(); c.arc(W * 0.82 + 14, H * 0.18 - 8, 42, 0, TAU); c.fill();
      // houses
      c.fillStyle = '#030202';
      for (let i = 0; i < 6; i++) {
        const hx = i * W / 5 - 40, hy = H * 0.68, hw = W / 6;
        c.fillRect(hx, hy, hw, H); c.beginPath(); c.moveTo(hx - 10, hy); c.lineTo(hx + hw / 2, hy - 70); c.lineTo(hx + hw + 10, hy); c.fill();
        if (Math.sin(i * 7.3) > 0) { c.fillStyle = `rgba(230,160,70,${0.35 * flick})`; c.fillRect(hx + hw * 0.3, hy + 30, 18, 22); c.fillStyle = '#030202'; }
      }
      if (Math.random() < 0.02) flick = Math.random() < 0.5 ? 0.2 : 1;
      // fog
      for (const f of fogs) {
        f.x += f.v / W * 0.016; if (f.x > 1.2) f.x = -0.2;
        const gr = c.createRadialGradient(f.x * W, f.y * H, 0, f.x * W, f.y * H, f.r);
        gr.addColorStop(0, 'rgba(120,110,110,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr; c.fillRect(f.x * W - f.r, f.y * H - f.r, f.r * 2, f.r * 2);
      }
      for (const l of lv) {
        l.x += l.s * 0.01; l.y += l.s * 0.006; l.r += 0.03;
        if (l.x > 1.05) l.x = -0.05; if (l.y > 1.05) l.y = -0.05;
        c.save(); c.translate(l.x * W, l.y * H); c.rotate(l.r); c.fillStyle = 'rgba(140,60,20,0.5)'; c.fillRect(-4, -2, 8, 4); c.restore();
      }
      const vg = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.85)');
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
      drawFeature(t, Math.min(0.05, t - (frame.last || t)));
      frame.last = t;
      menuAnim = requestAnimationFrame(frame);
    }
    if (!menuAnim) menuAnim = requestAnimationFrame(frame);
  }

  // ---------------- settings ----------------
  let settingsFrom = 'menu';
  function openSettings(from) {
    settingsFrom = from;
    hide(from); show('settings');
    $('set-ai-enabled').checked = LLM.cfg.enabled;
    $('set-ai-key').value = LLM.cfg.key;
    $('set-ai-model').value = LLM.cfg.model;
    $('set-ai-interval').value = LLM.cfg.interval;
    $('set-ai-killer').checked = LLM.cfg.killer;
    $('set-ai-npc').checked = LLM.cfg.npc;
    $('set-debug').checked = LLM.cfg.debug;
    $('set-vol-master').value = prefs.master; $('set-vol-music').value = prefs.music; $('set-vol-sfx').value = prefs.sfx;
    $('set-bright').value = prefs.brightness; $('set-bright').oninput = readSettings;
    $('set-shake').checked = prefs.shake; $('set-grain').checked = prefs.grain; $('set-weather').checked = prefs.weather;
    $('ai-test-result').textContent = '';
    ['set-vol-master', 'set-vol-music', 'set-vol-sfx'].forEach((id) => { $(id).oninput = readSettings; });
  }
  function readSettings() {
    LLM.cfg.enabled = $('set-ai-enabled').checked;
    LLM.cfg.key = $('set-ai-key').value.trim();
    LLM.cfg.model = $('set-ai-model').value.trim() || 'openai/gpt-4o-mini';
    LLM.cfg.interval = U.clamp(+$('set-ai-interval').value || 18, 8, 120);
    LLM.cfg.killer = $('set-ai-killer').checked;
    LLM.cfg.npc = $('set-ai-npc').checked;
    LLM.cfg.debug = $('set-debug').checked;
    LLM.save();
    prefs.master = +$('set-vol-master').value; prefs.music = +$('set-vol-music').value; prefs.sfx = +$('set-vol-sfx').value;
    prefs.brightness = +$('set-bright').value;
    prefs.shake = $('set-shake').checked; prefs.grain = $('set-grain').checked; prefs.weather = $('set-weather').checked;
    store.save(prefs); applyPrefs();
  }
  function closeSettings() { readSettings(); hide('settings'); show(settingsFrom); updateAIBadge(); }
  async function testAI() {
    readSettings();
    const el = $('ai-test-result');
    if (!LLM.cfg.key) { el.textContent = 'Enter an API key first.'; el.style.color = '#c88'; return; }
    const was = LLM.cfg.enabled; LLM.cfg.enabled = true;
    el.textContent = 'Testing...'; el.style.color = '#aaa';
    try { const t = await LLM.test(); el.textContent = `✓ Connected (${LLM.stats.lastMs} ms): "${t.slice(0, 30)}"`; el.style.color = '#7fd17f'; }
    catch (e) { el.textContent = '✗ ' + (LLM.stats.lastError || e.message); el.style.color = '#e77'; }
    LLM.cfg.enabled = was;
  }
  function updateAIBadge() {
    const b = $('ai-badge');
    if (LLM.active()) { b.textContent = `◉ OpenRouter AI active — ${LLM.cfg.model}`; b.className = 'on'; }
    else { b.textContent = '○ Built-in AI (add an OpenRouter key in Settings for LLM-driven killers & NPCs)'; b.className = ''; }
  }

  // ---------------- HUD ----------------
  function startHUD() { hide('menu'); show('hud'); $('messages').innerHTML = ''; $('subtitle').textContent = ''; invHash = ''; msgs.length = 0; }
  function message(text, color = '#ddd', dur = 4.5) {
    const el = document.createElement('div');
    el.className = 'msg'; el.textContent = text; el.style.color = color;
    $('messages').appendChild(el);
    msgs.push({ el, t: dur });
    while (msgs.length > 5) { const m = msgs.shift(); m.el.remove(); }
  }
  function subtitle(who, text, dur = 4, cls = '') {
    const el = $('subtitle');
    el.className = cls;
    el.innerHTML = who ? `<span class="who">${esc(who)}:</span> ${esc(text)}` : esc(text);
    subT = dur;
  }
  function bigText(text, color = '#b3161a', dur = 2) {
    if (!text) return;
    const el = $('bigtext'); el.textContent = text; el.style.color = color; el.classList.add('show'); bigT = dur;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

  function updateHUD(dt) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]; m.t -= dt;
      if (m.t < 1) m.el.style.opacity = Math.max(0, m.t);
      if (m.t <= 0) { m.el.remove(); msgs.splice(i, 1); }
    }
    if (subT > 0) { subT -= dt; if (subT <= 0) $('subtitle').textContent = ''; }
    if (bigT > 0) { bigT -= dt; if (bigT <= 0) $('bigtext').classList.remove('show'); }
    hudT -= dt;
    const P = g.player;
    setBar('bar-hp', P.hp); setBar('bar-st', P.stamina); setBar('bar-fear', P.fear); setBar('bar-bat', P.battery);
    const sleepy = g.killer && g.killer.has('dream');
    $('bar-sleep').classList.toggle('hidden', !sleepy);
    if (sleepy) { setBar('bar-sleep', g.dream.active ? 100 : P.sleep); $('bar-sleep').classList.toggle('high', P.sleep > 75 || g.dream.active); $('bar-sleep').querySelector('span').textContent = g.dream.active ? 'DREAMING' : 'DROWSY'; }
    $('bar-fear').classList.toggle('high', P.fear > 70);
    // prompt
    const it = P.inter;
    const pr = $('prompt');
    if (g.state === 'play' && it) {
      const t = `<b>[E]</b> ${esc(it.label)}${it.need ? ' <span style="color:#888">(hold)</span>' : ''}`;
      if (pr.innerHTML !== t) pr.innerHTML = t;
    } else if (P.hidden && g.state === 'play') { const t = '<b>[E]</b> Leave &nbsp; <b>[Shift]</b> Hold breath'; if (pr.innerHTML !== t) pr.innerHTML = t; }
    else if (pr.innerHTML) pr.innerHTML = '';
    const prog = $('progress');
    if (P.interProg > 0 && it && it.need) { prog.style.display = 'block'; prog.firstElementChild.style.width = Math.min(100, P.interProg * 100) + '%'; }
    else prog.style.display = 'none';
    if (hudT > 0) return;
    hudT = 0.15;
    $('clock').textContent = U.fmtClock(g.clockMin);
    $('location').textContent = g.placeName(P.x, P.y, true);
    // objectives
    const obj = g.objectives();
    const html = obj.map((o) => `<li class="${o.state || ''}">${o.state === 'done' ? '✓' : o.state === 'fail' ? '✗' : '•'} ${esc(o.text)}${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</li>`).join('');
    if ($('objectives').innerHTML !== html) $('objectives').innerHTML = html;
    // police
    const pol = g.police;
    let ps = '';
    if (pol.level > 0) {
      const lv = ['', 'Patrol', 'Backup', 'Sheriff & Tactical'][pol.level];
      const onScene = pol.cops.filter((c) => !c.dead).length;
      ps = `🚨 Police: ${lv}` + (pol.eta != null ? ` — ETA ${Math.ceil(pol.eta)}s` : '') + (onScene ? ` — ${onScene} on scene` : '') + (pol.officersDown ? ` <span class="red">(${pol.officersDown} down)</span>` : '');
    }
    if ($('police-status').innerHTML !== ps) $('police-status').innerHTML = ps;
    const k = g.killer;
    const pips = [0, 1, 2].map((i) => `<span class="pip${i <= k.level ? ' on' : ''}"></span>`).join('');
    const ev = `${g.profile.id === 'jason' ? 'RAGE' : 'EVIL'} ${pips}`;
    if ($('evil').innerHTML !== ev) $('evil').innerHTML = ev;
    $('ai-status').textContent = LLM.active() ? `◉ AI director: ${LLM.cfg.model}${LLM.stats.inflight ? ' (thinking…)' : ''}${LLM.stats.fail ? ` · ${LLM.stats.fail} err` : ''}` : '';
    $('debug-ai').textContent = LLM.cfg.debug ? `[killer] ${k.debug} | L${k.level} xp ${Math.round(k.xp)}` : '';
    const tags = [];
    if (P.hidden) tags.push(P.holdBreath ? 'HOLDING BREATH' : 'HIDDEN');
    if (P.crouch) tags.push('CROUCHED');
    if (P.exhausted) tags.push('EXHAUSTED');
    if (P.fear > 90) tags.push('PANIC');
    else if (P.fear > 70) tags.push('TERRIFIED');
    if (P.equipped) tags.push('ARMED: ' + ITEMS[P.equipped].name.toUpperCase());
    $('status-tags').textContent = tags.join(' · ');
    // inventory
    const h = P.inv.map((s) => s.id + s.n).join(',') + '|' + P.equipped + '|' + P.cellCharge + '|' + P.ammo;
    if (h !== invHash) {
      invHash = h;
      const inv = $('inventory'); inv.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const s = P.inv[i];
        const d = document.createElement('div'); d.className = 'slot' + (s && s.id === P.equipped ? ' eq' : '');
        d.innerHTML = `<span class="k">${i + 1}</span>`;
        if (s) {
          d.appendChild(Sprites.icon(s.id).cloneNode(true)).getContext('2d').drawImage(Sprites.icon(s.id), 0, 0);
          if (s.n > 1) d.insertAdjacentHTML('beforeend', `<span class="n">${s.n}</span>`);
          if (s.id === 'revolver') d.insertAdjacentHTML('beforeend', `<span class="n">${P.ammo}●</span>`);
          if (s.id === 'cellphone') d.insertAdjacentHTML('beforeend', `<span class="n">${P.cellCharge}⚡</span>`);
          d.insertAdjacentHTML('beforeend', `<span class="nm">${ITEMS[s.id].name}</span>`);
          d.title = ITEMS[s.id].desc;
        }
        inv.appendChild(d);
      }
    }
  }
  function setBar(id, v) { const f = $(id).querySelector('.fill'); const w = U.clamp(v, 0, 100) + '%'; if (f.style.width !== w) f.style.width = w; }

  function toggleMap() {
    const mm = $('minimap');
    if (mm.classList.contains('hidden')) { Render.minimap(g, mm); mm.classList.remove('hidden'); }
    else mm.classList.add('hidden');
  }
  function refreshMap() { const mm = $('minimap'); if (!mm.classList.contains('hidden')) Render.minimap(g, mm); }

  // ---------------- dialog ----------------
  function openDialog(r) {
    if (r.dead) return;
    dlgRes = r; g.state = 'dialog';
    show('dialog');
    $('dlg-name').textContent = r.name;
    $('dlg-mood').textContent = `${r.ageWord} · ${r.moodWord()}` + (r.house ? ` · lives at ${r.house.address || r.house.name}` : '');
    Sprites.portrait($('dlg-portrait'), r.spec, { scale: 4, dy: -4 });
    $('dlg-log').innerHTML = '';
    const ai = LLM.active() && LLM.cfg.npc;
    $('dlg-input-row').style.display = ai ? 'flex' : 'none';
    log('sys', ai ? 'Type anything, or pick an option. Time slows while you talk, but it doesn\'t stop.' : 'Time slows while you talk, but it doesn\'t stop.');
    const greet = r.state === 'follow' ? 'What do we do?!' : r.mem.killerSeen ? 'Oh thank God, someone else! Did you see him?!' : U.pick(LINES.greet);
    log('them', greet);
    buildChoices();
    if (ai) setTimeout(() => $('dlg-input').focus(), 50);
  }
  function buildChoices() {
    const r = dlgRes;
    const wrap = $('dlg-choices'); wrap.innerHTML = '';
    const opts = [
      ['seen', 'What have you seen tonight?'],
      ['follow', r.state === 'follow' ? '(They are following you)' : 'Come with me. It\'s not safe here.'],
      ['stay', 'Lock your doors and hide.'],
      ['call', 'Call the police!'],
      ['item', 'Do you have anything that could help?'],
    ];
    for (const [id, text] of opts) {
      const b = document.createElement('button');
      b.textContent = text;
      if (id === 'follow' && r.state === 'follow') b.disabled = true;
      b.onclick = () => choose(id, text);
      wrap.appendChild(b);
    }
  }
  function log(cls, text) {
    const el = document.createElement('div'); el.className = cls;
    el.textContent = cls === 'you' ? '> ' + text : cls === 'them' ? `${dlgRes ? dlgRes.first : ''}: ${text}` : text;
    $('dlg-log').appendChild(el); $('dlg-log').scrollTop = 1e6;
    return el;
  }
  function choose(id, text) {
    if (dlgBusy || !dlgRes) return;
    log('you', text);
    const r = dlgRes;
    const res = r.respond(id);
    if (LLM.active() && LLM.cfg.npc && id !== 'follow' && id !== 'stay') {
      // let the AI phrase it, but keep the rule-based outcome
      askLLM(text, res.action, res.say);
      return;
    }
    log('them', res.say); r.say(res.say);
    r.chat.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(res) });
    r.applyAction(res.action);
    $('dlg-mood').textContent = `${r.ageWord} · ${r.moodWord()}`;
    buildChoices();
  }
  function sendDialog() {
    const inp = $('dlg-input');
    const text = inp.value.trim();
    if (!text || dlgBusy || !dlgRes) return;
    inp.value = '';
    log('you', text);
    askLLM(text, null, null);
  }
  function askLLM(text, forcedAction, fallbackSay) {
    const r = dlgRes;
    dlgBusy = true;
    const pending = log('sys', `${r.first} is thinking...`);
    const ctx = g.residentContext(r);
    const promptText = forcedAction ? `${text} (Respond in character. Your decision is already: ${forcedAction}. ${fallbackSay ? 'Gist: ' + fallbackSay : ''})` : text;
    LLM.resident(r, ctx, promptText).then((j) => {
      pending.remove();
      if (dlgRes !== r) return;
      const action = forcedAction || validAction(r, j.action);
      const say = (j.say || fallbackSay || '...').slice(0, 300);
      log('them', say); r.say(say, 4);
      r.trust = U.clamp(r.trust + (+j.trust_delta || 0.03), 0, 1);
      r.chat.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ say, action }) });
      if (action && action !== 'none') { log('sys', actionText(r, action)); r.applyAction(action); }
      buildChoices();
      $('dlg-mood').textContent = `${r.ageWord} · ${r.moodWord()}`;
    }).catch((e) => {
      pending.textContent = `(AI unavailable: ${LLM.stats.lastError || e.message})`;
      if (fallbackSay) { log('them', fallbackSay); r.say(fallbackSay); if (forcedAction) r.applyAction(forcedAction); }
      else { const s = U.pick(LINES.greet); log('them', s); }
    }).finally(() => { dlgBusy = false; });
  }
  function validAction(r, a) {
    const ok = ['none', 'follow', 'stay', 'call_police', 'give_item', 'flee', 'hide'];
    if (!ok.includes(a)) return 'none';
    if (a === 'give_item' && !r.item) return 'none';
    if (a === 'call_police' && !r.house.phoneObj) return 'none';
    return a;
  }
  function actionText(r, a) {
    return ({ follow: `${r.first} will follow you.`, stay: `${r.first} locks up and hides.`, call_police: `${r.first} goes to call the police.`, give_item: `${r.first} hands you something.`, flee: `${r.first} runs!`, hide: `${r.first} looks for somewhere to hide.` })[a] || '';
  }
  function closeDialog() {
    if (!dlgRes) return;
    dlgRes = null; hide('dialog');
    if (g.state === 'dialog') g.state = 'play';
    $('dlg-input').blur();
  }
  function dialogOpen() { return !!dlgRes; }
  function dialogTarget() { return dlgRes; }

  // ---------------- intro / end ----------------
  function intro(text, cb) {
    show('intro');
    const el = $('intro-text'); el.textContent = '';
    let i = 0, done = false;
    const finish = () => { if (done) return; done = true; hide('intro'); window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); cb(); };
    const skip = (e) => { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter' || e.type === 'pointerdown') finish(); };
    window.addEventListener('keydown', skip); window.addEventListener('pointerdown', skip);
    const type = () => {
      if (done) return;
      if (i <= text.length) { el.textContent = text.slice(0, i); i++; if (text[i - 1] !== ' ' && i % 2) Sound.play('click', { vol: 0.15 }); setTimeout(type, text[i - 1] === '\n' ? 260 : 38); }
      else setTimeout(finish, 2400);
    };
    type();
  }
  function end(win, title, sub, stats) {
    hide('hud'); hide('dialog'); hide('pause');
    const t = $('end-title'); t.textContent = title; t.className = win ? 'win' : 'lose';
    $('end-sub').textContent = sub;
    $('end-stats').innerHTML = stats.map(([a, b]) => `${a}: <b>${b}</b>`).join('<br>');
    show('end');
    const cv = $('end-bg'), c = cv.getContext('2d');
    const t0 = performance.now();
    const spec = Sprites.SPECS[g.profile.id];
    function frame(now) {
      if ($('end').classList.contains('hidden')) { endAnim = null; return; }
      cv.width = window.innerWidth; cv.height = window.innerHeight;
      const W = cv.width, H = cv.height, tt = (now - t0) / 1000;
      c.fillStyle = win ? '#0a0806' : '#080000'; c.fillRect(0, 0, W, H);
      if (win) { const gr = c.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, `rgba(120,70,40,${Math.min(0.5, tt * 0.05)})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
      const s = Math.floor(H / 70);
      c.imageSmoothingEnabled = false;
      if (win) {
        c.globalAlpha = 0.18;
        c.drawImage(Sprites.get(spec, 0, 0), W / 2 - 11 * s, H / 2 - 22 * s, 22 * s, 36 * s);
      } else {
        c.imageSmoothingEnabled = true;
        c.globalAlpha = Math.min(0.42, tt * 0.2) + Math.sin(tt * 1.7) * 0.03;
        Sprites.face(c, spec.kind, W / 2, H * 0.5, H * (0.62 + tt * 0.01));
        const ug = c.createLinearGradient(0, H, 0, 0); ug.addColorStop(0, 'rgba(120,0,0,0.5)'); ug.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalAlpha = 1; c.fillStyle = ug; c.fillRect(0, 0, W, H);
      }
      c.globalAlpha = 1;
      endAnim = requestAnimationFrame(frame);
    }
    if (!endAnim) endAnim = requestAnimationFrame(frame);
  }

  return {
    init, show, hide, showMenu, startHUD, message, subtitle, bigText, updateHUD, openDialog, closeDialog, dialogOpen, dialogTarget,
    intro, end, toggleMap, refreshMap, openSettings, updateAIBadge, prefs,
  };
})();
