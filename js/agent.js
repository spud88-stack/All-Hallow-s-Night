'use strict';
// ---------------------------------------------------------------------------
// Base class for every moving character: collision, path following, doors.
// ---------------------------------------------------------------------------
class Agent {
  constructor(game, x, y) {
    this.g = game; this.x = x; this.y = y; this.r = 9;
    this.facing = Math.PI / 2; this.anim = 0; this.frame = 0; this.moving = false;
    this.path = null; this.pi = 0; this.pathKey = -1; this.repath = 0;
    this.stuckT = 0; this.lastX = x; this.lastY = y; this.doorT = 0;
    this.kind = 'agent'; this.dead = false; this.atkAnim = 0; this.speedNow = 0;
    this.blockedDoors = new Map(); // door idx -> time until retry
    this.flashOn = false; this.hidden = null;
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
  dist(o) { return Math.hypot(o.x - this.x, o.y - this.y); }
  angleTo(o) { return Math.atan2(o.y - this.y, o.x - this.x); }

  // ---- pathing cost (override for special abilities) ----
  cost(x, y) {
    const m = this.g.map;
    if (!m.inb(x, y)) return -1;
    const i = y * m.w + x, t = m.tiles[i];
    switch (t) {
      case T.WALL: case T.TREE: case T.WATER: case T.FENCE: case T.HEDGE: return -1;
      case T.WINDOW: { const w = m.windows.get(i); if (w.broken) return 4; return this.windowCost ? this.windowCost(w) : -1; }
      case T.DOOR: {
        const d = m.doors.get(i);
        if (d.open || d.broken) return 1;
        const bt = this.blockedDoors.get(i);
        if (bt && bt > this.g.time) return -1;
        if (d.locked) return this.lockedCost(d);
        return 1.6;
      }
      default:
        if (m.obj[i] >= 0 && m.objects[m.obj[i]].solid) return -1;
        return t === T.SAND ? 1.3 : t === T.CORN ? 2.2 : 1;
    }
  }
  lockedCost() { return -1; }

  // ---- collision ----
  solidAt(tx, ty) { return this.g.map.blocksMove(tx, ty); }
  resolve() {
    const r = this.r;
    const x0 = Math.floor((this.x - r) / TILE), x1 = Math.floor((this.x + r) / TILE);
    const y0 = Math.floor((this.y - r) / TILE), y1 = Math.floor((this.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.solidAt(tx, ty)) continue;
      const rx = tx * TILE, ry = ty * TILE;
      const cx = U.clamp(this.x, rx, rx + TILE), cy = U.clamp(this.y, ry, ry + TILE);
      const dx = this.x - cx, dy = this.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.x += dx / d * (r - d); this.y += dy / d * (r - d);
      } else {
        // centre is inside the tile: push out along the shortest axis
        const l = this.x - rx, rr = rx + TILE - this.x, u = this.y - ry, b = ry + TILE - this.y;
        const mn = Math.min(l, rr, u, b);
        if (mn === l) this.x = rx - r; else if (mn === rr) this.x = rx + TILE + r;
        else if (mn === u) this.y = ry - r; else this.y = ry + TILE + r;
      }
    }
  }
  moveBy(dx, dy) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    for (let s = 0; s < steps; s++) {
      this.x += dx / steps; this.resolve();
      this.y += dy / steps; this.resolve();
    }
  }
  moveToward(px, py, speed, dt) {
    const dx = px - this.x, dy = py - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return true;
    const step = Math.min(d, speed * dt);
    this.moveBy(dx / d * step, dy / d * step);
    this.turnTo(Math.atan2(dy, dx), dt, 10);
    this.moving = true; this.speedNow = speed;
    return d <= speed * dt;
  }
  turnTo(a, dt, rate = 8) { this.facing += U.angDiff(this.facing, a) * Math.min(1, rate * dt); }

  clearPath() { this.path = null; this.pathKey = -1; }

  // ---- navigation: returns 'arrived' | 'moving' | 'door' | 'nopath' ----
  goTo(px, py, speed, dt, o = {}) {
    const m = this.g.map;
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const key = ty * m.w + tx;
    this.repath -= dt;
    if (Math.hypot(px - this.x, py - this.y) < (o.arrive || 6)) { this.moving = false; return 'arrived'; }
    if (!this.path || this.pathKey !== key || this.repath <= 0) {
      this.path = m.findPath(this.tx, this.ty, tx, ty, (x, y) => this.cost(x, y));
      this.pathKey = key; this.pi = 0; this.repath = o.repath || 1.2;
      if (!this.path) { this.repath = 0.6; this.moving = false; return 'nopath'; }
    }
    // stuck detection
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    if (moved < speed * dt * 0.2 && this.doorT <= 0) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastX = this.x; this.lastY = this.y;
    if (this.stuckT > 0.8) { this.stuckT = 0; this.repath = 0; this.moveBy(U.rf(-4, 4), U.rf(-4, 4)); }

    if (this.pi >= this.path.length) {
      this.moveToward(px, py, speed, dt);
      return 'moving';
    }
    const wp = this.path[this.pi];
    const wx = (wp.x + 0.5) * TILE, wy = (wp.y + 0.5) * TILE;
    const wi = wp.y * m.w + wp.x;
    const t = m.tiles[wi];
    const dd = Math.hypot(wx - this.x, wy - this.y);
    if (t === T.DOOR) {
      const d = m.doors.get(wi);
      if (!d.open && !d.broken && dd < TILE * 1.15) {
        this.moving = false;
        this.turnTo(Math.atan2(wy - this.y, wx - this.x), dt);
        if (!this.handleDoor(d, dt)) { this.blockedDoors.set(wi, this.g.time + 8); this.clearPath(); this.repath = 0; }
        return 'door';
      }
    } else if (t === T.WINDOW) {
      const w = m.windows.get(wi);
      if (!w.broken && dd < TILE * 1.2) {
        this.moving = false;
        this.turnTo(Math.atan2(wy - this.y, wx - this.x), dt);
        if (!this.handleWindow(w, dt)) { this.clearPath(); this.repath = 0; }
        return 'door';
      }
    }
    this.doorT = 0;
    const last = this.pi === this.path.length - 1;
    if (dd < (last ? 4 : 10)) { this.pi++; }
    this.moveToward(wx, wy, speed * (t === T.WINDOW ? 0.5 : 1) * (m.tiles[this.ty * m.w + this.tx] === T.CORN ? 0.8 : 1), dt);
    return 'moving';
  }
  // default door behaviour: open if unlocked
  handleDoor(d, dt) {
    if (d.locked) return false;
    this.doorT += dt;
    if (this.doorT > 0.3) { this.g.setDoor(d, true, this); this.doorT = 0; }
    return true;
  }
  handleWindow() { return false; }

  animate(dt) {
    if (this.moving) { this.anim += dt * Math.max(3, this.speedNow / 16); this.frame = Math.floor(this.anim) % 4; }
    else { this.frame = 0; this.anim = 0; }
    if (this.atkAnim > 0) this.atkAnim -= dt;
  }
}
