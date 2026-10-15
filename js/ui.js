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
    selKiller = prefs.killer in KILLERS ? prefs.killer : 'myers';
    $('difficulty').value = prefs.diff;
    applyPrefs();
    buildCards();
    $('btn-start').onclick = () => { Sound.init(); Sound.play('ui'); prefs.killer = selKiller; prefs.diff = $('difficulty').value; store.save(prefs); g.newGame(selKiller, prefs.diff); };
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
    const unlock = () => { Sound.init(); Sound.menu(KILLERS[selKiller].music); window.removeEventListener('pointerdown', unlock); };
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
  function buildCards() {
    const wrap = $('killer-cards'); wrap.innerHTML = '';
    for (const id of Object.keys(KILLERS)) {
      const k = KILLERS[id];
      const card = document.createElement('div');
      card.className = 'kcard' + (id === selKiller ? ' sel' : '');
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = 170;
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `<h3>${k.name}</h3><div class="loc">${k.location} — ${k.date}</div><p>${k.desc}</p>`);
      card.onclick = () => { selKiller = id; Sound.init(); Sound.play('ui'); Sound.menu(k.music); buildCards(); };
      wrap.appendChild(card);
      drawCardArt(cv, id);
    }
  }
  function drawCardArt(cv, id) {
    const c = cv.getContext('2d');
    const k = KILLERS[id];
    const bg = c.createLinearGradient(0, 0, 0, 170);
    bg.addColorStop(0, id === 'jason' ? '#06100a' : id === 'ghostface' ? '#0a0612' : '#100804'); bg.addColorStop(1, '#000');
    c.fillStyle = bg; c.fillRect(0, 0, 300, 170);
    c.fillStyle = 'rgba(230,220,190,0.9)'; c.beginPath(); c.arc(250, 36, 16, 0, TAU); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(256, 32, 14, 0, TAU); c.fill();
    // silhouettes
    c.fillStyle = '#050505';
    if (id === 'jason') { for (let i = 0; i < 9; i++) { const x = i * 38 - 10; c.beginPath(); c.moveTo(x, 170); c.lineTo(x + 20, 60 + (i % 3) * 18); c.lineTo(x + 40, 170); c.fill(); } }
    else { c.fillRect(0, 110, 300, 60); c.beginPath(); c.moveTo(10, 110); c.lineTo(70, 70); c.lineTo(130, 110); c.fill(); c.fillRect(190, 95, 90, 20); c.beginPath(); c.moveTo(180, 95); c.lineTo(235, 60); c.lineTo(290, 95); c.fill(); c.fillStyle = '#d8a040'; c.fillRect(40, 92, 8, 8); c.fillRect(215, 100, 7, 7); }
    // figure
    const tmp = document.createElement('canvas'); tmp.width = 120; tmp.height = 170;
    Sprites.portrait(tmp, Sprites.SPECS[id], { scale: 5, dy: -10 });
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 90, 5);
    const lg = c.createRadialGradient(150, 60, 10, 150, 80, 160);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.8)');
    c.fillStyle = lg; c.fillRect(0, 0, 300, 170);
    c.fillStyle = k.id === 'myers' ? '#e2701f' : k.id === 'jason' ? '#7fbf6a' : '#d0d0ff';
    c.font = '13px "Special Elite"'; c.fillText(`"${k.tagline}"`, 10, 162);
  }
  function showMenu() {
    show('menu'); hide('hud'); hide('end'); hide('pause'); hide('dialog');
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
      // the figure, standing very still
      const s = Math.max(4, Math.floor(H / 120));
      const img = Sprites.get(Sprites.SPECS[selKiller], 0, 0);
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.85 + Math.sin(t * 0.7) * 0.1;
      c.drawImage(img, W * 0.72, H * 0.62 - 26 * s, 22 * s, 36 * s);
      c.globalAlpha = 1;
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
    const h = P.inv.map((s) => s.id + s.n).join(',') + '|' + P.equipped + '|' + P.cellCharge;
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
