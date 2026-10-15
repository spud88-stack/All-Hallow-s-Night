'use strict';
// ---------------------------------------------------------------------------
// Game: main loop, input, world rules, perception helpers, fear, events,
// the LLM director, and win / lose flow.
// ---------------------------------------------------------------------------
const Input = {
  keys: new Set(), pressedSet: new Set(), mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false }, mousePressed: false,
  key(c) { return this.keys.has(c); },
  pressed(c) { return this.pressedSet.has(c); },
  endFrame() { this.pressedSet.clear(); this.mousePressed = false; },
  init() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    const cv = document.getElementById('game');
    cv.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouse.down = true; this.mousePressed = true; } });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  },
};

const NIGHT_SECONDS = 14 * 60; // 9 PM -> 5 AM

const G = {
  state: 'menu', frame: 0, time: 0, input: Input,
  init() {
    Input.init();
    Render.init(document.getElementById('game'));
    this.ui = UI;
    UI.init(this);
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try { this.tick(dt); } catch (e) { console.error(e); }
      Input.endFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  // ======================================================================
  newGame(killerId, diffKey) {
    this.profile = KILLERS[killerId]; this.diffKey = diffKey; this.diff = DIFF[diffKey];
    UI.hide('menu'); UI.hide('end');
    RES_ID = 0;
    Render.reset();
    const m = this.map = MapGen.generate(this.profile.mapKind);
    m.nonSolid = m.objects.filter((o) => !o.solid);
    this.time = 0; this.clockMin = 0; this.frame = 0;
    this.noises = []; this.pendingNoises = []; this.speeches = []; this.bodies = []; this.flares = [];
    this.shakeAmt = 0; this.hurtFlash = 0; this.scareFlash = 0; this.senseFlash = 0; this.flash = 0; this.dawn = 0; this.fadeIn = 1;
    this.lastKillerSeenT = -99; this.exploreT = 0; this.lightT = 0; this.directorT = 12; this.directorBusy = false;
    this.lightningT = U.rf(40, 80); this.ringing = null; this.escapeCar = null; this.camOverride = null; this.ending = null;
    this.stats = { killed: 0, saved: 0, copsDown: 0 };
    this.jumpscare = null; this.lastJump = -99;
    const sp = m.playerSpawn || m.randomFloorIn(m.home) || m.randomOutdoor();
    this.player = new Player(this, (sp.x + 0.5) * TILE, (sp.y + 0.5) * TILE);
    this.player.addItem('candy', 1);
    this.police = new Police(this);
    this.spawnResidents();
    this.spawnKiller();
    Render.snapCam(this.player.x, this.player.y);
    Sound.stop();
    Sound.start(this.profile.music, this.profile.ambience);
    Sound.set({ intensity: 0, fear: 0, heart: 0, muffle: 0, hp: 1 });
    UI.startHUD();
    this.state = 'intro';
    UI.intro(this.profile.intro, () => {
      this.state = 'play';
      Input.pressedSet.clear(); Input.keys.clear();
      const home = m.home;
      UI.message(`${this.profile.date}. ${home.address || home.name}.`, '#e2701f', 6);
      UI.message('Find a way out: the car, the police, or dawn.', '#bbb', 7);
      this.explore(true);
    });
  },

  spawnResidents() {
    const m = this.map, kind = m.kind;
    this.residents = [];
    const houses = m.houses.filter((h) => !h.isPlayerHome && h.kind !== 'shed' && !h.noResidents);
    U.shuffle(houses);
    const total = kind === 'camp' ? 8 : kind === 'woodsboro' ? 9 : kind === 'texas' ? 6 : 7;
    const items = U.shuffle(['battery', 'bandage', 'flare', 'fuse', 'bat', 'battery', 'bandage', null, null, null]);
    const add = (H, o = {}) => {
      const r = new Resident(this, H, Object.assign({ surname: H.surname || U.pick(SURNAMES), item: items.pop() || null }, o));
      this.residents.push(r);
      return r;
    };
    if (kind === 'woodsboro') {
      const party = houses.find((h) => h.party);
      if (party) for (let i = 0; i < 4; i++) add(party, { age: 'teen', asleep: false, persona: U.pick(PERSONALITIES.filter((p) => p.id !== 'grumpy')), surname: null });
    }
    let i = 0;
    while (this.residents.length < total && houses.length) {
      const H = houses[i % houses.length];
      if (!H.party) add(H, kind === 'camp' || kind === 'texas' ? { age: U.pick(['teen', 'adult']), surname: null, asleep: U.chance(0.25) } : kind === 'elmstreet' ? { age: U.pick(['teen', 'teen', 'adult']), asleep: U.chance(0.55) } : {});
      i++;
      if (i > 40) break;
    }
    // what people know
    const kh = m.keyHouse;
    const keyObj = m.objects.find((o) => o.container && o.container.items.some((it) => it.id === 'keys'));
    const roomName = keyObj && keyObj.room != null && m.rooms[keyObj.room] ? m.rooms[keyObj.room].type : 'house';
    for (const r of this.residents) {
      if (kh && r.house === kh) r.knowledge.push(`The spare car keys? Your folks left them with us. They're in the ${niceName(keyObj.type).replace('the ', '')} in our ${roomName}.`);
      else if (kh && U.chance(0.45)) r.knowledge.push(`Car keys? I think the ${kh.surname ? kh.surname + 's' : kh.name.replace('the ', '')} were holding a spare set for your family.`);
      const tk = m.objects.find((o) => o.container && o.container.items.some((it) => it.id === 'toolkit'));
      if (tk && U.chance(0.3)) { const H = tk.house >= 0 ? m.houses[tk.house] : null; r.knowledge.push(`If you need tools, ${H ? H.name : 'someone around here'} has a toolkit somewhere.`); }
      if (r.house.phoneObj) r.knowledge.push('Our phone is in the living room if you need it.');
      if (kind === 'texas') r.knowledge.push(U.pick(['Don\'t go near that farmhouse. Folks go in, they don\'t come out.', 'The barn generator runs the road lights.', 'You hear that engine, you hide in the corn and you pray.']));
      if (kind === 'elmstreet') r.knowledge.push(U.pick(['Don\'t fall asleep. I mean it. Drink coffee. Anything.', 'If you\'re dreaming, find a clock. The alarm wakes you up.', 'Pain wakes you up. Sometimes.']));
      if (kind === 'lakeshore') r.knowledge.push(U.pick(['Somebody left dolls on every porch tonight. Creepy.', 'I swear that doll moved when I wasn\'t looking.', 'Don\'t turn your back on the toys.']));
      if (kind === 'camp') r.knowledge.push(U.pick(['The generator shed powers all the lights in camp.', 'The ranger station has a CB radio. It needs the generator running.', 'Only the main lodge has a phone.']));
    }
  },

  spawnKiller() {
    const m = this.map, P = this.player;
    let pos = null;
    if (m.killerSpawn) pos = { x: m.killerSpawn.x, y: m.killerSpawn.y };
    else if (m.cemetery) pos = { x: m.cemetery.x, y: m.cemetery.y };
    else if (this.profile.id === 'chucky') {
      // the doll on your porch
      const d = m.home.frontDoor; const oy = m.home.front === 'S' ? 1 : -1;
      for (const dx of [-1, 1, -2, 2]) if (m.walkable(d.x + dx, d.y + oy)) { pos = { x: d.x + dx, y: d.y + oy }; break; }
    }
    for (let i = 0; i < 300 && !pos; i++) {
      const p = m.randomOutdoor();
      if (Math.hypot(p.x * TILE - P.x, p.y * TILE - P.y) > 32 * TILE) pos = p;
    }
    if (!pos) pos = m.randomOutdoor();
    if (!m.walkable(pos.x, pos.y)) { const q = m.nearestPassable(pos.x, pos.y, (x, y) => (m.walkable(x, y) ? 1 : -1), 6); if (q) pos = q; }
    this.killer = new Killer(this, this.profile, (pos.x + 0.5) * TILE, (pos.y + 0.5) * TILE);
    // He's been watching the house. He knows roughly where you are.
    const k = this.killer;
    k.mem.px = P.x + U.rf(-3, 3) * TILE; k.mem.py = P.y + U.rf(-3, 3) * TILE; k.mem.t = -20;
    if (this.profile.id === 'myers') k.grace = 28;
    if (this.profile.id === 'chucky') { k.grace = 30; k.doll = true; k.facing = Math.PI / 2; }
    if (k.has('dream')) { k.offworld = true; k.grace = 0; }
    this.dream = { active: false, t: 0, max: 40, count: 0, amount: 0, sleepDeaths: 0, nextDeath: U.rf(110, 160) };
    this.halluc = null; this.hallucT = U.rf(30, 50); this.projectiles = [];
  },

  // ======================================================================
  tick(dt) {
    if (this.state === 'menu' || !this.map) return;
    // pause / map keys
    if (Input.pressed('Escape')) {
      if (UI.dialogOpen()) UI.closeDialog();
      else if (this.state === 'play') this.pause();
      else if (this.state === 'pause') this.resume();
    }
    if (this.state === 'play' && Input.pressed('KeyM')) UI.toggleMap();
    if (this.state === 'play' || this.state === 'dialog' || this.state === 'ending') {
      const ts = this.state === 'dialog' ? 0.15 : 1;
      this.update(dt * ts, dt);
    }
    if (this.state !== 'pause' && this.state !== 'end') {
      const w = Render.toWorld(Input.mouse.x, Input.mouse.y);
      Input.mouse.wx = w.x; Input.mouse.wy = w.y;
      Render.draw(this, dt);
      if (this.state !== 'end') UI.updateHUD(dt);
    }
  },
  pause() { this.state = 'pause'; UI.show('pause'); },
  resume() { UI.hide('pause'); UI.hide('settings'); this.state = 'play'; },
  toMenu() {
    this.state = 'menu'; Sound.stop(); Sound.loop('siren', 0);
    UI.hide('pause'); UI.hide('end'); UI.hide('hud'); UI.hide('dialog'); UI.hide('minimap');
    UI.showMenu(); Sound.menu((KILLERS[UI.prefs.killer] || KILLERS.myers).music);
  },

  update(dt, realDt) {
    this.frame++;
    this.time += dt;
    this.clockMin = Math.min(480, this.time / NIGHT_SECONDS * 480);
    this.noises = this.pendingNoises; this.pendingNoises = [];
    const P = this.player, k = this.killer, m = this.map;
    this.lightT -= dt;
    if (m.lightDirty && this.lightT <= 0) { m.computeLightGrid(); this.lightT = 0.15; }

    if (this.state === 'ending') { this.updateEnding(dt); this.updateFx(realDt); return; }

    P.update(dt, Input);
    this.updateKillerVisibility(dt);
    k.update(dt);
    for (const r of this.residents) {
      for (const n of this.noises) if (n.src !== r && Math.hypot(n.x - r.x, n.y - r.y) < n.r * TILE * (m.los(n.x, n.y, r.x, r.y) ? 1 : 0.55)) r.hear(n);
      r.update(dt);
    }
    this.police.update(dt);
    this.updateFear(dt);
    this.updateFlares(dt);
    this.updateGhostCalls(dt);
    this.updateDream(dt);
    this.updateProjectiles(dt);
    this.updateTips();
    this.updateDirector(dt);
    // speeches
    for (let i = this.speeches.length - 1; i >= 0; i--) { this.speeches[i].t -= dt; if (this.speeches[i].t <= 0) this.speeches.splice(i, 1); }
    // exploration
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = 0.3; this.explore(); UI.refreshMap(); }
    // weather
    this.lightningT -= dt;
    if (this.lightningT <= 0 && m.kind !== 'woodsboro') {
      this.lightningT = U.rf(45, 100);
      this.flash = 1; setTimeout(() => { this.flash = 0.8; }, 180);
      setTimeout(() => Sound.play('thunder', { vol: 0.9 }), U.rf(600, 1800));
      if (k.seenByPlayer || (P.dist(k) < 14 * TILE && m.los(P.x, P.y, k.x, k.y))) this.scare(14, 'lightning');
    }
    // dawn
    if (this.clockMin > 450) this.dawn = (this.clockMin - 450) / 30;
    if (this.clockMin >= 480 && !this.ending) this.win('dawn');
    // audio state
    this.updateAudio(dt);
    this.updateFx(realDt);
  },
  updateFx(dt) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 18);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.scareFlash = Math.max(0, this.scareFlash - dt * 3);
    this.senseFlash = Math.max(0, this.senseFlash - dt * 0.8);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.fadeIn = Math.max(0, this.fadeIn - dt * 0.6);
  },

  updateAudio() {
    const P = this.player, k = this.killer;
    Sound.listener.x = P.x; Sound.listener.y = P.y;
    const d = P.dist(k);
    const recent = this.time - this.lastKillerSeenT;
    let I = 0;
    if (P.fear > 30 || (k.seesPlayer && d < 16 * TILE) || d < 14 * TILE) I = 1;
    if (recent < 6 || P.fear > 60) I = 2;
    if ((k.goalName === 'chase' && (k.seesPlayer || recent < 3) && d < 12 * TILE) || P.fear > 88) I = 3;
    if (k.downed > 0) I = Math.min(I, 1);
    let heart = 0;
    if (d < 12 * TILE && !k.downed) heart = 1 - d / (12 * TILE);
    heart = Math.max(heart, (P.fear - 40) / 80);
    Sound.set({ intensity: I, fear: P.fear / 100, heart: U.clamp(heart, 0, 1), muffle: P.hidden ? 0.75 : 0, hp: P.hp / 100 });
    // TV static loop near TVs that are on
    let tv = 0;
    for (const L of this.map.lights) if (L.kind === 'tv' && this.map.lightActive(L)) { const dd = Math.hypot(L.x - P.x, L.y - P.y); if (dd < 5 * TILE && this.map.los(P.x, P.y, L.x, L.y)) tv = Math.max(tv, 1 - dd / (5 * TILE)); }
    Sound.loop('tv', tv * 0.5);
    if (k.has('chainsaw')) {
      const st = k.saw.state;
      const v = k.downed > 0 || st === 'stall' ? 0 : Math.max(0, 1 - d / (28 * TILE)) * (st === 'run' ? 0.9 : st === 'rev' ? 0.8 : 0.4);
      Sound.loop('chainsaw', v, U.clamp((k.x - P.x) / 500, -0.9, 0.9), st === 'run' ? 2.6 : st === 'rev' ? 2.1 : 1);
    }
  },

  // ======================================================================
  // perception
  canSee(obs, tgt, o) {
    if (!tgt || tgt.dead || tgt.hidden) return 0;
    if (tgt.kind === 'killer' && (tgt.hiddenIn || tgt.downed > 0 || tgt.offworld)) return 0;
    if (tgt.kind === 'killer' && tgt.has('dream') && obs.kind !== 'player') return 0; // he's only in YOUR dream
    const d = Math.hypot(tgt.x - obs.x, tgt.y - obs.y);
    if (d > o.range) return 0;
    const ang = Math.abs(U.angDiff(obs.facing, Math.atan2(tgt.y - obs.y, tgt.x - obs.x)));
    if (d > o.near && ang > o.fov / 2) return 0;
    if (!this.map.los(obs.x, obs.y, tgt.x, tgt.y)) return 0;
    let light = this.map.lightAt(tgt.x, tgt.y);
    if (tgt.kind === 'player' ? tgt.lightOn : (tgt.flashOn && tgt.kind !== 'killer')) light = Math.max(light, 0.85);
    if (this.litByFlash(tgt.x, tgt.y, obs)) light = 1;
    if (o.shroud && tgt.shrouded && light < 0.9 && d > 3 * TILE) return 0;
    if (d < o.near) return 1;
    let vis = light * 1.6 + 0.1;
    if (tgt.crouch) vis *= 0.55;
    if (tgt.running) vis += 0.25; else if (tgt.moving) vis += 0.06;
    vis = Math.min(1, vis);
    const eff = o.range * vis;
    if (d > eff) return 0;
    return U.clamp(1 - (d / eff) * 0.6, 0.2, 1);
  },
  inCone(sx, sy, a, half, range, x, y) {
    const d = Math.hypot(x - sx, y - sy);
    if (d > range || d < 1) return d < 1;
    if (Math.abs(U.angDiff(a, Math.atan2(y - sy, x - sx))) > half) return false;
    return this.map.los(sx, sy, x, y);
  },
  inPlayerFlash(x, y) { const P = this.player; return P.lightOn && this.inCone(P.x, P.y, P.aim, 0.44, 9.5 * TILE, x, y); },
  litByFlash(x, y, except) {
    const P = this.player;
    if (except !== P && this.inPlayerFlash(x, y)) return true;
    for (const c of this.police.cops) if (c !== except && !c.dead && this.inCone(c.x, c.y, c.facing, 0.38, 8 * TILE, x, y)) return true;
    return false;
  },

  updateKillerVisibility(dt) {
    const k = this.killer, P = this.player, m = this.map;
    let seen = false;
    const d = P.dist(k);
    if (!k.hiddenIn) {
      const range = P.hidden ? 3 * TILE : 17 * TILE;
      if (d < range) {
        const ang = Math.abs(U.angDiff(P.aim, P.angleTo(k)));
        const fovOK = P.hidden || ang < 1.25 || d < 2.2 * TILE;
        if (fovOK && m.los(P.x, P.y, k.x, k.y)) {
          const inFlash = this.inPlayerFlash(k.x, k.y);
          const L = m.lightAt(k.x, k.y);
          if (k.shrouded && !inFlash && d > 3.5 * TILE) seen = false;
          else seen = inFlash || d < 2.6 * TILE || L > 0.14 + d / (60 * TILE) || this.flash > 0.5 || this.litByFlash(k.x, k.y, P);
        }
      }
    }
    if (k.downed > 0 || k.offworld) seen = false;
    k.seenByPlayer = seen;
    if (seen) {
      const disguised = k.has('doll') && (k.doll || k.goalName !== 'chase');
      if (disguised) this.tip('doll', 'Is that just a doll...? Chucky freezes when you watch him. Keep your eyes on him and back away.');
      else if (this.time - this.lastKillerSeenT > 8) {
        const close = Math.max(0, 1 - d / (14 * TILE));
        this.scare(10 + 22 * close, 'sight');
        if (close > 0.8) this.jumpscareNow(k.atk ? 4 : 0, 0.4);
        if (k.p.id === 'myers' && close < 0.6 && U.chance(0.5)) UI.message(U.pick(['He\'s just... standing there.', 'He\'s watching you.', 'The Shape.']), '#e8e2d0');
      }
      this.lastKillerSeenT = this.time;
    }
    // Ghostface: expose him with your flashlight
    if (k.p.id === 'ghostface') {
      if (!k.hiddenIn && !k.downed && this.inPlayerFlash(k.x, k.y) && d < 10 * TILE) {
        k.exposeMeter += dt;
        if (k.exposeMeter > 1.4 && k.exposed <= 0) {
          k.exposed = 12; k.exposeMeter = 0;
          UI.bigText('EXPOSED', '#f0f0ea', 1.6); UI.message('Ghostface is exposed! He\'s vulnerable — hit him or make him run.', '#f0f0ea');
          Sound.play('stinger', { vol: 0.5 });
          k.setGoal('evade');
        }
      } else k.exposeMeter = Math.max(0, k.exposeMeter - dt * 0.5);
    }
    // stalking feeds his power
    if (k.seesPlayer && !k.seenByPlayer && d < 16 * TILE && !k.downed) {
      const rate = k.p.id === 'myers' ? 1.8 : k.p.id === 'ghostface' ? 1.0 : 0.5;
      this.killerXP(rate * dt, 'stalk');
      if (P.fear > 15 && this.time - P.watchedMsgT > 70 && d > 4 * TILE) {
        P.watchedMsgT = this.time;
        const flav = { myers: LINES.shapeFlavor, jason: LINES.jasonFlavor, ghostface: LINES.ghostFlavor, freddy: LINES.freddyFlavor, leatherface: LINES.sawFlavor, chucky: LINES.chuckyFlavor }[k.p.id] || LINES.shapeFlavor;
        UI.message(U.pick(flav), '#a99');
      }
    }
    this.killerXP(P.fear / 100 * 0.35 * dt, 'fear');
  },

  updateFear(dt) {
    const P = this.player, k = this.killer, m = this.map;
    let dF = 0;
    const L = m.lightAt(P.x, P.y);
    if (L < 0.16 && !P.lightOn) dF += 0.45; else if (L < 0.16) dF += 0.12;
    if (k.seenByPlayer && !k.doll) { const d = P.dist(k); dF += 1.2 + 5 * Math.max(0, 1 - d / (14 * TILE)); }
    if (k.seesPlayer && !k.seenByPlayer && P.dist(k) < 15 * TILE) dF += 0.55;
    if (P.hp < 40) dF += 0.3;
    const allies = this.residents.some((r) => !r.dead && r.state === 'follow' && r.dist(P) < 4 * TILE) || this.police.cops.some((c) => !c.dead && c.dist(P) < 7 * TILE);
    if (this.time - this.lastKillerSeenT > 15 && !k.seesPlayer) dF -= L > 0.3 ? 1.5 : 0.5;
    if (allies) dF -= 1.2;
    if (P.hidden && P.dist(k) > 8 * TILE) dF -= 1.0;
    P.fear = U.clamp(P.fear + dF * dt * (dF > 0 ? this.diff.fear : 1), 0, 100);
  },

  scare(n, reason) {
    const P = this.player;
    P.fear = Math.min(100, P.fear + n * this.diff.fear);
    P.stats.scares++;
    Sound.play('stinger', { vol: Math.min(1, 0.3 + n / 40), big: n >= 28 });
    this.scareFlash = Math.min(1, n / 30);
    if (n >= 18) Render.punch(Math.min(1, n / 35));
    this.shake(n / 4);
    this.killerXP(n * 0.45, 'scare:' + reason);
  },
  addFear(n) {
    const P = this.player;
    P.fear = U.clamp(P.fear + (n > 0 ? n * this.diff.fear : n), 0, 100);
  },
  killerXP(n) {
    const k = this.killer;
    if (!k || k.level >= 2) return;
    k.xp += n * this.diff.xp;
    if (k.xp >= k.p.xpLevels[k.level + 1]) k.levelUp();
  },
  onKillerLevel(level) {
    const id = this.profile.id;
    const titles = { myers: ['', 'THE EVIL GROWS', 'EVIL INCARNATE'], jason: ['', 'HIS RAGE GROWS', 'UNSTOPPABLE'], ghostface: ['', 'THE GAME ESCALATES', 'FINAL ACT'], freddy: ['', 'THE NIGHTMARE DEEPENS', 'NEVER SLEEP AGAIN'], leatherface: ['', 'THE FAMILY IS HUNGRY', 'THE SAW IS FAMILY'], chucky: ['', 'PLAYTIME IS OVER', 'FRIEND TO THE END'] };
    const desc = {
      myers: ['', 'He moves with purpose now. He\'ll come through windows.', 'If your fear peaks, he will not let you go.'],
      jason: ['', 'Faster. Doors won\'t hold him for long.', 'He shifts through the woods more often. Every hit is lethal.'],
      ghostface: ['', 'Bolder. Faster lunges. Windows won\'t stop him.', 'Lethal. He wants his final kill.'],
      freddy: ['', 'Your dreams last longer. He moves between shadows faster.', 'He\'s everywhere in the dream now.'],
      leatherface: ['', 'Longer charges. Shorter stalls.', 'The saw barely stops now.'],
      chucky: ['', 'He\'s bolder: faster, sneakier, and he climbs through windows.', 'He\'s done playing.'],
    };
    UI.bigText(titles[id][level], '#b3161a', 3);
    UI.message(desc[id][level], '#c66', 6);
    Sound.play('levelUp');
    this.shake(6);
  },
  shake(n) { this.shakeAmt = Math.max(this.shakeAmt, n); },

  // ---------- Freddy: the dream ----------
  updateDream(dt) {
    const k = this.killer, P = this.player, D = this.dream;
    D.amount = U.smooth(D.amount, D.active ? 1 : 0, D.active ? 1.6 : 3, dt);
    if (!k.has('dream')) return;
    if (!D.active) {
      const L = this.map.lightAt(P.x, P.y) + (P.lightOn ? 0.2 : 0);
      let rate = 0.5 + k.level * 0.12;
      if (!P.moving) rate += 0.35;
      if (L < 0.2) rate += 0.3;
      if (P.hidden) rate += 0.7;
      if (P.running) rate -= 1.1;
      if (P.fear > 55) rate -= 0.35;
      P.sleep = U.clamp((P.sleep || 0) + rate * dt, 0, 100);
      if (P.sleep > 70 && Math.random() < dt * 0.4) { this.shake(1.5); this.fadeIn = Math.max(this.fadeIn, 0.5); } // eyelids drooping
      if (P.sleep > 85 && !this.tipSeen('drowsy')) this.tip('drowsy', 'You\'re nodding off! Run, drink coffee, eat candy, or keep moving in the light.');
      if (P.sleep >= 100) this.enterDream();
      // waking-world glimpses of him
      this.hallucT -= dt;
      if (this.hallucT <= 0) { this.hallucT = U.rf(28, 55) - k.level * 6; this.hallucinate(); }
      if (this.halluc) { this.halluc.t -= dt; if (this.halluc.t <= 0) this.halluc = null; }
      // residents asleep die in their dreams
      D.nextDeath -= dt;
      if (D.nextDeath <= 0 && D.sleepDeaths < 4) {
        D.nextDeath = U.rf(90, 150);
        const r = this.residents.find((q) => !q.dead && (q.asleep || q.hidden));
        if (r) {
          D.sleepDeaths++;
          const near = P.dist(r) < 16 * TILE;
          this.killResident(r, k);
          UI.message(near ? `${r.first} thrashes in their sleep... four slashes open up across their chest.` : `Somewhere, ${r.first} never wakes up.`, '#c33', 6);
        }
      }
    } else {
      D.t += dt;
      if (D.t > D.max) this.wake('time');
      else if (D.max - D.t < 6 && Math.random() < dt * 0.6) this.fadeIn = Math.max(this.fadeIn, 0.3);
    }
  },
  enterDream() {
    const D = this.dream, k = this.killer, P = this.player, m = this.map;
    D.active = true; D.t = 0; D.count++; D.max = 32 + k.level * 6 + Math.min(10, D.count * 2);
    UI.closeDialog();
    this.fadeIn = 1; this.scareFlash = 1;
    Sound.play('dreamIn'); setTimeout(() => Sound.play('laugh', { pitch: 0.8 }), 1800);
    UI.bigText('YOU FELL ASLEEP', '#c83a2a', 2.5);
    UI.message('This isn\'t real. Find an alarm clock on a nightstand, or survive until you wake.', '#e8a050', 7);
    if (P.hidden) P.unhide();
    // he steps out of the dark somewhere near
    k.offworld = false; k.downed = 0; k.stun = 0; k.hp = k.maxHp; k.saw && (k.saw.state = 'idle');
    let placed = false;
    for (let i = 0; i < 60 && !placed; i++) {
      const a = U.rf(0, TAU), dd = U.rf(8, 13) * TILE;
      const tx = Math.floor((P.x + Math.cos(a) * dd) / TILE), ty = Math.floor((P.y + Math.sin(a) * dd) / TILE);
      if (!m.walkable(tx, ty)) continue;
      k.x = (tx + 0.5) * TILE; k.y = (ty + 0.5) * TILE; placed = true;
    }
    k.clearPath(); k.aware = 1.2; k.mem.px = P.x; k.mem.py = P.y; k.mem.t = this.time;
    k.setGoal('stalk'); k.cd.shift = 8; k.grace = Math.max(2, 5 - D.count);
  },
  wake(reason) {
    const D = this.dream, k = this.killer, P = this.player;
    if (!D.active || this.ending) return;
    D.active = false;
    P.sleep = 0;
    k.offworld = true; k.atk = null; k.doll = false;
    k.x = -50 * TILE; k.y = -50 * TILE; k.clearPath();
    this.scareFlash = 1; this.shake(6);
    Sound.play('dreamOut');
    const txt = { alarm: 'BRRRIIING! You jolt awake, gasping.', pain: 'The pain rips you awake!', time: 'You wake up. Drenched in sweat. Still alive.' }[reason];
    UI.bigText('AWAKE', '#e8e0d0', 1.6);
    UI.message(txt, '#e8e0d0', 5);
    if (reason === 'pain') this.addBlood(P.x, P.y, 3);
    this.addFear(-10);
  },
  hallucinate() {
    const P = this.player, m = this.map;
    for (let i = 0; i < 30; i++) {
      const a = P.aim + U.rf(-0.7, 0.7), d = U.rf(5, 10) * TILE;
      const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
      if (!m.walkable(Math.floor(x / TILE), Math.floor(y / TILE)) || !m.los(P.x, P.y, x, y)) continue;
      this.halluc = { x, y, t: 0.7, max: 0.7 };
      Sound.play('whisper', { vol: 0.6 });
      this.addFear(7);
      UI.message(U.pick(LINES.freddyFlavor), '#c88', 4);
      return;
    }
  },

  // ---------- firecrackers ----------
  throwFirecracker() {
    const P = this.player;
    if (!P.has('firecracker')) { UI.message('No firecrackers.', '#aaa'); return; }
    P.removeItem('firecracker');
    const range = Math.min(7.5 * TILE, Math.hypot(Input.mouse.wx - P.x, Input.mouse.wy - P.y));
    const d = Math.max(20, Math.min(range, this.map.castRay(P.x, P.y, P.aim, range) - 10));
    this.projectiles.push({ x: P.x, y: P.y - 10, sx: P.x, sy: P.y - 10, tx: P.x + Math.cos(P.aim) * d, ty: P.y + Math.sin(P.aim) * d, t: 0, fly: 0.5, fuse: 1.3 });
    Sound.play('swing', { vol: 0.5 });
    this.tip('firecracker', 'Firecrackers draw him to where they pop. Use them to slip past.');
  },
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const f = Math.min(1, p.t / p.fly);
      p.x = U.lerp(p.sx, p.tx, f); p.y = U.lerp(p.sy, p.ty, f) - Math.sin(f * Math.PI) * 30;
      if (p.t > p.fly && Math.random() < 0.6) Render.parts.push({ type: 'spark', x: p.x, y: p.y, vx: U.rf(-40, 40), vy: U.rf(-60, -10), life: 0.3, max: 0.3, col: '#ffd060', glow: true });
      if (p.t > p.fly + p.fuse) {
        Sound.play('firecracker', { x: p.x, y: p.y, maxD: 30 * TILE });
        this.noise(p.x, p.y, 17, 'bang', null);
        for (let k = 0; k < 4; k++) setTimeout(() => Render.muzzle(p.x + U.rf(-10, 10), p.y + U.rf(-10, 10)), k * 110);
        this.projectiles.splice(i, 1);
      }
    }
  },

  // ---------- tips + records ----------
  tipSeen(k) { try { return !!JSON.parse(localStorage.getItem('ahn_tips') || '{}')[k]; } catch (e) { return false; } },
  tip(k, text) {
    if (this.tipSeen(k) || (this._tipsShown || (this._tipsShown = new Set())).has(k)) return;
    this._tipsShown.add(k);
    UI.message('TIP: ' + text, '#9fd0ff', 8);
    try { const o = JSON.parse(localStorage.getItem('ahn_tips') || '{}'); o[k] = 1; localStorage.setItem('ahn_tips', JSON.stringify(o)); } catch (e) { /* ignore */ }
  },
  updateTips() {
    if (this.frame % 30) return;
    const P = this.player, k = this.killer;
    if (this.time > 3) this.tip('start_' + this.profile.id, {
      myers: 'He moves faster when you\'re not looking at him. Keep him in sight, or keep doors between you.',
      jason: 'Jason appears ahead of you through the woods. Stay near light and allies.',
      ghostface: 'Hold your flashlight on Ghostface to expose him. Answering his calls tells him where you are.',
      freddy: 'Watch the DROWSY bar. Coffee, candy and running keep you awake. Hiding makes you sleepy.',
      leatherface: 'Listen for the chainsaw. When it stalls, he\'s vulnerable. The corn hides you.',
      chucky: 'Watch the dolls. He only moves when you\'re not looking.',
    }[this.profile.id]);
    if (P.inter && P.inter.key && P.inter.key.startsWith('hide')) this.tip('hide', 'Hide with E. While hidden, hold Shift to hold your breath when he\'s close.');
    if (P.has('firecracker')) this.tip('fc_have', 'Press T to throw a firecracker where you\'re aiming.');
    if (P.has('revolver')) this.tip('gun', 'Equip the revolver from your inventory, then click to fire. It staggers him, but it\'s loud.');
    if (k.seenByPlayer && !k.doll) this.tip('seen', 'Doors slow him down. Lock them with L. Break line of sight, then hide.');
  },
  saveRecord(e) {
    try {
      const rec = JSON.parse(localStorage.getItem('ahn_records') || '{}');
      const r = rec[this.profile.id] || (rec[this.profile.id] = { wins: 0, deaths: 0, best: null });
      if (e.win) { r.wins++; if (r.best == null || this.clockMin < r.best) r.best = Math.round(this.clockMin); } else r.deaths++;
      localStorage.setItem('ahn_records', JSON.stringify(rec));
    } catch (err) { /* ignore */ }
  },
  jumpscareNow(frame = 4, dur = 0.55, force) {
    if (!force && this.time - (this.lastJump || -99) < 14) return;
    this.lastJump = this.time;
    this.jumpscare = { t: dur, max: dur, spec: this.killer.spec, frame };
    Render.punch(1);
  },
  footprint(x, y, a, side) {
    const c = this.map.ground.getContext('2d');
    const o = side ? 5 : -5;
    c.save(); c.translate(x + Math.cos(a + Math.PI / 2) * o, y + Math.sin(a + Math.PI / 2) * o); c.rotate(a);
    c.fillStyle = `rgba(${90 + Math.random() * 30},6,6,0.75)`;
    c.beginPath(); c.ellipse(1, 0, 6, 3, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(-8, 0, 3, 2.6, 0, 0, TAU); c.fill();
    c.restore();
  },
  shakeIfNear(x, y, n) { const d = Math.hypot(x - this.player.x, y - this.player.y); if (d < 10 * TILE) this.shake(n * (1 - d / (10 * TILE))); },

  // ======================================================================
  // world events
  noise(x, y, r, type, src) { this.pendingNoises.push({ x, y, r, type, src }); },
  message(t, c, d) { UI.message(t, c, d); },
  say(ent, text, dur = 3.2) {
    this.speeches = this.speeches.filter((s) => s.ent !== ent);
    this.speeches.push({ ent, text, t: dur });
  },
  radio(text, urgent) { UI.subtitle('RADIO', text, 6, ''); Sound.play('static', { vol: 0.5 }); if (urgent) UI.message(text, '#8fb0ff', 6); },
  muzzle(x, y) { Render.muzzle(x, y); },
  puff(x, y) { Render.puff(x, y); },
  addBlood(x, y, n = 2) {
    Render.blood(x, y, n * 4);
    const c = this.map.ground.getContext('2d');
    for (let i = 0; i < n * 3; i++) {
      c.fillStyle = `rgba(${90 + Math.random() * 40},${5 + Math.random() * 8},${5 + Math.random() * 8},${U.rf(0.5, 0.85)})`;
      c.beginPath(); c.ellipse(x + U.rf(-1, 1) * n * 7, y + U.rf(-1, 1) * n * 5, U.rf(2, 3 + n * 2), U.rf(1.5, 2.5 + n), Math.random() * 3, 0, TAU); c.fill();
    }
  },
  nearestDoor(x, y, maxD) {
    const m = this.map, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    let best = null, bd = maxD;
    for (let yy = ty - 2; yy <= ty + 2; yy++) for (let xx = tx - 2; xx <= tx + 2; xx++) {
      const d = m.doorAt(xx, yy);
      if (!d) continue;
      const dd = Math.hypot(d.px - x, d.py - y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  },
  nonSolidNear(x, y, r) { return this.map.nonSolid.filter((o) => Math.hypot(o.x - x, o.y - y) < r); },
  setDoor(d, open, who) {
    if (d.broken || d.open === open) return;
    d.open = open;
    if (open && who) {
      // swing away from whoever opened it
      d.openDir = 0;
    }
    Sound.play(open ? 'doorOpen' : 'doorClose', { x: d.px, y: d.py, maxD: 12 * TILE, vol: who && who.kind === 'killer' ? 0.9 : 0.7 });
    this.noise(d.px, d.py, open ? 3 : 4, 'door', who);
    this.map.invalidateLightsNear(d.px, d.py);
  },
  breakDoor(d, who) {
    d.broken = true; d.open = true; d.locked = false;
    Sound.play('doorBreak', { x: d.px, y: d.py, maxD: 22 * TILE });
    Render.splinters(d.px, d.py);
    this.noise(d.px, d.py, 16, 'doorBreak', who);
    this.map.invalidateLightsNear(d.px, d.py);
    const H = this.map.houseAt(this.player.x, this.player.y);
    if (H && H.id === d.house) this.scare(18, 'door');
    else this.shakeIfNear(d.px, d.py, 6);
  },
  breakWindow(w, who) {
    if (w.broken) return;
    w.broken = true;
    const x = (w.x + 0.5) * TILE, y = (w.y + 0.5) * TILE;
    Sound.play('glass', { x, y, maxD: 22 * TILE });
    Render.glass(x, y);
    this.noise(x, y, 14, 'glass', who);
    if (who && who.kind === 'killer' && Math.hypot(x - this.player.x, y - this.player.y) < 10 * TILE) this.scare(16, 'glass');
  },
  knock(d) {
    Sound.play('bang', { x: d.px, y: d.py, vol: 0.5 });
    this.noise(d.px, d.py, 6, 'knock', this.player);
    const H = this.map.houses[d.house];
    const r = H.residents.find((q) => !q.dead && q.inHouse());
    if (!r) return;
    setTimeout(() => {
      if (r.dead || this.state === 'menu') return;
      if (r.fear > 0.6 && r.trust < 0.5) { r.say('Go away! I\'ve got a gun! I\'m calling the cops!'); if (r.canCall()) r.setState('call'); return; }
      if (r.asleep) { r.asleep = false; r.say('Alright, alright, I\'m coming...'); }
      else r.say(U.pick(['Who is it?', 'Just a second!', 'Trick or treat? Bit late, isn\'t it?']));
      d.locked = false;
      setTimeout(() => { if (!d.broken && !r.dead) { this.setDoor(d, true, r); r.trust = Math.min(1, r.trust + 0.1); } }, 1400);
    }, 1500);
  },
  forceDoor(d) {
    d.locked = false; d.lockBroken = true;
    Sound.play('doorBreak', { x: d.px, y: d.py, vol: 0.7 });
    this.noise(d.px, d.py, 12, 'bang', this.player);
    this.setDoor(d, true, this.player);
    UI.message('The lock gives way.', '#ccc');
  },
  toggleLight(o) {
    const H = o.house >= 0 ? this.map.houses[o.house] : null;
    if (H && !H.power) { UI.message('Nothing. The power is out.', '#aaa'); Sound.play('click'); return; }
    o.light.on = !o.light.on;
    this.map.lightDirty = true;
    Sound.play('click');
  },
  onPlayerHide(o) {
    const k = this.killer;
    if (k.seesPlayer && k.aware >= 1) k.mem.sawHide = { obj: o, t: this.time };
  },
  searchContainer(o, P) {
    const c = o.container;
    c.searched = true;
    P.stats.searched++;
    this.noise(o.x, o.y, 2, 'search', P);
    if (!c.items.length) { UI.message('Nothing useful.', '#888'); return; }
    const left = [];
    for (const it of c.items) {
      if (P.addItem(it.id, it.n)) {
        UI.message(`Found: ${ITEMS[it.id].name}${it.n > 1 ? ' x' + it.n : ''}`, it.id === 'keys' ? '#ffd060' : '#e8c070');
        if (it.id === 'keys') { P.keysT = this.time; UI.bigText('CAR KEYS', '#ffd060', 2); UI.message('Get to the car!', '#ffd060'); }
      } else left.push(it);
    }
    c.items = left;
    if (left.length) UI.message('Inventory full.', '#aaa');
    Sound.play('pickup');
  },
  dropFlare(x, y) {
    const L = this.map.addLight({ x, y, r: 7 * TILE, color: [255, 70, 60], int: 1, on: true, power: 'none', kind: 'flare' });
    this.flares.push({ x, y, t: 45, rot: Math.random() * 3, light: L });
    Sound.play('flare', { x, y });
    this.noise(x, y, 10, 'flare', this.player);
  },
  updateFlares(dt) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t -= dt;
      if (f.t < 5) f.light.int = f.t / 5;
      if (f.t <= 0) { this.map.removeLight(f.light); this.flares.splice(i, 1); }
    }
  },

  // ---------- phones / police ----------
  usePhone(o) {
    const H = this.map.houses[o.house];
    if (this.ringing && this.ringing.obj === o) { this.answerGhostCall(); return; }
    if (!H.phoneLine) {
      Sound.play('dead');
      UI.subtitle('', '...nothing. No dial tone. The line is dead.', 4);
      H.phoneDeadKnown = true;
      this.scare(8, 'deadline');
      return;
    }
    Sound.play('dial');
    this.callPolice('landline', o.x, o.y, H);
  },
  useRadio(o) {
    const m = this.map;
    if (!m.streetPower) { UI.message('The radio is dead. No power from the generator.', '#aaa'); Sound.play('click'); this.scare(5, 'radio'); return; }
    Sound.play('static');
    this.callPolice('radio', o.x, o.y, m.houses[o.house]);
  },
  callPolice(src, x, y, H) {
    const P = this.player;
    const addr = H ? (H.address || H.name) : this.placeName(x, y);
    if (this.police.level === 0) {
      UI.subtitle(src === 'radio' ? 'RANGER DISPATCH' : '911', `${src === 'radio' ? 'Go ahead, Crystal Lake.' : '911, what is your emergency?'} ... A man with a knife at ${addr}? Stay where you are. We're sending a unit.`, 6);
    } else {
      UI.subtitle(src === 'radio' ? 'RANGER DISPATCH' : '911', 'We have units on the way. Stay hidden and stay on the line if you can.', 5);
    }
    this.police.report('player', x, y, addr);
  },
  onPoliceCalled() {},
  tryCruiser(car) {
    const P = this.player;
    const cop = this.police.cops.find((c) => !c.dead && c.dist(P) < 11 * TILE);
    if (!cop) { UI.message('The cruiser is locked. You need an officer.', '#8fb0ff'); return; }
    cop.say('Get in! GO GO GO!');
    this.win('police', car);
  },
  useCar(o, P) {
    const c = o.car;
    if (!P.has('keys')) { UI.message('Locked. You need the keys.', '#aaa'); return; }
    if (c.sabotaged) {
      if (P.has('toolkit')) { c.sabotaged = false; UI.message('You reconnect the wires. It might start.', '#e8c070'); Sound.play('pickup'); }
      else { UI.message('He\'s been here. The ignition wires are cut. You need a toolkit.', '#c66'); this.scare(10, 'car'); }
      return;
    }
    if (P.fear > 45 && !c.tried) {
      c.tried = true;
      Sound.play('carFail', { x: o.x, y: o.y });
      UI.subtitle('', 'Come on... COME ON! (try again)', 3);
      this.noise(o.x, o.y, 10, 'bang', P);
      this.addFear(6);
      return;
    }
    this.win('car', o);
  },
  sabotage(s, k) {
    const P = this.player, m = this.map;
    const pH = m.houseAt(P.x, P.y);
    switch (s.kind) {
      case 'power':
        s.house.power = false; m.lightDirty = true;
        for (const L of s.house.lights) L.poly = null;
        if (pH === s.house) { Sound.play('powerDown'); UI.message('The lights go out.', '#c8c8c8'); this.scare(12, 'power'); }
        else Sound.play('powerDown', { x: s.obj.x, y: s.obj.y, maxD: 20 * TILE });
        for (const r of s.house.residents) if (!r.dead && !r.asleep && r.inHouse()) { r.say('Hey! Who turned off the lights?!'); r.fear = Math.min(1, r.fear + 0.2); if (r.bravery > 0.5 && r.state === 'home') { r.mem.heard = { x: s.obj.x, y: s.obj.y, t: this.time }; r.setState('investigate'); } }
        break;
      case 'phone':
        s.house.phoneLine = false;
        if (pH === s.house && P.dist(s.obj) < 6 * TILE) UI.message('Something snaps outside the wall.', '#aaa');
        break;
      case 'street':
        m.streetPower = false; m.lightDirty = true;
        for (const L of m.lights) L.poly = null;
        Sound.play('powerDown', { vol: 0.8 });
        UI.message(m.kind === 'camp' ? 'The generator sputters and dies. The camp goes dark.' : 'Every streetlight on the block dies at once.', '#c8c8c8');
        this.scare(12, 'street');
        break;
      case 'car':
        s.obj.car.sabotaged = true;
        if (this.map.los(P.x, P.y, s.obj.x, s.obj.y) && P.dist(s.obj) < 14 * TILE) UI.message('He\'s doing something to the car...', '#c66');
        break;
      default: break;
    }
    this.killerXP(15, 'sabotage');
  },

  // ---------- Ghostface's phone games ----------
  updateGhostCalls(dt) {
    const k = this.killer, P = this.player, m = this.map;
    if (this.profile.id !== 'ghostface') return;
    if (this.ringing) {
      const r = this.ringing;
      r.t -= dt; r.next -= dt;
      const x = r.cell ? P.x : r.obj.x, y = r.cell ? P.y : r.obj.y;
      if (r.next <= 0) { r.next = 2.6; Sound.play('ring', { x, y, maxD: 18 * TILE }); this.noise(x, y, 9, 'ring', null); }
      if (r.t <= 0) { this.ringing = null; UI.message('The ringing stops.', '#999'); }
      return;
    }
    if (k.cd.call > 0 || k.grace > 0 || this.state !== 'play') return;
    k.cd.call = U.rf(60, 100);
    const H = m.houseAt(P.x, P.y);
    if (H && H.phoneObj && H.phoneLine) { this.ringing = { obj: H.phoneObj, t: 14, next: 0 }; UI.message('The phone is ringing.', '#ff6b6b'); }
    else if (P.has('cellphone')) { this.ringing = { cell: true, t: 12, next: 0 }; UI.message('Your cell phone is ringing. Use it from your inventory to answer.', '#ff6b6b'); }
    else {
      // lure a resident instead
      const r = this.residents.find((q) => !q.dead && !q.hidden && q.house.phoneLine && q.house.phoneObj && q.inHouse());
      if (r) {
        Sound.play('ring', { x: r.house.phoneObj.x, y: r.house.phoneObj.y, maxD: 18 * TILE });
        setTimeout(() => {
          if (r.dead) return;
          r.say('Hello? ...Who is this? ...How do you know my name?');
          r.fear = Math.min(1, r.fear + 0.3);
          r.mem.heard = { x: r.house.frontDoor.px, y: r.house.frontDoor.py + 3 * TILE, t: this.time };
          r.setState('investigate');
          k.setGoal('hunt', r);
        }, 2500);
      }
    }
  },
  answerGhostCall() {
    const P = this.player, k = this.killer;
    this.ringing = null;
    Sound.play('static', { vol: 0.4 });
    UI.subtitle('YOU', 'Hello?', 2);
    const ctx = { victim_location: this.placeName(P.x, P.y), victim_fear: Math.round(P.fear), residents_alive: this.residents.filter((r) => !r.dead).length, police_called: this.police.level > 0, time: U.fmtClock(this.clockMin) };
    const say = (t) => { UI.subtitle('THE VOICE', t, 6, 'ghost'); this.addFear(10); };
    if (LLM.active() && LLM.cfg.npc) LLM.ghostCall(ctx).then(say).catch(() => say(U.pick(LINES.ghostCalls)));
    else setTimeout(() => say(U.pick(LINES.ghostCalls)), 900);
    // answering tells him exactly where you are
    k.mem.px = P.x; k.mem.py = P.y; k.mem.t = this.time;
    this.killerXP(8, 'call');
  },

  // ---------- combat outcomes ----------
  hurtPlayer(dmg, src) {
    const P = this.player;
    if (this.ending) return;
    if (src.p && src.p.abilities.includes('tombstone') && src.level >= 2 && P.fear >= 90 && P.hp <= 70) { this.lose('tombstone'); return; }
    P.hp -= dmg;
    P.lastHurtT = this.time;
    this.hurtFlash = 1; this.shake(10);
    Render.hurt(dmg);
    this.addBlood(P.x, P.y, 2);
    this.scare(12, 'hurt');
    // knockback
    const a = Math.atan2(P.y - src.y, P.x - src.x);
    P.moveBy(Math.cos(a) * 14, Math.sin(a) * 14);
    for (const r of this.residents) if (!r.dead && r.state === 'follow' && r.dist(P) < 6 * TILE) { r.scream(); r.setState('flee'); }
    if (P.hp <= 0) { P.hp = 0; this.lose(this.dream.active ? 'dream' : 'killed'); return; }
    if (this.dream.active && Math.random() < 0.4) setTimeout(() => this.wake('pain'), 250);
  },
  killResident(r, killer) {
    r.dead = true; r.hp = 0;
    if (r.hidden) r.unhide();
    this.stats.killed++;
    this.bodies.push({ id: 'r' + r.id, x: r.x, y: r.y, spec: r.spec, name: r.name, first: r.first, item: r.item, side: U.chance(0.5) ? 1 : -1, seenBy: new Set([r.id]) });
    this.addBlood(r.x, r.y, 4);
    Sound.play('scream', { x: r.x, y: r.y, maxD: 1200, pitch: r.female ? 1.15 : 0.8 });
    Sound.play('stab', { x: r.x, y: r.y });
    this.noise(r.x, r.y, 15, 'scream', r);
    this.killerXP(40, 'kill');
    const P = this.player;
    if (P.dist(r) < 15 * TILE && this.map.los(P.x, P.y, r.x, r.y)) { this.scare(28, 'witness'); UI.message(`${r.name} is dead.`, '#c33'); }
    else if (P.dist(r) < 30 * TILE) UI.message('A scream cuts through the night... then silence.', '#a66');
    this.police.addHeat(2, 'homicide');
  },
  copDown(c) {
    c.dead = true;
    this.stats.copsDown++;
    this.police.officersDown++;
    this.bodies.push({ id: 'c' + c.name, x: c.x, y: c.y, spec: c.spec, name: c.name, first: c.name, item: 'revolver', side: 1, seenBy: new Set() });
    this.addBlood(c.x, c.y, 4);
    this.say(c, U.pick(LINES.cop.down), 2);
    this.radio(`${c.name}: ${U.pick(LINES.cop.down)}`, true);
    this.police.addHeat(3.5, 'officer down');
    this.killerXP(50, 'cop');
    if (this.player.dist(c) < 14 * TILE) this.scare(20, 'copdown');
  },
  onKillerDown(src) {
    const P = this.player;
    Sound.play('stinger', { vol: 0.5 });
    if (src.kind === 'cop') this.say(src, 'Suspect is down! Suspect down!');
    UI.message(this.profile.id === 'ghostface' ? 'Ghostface goes down hard!' : 'He goes down... is he dead?', '#e8c070');
    this.police.addHeat(1, 'down');
    if (P.dist(this.killer) < 10 * TILE) this.addFear(-15);
  },
  onKillerVanished() {
    const P = this.player, k = this.killer;
    if (k.downedAt && P.dist({ x: k.downedAt.x, y: k.downedAt.y }) < 16 * TILE) {
      UI.message('You look back. The body is gone.', '#e8e2d0'); this.scare(18, 'vanish');
    }
  },
  onKillerRises() { UI.message(this.profile.id === 'ghostface' ? 'He scrambles back to his feet!' : 'He sits up.', '#e8e2d0'); this.scare(20, 'rise'); },
  onSensed() {
    this.senseFlash = 1;
    Sound.play('whisper', { vol: 0.9 });
    UI.message('He can sense your fear...', '#c33');
  },

  // ---------- win / lose ----------
  win(type, obj) {
    if (this.ending) return;
    const P = this.player;
    this.ending = { type, t: 0, win: true };
    this.state = 'ending';
    UI.closeDialog();
    if (P.hidden) P.unhide();
    if (type === 'car' || type === 'police') {
      const x = type === 'car' ? obj.x : obj.x, y = type === 'car' ? obj.y : obj.y;
      this.escapeCar = { x, y, ang: type === 'car' ? Math.PI / 2 : Math.PI, color: type === 'car' ? obj.car.color : '#e8e8e8', vx: 0, phase: 0, police: type === 'police', target: { x: x, y: this.map.entry.y } };
      if (type === 'police') { this.escapeCar = null; obj.leaving = true; this.ending.car = obj; }
      Sound.play(type === 'car' ? 'carStart' : 'engine');
    } else if (type === 'dawn') {
      UI.bigText('DAWN', '#e2a24a', 4);
      Sound.play('levelUp', { vol: 0.4 });
    }
  },
  lose(type) {
    if (this.ending) return;
    this.ending = { type, t: 0, win: false };
    this.state = 'ending';
    UI.closeDialog();
    Sound.play('stinger', { vol: 1, big: true });
    Sound.play('stab');
    this.hurtFlash = 1; this.shake(18);
    if (type === 'tombstone') UI.bigText('HE LIFTS YOU OFF THE GROUND', '#b3161a', 3);
    this.jumpscareNow(4, 1.3, true);
    Render.hurt(60);
  },
  updateEnding(dt) {
    const e = this.ending, P = this.player, k = this.killer;
    e.t += dt;
    if (e.win && e.type === 'car' && this.escapeCar) {
      const c = this.escapeCar;
      if (c.phase === 0) { c.ang = U.lerp(c.ang, Math.PI, Math.min(1, dt * 1.5)); c.y += (this.map.entry.y - c.y) * Math.min(1, dt * 1.2); c.x -= 40 * dt; if (Math.abs(c.y - this.map.entry.y) < 6) c.phase = 1; }
      else { c.ang = Math.PI; c.x -= Math.min(420, 60 + e.t * 140) * dt; }
      if (this.map.car) this.map.car.solid = false;
      this.camOverride = { x: c.x, y: c.y };
      P.x = c.x; P.y = c.y; P.hidden = null;
    }
    if (e.win && e.type === 'police' && e.car) {
      const c = e.car;
      c.ang = Math.PI; c.x -= Math.min(380, 40 + e.t * 120) * dt; c.sirenOn = true;
      this.camOverride = { x: c.x, y: c.y };
      P.x = c.x; P.y = c.y;
    }
    if (e.win && e.type === 'dawn') this.dawn = Math.min(1.2, this.dawn + dt * 0.3);
    if (!e.win) { this.fadeIn = Math.min(1, e.t / 2.5); this.camOverride = { x: P.x, y: P.y }; }
    if (e.t > (e.win ? 4.5 : 3)) this.finish();
  },
  finish() {
    const e = this.ending, P = this.player, k = this.killer;
    this.state = 'end';
    Sound.stop(); Sound.loop('siren', 0); Sound.loop('tv', 0);
    const alive = this.residents.filter((r) => !r.dead).length;
    const saved = this.residents.filter((r) => !r.dead && (r.saved || r.state === 'follow' || r.state === 'safe')).length;
    const stats = [
      ['Time', U.fmtClock(this.clockMin)],
      ['Residents alive', `${alive} / ${this.residents.length}`],
      ['Residents with you or police', saved],
      ['Officers down', this.stats.copsDown],
      [this.profile.id === 'jason' ? 'His rage' : 'His evil', ['I', 'II', 'III'][k.level]],
      ['Times you were terrified', P.stats.scares],
      ['Times you fought back', P.stats.hits],
    ];
    const titles = {
      car: ['YOU ESCAPED', 'Tires screaming, you leave the town behind. In the rear-view mirror, a figure stands in the road.'],
      police: ['RESCUED', 'The cruiser tears away with you in the back seat. Somewhere behind you, he is still out there.'],
      dawn: ['YOU SURVIVED THE NIGHT', 'The sun comes up. He is gone. For now.'],
      killed: ['YOU DIED', `${this.profile.fullName} claims another victim.`],
      tombstone: ['YOU DIED', 'Your fear was too much. He held you there until it was over.'],
      dream: ['YOU NEVER WOKE UP', 'They found you in the morning. The doctors said your heart just... stopped.'],
    };
    const [t, s] = titles[e.type];
    UI.end(e.win, t, s, stats);
    this.saveRecord(e);
  },

  // ======================================================================
  // helpers
  placeName(x, y, long) {
    const m = this.map;
    const H = m.houseAt(x, y);
    if (H) {
      const r = m.roomAt(x, y);
      const room = r ? ({ living: 'living room', kitchen: 'kitchen', bedroom: 'bedroom', bath: 'bathroom', cabin: 'cabin', shed: 'shed' })[r.type] : '';
      const nm = H.isPlayerHome ? (m.kind === 'camp' ? 'your cabin' : 'your house') : H.name;
      return long ? `${nm}${room && room !== 'cabin' && room !== 'shed' ? ', ' + room : ''}` : `in ${nm}`;
    }
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (m.zone[m.idx(tx, ty)] === 1) return long ? 'Grove Cemetery' : 'in the cemetery';
    if (m.kind === 'camp') {
      const lk = m.lake;
      const d = Math.hypot((tx - lk.cx) / lk.rx, (ty - lk.cy) / lk.ry);
      if (d < 1.5) return long ? 'by the lake' : 'by the lake';
      if (m.get(tx, ty) === T.DIRT || m.get(tx, ty) === T.GRAVEL) return long ? 'on the camp trail' : 'on the trail';
      return long ? 'in the woods' : 'in the woods';
    }
    // nearest house
    let best = null, bd = 1e9;
    for (const h of m.houses) { const d = Math.hypot((h.x + h.w / 2) * TILE - x, (h.y + h.h / 2) * TILE - y); if (d < bd) { bd = d; best = h; } }
    if (best && bd < 12 * TILE) return long ? `outside ${best.isPlayerHome ? 'your house' : best.name}` : `outside ${best.name}`;
    return long ? STREETS[m.kind] : `on ${STREETS[m.kind]}`;
  },
  explore(full) {
    const P = this.player, m = this.map;
    const R = full ? 6 : 11;
    const tx = P.tx, ty = P.ty;
    for (let y = ty - R; y <= ty + R; y++) for (let x = tx - R; x <= tx + R; x++) {
      if (!m.inb(x, y)) continue;
      const i = m.idx(x, y);
      if (m.explored[i]) continue;
      if ((x - tx) ** 2 + (y - ty) ** 2 > R * R) continue;
      if (full || m.los(P.x, P.y, (x + 0.5) * TILE, (y + 0.5) * TILE)) m.explored[i] = 1;
    }
    // your own house you know by heart
    if (full) { const H = m.home; for (let y = H.y - 1; y <= H.y + H.h; y++) for (let x = H.x - 1; x <= H.x + H.w; x++) if (m.inb(x, y)) m.explored[m.idx(x, y)] = 1; }
  },
  objectives() {
    const P = this.player, m = this.map, pol = this.police;
    const o = [];
    const car = m.car;
    if (!P.has('keys')) o.push({ text: 'Find the car keys', sub: m.kind === 'camp' ? 'Someone at camp has the spare set.' : 'Your neighbors were holding a spare set.' });
    else o.push({ text: 'Get to the car', state: '', sub: car.car.sabotaged ? (P.has('toolkit') ? 'It\'s been sabotaged. Fix it with your toolkit.' : 'It\'s been sabotaged. You need a toolkit.') : '' });
    if (pol.level === 0) o.push({ text: m.kind === 'camp' ? 'Call for help (lodge phone or ranger radio)' : 'Call the police', sub: 'Landlines can be cut.' });
    else if (!pol.cars.some((c) => c.parked)) o.push({ text: 'Survive until the police arrive', sub: pol.eta != null ? `ETA ${Math.ceil(pol.eta)}s` : '' });
    else o.push({ text: 'Reach a police cruiser with an officer' });
    o.push({ text: 'Or survive until dawn', sub: `${Math.max(0, Math.ceil((NIGHT_SECONDS - this.time) / 60))} min left` });
    const followers = this.residents.filter((r) => !r.dead && r.state === 'follow').length;
    const dead = this.residents.filter((r) => r.dead).length;
    if (followers || dead) o.push({ text: `Following you: ${followers} · Dead: ${dead}`, state: '' });
    return o;
  },
  residentContext(r) {
    const P = this.player;
    return {
      address: r.house.address || r.house.name, town: this.profile.location, date: this.profile.date, time: U.fmtClock(this.clockMin), now: this.time,
      killerDesc: { myers: 'a tall silent man in a blank white mask and dark coveralls, carrying a kitchen knife', jason: 'a huge man in a hockey mask with a machete', ghostface: 'someone in a black robe and a ghost mask with a hunting knife', freddy: 'a burned man in a striped sweater and fedora with knives for fingers, who people only see in nightmares', leatherface: 'a huge man in a mask made of skin, with a chainsaw', chucky: 'a child-sized doll with red hair and a knife that walks and talks' }[this.profile.id],
      phoneWorks: !!(r.house.phoneLine && r.house.phoneObj), power: r.house.power,
      police: this.police.level === 0 ? 'not called yet' : this.police.cars.some((c) => c.parked) ? 'officers on scene' : 'on the way',
    };
  },

  // ---------- LLM director ----------
  updateDirector(dt) {
    if (!LLM.active() || !LLM.cfg.killer) return;
    this.directorT -= dt;
    if (this.directorT > 0 || this.directorBusy || this.state !== 'play') return;
    this.directorT = LLM.cfg.interval;
    this.directorBusy = true;
    const k = this.killer;
    LLM.director(this.profile, this.directorState())
      .then((a) => { k.advice = { tactic: a.tactic, target: a.target, reason: a.reason, until: this.time + Math.max(20, LLM.cfg.interval + 6) }; k.thinkT = 0; })
      .catch(() => {})
      .finally(() => { this.directorBusy = false; });
  },
  directorState() {
    const P = this.player, k = this.killer, m = this.map;
    const since = this.time - k.mem.t;
    const pH = since < 60 ? m.houseAt(k.mem.px, k.mem.py) : null;
    return {
      clock: U.fmtClock(this.clockMin), your_level: k.level + 1, your_location: this.placeName(k.x, k.y, true), your_health: Math.round(k.hp / k.maxHp * 100) + '%',
      survivor: {
        last_seen: since > 900 ? 'never' : `${Math.round(since)}s ago ${this.placeName(k.mem.px, k.mem.py, true)}`,
        in_house_id: pH ? pH.id : null, seeing_them_now: k.seesPlayer, they_see_you: k.seenByPlayer,
        fear: Math.round(P.fear), health: Math.round(P.hp), has_car_keys: P.has('keys'), hiding: !!P.hidden && !!k.mem.sawHide,
      },
      police: { called: this.police.level > 0, level: this.police.level, officers_on_scene: this.police.cops.filter((c) => !c.dead).length, eta: this.police.eta != null ? Math.round(this.police.eta) : null },
      houses: m.houses.filter((h) => h.kind !== 'shed').map((h) => ({ id: h.id, name: h.name, power: h.power, phone: h.phoneLine && !!h.phoneObj, residents: h.residents.filter((r) => !r.dead).length })),
      residents: this.residents.filter((r) => !r.dead).map((r) => ({ id: r.id, name: r.first, place: this.placeName(r.x, r.y, true), hidden: !!r.hidden, following_survivor: r.state === 'follow', dist_tiles: Math.round(k.dist(r) / TILE) })),
      car_sabotaged: m.car ? m.car.car.sabotaged : null, street_lights_on: m.streetPower,
      current_tactic: k.goalName,
    };
  },
};

window.addEventListener('load', () => G.init());
