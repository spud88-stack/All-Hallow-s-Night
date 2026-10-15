'use strict';
// ---------------------------------------------------------------------------
// The killer: utility-AI tactician with perception, memory, prediction,
// stalking, ambushes, sabotage, levels and per-killer abilities.
// An optional LLM "director" biases which tactic is chosen.
// ---------------------------------------------------------------------------
class Killer extends Agent {
  constructor(g, profile, x, y) {
    super(g, x, y);
    this.kind = 'killer'; this.p = profile; this.r = { jason: 11, leatherface: 12, chucky: 6 }[profile.id] || 10;
    this.level = 0; this.xp = 0; this.maxHp = profile.hp; this.hp = profile.hp;
    this.spec = Sprites.SPECS[profile.id];
    this.goal = null; this.goalName = 'patrol'; this.goalT = 0; this.thinkT = 0;
    this.mem = { px: x, py: y, t: -999, vx: 0, vy: 0, heard: null, sawHide: null, sawResHide: null, lastSab: -99, sabCount: {} };
    this.aware = 0; this.seesPlayer = false; this.seenByPlayer = false; this.seenSince = 0; this.unseenFor = 0;
    this.stun = 0; this.downed = 0; this.atk = null; this.atkCd = 0;
    this.hiddenIn = null; this.stare = 0;
    this.cd = { shift: 35, sense: 25, call: U.rf(35, 55), sprint: 0 };
    this.stamina = 100; this.sprinting = false;
    this.advice = null; this.exposed = 0; this.exposeMeter = 0;
    this.grace = 22; this.rage = 0; this.debug = '';
    this.prevPX = 0; this.prevPY = 0;
    this.stepDist = 0;
    this.saw = { state: 'idle', t: 0, cd: 1.5, hit: new Set() };
    this.doll = false; this.dollT = 0; this.tauntT = 12; this.offworld = false;
  }
  has(a) { return this.p.abilities.includes(a); }
  get L() { return this.level; }
  get shrouded() { return this.p.id === 'ghostface' && this.exposed <= 0 && !this.atk && this.goalName !== 'chase'; }

  // ---------------- core loop ----------------
  update(dt) {
    const g = this.g;
    this.moving = false; this.sprinting = false;
    this.goalT += dt; this.atkCd -= dt; this.grace -= dt; this.rage -= dt;
    for (const k in this.cd) this.cd[k] -= dt;
    if (this.exposed > 0) this.exposed -= dt;
    if (this.offworld) { this.moving = false; this.atk = null; return; }
    if (this.downed > 0) {
      this.downed -= dt;
      if (this.downed <= 0) this.recover();
      return;
    }
    if (this.stun > 0) { this.stun -= dt; this.atk = null; this.animate(dt); return; }
    this.perceive(dt);
    this.abilities(dt);
    if (this.updateDoll(dt)) { this.animate(dt); return; }
    if (this.has('chainsaw') && this.updateSaw(dt)) { this.footsteps(dt); this.animate(dt); return; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = U.rf(0.45, 0.75) * g.diff.think; }
    if (this.atk) this.updateAttack(dt);
    else this.act(dt);
    this.footsteps(dt);
    this.animate(dt);
  }
  footsteps(dt) {
    const g = this.g;
    if (this.moving && !this.hiddenIn) {
      this.stepDist += this.speedNow * dt;
      if (this.stepDist > 38) {
        this.stepDist = 0;
        const d = this.dist(g.player);
        if (this.bloody > 0) { this.bloody--; this.footSide = !this.footSide; g.footprint(this.x, this.y, Math.atan2(this.y - this.prevPY, this.x - this.prevPX), this.footSide); }
        this.prevPX = this.x; this.prevPY = this.y;
        if (d < 9 * TILE && this.p.id !== 'ghostface') Sound.play('heavyStep', { x: this.x, y: this.y, maxD: 9 * TILE, vol: 0.8 });
        else if (d < 6 * TILE) Sound.play('step', { x: this.x, y: this.y, maxD: 6 * TILE, vol: 0.6, surface: 'grass' });
      }
    }
  }

  // ---------------- Leatherface: rev, charge, stall ----------------
  startRev() {
    const g = this.g;
    this.saw.state = 'rev'; this.saw.t = 0.8 - this.L * 0.1; this.saw.hit.clear();
    Sound.play('sawRev', { x: this.x, y: this.y, maxD: 30 * TILE });
    g.noise(this.x, this.y, 20, 'bang', this);
    if (U.chance(0.5)) g.say(this, U.pick(['(squealing)', '(a wet, excited grunt)', 'RRRRAAAGH!']), 1.6);
  }
  updateSaw(dt) {
    const g = this.g, P = g.player, s = this.saw;
    s.cd -= dt;
    if (s.state === 'rev') {
      s.t -= dt; this.turnTo(this.angleTo(P), dt, 8);
      if (s.t <= 0) { s.state = 'run'; s.t = 2.8 + this.L * 0.4; }
      return true;
    }
    if (s.state === 'run') {
      s.t -= dt; this.sprinting = true;
      const tx = this.seesPlayer ? P.x : this.mem.px, ty = this.seesPlayer ? P.y : this.mem.py;
      this.goTo(tx, ty, this.speed(), dt, { repath: 0.3, arrive: 8 });
      for (const r of g.residents.concat(g.police.cops)) {
        if (r.dead || r.hidden || s.hit.has(r) || this.dist(r) > this.p.attackRange + 10) continue;
        s.hit.add(r); r.takeHit(this.p.dmg[this.L] * 1.3, this); this.bloody = 30; Sound.play('stab', { x: r.x, y: r.y });
      }
      if (!P.hidden && this.dist(P) < this.p.attackRange + 12 && g.map.los(this.x, this.y, P.x, P.y)) {
        Sound.play('stab', { x: P.x, y: P.y }); this.bloody = 30;
        g.hurtPlayer(this.p.dmg[this.L] * g.diff.dmg * 1.1, this);
        s.t = 0;
      }
      if (s.t <= 0) this.stall();
      return true;
    }
    if (s.state === 'stall') {
      s.t -= dt;
      if (s.t <= 0) { s.state = 'idle'; s.cd = 5.5 - this.L; }
      return true;
    }
    return false;
  }
  stall() {
    const s = this.saw;
    s.state = 'stall'; s.t = 2.0 + (this.L === 0 ? 0.6 : 0);
    this.exposed = s.t; this.clearPath();
    Sound.play('sawStall', { x: this.x, y: this.y, maxD: 20 * TILE });
    if (this.dist(this.g.player) < 10 * TILE) this.g.message('The chainsaw sputters and chokes! NOW!', '#e8c070', 2.5);
  }

  // ---------------- Chucky: just a toy when you look ----------------
  updateDoll(dt) {
    if (!this.has('doll')) return false;
    const g = this.g, P = g.player, d = this.dist(P);
    const charging = this.goalName === 'chase' && d < 4.5 * TILE;
    if (this.seenByPlayer && !this.atk && !charging && !this.hiddenIn && this.grace <= 0 || (this.doll && this.seenByPlayer && !charging)) {
      if (!this.doll) { this.doll = true; this.dollT = 0; this.clearPath(); this.facing = Math.PI / 2; }
      this.dollT += dt; this.moving = false;
      if (d < 1.5 * TILE && this.dollT > 0.5) this.springDoll();
      return this.doll;
    }
    this.doll = false;
    return false;
  }
  springDoll() {
    const g = this.g, P = g.player;
    this.doll = false;
    g.scare(30, 'doll'); g.jumpscareNow(4, 0.5, true);
    Sound.play('laugh', { pitch: 1.9 });
    g.say(this, U.pick(['SURPRISE!', 'Hi! Remember me?', 'PEEKABOO!', 'Gotcha!']), 2);
    this.aware = 1.5; this.mem.px = P.x; this.mem.py = P.y; this.mem.t = g.time;
    this.setGoal('chase');
    this.startAttack(P, 0.2);
  }
  // small enough to scurry under furniture
  solidAt(tx, ty) { return this.has('small') ? this.g.map.blocksTile(tx, ty) : super.solidAt(tx, ty); }
  cost(x, y) {
    const c = super.cost(x, y);
    if (c < 0 && this.has('small') && this.g.map.inb(x, y) && !this.g.map.blocksTile(x, y)) return 1.8;
    return c;
  }

  speed() {
    const g = this.g;
    let s = this.p.speeds[this.L] * g.diff.killerSpeed;
    const d = this.dist(g.player);
    if (!this.seenByPlayer && d > 4 * TILE) s *= this.p.unseenBoost[this.L];
    const sprintOK = this.has('chainsaw') ? this.saw.state === 'run' : this.sprinting;
    if (this.p.sprint && sprintOK) s = this.p.sprint[this.L] * g.diff.killerSpeed;
    if (this.rage > 0) s *= 1.1;
    return s;
  }

  // ---------------- perception ----------------
  canSeeAgent(a) {
    if (a.hidden || a.dead) return false;
    return this.g.canSee(this, a, { range: 15 * TILE, fov: 2.4, near: 2.2 * TILE }) > 0;
  }
  perceive(dt) {
    const g = this.g, P = g.player;
    let vis = 0;
    if (!P.hidden && !this.hiddenIn) vis = g.canSee(this, P, { range: 16 * TILE, fov: 2.5, near: 2.4 * TILE });
    else if (this.hiddenIn && !P.hidden) vis = g.canSee(this, P, { range: 5 * TILE, fov: 6.3, near: 2 * TILE });
    if (vis > 0) this.aware = Math.min(1.6, this.aware + vis * dt * (2 + (this.dist(P) < 6 * TILE ? 2 : 0)));
    else this.aware = Math.max(0, this.aware - dt * 0.35);
    const was = this.seesPlayer;
    this.seesPlayer = this.aware >= 1 && vis > 0;
    if (this.seesPlayer) {
      const dtv = Math.max(dt, 0.001);
      this.mem.vx = (P.x - this.mem.px) / dtv; this.mem.vy = (P.y - this.mem.py) / dtv;
      if (Math.hypot(this.mem.vx, this.mem.vy) > 400) { this.mem.vx = 0; this.mem.vy = 0; }
      this.mem.px = P.x; this.mem.py = P.y; this.mem.t = g.time;
      if (!was) this.thinkT = 0;
    }
    // hearing
    for (const n of g.noises) {
      if (n.src === this) continue;
      const d = Math.hypot(n.x - this.x, n.y - this.y);
      const r = n.r * TILE * (g.map.los(this.x, this.y, n.x, n.y) ? 1 : 0.6);
      if (d > r) continue;
      const loud = ['scream', 'glass', 'bang', 'gun', 'doorBreak', 'flare', 'ring', 'siren'].includes(n.type);
      this.mem.heard = { x: n.x, y: n.y, t: g.time, type: n.type, loud, src: n.src };
      if (n.src === P) {
        // fuzzy fix on the player
        if (g.time - this.mem.t > 1.5) { this.mem.px = n.x + U.rf(-1, 1) * TILE; this.mem.py = n.y + U.rf(-1, 1) * TILE; this.mem.t = g.time - 1.5; }
        if (n.type === 'breath' && P.hidden) this.mem.sawHide = { obj: P.hidden, t: g.time };
      }
      if (n.type === 'gun' || n.type === 'siren') this.mem.copSeen = { x: n.x, y: n.y, t: g.time };
    }
    // cops in sight
    this.copsNear = g.police.cops.filter((c) => !c.dead && (this.dist(c) < 7 * TILE || (this.dist(c) < 14 * TILE && g.map.los(this.x, this.y, c.x, c.y))));
  }

  abilities(dt) {
    const g = this.g, P = g.player, p = this.p;
    // Jason: sense fear
    if (p.abilities.includes('sense') && this.cd.sense <= 0 && P.fear > 60 && this.grace <= 0) {
      this.cd.sense = 24 - this.L * 4;
      this.mem.px = P.x; this.mem.py = P.y; this.mem.t = g.time - 0.5;
      if (P.hidden) this.mem.sawHide = { obj: P.hidden, t: g.time };
      g.onSensed();
    }
    // Jason: shift through the woods to get ahead of you
    if (p.abilities.includes('shift') && this.cd.shift <= 0 && this.grace <= 0 && !this.seenByPlayer && !this.atk) {
      const since = g.time - this.mem.t;
      const tx = since < 50 ? this.mem.px : P.x, ty = since < 50 ? this.mem.py : P.y;
      if (Math.hypot(tx - this.x, ty - this.y) > (p.id === 'freddy' ? 9 : 18) * TILE) this.shift(tx, ty);
    }
    // Ghostface stamina for sprinting
    if (p.sprint) this.stamina = Math.min(100, this.stamina + 12 * dt);
  }

  shift(tx, ty) {
    const g = this.g, m = g.map, P = g.player;
    for (let i = 0; i < 40; i++) {
      const a = U.rf(0, TAU), d = U.rf(7, 12) * TILE;
      const x = tx + Math.cos(a) * d, y = ty + Math.sin(a) * d;
      const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
      if (!m.walkable(cx, cy)) continue;
      const px = (cx + 0.5) * TILE, py = (cy + 0.5) * TILE;
      if (m.los(P.x, P.y, px, py) && Math.hypot(px - P.x, py - P.y) < 16 * TILE) continue;
      g.puff(this.x, this.y);
      this.x = px; this.y = py; this.clearPath();
      g.puff(px, py);
      Sound.play('teleport', { x: px, y: py, maxD: 16 * TILE });
      this.cd.shift = this.p.id === 'freddy' ? 14 - this.L * 3 : 50 - this.L * 10;
      if (this.p.id === 'freddy') Sound.play('laugh', { x: px, y: py, maxD: 22 * TILE, pitch: 0.85 });
      return true;
    }
    return false;
  }

  // ---------------- decision making ----------------
  think() {
    const g = this.g, P = g.player, W = this.p.w, L = this.L;
    const d = this.dist(P), since = g.time - this.mem.t;
    const cand = {};
    const add = (name, score, data) => { if (!cand[name] || cand[name].s < score) cand[name] = { s: score, data }; };
    const hasStalk = this.p.abilities.includes('stalk') || this.p.abilities.includes('shroud');
    const grace = this.grace > 0;

    if (this.hiddenIn) { add('ambush', 999, this.goal && this.goal.data); }
    // chase
    if (!grace && (this.seesPlayer || since < 1.2) && !P.hidden) {
      let s = 55 * W.chase + L * 14 + (P.hp < 40 ? 15 : 0) + P.fear * 0.15 + (this.rage > 0 ? 30 : 0);
      if (this.p.id === 'myers' && L === 0 && d > 3 * TILE && this.rage <= 0) s -= 32;
      if (this.p.id === 'myers' && P.fear > 75) s += 25;
      if (this.p.id === 'ghostface' && this.exposed > 0) s -= 45;
      if (d < 3 * TILE) s += 25;
      add('chase', s);
    }
    // pull a hidden player out if we saw them hide
    if (!grace && this.mem.sawHide && g.time - this.mem.sawHide.t < 40 && this.mem.sawHide.obj.occupant === P) add('search', 90, { hideObj: this.mem.sawHide.obj });
    // stalk
    if (hasStalk && since < 30 && !P.hidden) add('stalk', 50 * W.stalk + (2 - L) * 12 - (P.fear > 85 ? 25 : 0) + (grace ? 40 : 0));
    // search
    if (!grace && since >= 1.2 && since < 40) add('search', 46 * W.search - since * 0.45);
    // investigate
    const h = this.mem.heard;
    if (h && g.time - h.t < 12 && h.src !== this) add('investigate', (30 + (h.loud ? 16 : 0)) * W.investigate, h);
    // ambush
    if (!grace && !this.seesPlayer && since > 4) {
      const pred = this.predictTarget();
      if (pred) add('ambush', (34 + pred.w * 0.4) * W.ambush, pred);
    }
    // sabotage
    if (g.time - this.mem.lastSab > (this.p.id === 'myers' ? 20 : 30) && !this.seesPlayer) {
      const sab = this.pickSabotage();
      if (sab) add('sabotage', sab.s * W.sabotage, sab);
    }
    // hunt residents
    const res = this.pickVictim();
    if (res && !grace) add('hunt', (24 + (since > 20 ? 16 : 0) + (res.d < 8 * TILE ? 18 : 0) + (res.r.state === 'follow' ? 10 : 0)) * W.hunt, res.r);
    // hunt an isolated cop at max level
    const cop = this.copsNear.length === 1 && L >= 2 ? this.copsNear[0] : null;
    if (cop) add('huntcop', 55, cop);
    // evade police
    if (this.copsNear.length && L < 2) add('evade', 72 - L * 12 + (g.police.level >= 3 ? 25 : 0));
    else if (this.copsNear.length >= 2) add('evade', 40 + (g.police.level >= 3 ? 30 : 0));
    add('patrol', 12);

    // LLM director advice
    if (this.advice && g.time < this.advice.until) this.applyAdvice(add, cand);
    // taunts from the dark
    const lines = this.has('taunt') ? LINES.chuckyTaunts : this.has('dream') ? LINES.freddyCalls : null;
    if (lines && g.time > this.tauntT && d < 14 * TILE && !this.doll && this.grace <= 0) {
      this.tauntT = g.time + U.rf(13, 24);
      const fallback = U.pick(lines);
      g.say(this, fallback, 3);
      Sound.play('laugh', { x: this.x, y: this.y, maxD: 16 * TILE, pitch: this.has('taunt') ? 1.9 : 0.85, vol: 0.7 });
      if (LLM.active() && LLM.cfg.npc && U.chance(0.5)) LLM.taunt(this.p, { victim_distance_m: Math.round(d / TILE), victim_fear: Math.round(P.fear), victim_hiding: !!P.hidden }).then((t) => t && g.say(this, t, 3)).catch(() => {});
    }
    // hysteresis
    if (cand[this.goalName] && this.goalT < 25) cand[this.goalName].s += 12;
    let best = 'patrol', bs = -1e9;
    for (const k in cand) { const s = cand[k].s + U.rf(-3, 3); if (s > bs) { bs = s; best = k; } }
    const same = (a, b) => a === b || (a && b && ((a.hideObj && a.hideObj === b.hideObj) || (a.obj && a.obj === b.obj) || (a.kind && a.kind === b.kind && a.house === b.house)));
    if (best !== this.goalName || (cand[best].data && this.goal && !same(this.goal.data, cand[best].data) && best !== 'ambush' && best !== 'sabotage')) this.setGoal(best, cand[best].data);
    this.debug = `${best} (${Math.round(bs)})` + (this.advice && g.time < this.advice.until ? ` | AI: ${this.advice.tactic}${this.advice.target ? ' ' + this.advice.target : ''} — ${this.advice.reason || ''}` : '');
  }

  applyAdvice(add, cand) {
    const g = this.g, a = this.advice, P = g.player;
    const tgt = (a.target || '') + '';
    const bonus = 56;
    const hid = (s) => { const m = /(\d+)/.exec(s); return m ? g.map.houses[+m[1]] : null; };
    switch (a.tactic) {
      case 'stalk': if (cand.stalk) cand.stalk.s += bonus; break;
      case 'chase': if (cand.chase) cand.chase.s += bonus; else if (cand.search) cand.search.s += bonus * 0.5; break;
      case 'search': if (cand.search) cand.search.s += bonus; break;
      case 'patrol': cand.patrol.s += bonus; break;
      case 'evade_police': if (cand.evade) cand.evade.s += bonus; break;
      case 'hunt_resident': {
        const id = +(/(\d+)/.exec(tgt) || [])[1];
        const r = g.residents.find((q) => q.id === id && !q.dead && !q.hidden);
        if (r) add('hunt', 85 + bonus * 0.25, r);
        break;
      }
      case 'ambush': {
        let pred = null;
        if (tgt.startsWith('car') && g.map.car) pred = { kind: 'car', x: g.map.car.x, y: g.map.car.y, w: 50 };
        else if (tgt.startsWith('cruiser')) { const c = g.police.cars.find((q) => q.parked); if (c) pred = { kind: 'cruiser', x: c.x, y: c.y, w: 50 }; }
        else { const H = hid(tgt); if (H) { const o = tgt.startsWith('phone') && H.phoneObj ? H.phoneObj : null; pred = { kind: o ? 'phone' : 'house', house: H, x: o ? o.x : (H.x + H.w / 2) * TILE, y: o ? o.y : (H.y + H.h / 2) * TILE, w: 40 }; } }
        if (pred && !this.seesPlayer) add('ambush', 85 + bonus * 0.25, pred);
        break;
      }
      case 'cut_power': { const H = hid(tgt); if (H && H.power && H.breaker) add('sabotage', 85 + bonus * 0.25, { kind: 'power', obj: H.breaker, house: H }); break; }
      case 'cut_phone': { const H = hid(tgt); if (H && H.phoneLine && H.phoneBox) add('sabotage', 85 + bonus * 0.25, { kind: 'phone', obj: H.phoneBox, house: H }); break; }
      case 'cut_streetlights': { const o = g.map.transformer || g.map.generator; if (o && g.map.streetPower) add('sabotage', 85 + bonus * 0.25, { kind: 'street', obj: o }); break; }
      case 'sabotage_car': { const c = g.map.car; if (c && !c.car.sabotaged) add('sabotage', 85 + bonus * 0.25, { kind: 'car', obj: c }); break; }
      default: break;
    }
  }

  setGoal(name, data) {
    if (this.hiddenIn && name !== 'ambush') this.leaveHiding();
    this.goalName = name; this.goalT = 0;
    this.goal = { name, data, t: 0, sub: null };
    this.clearPath();
  }

  predictTarget() {
    const g = this.g, P = g.player, m = g.map;
    const px = this.mem.t > -100 ? this.mem.px : P.x, py = this.mem.t > -100 ? this.mem.py : P.y;
    const list = [];
    if (m.car && P.has('keys') && g.time - (P.keysT || 0) < 999 && this.L >= 0) list.push({ kind: 'car', x: m.car.x, y: m.car.y, w: 55 });
    const cr = g.police.cars.find((c) => c.parked);
    if (cr) list.push({ kind: 'cruiser', x: cr.x, y: cr.y, w: 45 });
    if (g.police.level === 0) {
      let best = null, bd = 1e9;
      for (const H of m.houses) {
        if (!H.phoneObj || !H.phoneLine) continue;
        const d = Math.hypot(H.phoneObj.x - px, H.phoneObj.y - py);
        if (d < bd) { bd = d; best = H; }
      }
      if (best) list.push({ kind: 'phone', house: best, x: best.phoneObj.x, y: best.phoneObj.y, w: 30 });
    }
    // where are they heading? extrapolate
    const vx = this.mem.vx, vy = this.mem.vy, vl = Math.hypot(vx, vy);
    if (vl > 20) {
      const ex = px + vx / vl * 14 * TILE, ey = py + vy / vl * 14 * TILE;
      let best = null, bd = 1e9;
      for (const H of m.houses) {
        if (!H.frontDoor) continue;
        const d = Math.hypot(H.frontDoor.px - ex, H.frontDoor.py - ey);
        if (d < bd) { bd = d; best = H; }
      }
      if (best && bd < 10 * TILE) list.push({ kind: 'house', house: best, x: (best.x + best.w / 2) * TILE, y: (best.y + best.h / 2) * TILE, w: 22 });
    }
    if (!list.length) return null;
    let best = null, bs = -1;
    for (const t of list) { const s = t.w / (1 + Math.hypot(t.x - px, t.y - py) / (30 * TILE)); if (s > bs) { bs = s; best = t; } }
    best.w = bs;
    return best;
  }

  pickSabotage() {
    const g = this.g, P = g.player, m = g.map, L = this.L;
    const px = this.mem.px, py = this.mem.py, recent = g.time - this.mem.t < 60;
    const opts = [];
    const pH = recent ? m.houseAt(px, py) : null;
    for (const H of m.houses) {
      const dist = Math.hypot((H.x + H.w / 2) * TILE - px, (H.y + H.h / 2) * TILE - py);
      if (H.power && H.breaker && !H.grid) {
        let s = 28 + (H === pH ? 22 : 0) + (recent && dist < 14 * TILE ? 10 : 0);
        if (this.p.id === 'jason') s -= 10;
        opts.push({ kind: 'power', obj: H.breaker, house: H, s });
      }
      if (H.phoneLine && H.phoneBox && g.police.level === 0) {
        const s = 32 + (H === pH ? 18 : 0) + (recent && dist < 18 * TILE ? 12 : 0) + (this.p.id === 'ghostface' ? 8 : 0);
        opts.push({ kind: 'phone', obj: H.phoneBox, house: H, s });
      }
    }
    const street = m.transformer || m.generator;
    if (street && m.streetPower && (L >= 1 || this.p.id === 'jason')) opts.push({ kind: 'street', obj: street, s: 30 + (this.p.id === 'jason' ? 18 : 0) + (pH ? 0 : 10) });
    if (m.car && !m.car.car.sabotaged && P.has('keys') && L >= 1) opts.push({ kind: 'car', obj: m.car, s: 58 });
    else if (m.car && !m.car.car.sabotaged && L >= 2) opts.push({ kind: 'car', obj: m.car, s: 30 });
    if (!opts.length) return null;
    // prefer nearby targets
    for (const o of opts) o.s -= Math.hypot(o.obj.x - this.x, o.obj.y - this.y) / TILE * 0.25;
    opts.sort((a, b) => b.s - a.s);
    return opts[0];
  }

  pickVictim() {
    let best = null, bd = 1e9;
    for (const r of this.g.residents) {
      if (r.dead || (r.hidden && !(this.mem.sawResHide && this.mem.sawResHide.res === r))) continue;
      const d = this.dist(r);
      const knows = this.canSeeAgent(r) || d < 25 * TILE;
      if (!knows) continue;
      if (d < bd) { bd = d; best = r; }
    }
    return best ? { r: best, d: bd } : null;
  }

  // ---------------- acting ----------------
  act(dt) {
    const gl = this.goal;
    if (!gl) { this.setGoal('patrol'); return; }
    gl.t += dt;
    switch (gl.name) {
      case 'chase': this.doChase(dt); break;
      case 'stalk': this.doStalk(dt); break;
      case 'search': this.doSearch(dt); break;
      case 'investigate': this.doInvestigate(dt); break;
      case 'ambush': this.doAmbush(dt); break;
      case 'sabotage': this.doSabotage(dt); break;
      case 'hunt': this.doHunt(dt); break;
      case 'huntcop': this.doHuntCop(dt); break;
      case 'evade': this.doEvade(dt); break;
      default: this.doPatrol(dt);
    }
  }

  doChase(dt) {
    const g = this.g, P = g.player;
    const d = this.dist(P);
    const tx = this.seesPlayer ? P.x : this.mem.px, ty = this.seesPlayer ? P.y : this.mem.py;
    if (this.has('chainsaw') && this.saw.state === 'idle' && this.saw.cd <= 0 && this.seesPlayer && d < 10 * TILE && d > 1.8 * TILE && this.grace <= 0) { this.startRev(); return; }
    if (this.p.sprint && !this.has('chainsaw') && d < 9 * TILE && this.stamina > 10) { this.sprinting = true; this.stamina -= 30 * dt; }
    if (this.seesPlayer && d < this.p.attackRange + 14) { this.startAttack(P); return; }
    const r = this.goTo(tx, ty, this.speed(), dt, { repath: 0.4, arrive: 10 });
    if ((r === 'arrived' || r === 'nopath') && !this.seesPlayer) this.setGoal('search');
  }

  pickStalkSpot() {
    const g = this.g, m = g.map, P = g.player;
    let best = null, bs = -1e9;
    for (let i = 0; i < 36; i++) {
      const a = U.rf(0, TAU), d = U.rf(5, 11) * TILE;
      const x = this.mem.px + Math.cos(a) * d, y = this.mem.py + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!m.walkable(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (!m.los(cx, cy, this.mem.px, this.mem.py)) continue;
      const dark = 1 - Math.min(1, m.lightAt(cx, cy) * 2);
      const behind = Math.abs(U.angDiff(P.aim, Math.atan2(cy - P.y, cx - P.x)));
      const s = dark * 4 + (behind > 1.8 ? 2.5 : behind > 1.2 ? 1 : -2) - Math.hypot(cx - this.x, cy - this.y) / TILE * 0.12 + (m.isIndoor(tx, ty) === m.isIndoor(P.tx, P.ty) ? 0 : -0.5);
      if (s > bs) { bs = s; best = { x: cx, y: cy }; }
    }
    return best;
  }
  pickHiddenSpot(fromX, fromY, minD, maxD) {
    const g = this.g, m = g.map;
    let best = null, bs = -1e9;
    for (let i = 0; i < 30; i++) {
      const a = U.rf(0, TAU), d = U.rf(minD, maxD) * TILE;
      const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!m.walkable(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const seen = m.los(fromX, fromY, cx, cy);
      const s = (seen ? -10 : 5) + (1 - m.lightAt(cx, cy)) * 2 + Math.hypot(cx - fromX, cy - fromY) / TILE * 0.2;
      if (s > bs) { bs = s; best = { x: cx, y: cy }; }
    }
    return best;
  }

  doStalk(dt) {
    const g = this.g, P = g.player, gl = this.goal;
    const d = this.dist(P);
    const sub = gl.sub || (gl.sub = { phase: 'move', spot: null, reT: 0 });
    // the Shape: when seen, stare... then withdraw
    if (this.seenByPlayer && sub.phase !== 'stare' && sub.phase !== 'withdraw') {
      if (this.p.id === 'ghostface') {
        if (d < 6 * TILE && this.L >= 1 && U.chance(0.5)) { this.setGoal('chase'); return; }
        sub.phase = 'withdraw'; sub.spot = this.pickHiddenSpot(P.x, P.y, 6, 12); this.sprinting = true;
      } else { sub.phase = 'stare'; sub.t = U.rf(1.6, 3.2); }
    }
    if (sub.phase === 'stare') {
      this.turnTo(this.angleTo(P), dt, 6);
      sub.t -= dt;
      if (d < 2.5 * TILE && this.grace <= 0) { this.setGoal('chase'); return; }
      if (sub.t <= 0) { sub.phase = 'withdraw'; sub.spot = this.pickHiddenSpot(P.x, P.y, 7, 13); }
      return;
    }
    if (sub.phase === 'withdraw') {
      if (!sub.spot) { sub.phase = 'move'; return; }
      if (this.p.sprint && this.stamina > 10) { this.sprinting = true; this.stamina -= 20 * dt; }
      const r = this.goTo(sub.spot.x, sub.spot.y, this.speed() * (this.seenByPlayer ? 0.8 : 1), dt);
      if (r === 'arrived' || r === 'nopath' || (!this.seenByPlayer && !g.map.los(P.x, P.y, this.x, this.y))) { sub.phase = 'move'; sub.spot = null; }
      return;
    }
    // move to a stalking vantage point
    sub.reT -= dt;
    if (!sub.spot || sub.reT <= 0 || Math.hypot(sub.spot.x - this.mem.px, sub.spot.y - this.mem.py) > 13 * TILE) {
      sub.spot = this.pickStalkSpot(); sub.reT = U.rf(6, 10);
      if (!sub.spot) { this.setGoal('search'); return; }
    }
    const r = this.goTo(sub.spot.x, sub.spot.y, this.speed() * (this.seenByPlayer ? 0.6 : 1), dt);
    if (r === 'arrived') {
      sub.phase = 'watch';
      this.turnTo(this.angleTo(P), dt, 4);
    }
    // strike when the moment is right
    if (this.grace <= 0 && this.seesPlayer) {
      const isolated = !g.residents.some((q) => !q.dead && q.state === 'follow') && !g.police.cops.some((c) => !c.dead && c.dist(P) < 10 * TILE);
      const strike = (this.p.id === 'myers' && (P.fear > 78 || (this.L >= 1 && d < 4.5 * TILE && !this.seenByPlayer && isolated))) ||
        (this.p.id === 'ghostface' && d < 5.5 * TILE && !this.seenByPlayer) ||
        (this.p.id === 'freddy' && d < 7 * TILE) ||
        (this.p.id === 'chucky' && d < 4 * TILE && !this.seenByPlayer);
      if (strike) this.setGoal('chase');
    }
  }

  doSearch(dt) {
    const g = this.g, gl = this.goal, m = g.map;
    const sub = gl.sub || (gl.sub = { checks: [], wp: null, checking: null, ct: 0 });
    if (gl.t > 30) { this.setGoal('patrol'); return; }
    // 1. a hiding spot we're sure about
    const hideObj = gl.data && gl.data.hideObj ? gl.data.hideObj : null;
    if (!sub.checking) {
      if (hideObj) sub.checking = hideObj;
      else if (!sub.wp) {
        // build list of hiding places near the last sighting
        if (!sub.checks.length && !sub.built) {
          sub.built = true;
          sub.checks = m.objects.filter((o) => o.hide && Math.hypot(o.x - this.mem.px, o.y - this.mem.py) < 7 * TILE)
            .sort((a, b) => Math.hypot(a.x - this.mem.px, a.y - this.mem.py) - Math.hypot(b.x - this.mem.px, b.y - this.mem.py)).slice(0, 4);
        }
        if (gl.t < 2.5 || U.chance(0.25)) sub.wp = { x: this.mem.px + U.rf(-2, 2) * TILE, y: this.mem.py + U.rf(-2, 2) * TILE };
        else if (sub.checks.length && U.chance(0.75)) sub.checking = sub.checks.shift();
        else sub.wp = { x: this.mem.px + U.rf(-6, 6) * TILE, y: this.mem.py + U.rf(-6, 6) * TILE };
      }
    }
    if (sub.checking) {
      const o = sub.checking;
      const r = this.goTo(o.x, o.y, this.speed() * 0.9, dt, { arrive: 30 });
      if (r === 'arrived' || m.distToObj(this.x, this.y, o) < 20) {
        this.turnTo(this.angleTo(o), dt, 8);
        sub.ct += dt;
        if (sub.ct > 0.9) {
          sub.ct = 0; sub.checking = null;
          if (gl.data) gl.data.hideObj = null;
          this.openHidingSpot(o);
        }
      } else if (r === 'nopath') sub.checking = null;
      return;
    }
    if (sub.wp) {
      const r = this.goTo(sub.wp.x, sub.wp.y, this.speed() * 0.85, dt, { arrive: 16 });
      if (r === 'arrived' || r === 'nopath') { sub.wp = null; this.turnTo(this.facing + U.rf(-2, 2), 1, 1); }
    }
  }

  openHidingSpot(o) {
    const g = this.g;
    Sound.play('doorOpen', { x: o.x, y: o.y, vol: 0.9 });
    const occ = o.occupant;
    if (!occ) return;
    if (occ === g.player) {
      g.player.unhide();
      g.scare(30, 'found');
      g.jumpscareNow(4, 0.5, true);
      g.ui.bigText('FOUND YOU', '#b3161a', 1.2);
      this.startAttack(g.player, 0.25);
    } else if (occ.kind === 'resident') {
      occ.unhide(); occ.scream();
      this.startAttack(occ, 0.2);
    }
  }

  doInvestigate(dt) {
    const h = this.goal.data;
    if (!h || this.goal.t > 14) { this.setGoal('patrol'); return; }
    const r = this.goTo(h.x, h.y, this.speed() * (h.loud ? 1 : 0.85), dt, { arrive: 24 });
    if (r === 'arrived' || r === 'nopath') {
      this.turnTo(this.facing + 1.2, 0.05, 1);
      if (this.goal.t > 4 && !this.goal.looked) { this.goal.looked = true; this.mem.heard = null; }
      if (this.goal.t > 7) this.setGoal('patrol');
    }
  }

  doAmbush(dt) {
    const g = this.g, P = g.player, gl = this.goal, m = g.map;
    const t = gl.data;
    if (!t) { this.setGoal('patrol'); return; }
    const sub = gl.sub || (gl.sub = { spot: null, wait: 0 });
    if (this.hiddenIn) {
      sub.wait += dt;
      const d = this.dist(P);
      if (!P.hidden && d < 1.9 * TILE) { this.springFromHiding(false); return; }
      if (sub.wait > 55 || (g.time - this.mem.t < 1 && d > 10 * TILE && sub.wait > 20)) { this.leaveHiding(); this.setGoal('patrol'); }
      return;
    }
    if (!sub.spot) {
      sub.spot = this.chooseAmbushSpot(t);
      if (!sub.spot) { this.setGoal('patrol'); return; }
    }
    if (sub.spot.obj) {
      const o = sub.spot.obj;
      if (o.occupant) { sub.spot = null; return; }
      const r = this.goTo(o.x, o.y, this.speed(), dt, { arrive: 26 });
      if (r === 'arrived' || m.distToObj(this.x, this.y, o) < 18) {
        if (m.los(P.x, P.y, this.x, this.y) && this.seenByPlayer) { sub.spot = null; return; }
        this.enterHiding(o);
      } else if (r === 'nopath') sub.spot = null;
      return;
    }
    const r = this.goTo(sub.spot.x, sub.spot.y, this.speed(), dt, { arrive: 10 });
    if (r === 'arrived') {
      sub.wait += dt;
      this.turnTo(Math.atan2(t.y - this.y, t.x - this.x), dt, 3);
      const d = this.dist(P);
      if (this.seesPlayer && d < 4 * TILE) { this.setGoal('chase'); return; }
      if (sub.wait > 45) this.setGoal('patrol');
    } else if (r === 'nopath') this.setGoal('patrol');
    if (this.seesPlayer && this.dist(P) < 3 * TILE) this.setGoal('chase');
  }
  chooseAmbushSpot(t) {
    const g = this.g, m = g.map, P = g.player;
    if (this.p.abilities.includes('closet') || this.has('doll') || (this.p.id === 'ghostface' && U.chance(0.5))) {
      let best = null, bd = 1e9;
      for (const o of m.objects) {
        if (o.type !== 'closet' || o.occupant) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d < 7 * TILE && d < bd && !(m.los(P.x, P.y, o.x, o.y) && P.dist(o) < 10 * TILE)) { bd = d; best = o; }
      }
      if (best) return { obj: best };
    }
    let best = null, bs = -1e9;
    for (let i = 0; i < 40; i++) {
      const a = U.rf(0, TAU), d = U.rf(1.5, 5) * TILE;
      const tx = Math.floor((t.x + Math.cos(a) * d) / TILE), ty = Math.floor((t.y + Math.sin(a) * d) / TILE);
      if (!m.walkable(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const s = (1 - m.lightAt(cx, cy)) * 3 + (m.los(P.x, P.y, cx, cy) ? -4 : 1) + (m.los(cx, cy, t.x, t.y) ? 1 : -1);
      if (s > bs) { bs = s; best = { x: cx, y: cy }; }
    }
    return best;
  }
  enterHiding(o) {
    this.hiddenIn = o; o.occupant = this;
    this.hideFrom = { x: this.x, y: this.y };
    this.x = o.x; this.y = o.y; this.clearPath();
  }
  leaveHiding() {
    const o = this.hiddenIn;
    if (!o) return;
    o.occupant = null; this.hiddenIn = null;
    const m = this.g.map;
    for (let y = o.ty - 1; y <= o.ty + o.h; y++) for (let x = o.tx - 1; x <= o.tx + o.w; x++) {
      if (m.walkable(x, y)) { this.x = (x + 0.5) * TILE; this.y = (y + 0.5) * TILE; return; }
    }
    if (this.hideFrom) { this.x = this.hideFrom.x; this.y = this.hideFrom.y; }
  }
  springFromHiding(playerOpened) {
    const g = this.g, P = g.player;
    const o = this.hiddenIn;
    this.leaveHiding();
    if (o) { const a = Math.atan2(P.y - o.y, P.x - o.x); this.x = o.x + Math.cos(a) * 22; this.y = o.y + Math.sin(a) * 22; this.resolve(); }
    Sound.play('doorBreak', { x: this.x, y: this.y });
    g.scare(playerOpened ? 40 : 35, 'ambush');
    g.jumpscareNow(4, 0.6, true);
    g.ui.bigText(playerOpened ? 'HE WAS INSIDE' : '', '#b3161a', 1.2);
    this.aware = 1.5; this.mem.px = P.x; this.mem.py = P.y; this.mem.t = g.time;
    this.setGoal('chase');
    this.startAttack(P, playerOpened ? 0.15 : 0.3);
    g.killerXP(12, 'ambush');
  }

  doSabotage(dt) {
    const g = this.g, gl = this.goal, s = gl.data;
    if (!s || !s.obj) { this.setGoal('patrol'); return; }
    // already done by the time we get there?
    if ((s.kind === 'power' && !s.house.power) || (s.kind === 'phone' && !s.house.phoneLine) || (s.kind === 'street' && !g.map.streetPower) || (s.kind === 'car' && s.obj.car.sabotaged)) { this.setGoal('patrol'); return; }
    const r = this.goTo(s.obj.x, s.obj.y, this.speed(), dt, { arrive: s.kind === 'car' ? 46 : 28 });
    const near = g.map.distToObj(this.x, this.y, s.obj) < (s.kind === 'car' ? 24 : 20);
    if (r === 'arrived' || near) {
      this.turnTo(this.angleTo(s.obj), dt, 8);
      gl.work = (gl.work || 0) + dt;
      if (gl.work > 0.4 && !gl.snd) { gl.snd = true; Sound.play(s.kind === 'car' ? 'stab' : 'static', { x: this.x, y: this.y, maxD: 8 * TILE }); }
      if (gl.work > (s.kind === 'car' ? 3 : 2.2)) {
        g.sabotage(s, this);
        this.mem.lastSab = g.time;
        this.setGoal(this.p.id === 'myers' ? 'stalk' : 'patrol');
      }
    } else if (r === 'nopath' || gl.t > 40) this.setGoal('patrol');
  }

  doHunt(dt) {
    const r = this.goal.data;
    if (!r || r.dead || (r.hidden && !(this.mem.sawResHide && this.mem.sawResHide.res === r)) || this.goal.t > 40) { this.setGoal('patrol'); return; }
    if (r.hidden) {
      const o = r.hidden;
      const st = this.goTo(o.x, o.y, this.speed(), dt, { arrive: 26 });
      if (st === 'arrived' || this.g.map.distToObj(this.x, this.y, o) < 20) this.openHidingSpot(o);
      return;
    }
    const d = this.dist(r);
    if (d < this.p.attackRange + 12) { this.startAttack(r); return; }
    if (this.p.sprint && d < 8 * TILE && this.stamina > 20) { this.sprinting = true; this.stamina -= 25 * dt; }
    this.goTo(r.x, r.y, this.speed(), dt, { repath: 0.5 });
  }
  doHuntCop(dt) {
    const c = this.goal.data;
    if (!c || c.dead || this.goal.t > 25) { this.setGoal('patrol'); return; }
    const d = this.dist(c);
    if (d < this.p.attackRange + 12) { this.startAttack(c); return; }
    this.goTo(c.x, c.y, this.speed(), dt, { repath: 0.5 });
  }
  doEvade(dt) {
    const g = this.g, gl = this.goal;
    if (!gl.spot || gl.t > 12) {
      const cops = g.police.cops.filter((c) => !c.dead);
      let best = null, bs = -1e9;
      for (let i = 0; i < 30; i++) {
        const a = U.rf(0, TAU), d = U.rf(9, 18) * TILE;
        const tx = Math.floor((this.x + Math.cos(a) * d) / TILE), ty = Math.floor((this.y + Math.sin(a) * d) / TILE);
        if (!g.map.walkable(tx, ty)) continue;
        const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
        let s = (1 - g.map.lightAt(cx, cy)) * 3;
        for (const c of cops) { s += Math.min(20, Math.hypot(cx - c.x, cy - c.y) / TILE) * 0.4; if (g.map.los(c.x, c.y, cx, cy)) s -= 6; }
        if (s > bs) { bs = s; best = { x: cx, y: cy }; }
      }
      gl.spot = best; gl.t = gl.t > 12 ? 0 : gl.t;
      if (!best) { this.setGoal('patrol'); return; }
    }
    if (this.p.sprint && this.stamina > 10) { this.sprinting = true; this.stamina -= 20 * dt; }
    const r = this.goTo(gl.spot.x, gl.spot.y, this.speed() * 1.1, dt);
    if (r === 'arrived' || r === 'nopath') { gl.spot = null; if (!this.copsNear.length) this.setGoal(this.p.w.stalk > 1 ? 'stalk' : 'patrol'); }
  }
  doPatrol(dt) {
    const g = this.g, gl = this.goal, P = g.player;
    if (!gl.wp || gl.t > 25) {
      gl.t = 0;
      const recent = g.time - this.mem.t < 90;
      // drift towards where the survivor probably is
      const cx = recent ? this.mem.px : P.x + U.rf(-15, 15) * TILE, cy = recent ? this.mem.py : P.y + U.rf(-15, 15) * TILE;
      for (let i = 0; i < 20; i++) {
        const x = cx + U.rf(-10, 10) * TILE, y = cy + U.rf(-10, 10) * TILE;
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (g.map.walkable(tx, ty)) { gl.wp = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; break; }
      }
      if (!gl.wp) { const p = g.map.randomOutdoor(); gl.wp = { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE }; }
    }
    const r = this.goTo(gl.wp.x, gl.wp.y, this.speed() * 0.85, dt);
    if (r === 'arrived' || r === 'nopath') gl.wp = null;
  }

  // ---------------- doors / windows ----------------
  lockedCost() { return 10 / (this.L + 1) + 4; }
  windowCost() { return this.L >= this.p.windowLevel ? 12 : -1; }
  handleDoor(d, dt) {
    const g = this.g;
    if (this.saw.state === 'run') { g.breakDoor(d, this); return true; }
    if (!d.locked) { this.doorT += dt; if (this.doorT > (this.p.id === 'jason' ? 0.15 : 0.35)) { g.setDoor(d, true, this); this.doorT = 0; } return true; }
    // break it down
    this.doorT += dt;
    this.bangT = (this.bangT || 0) - dt;
    if (this.bangT <= 0) {
      this.bangT = 0.75;
      Sound.play('bang', { x: d.px, y: d.py, maxD: 18 * TILE });
      g.noise(d.px, d.py, 12, 'bang', this);
      g.shakeIfNear(d.px, d.py, 3);
      d.hp -= 100 / (this.p.breakTime[this.L] / 0.75);
      const H = g.map.houseAt(g.player.x, g.player.y);
      if (H && H.id === d.house) g.addFear(3, 'banging');
      if (d.hp <= 0) { g.breakDoor(d, this); this.doorT = 0; }
    }
    return true;
  }
  handleWindow(w, dt) {
    if (this.L < this.p.windowLevel) return false;
    this.doorT += dt;
    if (this.doorT > 0.6) { this.g.breakWindow(w, this); this.doorT = 0; }
    return true;
  }

  // ---------------- combat ----------------
  startAttack(target, windupOverride) {
    if (this.atk || this.atkCd > 0 || this.downed > 0) return;
    if (this.hiddenIn) this.leaveHiding();
    this.atk = { target, t: windupOverride != null ? windupOverride : this.p.windup[this.L] };
    this.atkAnim = this.atk.t + 0.2;
    this.facing = this.angleTo(target);
  }
  updateAttack(dt) {
    const g = this.g, a = this.atk, tg = a.target;
    if (!tg || tg.dead) { this.atk = null; return; }
    this.turnTo(this.angleTo(tg), dt, 12);
    a.t -= dt;
    // keep closing in during the wind-up
    if (this.dist(tg) > this.p.attackRange * 0.7) { this.moveToward(tg.x, tg.y, this.speed() * 0.55, dt); }
    this.atkAnim = Math.max(this.atkAnim, 0.1);
    if (a.t > 0) return;
    this.atk = null; this.atkCd = this.p.attackCd; this.atkAnim = 0.3;
    const d = this.dist(tg);
    const reach = this.p.attackRange + (tg.r || 9) + 6;
    if (d < reach && g.map.los(this.x, this.y, tg.x, tg.y) && !tg.hidden) {
      const dmg = this.p.dmg[this.L] * g.diff.dmg;
      Sound.play('stab', { x: tg.x, y: tg.y });
      this.bloody = 28;
      if (tg === g.player) g.hurtPlayer(dmg, this);
      else tg.takeHit(dmg, this);
    } else Sound.play('swing', { x: this.x, y: this.y, vol: 0.7 });
  }
  takeHit(dmg, stun, src, knock = 20, type) {
    const g = this.g;
    if (this.downed > 0 || this.offworld) return;
    if (this.doll) this.doll = false;
    if (this.saw.state === 'run' || this.saw.state === 'rev') { this.stall(); }
    if (this.hiddenIn) this.leaveHiding();
    const exp = this.exposed > 0 ? 2 : 1;
    this.hp -= dmg * exp;
    this.stun = Math.max(this.stun, stun / this.p.stunResist * exp);
    this.atk = null;
    const a = Math.atan2(this.y - src.y, this.x - src.x);
    this.moveBy(Math.cos(a) * knock * 0.5, Math.sin(a) * knock * 0.5);
    if (src === g.player) {
      if (this.p.id === 'jason') { this.rage = 12; this.mem.px = src.x; this.mem.py = src.y; this.mem.t = g.time; }
      else if (this.p.id === 'myers') { this.rage = 8; this.mem.px = src.x; this.mem.py = src.y; this.mem.t = g.time; }
      else { this.exposed = Math.max(this.exposed, 4); }
      g.addFear(-6, 'fought back');
    }
    if (this.hp <= 0) this.goDown(src);
  }
  goDown(src) {
    const g = this.g;
    this.downed = this.p.id === 'ghostface' ? 7 : 12;
    this.atk = null; this.clearPath();
    this.downedAt = { x: this.x, y: this.y };
    g.onKillerDown(src);
  }
  recover() {
    const g = this.g, P = g.player;
    this.hp = this.maxHp * 0.75;
    const watched = g.map.los(P.x, P.y, this.x, this.y) && P.dist(this) < 14 * TILE;
    if (!watched || this.p.id === 'myers') {
      // The classic: you look back and he's gone.
      const spot = this.pickHiddenSpot(P.x, P.y, 14, 24);
      if (spot && !watched) { this.x = spot.x; this.y = spot.y; this.clearPath(); g.onKillerVanished(); }
      else g.onKillerRises();
    } else g.onKillerRises();
    this.stun = 0.8; this.aware = 0;
    this.setGoal(g.police.cops.some((c) => !c.dead) ? 'evade' : 'patrol');
  }
  levelUp() {
    const g = this.g;
    if (this.level >= 2) return;
    this.level++;
    g.onKillerLevel(this.level);
  }
}
