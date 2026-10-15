'use strict';
// ---------------------------------------------------------------------------
// The survivor: movement, stamina, flashlight, fear, combat, hiding,
// inventory and the context-sensitive interaction system.
// ---------------------------------------------------------------------------
class Player extends Agent {
  constructor(g, x, y) {
    super(g, x, y);
    this.kind = 'player'; this.r = 9;
    this.hp = 100; this.stamina = 100; this.fear = 0; this.battery = 100;
    this.flashOn = true; this.inv = []; this.equipped = null;
    this.crouch = false; this.running = false; this.exhausted = false; this.staminaDelay = 0;
    this.hidden = null; this.holdBreath = false; this.breathT = 0;
    this.aim = 0; this.atkCd = 0; this.stepDist = 0; this.lockMsgT = 0;
    this.inter = null; this.interProg = 0; this.interKey = null;
    this.spec = Object.assign({}, Sprites.SPECS.player);
    this.cellCharge = 2; this.flicker = 0; this.healQ = 0;
    this.lastHurtT = -99; this.watchedMsgT = -99;
    this.stats = { searched: 0, hits: 0, scares: 0, hidden: 0 };
  }

  get weapon() { return this.equipped ? ITEMS[this.equipped].weapon : null; }
  has(id) { return this.inv.some((s) => s.id === id); }
  count(id) { const s = this.inv.find((q) => q.id === id); return s ? s.n : 0; }
  addItem(id, n = 1) {
    const s = this.inv.find((q) => q.id === id);
    if (s) { s.n += n; return true; }
    if (this.inv.length >= 8) return false;
    this.inv.push({ id, n });
    if ((id === 'knife' || id === 'bat') && !this.equipped) this.equipped = id;
    if (id === 'bat' && this.equipped === 'knife') this.equipped = 'bat';
    return true;
  }
  removeItem(id, n = 1) {
    const s = this.inv.find((q) => q.id === id);
    if (!s) return false;
    s.n -= n;
    if (s.n <= 0) { this.inv.splice(this.inv.indexOf(s), 1); if (this.equipped === id) this.equipped = null; }
    return true;
  }

  update(dt, inp) {
    const g = this.g;
    this.moving = false;
    this.atkCd -= dt; this.lockMsgT -= dt; this.hideCd = (this.hideCd || 0) - dt;
    // aim
    this.aim = Math.atan2(inp.mouse.wy - this.y, inp.mouse.wx - this.x);
    // fear tremor on the flashlight
    if (this.fear > 30) this.aim += Math.sin(g.time * 23) * 0.012 * (this.fear - 30) / 10 + (Math.random() - 0.5) * 0.004 * this.fear / 10;
    this.facing = this.aim;

    if (this.hidden) { this.updateHidden(dt, inp); this.animate(dt); return; }

    // movement
    let mx = 0, my = 0;
    if (inp.key('KeyA') || inp.key('ArrowLeft')) mx -= 1;
    if (inp.key('KeyD') || inp.key('ArrowRight')) mx += 1;
    if (inp.key('KeyW') || inp.key('ArrowUp')) my -= 1;
    if (inp.key('KeyS') || inp.key('ArrowDown')) my += 1;
    const ml = Math.hypot(mx, my);
    if (ml > 0) { mx /= ml; my /= ml; }
    this.crouch = inp.key('KeyC') || inp.key('ControlLeft');
    const wantRun = inp.key('ShiftLeft') || inp.key('ShiftRight');
    this.running = wantRun && ml > 0 && !this.crouch && !this.exhausted && this.stamina > 0;
    let speed = this.crouch ? 52 : this.running ? 168 : 98;
    if (this.fear > 70) speed *= 0.93;
    if (this.hp < 30) speed *= 0.88;
    // panic stumble
    if (this.running && this.fear > 90 && Math.random() < dt * 0.25) {
      this.stamina = Math.max(0, this.stamina - 25); g.message('You stumble in panic!', '#c8a0ff'); g.shake(4);
    }
    // stamina
    if (this.running) {
      this.stamina -= (this.fear > 50 ? 27 : 21) * dt; this.staminaDelay = 0.9;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; g.message('Exhausted...', '#c8b25a'); }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + 15 * dt * (this.fear > 50 ? 0.65 : 1) * (this.crouch ? 1.25 : 1));
      if (this.exhausted && this.stamina > 35) this.exhausted = false;
    }
    if (ml > 0) {
      // bump-open doors
      const ax = Math.floor((this.x + mx * (this.r + 5)) / TILE), ay = Math.floor((this.y + my * (this.r + 5)) / TILE);
      const d = g.map.doorAt(ax, ay);
      if (d && !d.open && !d.broken) {
        if (d.locked) { if (this.lockMsgT <= 0) { g.message('Locked.' + (d.exterior ? ' Hold E to force it, or knock.' : ''), '#aaa'); this.lockMsgT = 2.5; } }
        else g.setDoor(d, true, this);
      }
      const onWin = g.map.get(this.tx, this.ty) === T.WINDOW;
      this.moveBy(mx * speed * dt * (onWin ? 0.45 : 1), my * speed * dt * (onWin ? 0.45 : 1));
      this.moving = true; this.speedNow = speed;
      // footsteps
      this.stepDist += speed * dt;
      const stride = this.running ? 40 : this.crouch ? 30 : 34;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const surf = g.map.isIndoor(this.tx, this.ty) ? 'wood' : 'grass';
        Sound.play('step', { vol: this.crouch ? 0.25 : this.running ? 0.9 : 0.55, surface: surf });
        g.noise(this.x, this.y, this.running ? 8 : this.crouch ? 1.2 : 3.5, 'step', this);
      }
    }
    // edge of the map on foot
    if (this.x < g.map.exitX) { this.x = g.map.exitX + 4; if (this.lockMsgT <= 0) { g.message("It's miles to the next town. You'd never make it on foot in the dark.", '#aaa'); this.lockMsgT = 4; } }

    // flashlight
    if (inp.pressed('KeyF')) { this.flashOn = !this.flashOn; Sound.play('click'); }
    if (this.flashOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - 0.42 * dt * g.diff.battery);
      if (this.battery === 0) g.message('Your flashlight dies.', '#f0e6a0');
    }
    // flicker: low battery, terror, or HIM close by
    const kd = g.killer ? this.dist(g.killer) : 1e9;
    let flick = 0;
    if (this.battery < 15) flick += 0.06;
    if (this.fear > 60) flick += 0.015;
    if (kd < 5 * TILE && !g.killer.downed) flick += 0.12;
    if (Math.random() < flick) this.flicker = U.rf(0.05, 0.25);
    this.flicker -= dt;

    // attack
    if ((inp.pressed('Space') || inp.mousePressed) && this.atkCd <= 0) this.attack();
    // items
    for (let i = 0; i < 8; i++) if (inp.pressed('Digit' + (i + 1))) this.useSlot(i);
    if (inp.pressed('KeyG')) { if (this.has('flare')) this.useItem('flare'); else g.message('No flares.', '#aaa'); }
    if (inp.pressed('KeyL')) this.toggleLock();

    // healing over time
    if (this.healQ > 0) { const h = Math.min(this.healQ, 18 * dt); this.healQ -= h; this.hp = Math.min(100, this.hp + h); }

    this.updateInteract(dt, inp);
    this.animate(dt);
  }

  get lightOn() { return this.flashOn && this.battery > 0 && this.flicker <= 0 && !this.hidden; }

  updateHidden(dt, inp) {
    const g = this.g;
    this.holdBreath = (inp.key('ShiftLeft') || inp.key('ShiftRight')) && this.stamina > 0;
    if (this.holdBreath) { this.stamina = Math.max(0, this.stamina - 11 * dt); }
    else this.stamina = Math.min(100, this.stamina + 9 * dt);
    // heavy breathing at high fear gives you away
    this.breathT -= dt;
    if (!this.holdBreath && this.fear > 55 && this.breathT <= 0) {
      this.breathT = U.rf(2.2, 3.5);
      Sound.play('breath', { vol: 0.5 });
      g.noise(this.x, this.y, 2.2 + (this.fear - 55) / 15, 'breath', this);
    }
    if (inp.pressed('KeyE')) { this.unhide(); return; }
    this.updateInteract(dt, inp, true);
  }
  hide(o) {
    this.hidden = o; o.occupant = this;
    this.hideFrom = { x: this.x, y: this.y };
    this.x = o.x; this.y = o.y;
    this.stats.hidden++;
    Sound.play('doorClose', { vol: 0.4 });
    this.g.noise(this.x, this.y, 1.5, 'hide', this);
    this.g.onPlayerHide(o);
  }
  unhide() {
    const o = this.hidden;
    if (!o) return;
    o.occupant = null; this.hidden = null;
    // step out to the nearest free tile
    const m = this.g.map;
    let best = this.hideFrom, bd = 1e9;
    for (let y = o.ty - 1; y <= o.ty + o.h; y++) for (let x = o.tx - 1; x <= o.tx + o.w; x++) {
      if (!m.walkable(x, y)) continue;
      const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
      const d = Math.hypot(px - this.hideFrom.x, py - this.hideFrom.y);
      if (d < bd) { bd = d; best = { x: px, y: py }; }
    }
    this.x = best.x; this.y = best.y;
    this.hideCd = 0.6; // don't re-enter on the same key press
    this.interProg = 0; this.interKey = null;
    Sound.play('doorOpen', { vol: 0.35 });
  }

  attack() {
    const g = this.g;
    const w = this.weapon || { dmg: 4, stun: 0.35, range: 30, cd: 0.55, stamina: 10, sound: 'hit', knock: 30 };
    if (this.stamina < w.stamina * 0.5) { g.message('Too tired to swing.', '#c8b25a'); return; }
    this.atkCd = w.cd; this.stamina = Math.max(0, this.stamina - w.stamina);
    this.atkAnim = 0.25;
    Sound.play('swing', { vol: 0.6 });
    g.noise(this.x, this.y, 3, 'swing', this);
    const k = g.killer;
    if (k && !k.downed && !k.hiddenIn && this.dist(k) < w.range + k.r + 6 && Math.abs(U.angDiff(this.aim, this.angleTo(k))) < 1.0 && g.map.los(this.x, this.y, k.x, k.y)) {
      k.takeHit(w.dmg, w.stun, this, w.knock || 20);
      Sound.play(w.sound, { vol: 1 });
      this.stats.hits++;
      g.addBlood(k.x, k.y, 3);
      return;
    }
    // break a window in front
    const fx = Math.floor((this.x + Math.cos(this.aim) * 26) / TILE), fy = Math.floor((this.y + Math.sin(this.aim) * 26) / TILE);
    const win = g.map.windowAt(fx, fy);
    if (win && !win.broken) {
      win.hp = (win.hp == null ? 3 : win.hp) - (this.weapon ? 2 : 1);
      Sound.play('hit', { vol: 0.5 });
      if (win.hp <= 0) g.breakWindow(win, this);
    }
  }

  toggleLock() {
    const g = this.g;
    const d = g.nearestDoor(this.x, this.y, 46);
    if (!d) { g.message('No door nearby to lock.', '#aaa'); return; }
    if (d.broken) { g.message('The lock is broken.', '#aaa'); return; }
    if (d.open) g.setDoor(d, false, this);
    d.locked = !d.locked;
    Sound.play('lock', { x: d.px, y: d.py });
    g.message(d.locked ? 'Door locked.' : 'Door unlocked.', '#ccc');
  }

  useSlot(i) { const s = this.inv[i]; if (s) this.useItem(s.id); }
  useItem(id) {
    const g = this.g;
    switch (id) {
      case 'battery':
        if (this.battery > 95) { g.message('Flashlight is already full.', '#aaa'); return; }
        this.battery = Math.min(100, this.battery + 70); this.removeItem(id); Sound.play('click');
        g.message('Fresh batteries.', '#f0e6a0'); break;
      case 'bandage':
        if (this.hp >= 100) { g.message('You are not hurt.', '#aaa'); return; }
        this.healQ += 35; this.removeItem(id); g.message('You bandage your wounds.', '#e88'); break;
      case 'candy':
        this.fear = Math.max(0, this.fear - 15); this.stamina = Math.min(100, this.stamina + 35); this.removeItem(id);
        g.message('Sugar. Breathe. You can do this.', '#e8a050'); break;
      case 'flare':
        this.removeItem(id); g.dropFlare(this.x + Math.cos(this.aim) * 18, this.y + Math.sin(this.aim) * 18); break;
      case 'knife': case 'bat':
        this.equipped = this.equipped === id ? null : id;
        g.message(this.equipped ? ITEMS[id].name + ' ready.' : 'Weapon put away.', '#ddd'); break;
      case 'cellphone':
        if (this.hidden) { g.message('Too risky to talk in here... the screen lights up.', '#aaa'); }
        if (g.ringing && g.ringing.cell) { g.answerGhostCall(); return; }
        if (this.cellCharge <= 0) { g.message('Battery dead. "Low battery" blinks, then nothing.', '#aaa'); return; }
        if (g.killer.profile.id === 'jason') { g.message('No signal out here in the woods.', '#aaa'); return; }
        this.cellCharge--; g.callPolice('cell', this.x, this.y);
        break;
      default:
        g.message(ITEMS[id].desc, '#ccc');
    }
  }

  // ---------------- interactions ----------------
  findInteraction() {
    const g = this.g, m = g.map;
    const opts = [];
    const add = (o) => { o.d = o.d == null ? 0 : o.d; opts.push(o); };
    if (this.hidden) {
      add({ label: 'Leave hiding spot', key: 'unhide', act: () => this.unhide(), d: 0 });
      return opts[0];
    }
    // residents
    for (const r of g.residents) {
      if (r.dead || r.hidden) continue;
      const d = this.dist(r);
      if (d < 48) add({ label: `Talk to ${r.name}`, key: 'talk' + r.id, act: () => g.ui.openDialog(r), d: d - 8, target: r });
    }
    // bodies
    for (const b of g.bodies) {
      const d = Math.hypot(b.x - this.x, b.y - this.y);
      if (d < 40 && b.item) add({ label: `Search ${b.name}'s body`, key: 'body' + b.id, need: 1.5, act: () => { this.addItem(b.item); g.message(`You take ${ITEMS[b.item].name} from ${b.name}. I'm sorry.`, '#c88'); b.item = null; }, d });
    }
    // doors
    const door = g.nearestDoor(this.x, this.y, 44);
    if (door && !door.broken) {
      const d = Math.hypot(door.px - this.x, door.py - this.y);
      if (door.locked && !door.open) {
        if (door.exterior) {
          const H = m.houses[door.house];
          const home = H && H.residents.some((r) => !r.dead && r.house === H && r.inHouse());
          if (home) add({ label: 'Knock on the door', key: 'knock' + door.x + door.y, act: () => g.knock(door), d: d + 2 });
        }
        add({ label: 'Force the door (loud)', key: 'force' + door.x + door.y, need: 3.2, act: () => g.forceDoor(door), d: d + 4, loud: true });
      } else {
        add({ label: door.open ? 'Close door' : 'Open door', key: 'door' + door.x + door.y, act: () => g.setDoor(door, !door.open, this), d: d + 6 });
      }
    }
    // objects
    const tx = this.tx, ty = this.ty;
    for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
      if (!m.inb(x, y)) continue;
      const oi = m.obj[m.idx(x, y)];
      if (oi >= 0) this.objInteractions(m.objects[oi], add);
    }
    for (const o of g.nonSolidNear(this.x, this.y, 60)) this.objInteractions(o, add);
    if (g.police) for (const car of g.police.cars) {
      const d = Math.hypot(car.x - this.x, car.y - this.y);
      if (car.parked && d < 70) add({ label: 'Get in the police cruiser', key: 'cruiser', act: () => g.tryCruiser(car), d: d - 30 });
    }
    if (!opts.length) return null;
    // prefer what we're aiming at
    let best = null, bs = 1e9;
    for (const o of opts) {
      let s = o.d;
      if (o.target) s -= 6;
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }

  objInteractions(o, add) {
    if (o._seenFrame === this.g.frame) return;
    o._seenFrame = this.g.frame;
    const g = this.g, m = g.map;
    const d = m.distToObj(this.x, this.y, o);
    if (d > 26) return;
    const H = o.house >= 0 ? m.houses[o.house] : null;
    if (o.container && (!o.container.searched || o.container.items.length)) {
      add({ label: `Search ${niceName(o.type)}`, key: 'search' + o.id, need: 1.1, act: () => g.searchContainer(o, this), d });
    }
    if (this.hideCd > 0) { /* just left a hiding spot */ }
    else if (o.hide && !o.occupant && !(g.killer && g.killer.hiddenIn === o)) add({ label: `Hide ${o.type === 'closet' ? 'in the closet' : 'under the bed'}`, key: 'hide' + o.id, act: () => this.hide(o), d: d + 1 });
    else if (o.hide && g.killer && g.killer.hiddenIn === o) add({ label: `Hide ${o.type === 'closet' ? 'in the closet' : 'under the bed'}`, key: 'hidek' + o.id, act: () => g.killer.springFromHiding(true), d: d + 1 });
    switch (o.type) {
      case 'phone':
        if (g.ringing && g.ringing.obj === o) add({ label: 'Answer the ringing phone', key: 'answer' + o.id, act: () => g.answerGhostCall(), d: d - 5 });
        else add({ label: 'Call 911', key: 'phone' + o.id, need: 1.6, act: () => g.usePhone(o), d });
        break;
      case 'radio': add({ label: 'Radio for help', key: 'radio' + o.id, need: 1.8, act: () => g.useRadio(o), d }); break;
      case 'lamp': case 'tv': if (o.light && (!H || H.power)) add({ label: o.light.on ? `Turn off ${o.type === 'tv' ? 'TV' : 'lamp'}` : `Turn on ${o.type === 'tv' ? 'TV' : 'lamp'}`, key: 'lamp' + o.id, act: () => g.toggleLight(o), d: d + 3 }); break;
      case 'breaker':
        if (H && !H.power) add({ label: this.has('fuse') ? 'Replace the fuse (restore power)' : 'Breaker is fried (need a fuse)', key: 'brk' + o.id, need: this.has('fuse') ? 2.5 : 0, act: () => g.restorePower(H, this), d });
        break;
      case 'phonebox':
        if (H && !H.phoneLine) add({ label: this.has('toolkit') ? 'Splice the phone line' : 'Phone line cut (need a toolkit)', key: 'pbx' + o.id, need: this.has('toolkit') ? 4 : 0, act: () => g.repairPhone(H, this), d });
        break;
      case 'transformer': case 'generator':
        if (!m.streetPower) add({ label: this.has('fuse') ? `Fix the ${o.type} (fuse)` : `The ${o.type} is dead (need a fuse)`, key: 'trf' + o.id, need: this.has('fuse') ? 3.5 : 0, act: () => g.restoreStreet(this), d });
        break;
      case 'car':
        add({ label: !this.has('keys') ? 'Car is locked (need keys)' : o.car.sabotaged ? (this.has('toolkit') ? 'Fix the car (toolkit)' : 'Car is sabotaged (need toolkit)') : 'Start the car and ESCAPE', key: 'car', need: this.has('keys') && o.car.sabotaged && this.has('toolkit') ? 6 : 0, act: () => g.useCar(o, this), d: d - 4 });
        break;
      default: break;
    }
  }

  updateInteract(dt, inp, hiddenMode) {
    const g = this.g;
    const it = this.findInteraction();
    this.inter = it;
    const holdingE = inp.key('KeyE');
    if (!it) { this.interProg = 0; this.interKey = null; return; }
    if (hiddenMode && it.key === 'unhide') return; // handled in updateHidden
    const need = (it.need || 0) * (this.fear > 70 ? 1.4 : this.fear > 30 ? 1.2 : 1);
    if (need <= 0) {
      if (inp.pressed('KeyE')) { it.act(); this.interProg = 0; }
      return;
    }
    if (holdingE && this.interKey === it.key) {
      this.interProg += dt / need;
      if (it.loud && Math.random() < dt * 2) { Sound.play('bang', { x: this.x, y: this.y, vol: 0.5 }); g.noise(this.x, this.y, 9, 'bang', this); }
      if (this.interProg >= 1) { this.interProg = 0; this.interKey = null; it.act(); }
    } else if (inp.pressed('KeyE')) {
      this.interKey = it.key; this.interProg = 0.001;
      if (it.key.startsWith('search')) Sound.play('search', { vol: 0.6 });
    } else if (!holdingE) { this.interProg = 0; this.interKey = null; }
  }
}

function niceName(t) {
  return ({ counter: 'the drawers', nightstand: 'the nightstand', dresser: 'the dresser', cabinet: 'the cabinet', footlocker: 'the footlocker', workbench: 'the workbench', desk: 'the desk', bookshelf: 'the bookshelf', fridge: 'the fridge', candybowl: 'the candy bowl', crate: 'the crate' })[t] || t;
}
