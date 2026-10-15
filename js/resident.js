'use strict';
// ---------------------------------------------------------------------------
// Residents: personalities, memory, perception and a state machine
// (home / investigate / flee / hide / follow / stay / call / fight / safe).
// ---------------------------------------------------------------------------
let RES_ID = 0;
class Resident extends Agent {
  constructor(g, house, o = {}) {
    const spot = g.map.randomFloorIn(house) || { x: house.x + 2, y: house.y + 2 };
    super(g, (spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE);
    this.kind = 'resident'; this.id = RES_ID++;
    this.house = house; house.residents.push(this);
    this.female = o.female != null ? o.female : U.chance(0.55);
    const first = U.pick(this.female ? NAMES_F : NAMES_M);
    this.name = first + (o.surname ? ' ' + o.surname : '');
    this.first = first;
    this.age = o.age || U.pick(['teen', 'adult', 'adult', 'older']);
    this.ageWord = { teen: 'teenager', adult: 'adult', older: 'older neighbor' }[this.age];
    this.persona = o.persona || U.pick(PERSONALITIES);
    this.bravery = U.clamp(this.persona.bravery + U.rf(-0.15, 0.15), 0, 1);
    this.trust = U.clamp(this.persona.trust + U.rf(-0.1, 0.1), 0, 1);
    this.spec = Sprites.randomSpec(this.female);
    if (this.age === 'older') this.spec.hair = U.pick(['#8a8a8a', '#b0b0b0', '#6a6a6a']);
    this.hp = 60; this.fear = 0; this.state = 'home'; this.stateT = 0;
    this.asleep = o.asleep != null ? o.asleep : (this.age === 'older' && U.chance(0.45));
    this.item = o.item || null;
    this.weapon = this.bravery > 0.7 && U.chance(0.5) ? 'bat' : null;
    if (this.weapon) this.spec.weapon = 'bat';
    this.knowledge = [];
    this.mem = { killerSeen: false, killerT: -999, killerX: 0, killerY: 0, killerPlace: '', bodies: 0, heard: null, saidT: -99 };
    this.chat = [];
    this.waypoint = null; this.idleT = U.rf(1, 5);
    this.screamT = -99; this.hidden = null; this.speech = null;
    this.flashOn = this.age !== 'older' && U.chance(0.3);
    this.saved = false; this.lastSawPlayerT = -99; this.talked = 0;
    this.awareK = 0;
  }
  inHouse() { const H = this.g.map.houseAt(this.x, this.y); return H === this.house; }
  get place() { return this.g.placeName(this.x, this.y); }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; this.clearPath(); this.waypoint = null; } }
  say(text, dur = 3.2) { this.g.say(this, text, dur); }

  update(dt) {
    if (this.dead) return;
    const g = this.g;
    this.moving = false; this.stateT += dt;
    this.fear = Math.max(0, this.fear - dt * 0.01);
    if (!this.hidden) this.perceive(dt);
    switch (this.state) {
      case 'home': this.doHome(dt); break;
      case 'investigate': this.doInvestigate(dt); break;
      case 'flee': this.doFlee(dt); break;
      case 'hide': this.doHide(dt); break;
      case 'follow': this.doFollow(dt); break;
      case 'stay': this.doStay(dt); break;
      case 'call': this.doCall(dt); break;
      case 'fight': this.doFight(dt); break;
      case 'safe': this.doSafe(dt); break;
      default: break;
    }
    // cops nearby => safe
    if (this.state !== 'safe' && g.police.cops.some((c) => !c.dead && this.dist(c) < 4 * TILE) && !this.hidden) {
      this.setState('safe'); this.saved = true; this.say(U.pick(['Oh thank God, officer!', 'Please get me out of here!', 'He\'s still out there!']));
      g.police.addHeat(0.5, 'witness');
    }
    this.animate(dt);
  }

  perceive(dt) {
    const g = this.g, k = g.killer;
    if (this.asleep) {
      return;
    }
    if (k && !k.hiddenIn && !k.downed) {
      const vis = g.canSee(this, k, { range: 13 * TILE, fov: 2.4, near: 2 * TILE, shroud: true });
      if (vis > 0) this.awareK += vis * dt * 3; else this.awareK = Math.max(0, this.awareK - dt);
      if (this.awareK >= 1) this.onSeeKiller();
    }
    // bodies
    for (const b of g.bodies) {
      if (b.seenBy.has(this.id)) continue;
      if (this.dist(b) < 7 * TILE && g.map.los(this.x, this.y, b.x, b.y) && g.map.lightAt(b.x, b.y) + (this.flashOn ? 0.3 : 0) > 0.12) {
        b.seenBy.add(this.id); this.mem.bodies++; this.fear = Math.min(1, this.fear + 0.5);
        this.say(`Oh God... ${b.first}?! ${U.pick(['NO!', 'Somebody help!', 'Is that blood?!'])}`);
        this.scream(); g.police.addHeat(0.5, 'body');
        if (this.state === 'home' || this.state === 'investigate') this.setState(this.canCall() ? 'call' : 'flee');
      }
    }
    // player noticed
    if (g.canSee(this, g.player, { range: 9 * TILE, fov: 2.6, near: 2 * TILE }) > 0) this.lastSawPlayerT = g.time;
  }

  hear(n) {
    if (this.dead || this.hidden) return;
    const loud = ['scream', 'glass', 'bang', 'gun', 'doorBreak', 'flare'].includes(n.type);
    if (this.asleep) { if (loud && n.r >= 6) { this.asleep = false; this.say('Huh? What was that?!'); } else return; }
    if (!loud) return;
    this.mem.heard = { x: n.x, y: n.y, t: this.g.time, type: n.type };
    this.fear = Math.min(1, this.fear + (n.type === 'gun' ? 0.25 : 0.15));
    if (this.state === 'home') {
      if (n.type === 'gun' || n.type === 'scream') { if (this.canCall() && U.chance(0.6)) { this.say('Something\'s wrong. I\'m calling the police!'); this.setState('call'); return; } }
      if (this.bravery > 0.55 && U.chance(0.7)) { this.say(U.pick(LINES.hearNoise)); this.setState('investigate'); }
      else { this.say(U.pick(['What was that?!', 'I\'m locking the doors.', 'Hello...?'])); this.setState('stay'); }
    }
  }

  canCall() { return this.house.phoneLine && this.house.phoneObj && !this.house.phoneDeadKnown; }

  onSeeKiller() {
    const g = this.g, k = g.killer;
    const first = !this.mem.killerSeen;
    this.mem.killerSeen = true; this.mem.killerT = g.time; this.mem.killerX = k.x; this.mem.killerY = k.y;
    this.mem.killerPlace = g.placeName(k.x, k.y);
    this.fear = Math.min(1, this.fear + 0.6);
    if (this.asleep) this.asleep = false;
    if (first) { g.police.addHeat(0.5, 'sighting'); this.trust = Math.min(1, this.trust + 0.25); }
    if (['flee', 'hide', 'fight'].includes(this.state) && this.stateT < 3) return;
    if (this.hidden) return;
    if (this.weapon && this.bravery > 0.75 && k.level < 2 && this.dist(k) < 6 * TILE && U.chance(0.5)) {
      this.say(U.pick(['Get away from here, you freak!', 'Come on then!', 'I\'ll bash your head in!'])); this.setState('fight'); return;
    }
    if (g.time - this.screamT > 6) { this.say(U.pick(LINES.seeKiller)); this.scream(); }
    if (this.state === 'follow') { this.fleeT = 3; return; }
    this.setState('flee');
  }
  scream() {
    const g = this.g;
    this.screamT = g.time;
    Sound.play('scream', { x: this.x, y: this.y, maxD: 1100, pitch: this.female ? U.rf(1.0, 1.2) : U.rf(0.7, 0.85) });
    g.noise(this.x, this.y, 16, 'scream', this);
  }

  // -------- states --------
  doHome(dt) {
    if (this.asleep) return;
    this.idleT -= dt;
    if (!this.waypoint && this.idleT <= 0) {
      const H = this.house;
      const p = U.chance(0.85) ? this.g.map.randomFloorIn(H) : null;
      if (p) this.waypoint = { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
      this.idleT = U.rf(4, 11);
    }
    if (this.waypoint) {
      const r = this.goTo(this.waypoint.x, this.waypoint.y, 50, dt);
      if (r === 'arrived' || r === 'nopath') this.waypoint = null;
    }
  }
  doInvestigate(dt) {
    const h = this.mem.heard;
    if (!h || this.stateT > 14) { this.say(U.pick(['Must\'ve been the wind.', 'Probably just kids.', 'Hello? ...nothing.'])); this.setState('home'); return; }
    this.flashOn = true;
    const r = this.goTo(h.x, h.y, 70, dt, { arrive: 40 });
    if (r === 'arrived' || r === 'nopath') { this.turnTo(this.facing + 1.5, dt, 1); if (this.stateT > 10) this.setState('home'); }
  }
  doFlee(dt) {
    const g = this.g, k = g.killer;
    if (!this.waypoint || this.stateT > 7 && !this.fleeDecided) {
      this.fleeDecided = this.stateT > 7;
      this.waypoint = this.pickFleeTarget();
    }
    const kd = this.dist(k);
    const r = this.goTo(this.waypoint.x, this.waypoint.y, kd < 6 * TILE ? 148 : 120, dt, { repath: 0.6 });
    if (r === 'arrived' || r === 'nopath' || this.stateT > 14) {
      this.fleeDecided = false;
      if (this.waypoint.toPlayer && this.dist(g.player) < 3 * TILE && !g.player.hidden) { this.say('Please, don\'t leave me!'); this.setState('follow'); return; }
      if (this.waypoint.toCop) { this.setState('safe'); return; }
      this.setState('hide');
    }
  }
  pickFleeTarget() {
    const g = this.g, k = g.killer, P = g.player;
    const cop = g.police.cops.filter((c) => !c.dead).sort((a, b) => this.dist(a) - this.dist(b))[0];
    if (cop && this.dist(cop) < 25 * TILE) return { x: cop.x, y: cop.y, toCop: true };
    if (!P.hidden && this.trust > 0.4 && this.dist(P) < 12 * TILE && P.dist(k) > 5 * TILE) return { x: P.x, y: P.y, toPlayer: true };
    // farthest reachable-ish spot from the killer, preferring indoors
    let best = null, bs = -1e9;
    for (let i = 0; i < 24; i++) {
      const a = U.rf(0, TAU), d = U.rf(6, 14) * TILE;
      const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!g.map.walkable(tx, ty)) continue;
      const s = Math.hypot(x - k.x, y - k.y) / TILE + (g.map.isIndoor(tx, ty) ? 4 : 0) - (Math.abs(U.angDiff(a, this.angleTo(k))) < 0.8 ? 12 : 0);
      if (s > bs) { bs = s; best = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; }
    }
    return best || { x: this.x - Math.cos(this.angleTo(k)) * 5 * TILE, y: this.y - Math.sin(this.angleTo(k)) * 5 * TILE };
  }
  doHide(dt) {
    const g = this.g;
    if (this.hidden) {
      this.hideT += dt;
      const k = g.killer;
      if (this.followHide && !g.player.hidden && this.hideT > 1.5) { this.unhide(); this.followHide = false; this.setState('follow'); return; }
      const calm = g.time - this.mem.killerT > 45 && (!k || this.dist(k) > 10 * TILE);
      if (calm && this.hideT > 30) { this.unhide(); this.say('(whispering) Is he gone...?'); this.setState(this.canCall() ? 'call' : 'home'); }
      return;
    }
    if (!this.hideSpot || this.hideSpot.occupant || (g.killer.hiddenIn === this.hideSpot)) this.hideSpot = this.findHideSpot();
    if (!this.hideSpot) { this.setState('stay'); return; }
    const r = this.goTo(this.hideSpot.x, this.hideSpot.y, 120, dt, { arrive: 26 });
    if (r === 'arrived' || g.map.distToObj(this.x, this.y, this.hideSpot) < 18) {
      if (this.hideSpot.occupant) { this.hideSpot = null; return; }
      this.hidden = this.hideSpot; this.hideSpot.occupant = this; this.hideT = 0;
      this.x = this.hidden.x; this.y = this.hidden.y;
      // the killer might have seen
      const k = g.killer;
      if (k.canSeeAgent(this)) k.mem.sawResHide = { res: this, obj: this.hidden, t: g.time };
    } else if (r === 'nopath') this.hideSpot = null;
  }
  findHideSpot() {
    const g = this.g;
    let best = null, bd = 1e9;
    for (const o of g.map.objects) {
      if (!o.hide || o.occupant || g.killer.hiddenIn === o) continue;
      const d = Math.hypot(o.x - this.x, o.y - this.y);
      if (d < bd && d < 16 * TILE) { bd = d; best = o; }
    }
    return best;
  }
  unhide() {
    if (!this.hidden) return;
    const o = this.hidden; o.occupant = null; this.hidden = null;
    const m = this.g.map;
    for (let y = o.ty - 1; y <= o.ty + o.h; y++) for (let x = o.tx - 1; x <= o.tx + o.w; x++) {
      if (m.walkable(x, y)) { this.x = (x + 0.5) * TILE; this.y = (y + 0.5) * TILE; return; }
    }
  }
  doFollow(dt) {
    const g = this.g, P = g.player;
    const d = this.dist(P);
    if (P.hidden) {
      // hide near the player
      if (!this.hidden) { this.followHide = true; this.setState('hide'); }
      return;
    }
    if (d > 26 * TILE) { this.say('Where did you go?! ...I\'ll hide.'); this.setState('hide'); return; }
    this.fleeT = (this.fleeT || 0) - dt;
    if (d > 2.2 * TILE) {
      const sp = d > 6 * TILE || this.fleeT > 0 || P.running ? 150 : 96;
      this.goTo(P.x - Math.cos(P.aim) * 30, P.y - Math.sin(P.aim) * 30, sp, dt, { repath: 0.5, arrive: 20 });
    } else this.turnTo(this.angleTo(P), dt, 4);
    if (U.chance(dt * 0.02) && g.time - this.mem.saidT > 25) { this.mem.saidT = g.time; this.say(U.pick(['Where are we going?', 'I think I heard something...', 'Stay close, okay?', 'Is he still out there?'])); }
  }
  doStay(dt) {
    const H = this.house;
    if (!this.inHouse()) {
      const p = this.homeSpot || (this.homeSpot = this.g.map.randomFloorIn(H));
      if (p) { const r = this.goTo((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 120, dt); if (r !== 'nopath') return; }
    }
    // lock up and hide
    for (const d of H.extDoors) { if (!d.broken) { if (d.open) this.g.setDoor(d, false, this); d.locked = true; } }
    this.setState('hide');
  }
  doCall(dt) {
    const g = this.g, H = this.house;
    if (!H.phoneObj) { this.setState('stay'); return; }
    const r = this.goTo(H.phoneObj.x, H.phoneObj.y, 115, dt, { arrive: 30 });
    if (r === 'arrived' || g.map.distToObj(this.x, this.y, H.phoneObj) < 22) {
      this.callT = (this.callT || 0) + dt;
      if (this.callT > 2.2) {
        this.callT = 0;
        if (H.phoneLine) {
          this.say(U.pick(LINES.called));
          g.police.report('resident', this.x, this.y, `${this.name} at ${H.address}`);
          this.calledPolice = true;
        } else { this.say(U.pick(LINES.lineDead)); Sound.play('dead', { x: this.x, y: this.y }); H.phoneDeadKnown = true; this.fear = Math.min(1, this.fear + 0.3); }
        this.setState('stay');
      }
    } else if (r === 'nopath') this.setState('stay');
  }
  doFight(dt) {
    const g = this.g, k = g.killer;
    if (k.downed || k.hiddenIn || this.stateT > 12 || this.hp < 30) { this.setState('flee'); return; }
    const d = this.dist(k);
    if (d > 1.4 * TILE) this.goTo(k.x, k.y, 135, dt, { repath: 0.4 });
    else {
      this.turnTo(this.angleTo(k), dt, 10);
      this.atkCd = (this.atkCd || 0) - dt;
      if (this.atkCd <= 0) {
        this.atkCd = 1.1; this.atkAnim = 0.25;
        Sound.play('hit', { x: this.x, y: this.y });
        k.takeHit(14, 1.4, this, 40);
        if (U.chance(0.3)) this.say(U.pick(['Stay DOWN!', 'Take that!', 'Run! I\'ll hold him!']));
      }
    }
  }
  doSafe(dt) {
    const g = this.g;
    const car = g.police.cars.find((c) => c.parked);
    if (car) { const r = this.goTo(car.x + 20, car.y + 40, 110, dt, { arrive: 30 }); if (r === 'arrived') this.turnTo(this.angleTo(g.player), dt, 2); }
    else { const cop = g.police.cops.find((c) => !c.dead); if (cop && this.dist(cop) > 2 * TILE) this.goTo(cop.x, cop.y, 110, dt, { arrive: 40 }); }
  }

  takeHit(dmg, killer) {
    if (this.dead) return;
    this.hp -= dmg;
    this.g.addBlood(this.x, this.y, 2);
    if (this.hidden) this.unhide();
    if (this.hp <= 0) { this.g.killResident(this, killer); return; }
    this.scream();
    this.setState('flee');
  }
  cost(x, y) {
    const c = super.cost(x, y);
    return c;
  }
  handleDoor(d, dt) {
    if (d.locked) {
      // residents can unlock their own house's doors
      if (d.house === this.house.id) { d.locked = false; Sound.play('lock', { x: d.px, y: d.py }); }
      else return false;
    }
    this.doorT += dt;
    if (this.doorT > 0.35) { this.g.setDoor(d, true, this); this.doorT = 0; }
    return true;
  }

  // ---------- conversation ----------
  moodWord() {
    if (this.fear > 0.7) return 'terrified';
    if (this.fear > 0.35) return 'scared';
    if (this.state === 'follow') return 'following you';
    return this.persona.label;
  }
  respond(choice) {
    const g = this.g;
    this.talked++;
    this.trust = Math.min(1, this.trust + 0.06);
    const willing = this.trust + this.fear * 0.6 + (this.mem.killerSeen ? 0.3 : 0) + this.mem.bodies * 0.25;
    switch (choice) {
      case 'seen': {
        const bits = [];
        if (this.mem.killerSeen) bits.push(`I saw him! ${Math.round((g.time - this.mem.killerT))} seconds ago, ${this.mem.killerPlace}. A man in a ${g.killer.profile.id === 'jason' ? 'hockey mask' : g.killer.profile.id === 'ghostface' ? 'ghost costume' : 'white mask'}.`);
        else if (this.mem.heard) bits.push('I heard something, but I didn\'t see anything.');
        else bits.push(U.pick(['Seen what? It\'s been quiet. Just trick-or-treaters.', 'Nothing. Why, what\'s going on?']));
        if (this.knowledge.length) bits.push(U.pick(this.knowledge));
        return { say: bits.join(' '), action: 'none' };
      }
      case 'follow':
        if (this.state === 'follow') return { say: 'I\'m right behind you!', action: 'none' };
        if (willing > 0.75 || (this.persona.id !== 'grumpy' && willing > 0.6)) return { say: U.pick(LINES.follow), action: 'follow' };
        return { say: U.pick(LINES.refuse), action: 'none' };
      case 'stay': return { say: U.pick(LINES.stay), action: 'stay' };
      case 'call':
        if (!this.house.phoneObj) return { say: 'We don\'t have a phone out here!', action: 'none' };
        if (willing > 0.45 || this.mem.killerSeen) return { say: 'Okay... okay, I\'ll call them.', action: 'call_police' };
        return { say: 'And tell them what? A Halloween prank? No.', action: 'none' };
      case 'item':
        if (!this.item) return { say: 'I don\'t have anything that would help. Sorry.', action: 'none' };
        if (this.trust > 0.35 || this.mem.killerSeen) return { say: `Here, take my ${ITEMS[this.item].name.toLowerCase()}. Be careful.`, action: 'give_item' };
        return { say: 'I don\'t even know you.', action: 'none' };
      default: return { say: U.pick(LINES.greet), action: 'none' };
    }
  }
  applyAction(action) {
    const g = this.g;
    switch (action) {
      case 'follow': if (this.hidden) this.unhide(); this.setState('follow'); break;
      case 'stay': this.setState('stay'); break;
      case 'call_police':
        if (!this.house.phoneObj) break;
        this.setState('call'); break;
      case 'give_item':
        if (this.item) { if (g.player.addItem(this.item)) { g.message(`${this.first} gave you: ${ITEMS[this.item].name}`, '#e8c070'); Sound.play('pickup'); this.item = null; } else g.message('Inventory full.', '#aaa'); }
        break;
      case 'flee': this.setState('flee'); break;
      case 'hide': this.setState('hide'); break;
      default: break;
    }
  }
}
