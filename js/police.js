'use strict';
// ---------------------------------------------------------------------------
// Police: 911 calls, escalation (patrol -> backup -> sheriff/tactical),
// cruisers that drive in, and officers who search, shoot and escort.
// ---------------------------------------------------------------------------
const COP_SURNAMES = ['Hunt', 'Brackett', 'Riley', 'Dewey', 'Hollis', 'McCabe', 'Garza', 'Ortiz', 'Price', 'Shaw', 'Novak', 'Kowalski', 'Dunn', 'Pike'];

class Police {
  constructor(g) {
    this.g = g; this.level = 0; this.heat = 0; this.calls = 0;
    this.queue = []; this.cars = []; this.cops = []; this.callLoc = null;
    this.officersDown = 0; this.log = [];
    this.copNames = U.shuffle(COP_SURNAMES.slice());
  }
  get eta() {
    if (!this.queue.length) return null;
    return Math.max(0, Math.min(...this.queue.map((q) => q.t)) - this.g.time);
  }
  report(src, x, y, info) {
    const g = this.g;
    this.calls++;
    this.callLoc = { x, y, info };
    // On Halloween night, an unverified "man in a mask" call sounds like a prank.
    const evidence = g.time - g.lastKillerSeenT < 90 || g.bodies.length > 0 || g.player.hp < 100 || src === 'resident' && this.calls > 1;
    this.lowPriority = this.level === 0 && !evidence;
    if (this.level === 0) this.dispatch(1);
    else {
      // a second, credible call speeds things up
      if (evidence) for (const q of this.queue) q.t = Math.min(q.t, g.time + g.diff.policeEta * 0.6);
      this.addHeat(1.6, 'call');
    }
    g.onPoliceCalled(src);
  }
  addHeat(n, reason) {
    if (this.level === 0) { this.heat += n * 0.5; return; }
    this.heat += n;
    if (this.level === 1 && this.heat >= 4) this.dispatch(2);
    else if (this.level === 2 && this.heat >= 9) this.dispatch(3);
  }
  dispatch(level) {
    const g = this.g;
    this.level = level;
    const units = level === 1 ? 1 : level === 2 ? 2 : 3;
    const eta = g.diff.policeEta * (level === 1 ? (this.lowPriority ? 1.8 : 1) : level === 2 ? 0.65 : 0.5) * U.rf(0.9, 1.1);
    if (level === 1 && this.lowPriority) g.ui.message('Dispatch sounds tired: "Third masked-man call tonight, hon. We\'ll send someone when we can." (Seeing him or finding evidence makes them hurry.)', '#8fb0ff', 7);
    for (let i = 0; i < units; i++) this.queue.push({ t: g.time + eta + i * 4, level, idx: i });
    const loc = this.callLoc ? g.placeName(this.callLoc.x, this.callLoc.y) : STREETS[g.map.kind];
    const addr = (this.callLoc && this.callLoc.info) || loc;
    const tpl = U.pick(DISPATCH_LINES[level]);
    const fallback = tpl.replace('{addr}', addr).replace('{loc}', loc).replace('{eta}', Math.round(eta));
    g.radio(fallback, level >= 2);
    if (LLM.active() && LLM.cfg.npc) {
      LLM.dispatch({ level, units, eta_seconds: Math.round(eta), location: addr, town: g.profile.location, reason: level === 1 ? '911 call about a prowler with a knife' : level === 2 ? 'multiple calls, possible homicide' : 'officer down / multiple homicides' })
        .then((t) => { if (t) g.radio('Dispatch: ' + t.replace(/^dispatch:\s*/i, ''), level >= 2); }).catch(() => {});
    }
    if (level >= 2) g.ui.bigText(level === 2 ? 'BACKUP DISPATCHED' : 'ALL UNITS RESPONDING', '#7aa0ff', 2.5);
  }
  update(dt) {
    const g = this.g;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (g.time >= this.queue[i].t) { this.spawnCar(this.queue[i]); this.queue.splice(i, 1); }
    }
    let siren = 0, pan = 0;
    for (const c of this.cars) {
      c.update(dt);
      const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
      const v = c.sirenOn ? Math.max(0, 1 - d / 1800) * 0.9 : 0;
      if (v > siren) { siren = v; pan = U.clamp((c.x - g.player.x) / 500, -0.9, 0.9); }
    }
    Sound.loop('siren', siren, pan);
    for (const cop of this.cops) cop.update(dt);
  }
  spawnCar(q) {
    const g = this.g, m = g.map;
    const target = this.callLoc || { x: g.player.x, y: g.player.y };
    let tx;
    if (m.kind === 'camp') tx = (16 + this.cars.length * 4) * TILE;
    else tx = U.clamp(target.x + this.cars.length * 3 * TILE * (this.cars.length % 2 ? 1 : -1), 6 * TILE, (m.w - 8) * TILE);
    const laneY = m.entry.y + (m.kind === 'camp' ? 0 : (this.cars.length % 2 ? -TILE : TILE * 0.5));
    const car = new Cruiser(g, m.entry.x - this.cars.length * 60, laneY, tx, q.level);
    this.cars.push(car);
  }
  copName(rank) {
    const n = this.copNames.shift() || U.pick(COP_SURNAMES);
    return (rank || 'Officer') + ' ' + n;
  }
}

class Cruiser {
  constructor(g, x, y, tx, level) {
    this.g = g; this.x = x; this.y = y; this.tx = tx; this.level = level;
    this.ang = 0; this.speed = 260; this.parked = false; this.sirenOn = true; this.flashT = 0;
    this.cops = []; this.color = level === 3 ? '#1a1a1a' : '#e8e8e8';
  }
  update(dt) {
    const g = this.g;
    this.flashT += dt;
    if (!this.parked) {
      const d = this.tx - this.x;
      const sp = Math.min(this.speed, Math.max(40, Math.abs(d) * 1.6));
      this.x += Math.sign(d) * Math.min(Math.abs(d), sp * dt);
      if (Math.abs(d) < 2) this.park();
    }
  }
  park() {
    const g = this.g;
    this.parked = true;
    const n = this.level === 3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const rank = this.level === 3 && i === 0 ? 'Sheriff' : this.level === 3 ? 'Deputy' : 'Officer';
      const cop = new Cop(g, this, this.x + (i - 0.5) * 30, this.y + (i % 2 ? -28 : 28), rank);
      this.cops.push(cop); g.police.cops.push(cop);
    }
    g.message(`Police cruiser arrived ${g.placeName(this.x, this.y)}.`, '#8fb0ff');
    const c0 = this.cops[0];
    c0.say(this.level === 3 ? 'Sheriff\'s department! Spread out, find him!' : U.pick(LINES.cop.arrive).replace('Haddonfield', g.profile.location.split(',')[0]));
    g.noise(this.x, this.y, 14, 'siren', this);
    setTimeout(() => { this.sirenOn = false; }, 6000);
  }
  get flash() { return Math.floor(this.flashT * 6) % 2; }
}

class Cop extends Agent {
  constructor(g, car, x, y, rank) {
    super(g, x, y);
    this.kind = 'cop'; this.car = car; this.rank = rank;
    this.name = g.police.copName(rank);
    this.hp = rank === 'Sheriff' ? 140 : rank === 'Deputy' ? 120 : 100;
    this.state = 'deploy'; this.stateT = 0;
    this.spec = Object.assign({}, Sprites.SPECS.cop, { id: 'cop' + rank, top: rank === 'Officer' ? '#2a3a5e' : '#5a4a2a', pants: rank === 'Officer' ? '#1b2236' : '#3a3020' });
    this.flashOn = true; this.shootCd = U.rf(0, 0.5); this.awareK = 0;
    this.lastSeenK = -99; this.kx = 0; this.ky = 0; this.wp = null; this.barkT = 0;
    this.r = 9;
  }
  say(t, d = 3) { this.g.say(this, t, d); }
  update(dt) {
    if (this.dead) return;
    const g = this.g, k = g.killer, P = g.player;
    this.moving = false; this.stateT += dt; this.shootCd -= dt; this.barkT -= dt;
    // perceive killer
    let vis = 0;
    if (k && !k.hiddenIn && !k.downed) vis = g.canSee(this, k, { range: 14 * TILE, fov: 2.2, near: 2.5 * TILE, flash: true, shroud: true });
    if (vis > 0) this.awareK = Math.min(1.5, this.awareK + vis * dt * 4); else this.awareK = Math.max(0, this.awareK - dt * 0.5);
    const seesK = this.awareK >= 1 && vis > 0;
    if (seesK) {
      if (g.time - this.lastSeenK > 6) {
        this.say(U.pick(LINES.cop.see));
        g.police.addHeat(1, 'sighting');
        if (LLM.active() && LLM.cfg.npc && U.chance(0.4)) LLM.copBark({ situation: 'you just spotted the masked killer', killer: g.profile.fullName }).then((t) => t && this.say(t)).catch(() => {});
      }
      this.lastSeenK = g.time; this.kx = k.x; this.ky = k.y;
      if (this.state !== 'engage') this.state = 'engage';
    }
    const dP = this.dist(P);
    switch (this.state) {
      case 'deploy': {
        const t = g.police.callLoc || P;
        const r = this.goTo(t.x, t.y, 100, dt, { arrive: 48 });
        if (r === 'arrived' || r === 'nopath' || this.stateT > 40) { this.state = 'search'; this.stateT = 0; }
        if (dP < 9 * TILE && g.canSee(this, P, { range: 10 * TILE, fov: 3, near: 3 * TILE }) > 0) this.startEscort();
        break;
      }
      case 'search': {
        if (!this.wp || this.stateT > 12) {
          const H = g.police.callLoc ? g.map.houseAt(g.police.callLoc.x, g.police.callLoc.y) : null;
          const p = H && U.chance(0.6) ? g.map.randomFloorIn(H) : null;
          this.wp = p ? { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE } : { x: this.car.x + U.rf(-9, 9) * TILE, y: this.car.y + U.rf(-9, 9) * TILE };
          this.stateT = 0;
        }
        const r = this.goTo(this.wp.x, this.wp.y, 80, dt);
        if (r === 'arrived' || r === 'nopath') this.wp = null;
        if (this.barkT <= 0) { this.barkT = U.rf(9, 16); this.say(U.pick(['Police! Anybody here?', 'Come out with your hands up!', 'Clear!', 'Hello? Police!'])); g.noise(this.x, this.y, 10, 'shout', this); }
        if (dP < 10 * TILE && g.canSee(this, P, { range: 10 * TILE, fov: 3, near: 3 * TILE }) > 0) this.startEscort();
        break;
      }
      case 'engage': {
        const d = Math.hypot(this.kx - this.x, this.ky - this.y);
        this.turnTo(Math.atan2(this.ky - this.y, this.kx - this.x), dt, 10);
        if (seesK) {
          if (d < 2.6 * TILE) this.moveBy(-Math.cos(this.facing) * 70 * dt, -Math.sin(this.facing) * 70 * dt);
          if (this.shootCd <= 0) this.shoot(k, d);
        } else if (g.time - this.lastSeenK < 6) {
          this.goTo(this.kx, this.ky, 95, dt, { arrive: 30 });
        } else { this.state = this.escorting ? 'escort' : 'search'; this.stateT = 0; }
        break;
      }
      case 'escort': {
        const car = this.car;
        if (P.hidden) { if (this.barkT <= 0) { this.barkT = 6; this.say('Come on out, it\'s the police! You\'re safe!'); } this.goTo(P.x, P.y, 90, dt, { arrive: 40 }); break; }
        if (dP > 4.5 * TILE) this.goTo(P.x, P.y, 120, dt, { arrive: 50, repath: 0.6 });
        else { const r = this.goTo(car.x, car.y + 34, 82, dt, { arrive: 40 }); if (r === 'arrived') this.turnTo(this.angleTo(P), dt, 4); }
        break;
      }
      default: break;
    }
    this.animate(dt);
  }
  startEscort() {
    if (this.escorting) return;
    this.escorting = true; this.state = 'escort'; this.stateT = 0;
    this.say(U.pick(LINES.cop.escort));
    this.g.message(`${this.name} will escort you to the cruiser. Stay close and get in!`, '#8fb0ff');
  }
  shoot(k, d) {
    const g = this.g;
    this.shootCd = U.rf(0.55, 0.85);
    this.atkAnim = 0.12;
    Sound.play('gun', { x: this.x, y: this.y, maxD: 1600 });
    g.noise(this.x, this.y, 24, 'gun', this);
    g.muzzle(this.x + Math.cos(this.facing) * 16, this.y + Math.sin(this.facing) * 16, this.facing);
    const hitP = U.clamp(0.75 - d / (22 * TILE) - (k.moving ? 0.1 : 0), 0.15, 0.85);
    if (Math.random() < hitP) { k.takeHit(13, 0.55, this, 18, 'gun'); g.addBlood(k.x, k.y, 1); }
    if (!this.firedOnce) { this.firedOnce = true; g.police.addHeat(1, 'shots'); }
  }
  takeHit(dmg) {
    if (this.dead) return;
    this.hp -= dmg;
    this.g.addBlood(this.x, this.y, 2);
    if (this.hp <= 0) this.g.copDown(this);
    else { this.state = 'engage'; this.lastSeenK = this.g.time; this.kx = this.g.killer.x; this.ky = this.g.killer.y; }
  }
}
