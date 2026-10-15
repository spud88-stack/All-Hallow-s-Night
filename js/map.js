'use strict';
// ---------------------------------------------------------------------------
// GameMap: tile grid, doors/windows, objects, lights, raycasting, A*,
// plus procedural generation of the three locations and baking to canvases.
// ---------------------------------------------------------------------------
class GameMap {
  constructor(w, h, kind) {
    this.w = w; this.h = h; this.kind = kind;
    const n = w * h;
    this.tiles = new Uint8Array(n);
    this.house = new Int16Array(n).fill(-1);
    this.roomId = new Int16Array(n).fill(-1);
    this.obj = new Int32Array(n).fill(-1);
    this.reserved = new Uint8Array(n);
    this.zone = new Uint8Array(n); // 1 = cemetery
    this.light = new Float32Array(n);
    this.explored = new Uint8Array(n);
    this.doors = new Map();
    this.windows = new Map();
    this.objects = [];
    this.lights = [];
    this.houses = [];
    this.decals = [];
    this.rooms = [];
    this.lightDirty = true;
    this.streetPower = true;
    this.moon = kind === 'camp' ? 0.1 : 0.075;
    // A* scratch
    this._g = new Float32Array(n); this._p = new Int32Array(n);
    this._s = new Uint32Array(n); this._c = new Uint32Array(n); this._stamp = 0;
  }
  idx(x, y) { return y * this.w + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inb(x, y) ? this.tiles[y * this.w + x] : T.TREE; }
  setT(x, y, t) { if (this.inb(x, y)) this.tiles[y * this.w + x] = t; }
  fill(t) { this.tiles.fill(t); }
  doorAt(x, y) { return this.doors.get(this.idx(x, y)); }
  windowAt(x, y) { return this.windows.get(this.idx(x, y)); }
  objAtTile(x, y) { const i = this.obj[this.idx(x, y)]; return i >= 0 ? this.objects[i] : null; }
  isIndoor(x, y) { return this.inb(x, y) && INDOOR_TILES.has(this.tiles[this.idx(x, y)]); }
  houseAt(px, py) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    if (!this.inb(x, y)) return null;
    const h = this.house[this.idx(x, y)];
    return h >= 0 ? this.houses[h] : null;
  }
  roomAt(px, py) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    if (!this.inb(x, y)) return null;
    const r = this.roomId[this.idx(x, y)];
    return r >= 0 ? this.rooms[r] : null;
  }

  isOpaque(x, y) {
    if (!this.inb(x, y)) return true;
    const t = this.tiles[y * this.w + x];
    if (t === T.WALL || t === T.TREE || t === T.HEDGE) return true;
    if (t === T.DOOR) { const d = this.doors.get(y * this.w + x); return !(d.open || d.broken); }
    return false;
  }
  // like blocksMove, but ignores furniture (for things small enough to go under it)
  blocksTile(x, y) {
    if (!this.inb(x, y)) return true;
    const i = y * this.w + x, t = this.tiles[i];
    if (t === T.WALL || t === T.TREE || t === T.WATER || t === T.FENCE || t === T.HEDGE) return true;
    if (t === T.WINDOW) return !this.windows.get(i).broken;
    if (t === T.DOOR) { const d = this.doors.get(i); return !(d.open || d.broken); }
    return false;
  }
  blocksMove(x, y) {
    if (!this.inb(x, y)) return true;
    const i = y * this.w + x, t = this.tiles[i];
    switch (t) {
      case T.WALL: case T.TREE: case T.WATER: case T.FENCE: case T.HEDGE: return true;
      case T.WINDOW: return !this.windows.get(i).broken;
      case T.DOOR: { const d = this.doors.get(i); return !(d.open || d.broken); }
      default: return this.obj[i] >= 0 && this.objects[this.obj[i]].solid;
    }
  }

  // ---------- raycasting ----------
  castRay(ox, oy, ang, maxD) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const x = ox / TILE, y = oy / TILE;
    let mx = Math.floor(x), my = Math.floor(y);
    const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx), ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
    let sx, sy, sdx, sdy;
    if (dx < 0) { sx = -1; sdx = (x - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - x) * ddx; }
    if (dy < 0) { sy = -1; sdy = (y - my) * ddy; } else { sy = 1; sdy = (my + 1 - y) * ddy; }
    const maxT = maxD / TILE;
    for (let i = 0; i < 256; i++) {
      let t;
      if (sdx < sdy) { t = sdx; sdx += ddx; mx += sx; } else { t = sdy; sdy += ddy; my += sy; }
      if (t >= maxT) return maxD;
      if (this.isOpaque(mx, my)) return t * TILE;
      // corn: you can only see a little way into it
      if (t > 1.3 && this.inb(mx, my) && this.tiles[my * this.w + mx] === T.CORN) return t * TILE;
    }
    return maxD;
  }
  los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 2) return true;
    // ignore the target's own tile being opaque (e.g. a wall-mounted box)
    return this.castRay(ax, ay, Math.atan2(by - ay, bx - ax), d) >= d - 1;
  }
  // visibility polygon as flat [x0,y0,x1,y1,...]
  visPoly(x, y, r, a0, a1, n, wallBleed = 7) {
    const pts = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      let d = this.castRay(x, y, a, r);
      if (d < r) d = Math.min(r, d + wallBleed);
      pts[i * 2] = x + Math.cos(a) * d; pts[i * 2 + 1] = y + Math.sin(a) * d;
    }
    return pts;
  }

  // ---------- lighting ----------
  lightActive(L) {
    if (!L.on) return false;
    if (L.power === 'house') { const H = this.houses[L.house]; return H.power && (!H.grid || this.streetPower); }
    if (L.power === 'street') return this.streetPower;
    return true;
  }
  addLight(L) {
    L.poly = null; if (L.on == null) L.on = true;
    this.lights.push(L); this.lightDirty = true; return L;
  }
  removeLight(L) { const i = this.lights.indexOf(L); if (i >= 0) this.lights.splice(i, 1); this.lightDirty = true; }
  invalidateLightsNear(px, py) {
    for (const L of this.lights) if (Math.hypot(L.x - px, L.y - py) < L.r + TILE * 1.5) L.poly = null;
    this.lightDirty = true;
  }
  computeLightGrid() {
    const W = this.w, Hh = this.h, lg = this.light;
    for (let i = 0; i < lg.length; i++) lg[i] = INDOOR_TILES.has(this.tiles[i]) ? 0.025 : this.moon;
    for (const L of this.lights) {
      if (!this.lightActive(L)) continue;
      const r = L.r / TILE, lx = L.x / TILE, ly = L.y / TILE;
      const x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(W - 1, Math.ceil(lx + r));
      const y0 = Math.max(0, Math.floor(ly - r)), y1 = Math.min(Hh - 1, Math.ceil(ly + r));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const d = Math.hypot(tx + 0.5 - lx, ty + 0.5 - ly);
        if (d > r) continue;
        if (!this.los(L.x, L.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE)) continue;
        const i = ty * W + tx;
        lg[i] = Math.min(1, lg[i] + L.int * Math.pow(1 - d / r, 1.1));
      }
    }
    this.lightDirty = false;
  }
  lightAt(px, py) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    return this.inb(x, y) ? this.light[y * this.w + x] : 0;
  }

  // ---------- A* ----------
  findPath(sx, sy, tx, ty, cost, maxN = 9000) {
    const w = this.w;
    if (!this.inb(sx, sy) || !this.inb(tx, ty)) return null;
    if (cost(tx, ty) < 0) {
      const alt = this.nearestPassable(tx, ty, cost, 4);
      if (!alt) return null;
      tx = alt.x; ty = alt.y;
    }
    if (sx === tx && sy === ty) return [];
    const st = ++this._stamp;
    const G = this._g, P = this._p, S = this._s, C = this._c;
    const start = sy * w + sx, goal = ty * w + tx;
    const heap = new MinHeap();
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); };
    G[start] = 0; S[start] = st; P[start] = -1; heap.push(h(sx, sy), start);
    let n = 0, found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (C[cur] === st) continue;
      C[cur] = st;
      if (++n > maxN) break;
      const cx = cur % w, cy = (cur / w) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DIRS8[k][0], dy = DIRS8[k][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
        const c = cost(nx, ny);
        if (c < 0) continue;
        const diag = dx !== 0 && dy !== 0;
        if (diag && (cost(cx + dx, cy) < 0 || cost(cx, cy + dy) < 0)) continue;
        if (diag && (this.tiles[cy * w + cx] === T.DOOR || this.tiles[ny * w + nx] === T.DOOR)) continue;
        const ni = ny * w + nx;
        const ng = G[cur] + c * (diag ? 1.414 : 1);
        if (S[ni] !== st || ng < G[ni]) { S[ni] = st; G[ni] = ng; P[ni] = cur; heap.push(ng + h(nx, ny), ni); }
      }
    }
    if (!found) return null;
    const path = [];
    let c = goal;
    while (c !== start && c >= 0) { path.push({ x: c % w, y: (c / w) | 0 }); c = P[c]; }
    path.reverse();
    return path;
  }
  nearestPassable(tx, ty, cost, rad) {
    for (let r = 1; r <= rad; r++) {
      let best = null, bd = 1e9;
      for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
        if (!this.inb(x, y) || cost(x, y) < 0) continue;
        const d = Math.abs(x - tx) + Math.abs(y - ty);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (best) return best;
    }
    return null;
  }
  // basic walkability for spawning and spot selection
  walkable(x, y) { return this.inb(x, y) && !this.blocksMove(x, y) && this.tiles[this.idx(x, y)] !== T.DOOR; }
  randomFloorIn(H, roomType) {
    for (let i = 0; i < 200; i++) {
      const x = U.ri(H.x + 1, H.x + H.w - 2), y = U.ri(H.y + 1, H.y + H.h - 2);
      if (!this.walkable(x, y) || !this.isIndoor(x, y)) continue;
      if (roomType) { const r = this.rooms[this.roomId[this.idx(x, y)]]; if (!r || r.type !== roomType) continue; }
      return { x, y };
    }
    return null;
  }
  randomOutdoor() {
    for (let i = 0; i < 500; i++) {
      const x = U.ri(3, this.w - 4), y = U.ri(3, this.h - 4);
      if (this.walkable(x, y) && !this.isIndoor(x, y)) return { x, y };
    }
    return { x: 5, y: 5 };
  }

  // ---------- doors / objects ----------
  addDoor(x, y, o) {
    const d = Object.assign({ x, y, px: (x + 0.5) * TILE, py: (y + 0.5) * TILE, open: false, locked: false, broken: false, hp: 100, exterior: false, house: -1, orient: 'h' }, o);
    this.tiles[this.idx(x, y)] = T.DOOR;
    this.doors.set(this.idx(x, y), d);
    return d;
  }
  addObject(o) {
    o.id = this.objects.length;
    o.x = (o.tx + o.w / 2) * TILE; o.y = (o.ty + o.h / 2) * TILE;
    if (o.house == null) o.house = -1;
    this.objects.push(o);
    if (o.solid) for (let y = o.ty; y < o.ty + o.h; y++) for (let x = o.tx; x < o.tx + o.w; x++) this.obj[this.idx(x, y)] = o.id;
    return o;
  }
  removeObjectGrid(o) {
    for (let y = o.ty; y < o.ty + o.h; y++) for (let x = o.tx; x < o.tx + o.w; x++) if (this.obj[this.idx(x, y)] === o.id) this.obj[this.idx(x, y)] = -1;
    o.solid = false; o.removed = true;
  }
  // distance from point to object rect (px)
  distToObj(px, py, o) {
    const x0 = o.tx * TILE, y0 = o.ty * TILE, x1 = x0 + o.w * TILE, y1 = y0 + o.h * TILE;
    const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1);
    return Math.hypot(dx, dy);
  }
}
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ===========================================================================
// Generation
// ===========================================================================
const MapGen = (() => {
  const HOUSE_COLORS = ['#6a5a4a', '#5a5e66', '#6e5040', '#4e5a4e', '#665a6e', '#7a6a52', '#5a4a3e', '#4a525e'];
  const WOOD_COLORS = ['#5a4430', '#4e3a28', '#62482e'];

  function generate(kind) {
    U.seed = U.ri(1, 1e6);
    let m;
    if (kind === 'camp') { m = new GameMap(112, 86, kind); genCamp(m); }
    else if (kind === 'texas') { m = new GameMap(112, 86, kind); genRural(m); }
    else { m = new GameMap(kind === 'woodsboro' ? 112 : 100, 78, kind); genSuburb(m, kind === 'woodsboro'); }
    if (kind === 'lakeshore') placeDolls(m);
    distributeLoot(m);
    bake(m);
    m.computeLightGrid();
    return m;
  }

  // ---------------------------------------------------------------- house
  function buildHouse(m, hx, hy, w, h, front, o) {
    const id = m.houses.length;
    const H = {
      id, x: hx, y: hy, w, h, front, power: true, phoneLine: !!o.phone, grid: !!o.grid, name: o.name, color: o.color || U.pick(HOUSE_COLORS),
      surname: o.surname || null, address: o.address || o.name,
      wallpaper: U.pick(['#5a4a3e', '#4a5048', '#5a4450', '#504a3a', '#3e4654', '#5a3a34']),
      kind: o.kind, rooms: [], lights: [], residents: [], extDoors: [], doors: [], windows: [], isPlayerHome: false,
      phoneObj: null, breaker: null, phoneBox: null, frontDoor: null, radio: null,
    };
    m.houses.push(H);
    const toW = (lx, ly) => (front === 'S' ? [hx + lx, hy + ly] : [hx + lx, hy + (h - 1 - ly)]);
    const setL = (lx, ly, t) => { const [x, y] = toW(lx, ly); m.setT(x, y, t); m.house[m.idx(x, y)] = id; };
    for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) setL(lx, ly, (lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1) ? T.WALL : T.FLOOR);
    const iw = w - 2, ih = h - 2;
    const doorsL = [], roomsL = [];
    let frontDoorL;

    if (o.kind === 'shed') {
      roomsL.push({ x0: 1, y0: 1, x1: w - 2, y1: h - 2, type: 'shed' });
      frontDoorL = { lx: Math.floor(w / 2), ly: h - 1, ext: true, orient: 'h' };
      doorsL.push(frontDoorL);
    } else if (o.kind === 'cabin') {
      const bathRight = U.chance(0.5), bw = 3;
      const wx = bathRight ? w - 2 - bw : bw + 1;
      for (let ly = 1; ly <= 3; ly++) setL(wx, ly, T.WALL);
      const bx0 = bathRight ? wx : 1, bx1 = bathRight ? w - 2 : wx;
      for (let lx = bx0; lx <= bx1; lx++) setL(lx, 4, T.WALL);
      doorsL.push({ lx: wx, ly: 2, orient: 'v' });
      roomsL.push({ x0: bathRight ? wx + 1 : 1, y0: 1, x1: bathRight ? w - 2 : wx - 1, y1: 3, type: 'bath' });
      roomsL.push({ x0: 1, y0: 1, x1: w - 2, y1: h - 2, type: 'cabin' });
      frontDoorL = { lx: U.ri(2, w - 3), ly: h - 1, ext: true, orient: 'h' };
      doorsL.push(frontDoorL);
    } else {
      const bd = Math.max(3, Math.floor(ih * 0.45));
      const divY = bd + 1;
      for (let lx = 1; lx <= w - 2; lx++) setL(lx, divY, T.WALL);
      const livingLeft = U.chance(0.5);
      const sx = livingLeft ? 1 + Math.round(iw * 0.58) : Math.round(iw * 0.42);
      for (let ly = divY + 1; ly <= h - 2; ly++) setL(sx, ly, T.WALL);
      const living = livingLeft ? { x0: 1, x1: sx - 1 } : { x0: sx + 1, x1: w - 2 };
      const kitchen = livingLeft ? { x0: sx + 1, x1: w - 2 } : { x0: 1, x1: sx - 1 };
      roomsL.push(Object.assign({ y0: divY + 1, y1: h - 2, type: 'living' }, living));
      roomsL.push(Object.assign({ y0: divY + 1, y1: h - 2, type: 'kitchen' }, kitchen));
      let back;
      if (iw >= 13) {
        const wA = Math.floor((iw - 5) / 2), a = 1 + wA, b = a + 4;
        for (let ly = 1; ly <= bd; ly++) { setL(a, ly, T.WALL); setL(b, ly, T.WALL); }
        back = [{ x0: 1, x1: a - 1, type: 'bedroom' }, { x0: a + 1, x1: b - 1, type: 'bath' }, { x0: b + 1, x1: w - 2, type: 'bedroom' }];
      } else if (U.chance(0.5)) {
        for (let ly = 1; ly <= bd; ly++) setL(4, ly, T.WALL);
        back = [{ x0: 1, x1: 3, type: 'bath' }, { x0: 5, x1: w - 2, type: 'bedroom' }];
      } else {
        const a = w - 5;
        for (let ly = 1; ly <= bd; ly++) setL(a, ly, T.WALL);
        back = [{ x0: 1, x1: a - 1, type: 'bedroom' }, { x0: a + 1, x1: w - 2, type: 'bath' }];
      }
      back.forEach((r) => {
        r.y0 = 1; r.y1 = bd; roomsL.push(r);
        const cands = [];
        for (let lx = r.x0; lx <= r.x1; lx++) if (lx !== sx && lx !== sx - 1 && lx !== sx + 1) cands.push(lx);
        if (!cands.length) for (let lx = r.x0; lx <= r.x1; lx++) if (lx !== sx) cands.push(lx);
        const mid = (r.x0 + r.x1) / 2;
        cands.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
        doorsL.push({ lx: cands[Math.min(cands.length - 1, U.ri(0, 1))], ly: divY, orient: 'h' });
      });
      const fy0 = divY + 1, fy1 = h - 2;
      doorsL.push({ lx: sx, ly: Math.round((fy0 + fy1) / 2) + U.ri(-1, 0), orient: 'v' });
      frontDoorL = { lx: U.ri(living.x0 + 1, Math.max(living.x0 + 1, living.x1 - 1)), ly: h - 1, ext: true, orient: 'h' };
      doorsL.push(frontDoorL);
      doorsL.push({ lx: livingLeft ? w - 1 : 0, ly: Math.round((fy0 + fy1) / 2), ext: true, orient: 'v' });
      if (iw >= 13) doorsL.push({ lx: U.ri(back[2].x0, back[2].x1), ly: 0, ext: true, orient: 'h' });
      H.livingLeft = livingLeft;
      H.phoneBoxL = { lx: livingLeft ? -1 : w, ly: Math.round((fy0 + fy1) / 2) + 1 };
      if (H.phoneBoxL.ly >= h - 1) H.phoneBoxL.ly = h - 2;
    }

    // doors
    for (const dl of doorsL) {
      const [x, y] = toW(dl.lx, dl.ly);
      const d = m.addDoor(x, y, { house: id, exterior: !!dl.ext, orient: dl.orient });
      m.house[m.idx(x, y)] = id;
      H.doors.push(d);
      if (dl.ext) H.extDoors.push(d);
      if (dl === frontDoorL) H.frontDoor = d;
    }
    // windows
    const isDoorL = (lx, ly) => doorsL.some((d) => d.lx === lx && d.ly === ly);
    const localT = (lx, ly) => { const [x, y] = toW(lx, ly); return m.get(x, y); };
    const tryWin = (lx, ly, pos, inLx, inLy, orient) => {
      if (isDoorL(lx, ly)) return;
      if (localT(inLx, inLy) === T.WALL) return;
      if (orient === 'h' && (isDoorL(lx - 1, ly) || isDoorL(lx + 1, ly))) return;
      if (orient === 'v' && (isDoorL(lx, ly - 1) || isDoorL(lx, ly + 1))) return;
      if (pos % 4 !== 1 && pos % 4 !== 2) return;
      const [x, y] = toW(lx, ly);
      m.setT(x, y, T.WINDOW);
      const wdw = { x, y, broken: false, house: id, orient };
      m.windows.set(m.idx(x, y), wdw);
      H.windows.push(wdw);
    };
    if (o.kind !== 'shed') {
      for (let lx = 1; lx <= w - 2; lx++) { tryWin(lx, 0, lx, lx, 1, 'h'); tryWin(lx, h - 1, lx, lx, h - 2, 'h'); }
      for (let ly = 1; ly <= h - 2; ly++) { tryWin(0, ly, ly, 1, ly, 'v'); tryWin(w - 1, ly, ly, w - 2, ly, 'v'); }
    }
    // rooms -> world
    for (const rl of roomsL) {
      const [ax, ay] = toW(rl.x0, rl.y0), [bx, by] = toW(rl.x1, rl.y1);
      const r = { id: m.rooms.length, house: id, type: rl.type, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      const ft = r.type === 'kitchen' || r.type === 'bath' ? T.TILEF : r.type === 'bedroom' ? T.CARPET : T.FLOOR;
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const i = m.idx(x, y);
        if (m.tiles[i] === T.FLOOR && m.roomId[i] < 0) { m.roomId[i] = r.id; m.tiles[i] = ft; }
      }
      m.rooms.push(r); H.rooms.push(r);
    }
    // reserve tiles next to doors
    for (const d of H.doors) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = d.x + dx, y = d.y + dy;
      if (m.inb(x, y)) m.reserved[m.idx(x, y)] = 1;
    }
    if (H.phoneBoxL) { const [x, y] = toW(H.phoneBoxL.lx, H.phoneBoxL.ly); H.phoneBoxW = { x, y }; }
    furnish(m, H, o);
    return H;
  }

  function houseConnected(m, H) {
    const start = H.frontDoor;
    if (!start) return true;
    const seen = new Set();
    const st = [m.idx(start.x, start.y)];
    seen.add(st[0]);
    const pass = (i) => {
      const t = m.tiles[i];
      if (t === T.DOOR) return m.house[i] === H.id;
      return INDOOR_TILES.has(t) && m.house[i] === H.id && m.obj[i] < 0;
    };
    while (st.length) {
      const i = st.pop(); const x = i % m.w, y = (i / m.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = m.idx(x + dx, y + dy);
        if (!seen.has(j) && pass(j)) { seen.add(j); st.push(j); }
      }
    }
    let total = 0;
    for (let y = H.y; y < H.y + H.h; y++) for (let x = H.x; x < H.x + H.w; x++) { if (pass(m.idx(x, y))) total++; }
    return seen.size >= total;
  }

  function place(m, H, room, type, w, h, opt = {}) {
    for (let tries = 0; tries < 60; tries++) {
      let ww = w, hh = h;
      if (w !== h && U.chance(0.5)) { ww = h; hh = w; }
      if (ww > room.x1 - room.x0 + 1 || hh > room.y1 - room.y0 + 1) continue;
      const ox = U.ri(room.x0, room.x1 - ww + 1), oy = U.ri(room.y0, room.y1 - hh + 1);
      let wall = null;
      if (oy === room.y0) wall = 'N'; else if (oy + hh - 1 === room.y1) wall = 'S';
      else if (ox === room.x0) wall = 'W'; else if (ox + ww - 1 === room.x1) wall = 'E';
      if (opt.wall !== false && !wall) continue;
      if (opt.wall === false && wall) continue;
      let ok = true;
      for (let y = oy; y < oy + hh && ok; y++) for (let x = ox; x < ox + ww; x++) {
        const i = m.idx(x, y);
        if (m.roomId[i] !== room.id || m.obj[i] >= 0 || m.reserved[i] || !INDOOR_TILES.has(m.tiles[i])) { ok = false; break; }
      }
      if (!ok) continue;
      const ob = m.addObject(Object.assign({ type, tx: ox, ty: oy, w: ww, h: hh, solid: opt.solid !== false, house: H.id, room: room.id, wall }, opt.props || {}));
      if (ob.solid && !houseConnected(m, H)) { m.removeObjectGrid(ob); m.objects.pop(); continue; }
      return ob;
    }
    return null;
  }

  const CONTAINERS = new Set(['toybox', 'dresser', 'nightstand', 'counter', 'cabinet', 'footlocker', 'workbench', 'desk', 'bookshelf', 'fridge', 'candybowl', 'crate']);
  const HIDES = new Set(['closet', 'bed', 'bunk']);

  function mk(m, H, room, type, w, h, opt = {}) {
    const o = place(m, H, room, type, w, h, opt);
    if (!o) return null;
    if (CONTAINERS.has(type)) o.container = { items: [], searched: false };
    if (HIDES.has(type)) o.hide = true;
    return o;
  }
  function lampLight(m, H, x, y, r, col, on, kind) {
    const L = m.addLight({ x, y, r: r * TILE, color: col, int: 0.9, on, power: 'house', house: H.id, kind: kind || 'lamp' });
    H.lights.push(L);
    return L;
  }

  function furnish(m, H, o) {
    const warm = [255, 196, 130];
    for (const r of H.rooms) {
      const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
      const cx = (r.x0 + r.x1 + 1) / 2 * TILE, cy = (r.y0 + r.y1 + 1) / 2 * TILE;
      const size = Math.max(rw, rh);
      if ((r.type === 'living' || r.type === 'bedroom' || r.type === 'cabin') && rw >= 4 && rh >= 4 && U.chance(0.8)) {
        const w = Math.min(rw - 2, 4), h = Math.min(rh - 2, 3);
        m.decals.push({ type: 'rug', tx: r.x0 + Math.floor((rw - w) / 2), ty: r.y0 + Math.floor((rh - h) / 2), w, h, color: U.pick(['#5a1e1e', '#1e2e4a', '#3e2a14', '#2a3a2a', '#4a1e3a']) });
      }
      if (U.chance(0.45)) {
        const cr = U.pick([[0, 0], [1, 0], [0, 1], [1, 1]]);
        m.decals.push({ type: 'cobweb', tx: cr[0] ? r.x1 : r.x0, ty: cr[1] ? r.y1 : r.y0, w: 1, h: 1, corner: cr, top: true });
      }
      switch (r.type) {
        case 'living': {
          mk(m, H, r, 'couch', 3, 1, { props: { color: U.pick(['#5a3a4a', '#3a4a5a', '#5a4a2a', '#4a2a2a']) } });
          const tv = mk(m, H, r, 'tv', 2, 1);
          if (tv) tv.light = lampLight(m, H, tv.x, tv.y, 3.6, [120, 160, 255], U.chance(0.5), 'tv');
          const lamp = mk(m, H, r, 'lamp', 1, 1);
          if (lamp) lamp.light = lampLight(m, H, lamp.x, lamp.y, 4.5, warm, U.chance(0.75));
          if (H.phoneLine) { const ph = mk(m, H, r, 'phone', 1, 1, { props: { color: U.pick(['#9a2a22', '#c8b89a', '#2a2a2a']) } }); if (ph) H.phoneObj = ph; }
          mk(m, H, r, 'bookshelf', 2, 1);
          if (U.chance(0.6)) mk(m, H, r, 'armchair', 1, 1);
          if (o.lodge) { mk(m, H, r, 'desk', 2, 1); mk(m, H, r, 'table', 2, 2, { wall: false }); }
          lampLight(m, H, cx, cy, size * 0.55 + 2, warm, U.chance(0.55), 'ceiling');
          break;
        }
        case 'kitchen': {
          mk(m, H, r, 'fridge', 1, 1); mk(m, H, r, 'stove', 1, 1); mk(m, H, r, 'sink', 1, 1);
          for (let i = 0; i < 3; i++) mk(m, H, r, 'counter', 1, 1);
          const b = mk(m, H, r, 'breaker', 1, 1); if (b) H.breaker = b;
          lampLight(m, H, cx, cy, size * 0.55 + 2, [255, 230, 190], U.chance(0.6), 'ceiling');
          break;
        }
        case 'bedroom': {
          mk(m, H, r, 'bed', 2, 3, { props: { color: U.pick(['#5a2a3a', '#2a3a5a', '#3a5a3a', '#6a4a2a', '#4a2a5a']) } });
          mk(m, H, r, 'closet', 2, 1);
          mk(m, H, r, 'dresser', 2, 1);
          mk(m, H, r, 'nightstand', 1, 1);
          if (m.kind === 'lakeshore') mk(m, H, r, 'toybox', 1, 1);
          const lamp = mk(m, H, r, 'lamp', 1, 1);
          if (lamp) lamp.light = lampLight(m, H, lamp.x, lamp.y, 4, warm, U.chance(0.35));
          break;
        }
        case 'bath': mk(m, H, r, 'tub', 2, 1); mk(m, H, r, 'toilet', 1, 1); mk(m, H, r, 'cabinet', 1, 1); break;
        case 'cabin': {
          mk(m, H, r, 'bunk', 2, 3); mk(m, H, r, 'bunk', 2, 3);
          mk(m, H, r, 'closet', 2, 1); mk(m, H, r, 'footlocker', 2, 1); mk(m, H, r, 'nightstand', 1, 1);
          const lamp = mk(m, H, r, 'lamp', 1, 1);
          if (lamp) lamp.light = lampLight(m, H, lamp.x, lamp.y, 4.5, warm, U.chance(0.6));
          if (o.radio) { const rd = mk(m, H, r, 'radio', 1, 1); if (rd) H.radio = rd; }
          break;
        }
        case 'shed': {
          mk(m, H, r, 'workbench', 2, 1);
          if (o.generator) { const g = mk(m, H, r, 'generator', 1, 1); if (g) m.generator = g; }
          mk(m, H, r, 'crate', 1, 1);
          lampLight(m, H, cx, cy, 3.5, [255, 220, 160], true, 'ceiling');
          break;
        }
        default: break;
      }
    }
    // porch light + phone box
    if (H.frontDoor) {
      const d = H.frontDoor;
      const oy = H.front === 'S' ? 1 : -1;
      const L = m.addLight({ x: d.px, y: d.py + oy * TILE * 0.9, r: 4 * TILE, color: [255, 200, 140], int: 0.8, on: U.chance(0.75), power: 'house', house: H.id, kind: 'porch' });
      H.lights.push(L); H.porch = L;
    }
    if (H.phoneLine && H.phoneBoxW) {
      const { x, y } = H.phoneBoxW;
      if (m.inb(x, y) && !m.blocksMove(x, y)) H.phoneBox = m.addObject({ type: 'phonebox', tx: x, ty: y, w: 1, h: 1, solid: false, house: H.id });
      else H.phoneLine = !!H.phoneObj; // no box: line can't be cut
    }
  }

  // ---------------------------------------------------------------- suburb
  function genSuburb(m, big) {
    const W = m.w, H = m.h;
    m.fill(T.GRASS);
    const RY0 = Math.floor(H / 2) - 2;
    m.roadY0 = RY0; m.roadY1 = RY0 + 3;
    for (let x = 0; x < W; x++) {
      for (let y = RY0; y <= RY0 + 3; y++) m.setT(x, y, T.ROAD);
      m.setT(x, RY0 - 1, T.SIDEWALK); m.setT(x, RY0 - 2, T.SIDEWALK);
      m.setT(x, RY0 + 4, T.SIDEWALK); m.setT(x, RY0 + 5, T.SIDEWALK);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
      const roadRow = y >= RY0 - 2 && y <= RY0 + 5;
      if (edge && !(x < 2 && roadRow)) m.setT(x, y, T.TREE);
      else if ((y < 4 || y >= H - 4) && U.chance(0.45)) m.setT(x, y, T.TREE);
    }
    // dead end: hedge across the road at the right edge
    for (let y = RY0 - 2; y <= RY0 + 5; y++) { m.setT(W - 2, y, T.TREE); m.setT(W - 1, y, T.TREE); m.setT(W - 3, y, T.HEDGE); }

    const lotW = big ? 24 : 19;
    const nLots = Math.floor((W - 4) / lotW);
    const startX = Math.floor((W - nLots * lotW) / 2);
    m.lots = [];
    const surnames = U.shuffle(SURNAMES.slice());
    let sIdx = 0;
    const playerLot = Math.floor(nLots / 2);
    for (const side of ['N', 'S']) {
      for (let i = 0; i < nLots; i++) {
        const lx0 = startX + i * lotW, lx1 = lx0 + lotW - 1;
        if (m.kind === 'haddonfield' && side === 'S' && i === nLots - 1) { genCemetery(m, lx0, lx1, RY0); continue; }
        const party = big && side === 'S' && i === 1;
        const hw = party ? lotW - 5 : big ? U.ri(15, 18) : U.ri(12, 14);
        const hh = party ? 14 : big ? U.ri(12, 13) : U.ri(10, 12);
        const driveRight = U.chance(0.5);
        const hx = driveRight ? lx0 + 2 : lx1 - hw;
        const frontYard = U.ri(4, 6);
        let hy, fy;
        if (side === 'N') { fy = RY0 - 3 - frontYard; hy = fy - hh + 1; } else { fy = RY0 + 6 + frontYard; hy = fy; }
        const surname = surnames[sIdx++ % surnames.length];
        const num = 100 + (side === 'N' ? i * 2 : i * 2 + 1) * 4 + U.ri(0, 3);
        const Hs = buildHouse(m, hx, hy, hw, hh, side === 'N' ? 'S' : 'N', {
          kind: 'house', phone: true, name: party ? `${surname} House (party)` : `the ${surname} house`, surname, address: `${num} ${STREETS[m.kind]}`,
        });
        Hs.party = party;
        Hs.lot = { x0: lx0, x1: lx1, side };
        if (side === 'N' && i === playerLot) Hs.isPlayerHome = true;
        // driveway
        const dx0 = driveRight ? hx + hw : hx - 2;
        const dyA = side === 'N' ? hy + hh - 5 : RY0 + 6, dyB = side === 'N' ? RY0 - 3 : hy + 4;
        for (let y = dyA; y <= dyB; y++) for (let x = dx0; x <= dx0 + 1; x++) if (m.get(x, y) === T.GRASS) m.setT(x, y, T.DRIVE);
        Hs.driveway = { x: dx0, y0: dyA, y1: dyB };
        // walkway
        const d = Hs.frontDoor;
        if (side === 'N') for (let y = d.y + 1; y <= RY0 - 3; y++) { if (m.get(d.x, y) === T.GRASS) m.setT(d.x, y, T.SIDEWALK); }
        else for (let y = RY0 + 6; y <= d.y - 1; y++) { if (m.get(d.x, y) === T.GRASS) m.setT(d.x, y, T.SIDEWALK); }
        // porch decorations
        const py = side === 'N' ? d.y + 1 : d.y - 1;
        const spots = U.shuffle([[d.x - 1, py], [d.x + 1, py], [d.x - 1, py + (side === 'N' ? 1 : -1)], [d.x + 1, py + (side === 'N' ? 1 : -1)]]);
        let pk = U.ri(1, 3);
        for (const [x, y] of spots) {
          if (m.get(x, y) !== T.GRASS || m.obj[m.idx(x, y)] >= 0) continue;
          if (pk > 0) {
            const o = m.addObject({ type: 'pumpkin', tx: x, ty: y, w: 1, h: 1, solid: true, face: U.ri(0, 2) });
            o.light = m.addLight({ x: o.x, y: o.y, r: 2.4 * TILE, color: [255, 140, 40], int: 0.55, on: U.chance(0.8), power: 'none', kind: 'pumpkin', flicker: 1 });
            pk--;
          } else if (!Hs.candy) {
            Hs.candy = m.addObject({ type: 'candybowl', tx: x, ty: y, w: 1, h: 1, solid: true, container: { items: [], searched: false } });
          }
        }
        // bushes along front wall
        const fwY = side === 'N' ? hy + hh : hy - 1;
        for (let x = hx; x < hx + hw; x++) {
          if (Math.abs(x - d.x) <= 1 || !U.chance(0.3)) continue;
          if (m.get(x, fwY) === T.GRASS && m.obj[m.idx(x, fwY)] < 0) m.addObject({ type: 'bush', tx: x, ty: fwY, w: 1, h: 1, solid: true });
        }
        // Halloween yard display
        if (U.chance(0.6)) {
          const ya = side === 'N' ? fy + 1 : RY0 + 6, yb = side === 'N' ? RY0 - 3 : fy - 1;
          const cands = [];
          for (let y = ya; y <= yb; y++) for (let x = lx0 + 1; x <= lx1 - 1; x++) if (clearAround(m, x, y, 1)) cands.push([x, y]);
          U.shuffle(cands);
          const style = U.ri(0, 2);
          let n = 0;
          for (const [x, y] of cands) {
            if (n >= 3 || !clearAround(m, x, y, 1)) continue;
            if (style === 0 || (style === 2 && n < 2)) m.addObject({ type: 'fakegrave', tx: x, ty: y, w: 1, h: 1, solid: true });
            else if (style === 1 && n === 0) m.addObject({ type: 'scarecrow', tx: x, ty: y, w: 1, h: 1, solid: true });
            else m.decals.push({ type: 'skeleton', tx: x, ty: y, w: 1, h: 1, rot: U.rf(-1, 1) });
            n++;
          }
        }
        // trash + mailbox
        const ty = side === 'N' ? RY0 - 3 : RY0 + 6;
        const tx = driveRight ? dx0 + 2 : dx0 - 1;
        if (m.get(tx, ty) === T.GRASS) m.addObject({ type: U.chance(0.5) ? 'trash' : 'mailbox', tx, ty, w: 1, h: 1, solid: true });
        // fences + trees in backyard
        const yb0 = side === 'N' ? 4 : hy + hh + 1, yb1 = side === 'N' ? hy - 2 : H - 5;
        const fenceTo = side === 'N' ? fy : fy;
        const fx = [lx0];
        if (i === nLots - 1) fx.push(lx1);
        for (const x of fx) {
          const gate = U.ri(Math.min(yb0, yb1) + 1, Math.max(yb0, yb1) - 1);
          const ya = side === 'N' ? 3 : fenceTo, yb = side === 'N' ? fenceTo : H - 4;
          for (let y = ya; y <= yb; y++) if (m.get(x, y) === T.GRASS && Math.abs(y - gate) > 0) m.setT(x, y, T.FENCE);
        }
        for (let k = 0; k < U.ri(3, 6); k++) {
          const x = U.ri(lx0 + 2, lx1 - 2), y = U.ri(Math.min(yb0, yb1), Math.max(yb0, yb1));
          if (clearAround(m, x, y, 1)) m.setT(x, y, T.TREE);
        }
        if (U.chance(0.5)) {
          const x = driveRight ? lx1 - 1 : lx0 + 2, y = side === 'N' ? RY0 - 4 : RY0 + 7;
          if (clearAround(m, x, y, 1)) m.setT(x, y, T.TREE);
        }
        if (U.chance(0.4)) { // back porch crate / shed stuff
          const x = U.ri(lx0 + 2, lx1 - 2), y = U.ri(Math.min(yb0, yb1), Math.max(yb0, yb1));
          if (clearAround(m, x, y, 1)) m.addObject({ type: 'crate', tx: x, ty: y, w: 1, h: 1, solid: true, container: { items: [], searched: false } });
        }
      }
    }
    // streetlights
    for (let x = 6; x < W - 6; x += 14) {
      for (const [y, off] of [[RY0 - 2, 0], [RY0 + 5, 7]]) {
        const xx = x + off;
        if (m.get(xx, y) !== T.SIDEWALK) continue;
        const o = m.addObject({ type: 'streetlight', tx: xx, ty: y, w: 1, h: 1, solid: true });
        o.light = m.addLight({ x: o.x, y: o.y + (y < RY0 ? 6 : -6), r: 6 * TILE, color: big ? [190, 205, 255] : [255, 178, 100], int: 0.85, on: true, power: 'street', kind: 'street' });
      }
    }
    m.transformer = m.addObject({ type: 'transformer', tx: W - 5, ty: RY0 - 2, w: 1, h: 1, solid: true });
    m.entry = { x: -2 * TILE, y: (RY0 + 2.5) * TILE, dir: 0 };
    m.exitX = 1.5 * TILE;
    // player home + car
    const home = m.houses.find((h) => h.isPlayerHome);
    const dw = home.driveway;
    m.car = m.addObject({ type: 'car', tx: dw.x, ty: RY0 - 6, w: 2, h: 3, solid: true, car: { color: U.pick(['#6a2a22', '#2a4a6a', '#5a5a2a']), sabotaged: false, horiz: false } });
    m.playerSpawn = m.randomFloorIn(home, 'living') || m.randomFloorIn(home);
    m.home = home;
  }

  function clearAround(m, x, y, r) {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
      if (!m.inb(xx, yy)) return false;
      if (m.get(xx, yy) !== T.GRASS || m.obj[m.idx(xx, yy)] >= 0 || m.house[m.idx(xx, yy)] >= 0) return false;
    }
    return true;
  }

  function genCemetery(m, lx0, lx1, RY0) {
    const y0 = RY0 + 7, y1 = m.h - 5;
    const x0 = lx0 + 1, x1 = lx1 - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { m.zone[m.idx(x, y)] = 1; if (m.get(x, y) === T.TREE) m.setT(x, y, T.GRASS); }
    const gx = Math.floor((x0 + x1) / 2);
    for (let x = x0; x <= x1; x++) { if (Math.abs(x - gx) > 1) m.setT(x, y0, T.FENCE); m.setT(x, y1, T.FENCE); }
    for (let y = y0; y <= y1; y++) { m.setT(x0, y, T.FENCE); m.setT(x1, y, T.FENCE); }
    for (let y = RY0 + 6; y < y0; y++) for (let x = gx - 1; x <= gx + 1; x++) m.setT(x, y, T.DIRT);
    for (let y = y0; y <= y1 - 1; y++) m.setT(gx, y, T.DIRT);
    for (let y = y0 + 3; y < y1 - 1; y += 3) for (let x = x0 + 2; x < x1 - 1; x += 3) {
      if (Math.abs(x - gx) < 2) continue;
      if (U.chance(0.85)) m.addObject({ type: 'gravestone', tx: x, ty: y, w: 1, h: 1, solid: true });
    }
    for (let k = 0; k < 4; k++) { const x = U.ri(x0 + 1, x1 - 1), y = U.ri(y0 + 1, y1 - 1); if (clearAround(m, x, y, 1)) m.setT(x, y, T.TREE); }
    m.cemetery = { x: gx, y: Math.floor((y0 + y1) / 2) };
  }

  // ---------------------------------------------------------------- camp
  function genCamp(m) {
    const W = m.w, H = m.h;
    m.fill(T.GRASS);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const border = Math.min(x, y, W - 1 - x, H - 1 - y);
      const n = U.fbm(x * 0.08, y * 0.08);
      if (border < 3 || n > 0.53 || (n > 0.45 && U.chance(0.35))) m.setT(x, y, T.TREE);
    }
    const cx = 74, cy = 44, rx = 21, ry = 15;
    m.lake = { cx, cy, rx, ry };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (U.valueNoise(x * 0.18, y * 0.18) - 0.5) * 0.35;
      if (d < 1) m.setT(x, y, T.WATER);
      else if (d < 1.22) m.setT(x, y, T.SAND);
    }
    const clear = (x0, y0, x1, y1, t = T.GRASS) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.inb(x, y) && x > 2 && y > 2 && x < W - 3 && y < H - 3 && m.get(x, y) === T.TREE) m.setT(x, y, t);
    };
    const structs = [];
    // lodge
    clear(10, 18, 38, 50);
    const lodge = buildHouse(m, 13, 22, 19, 14, 'S', { kind: 'house', phone: true, name: 'the Main Lodge', lodge: true, grid: true, color: '#5a4430', address: 'the Main Lodge' });
    structs.push(lodge);
    for (let y = 40; y <= 46; y++) for (let x = 11; x <= 30; x++) if (m.get(x, y) === T.GRASS) m.setT(x, y, T.GRAVEL);
    for (let y = 42; y <= 44; y++) for (let x = 0; x <= 12; x++) m.setT(x, y, T.DIRT);
    // generator shed
    const shed = buildHouse(m, 33, 38, 6, 5, 'S', { kind: 'shed', name: 'the Generator Shed', generator: true, grid: false, color: '#4e3a28', address: 'the generator shed' });
    structs.push(shed);
    // cabins around the lake
    const angles = [-2.75, -2.05, -1.35, -0.65, 0.05, 0.75, 1.45, 2.15, 2.85];
    const cabinNames = ['Cabin 1', 'Cabin 2', 'Ranger Station', 'Cabin 3', 'Cabin 4', 'Cabin 5', 'Cabin 6', 'Cabin 7', 'Cabin 8'];
    let ci = 0;
    const cabins = [];
    for (const a of angles) {
      const cw = 9, ch = 9;
      let px = Math.round(cx + Math.cos(a) * (rx + 10) - cw / 2), py = Math.round(cy + Math.sin(a) * (ry + 9) - ch / 2);
      px = U.clamp(px, 5, W - 6 - cw); py = U.clamp(py, 5, H - 6 - ch);
      let bad = false;
      for (const s of structs) if (px < s.x + s.w + 4 && px + cw + 4 > s.x && py < s.y + s.h + 4 && py + ch + 4 > s.y) bad = true;
      for (let y = py - 1; y <= py + ch && !bad; y++) for (let x = px - 1; x <= px + cw; x++) { const t = m.get(x, y); if (t === T.WATER || t === T.SAND) { bad = true; break; } }
      if (bad) continue;
      clear(px - 3, py - 3, px + cw + 2, py + ch + 2);
      const name = cabinNames[ci++];
      const front = py + ch / 2 < cy ? 'S' : 'N';
      const c = buildHouse(m, px, py, cw, ch, front, { kind: 'cabin', name: name === 'Ranger Station' ? 'the Ranger Station' : name, radio: name === 'Ranger Station', grid: true, color: U.pick(WOOD_COLORS), address: name });
      c.angle = a;
      cabins.push(c); structs.push(c);
    }
    // paths
    const doorOut = (Hs) => { const d = Hs.frontDoor; const oy = Hs.front === 'S' ? 1 : -1; return { x: d.x, y: d.y + oy }; };
    const path = (a, b) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
          const xx = x + ox, yy = y + oy;
          if (!m.inb(xx, yy) || m.house[m.idx(xx, yy)] >= 0) continue;
          const t = m.get(xx, yy);
          if (xx < 3 || yy < 3 || xx > W - 4 || yy > H - 4) continue;
          if (t === T.GRASS || t === T.TREE || t === T.SAND) m.setT(xx, yy, T.DIRT);
          else if (t === T.WATER) m.setT(xx, yy, T.DOCK);
        }
      }
    };
    cabins.sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < cabins.length; i++) path(doorOut(cabins[i]), doorOut(cabins[(i + 1) % cabins.length]));
    let nearest = cabins[0], nd = 1e9;
    const ld = doorOut(lodge);
    for (const c of cabins) { const p = doorOut(c); const d = Math.hypot(p.x - ld.x, p.y - ld.y); if (d < nd) { nd = d; nearest = c; } }
    path(ld, doorOut(nearest));
    path(ld, { x: ld.x, y: 41 });
    path(doorOut(shed), { x: ld.x + 3, y: ld.y + 1 });
    // dock
    const dockX = cx - 4;
    let dy = cy - ry - 3;
    while (m.get(dockX, dy) !== T.WATER && dy < cy) { if (m.get(dockX, dy) === T.TREE || m.get(dockX, dy) === T.GRASS) m.setT(dockX, dy, T.DIRT); dy++; }
    for (let k = 0; k < 6; k++) { m.setT(dockX, dy + k, T.DOCK); m.setT(dockX + 1, dy + k, T.DOCK); }
    m.addObject({ type: 'canoe', tx: dockX - 3, ty: dy - 2, w: 2, h: 1, solid: true });
    // campfire
    const fx = cx - rx - 6, fy = cy + 4;
    clear(fx - 3, fy - 3, fx + 3, fy + 3);
    for (let y = fy - 3; y <= fy + 3; y++) for (let x = fx - 3; x <= fx + 3; x++) if (m.get(x, y) === T.WATER) m.setT(x, y, T.SAND);
    const fire = m.addObject({ type: 'campfire', tx: fx, ty: fy, w: 1, h: 1, solid: true });
    fire.light = m.addLight({ x: fire.x, y: fire.y, r: 6.5 * TILE, color: [255, 150, 60], int: 1, on: true, power: 'none', kind: 'fire', flicker: 1 });
    m.addObject({ type: 'log', tx: fx - 2, ty: fy - 2, w: 2, h: 1, solid: true });
    m.addObject({ type: 'log', tx: fx + 1, ty: fy + 2, w: 2, h: 1, solid: true });
    m.addObject({ type: 'picnic', tx: fx + 2, ty: fy - 2, w: 2, h: 1, solid: true });
    path({ x: fx, y: fy + 1 }, doorOut(nearest));
    // lamp posts along paths (powered by generator)
    let cnt = 0;
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      if (m.get(x, y) !== T.DIRT) continue;
      if (++cnt % 23 !== 0) continue;
      for (const [ox, oy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const xx = x + ox, yy = y + oy;
        if (m.get(xx, yy) === T.GRASS && m.house[m.idx(xx, yy)] < 0 && m.obj[m.idx(xx, yy)] < 0) {
          const o = m.addObject({ type: 'lamppost', tx: xx, ty: yy, w: 1, h: 1, solid: true });
          o.light = m.addLight({ x: o.x, y: o.y, r: 5 * TILE, color: [255, 210, 150], int: 0.75, on: true, power: 'street', kind: 'street' });
          break;
        }
      }
    }
    // haybales / crates for flavour
    for (let k = 0; k < 10; k++) {
      const p = m.randomOutdoor();
      if (clearAround(m, p.x, p.y, 1)) m.addObject({ type: U.chance(0.5) ? 'haybale' : 'crate', tx: p.x, ty: p.y, w: 1, h: 1, solid: true, container: U.chance(0.5) ? { items: [], searched: false } : null });
    }
    m.transformer = null;
    m.entry = { x: -2 * TILE, y: 43.5 * TILE, dir: 0 };
    m.exitX = 1.5 * TILE;
    m.roadY0 = 42; m.roadY1 = 44;
    m.car = m.addObject({ type: 'car', tx: 18, ty: 41, w: 2, h: 3, solid: true, car: { color: '#3a4a2a', sabotaged: false } });
    // player's cabin: closest cabin to the lodge
    nearest.isPlayerHome = true;
    m.home = nearest;
    m.playerSpawn = m.randomFloorIn(nearest);
    m.cemetery = null;
  }

  // ---------------------------------------------------------------- texas
  function genRural(m) {
    const W = m.w, H = m.h;
    m.fill(T.GRASS);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const border = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (border < 3 || (border < 6 && U.chance(0.35)) || U.chance(0.006)) m.setT(x, y, T.TREE);
    }
    const RY0 = 42; m.roadY0 = RY0; m.roadY1 = RY0 + 2;
    for (let x = 0; x < W - 12; x++) for (let y = RY0; y <= RY0 + 2; y++) m.setT(x, y, T.DIRT);
    const path = (ax, ay, bx, by) => {
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(ax + (bx - ax) * i / n), y = Math.round(ay + (by - ay) * i / n);
        for (const [ox, oy] of [[0, 0], [1, 0]]) { const xx = x + ox, yy = y + oy; if (m.inb(xx, yy) && m.house[m.idx(xx, yy)] < 0 && [T.GRASS, T.TREE, T.CORN].includes(m.get(xx, yy))) m.setT(xx, yy, T.DIRT); }
      }
    };
    const clearRect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.get(x, y) === T.TREE && x > 2 && y > 2 && x < W - 3 && y < H - 3) m.setT(x, y, T.GRASS); };
    const doorOut = (Hs) => { const d = Hs.frontDoor; return { x: d.x, y: d.y + (Hs.front === 'S' ? 1 : -1) }; };
    // gas station (where you're stranded)
    clearRect(5, 26, 26, 41);
    const gas = buildHouse(m, 8, 29, 13, 10, 'S', { kind: 'house', phone: true, name: 'the Gas Station', address: 'the gas station', color: '#7a6a52' });
    for (let y = 39; y <= 41; y++) for (let x = 6; x <= 25; x++) m.setT(x, y, T.GRAVEL);
    m.addObject({ type: 'gaspump', tx: 11, ty: 40, w: 1, h: 1, solid: true });
    m.addObject({ type: 'gaspump', tx: 15, ty: 40, w: 1, h: 1, solid: true });
    gas.isPlayerHome = true; m.home = gas;
    // the farmhouse
    clearRect(34, 12, 64, 41);
    const farm = buildHouse(m, 40, 17, 19, 14, 'S', { kind: 'house', phone: true, name: 'the Old Farmhouse', address: 'the farmhouse', color: '#6a5e4a' });
    farm.noResidents = true;
    for (let x = 36; x <= 62; x++) { if (Math.abs(x - farm.frontDoor.x) > 1 && m.get(x, 35) === T.GRASS) m.setT(x, 35, T.FENCE); }
    for (let y = 13; y <= 35; y++) { if (m.get(36, y) === T.GRASS && y !== 24) m.setT(36, y, T.FENCE); if (m.get(62, y) === T.GRASS && y !== 26) m.setT(62, y, T.FENCE); }
    path(farm.frontDoor.x, farm.frontDoor.y + 1, farm.frontDoor.x, RY0);
    for (let k = 0; k < 9; k++) { // pumpkin patch
      const x = U.ri(38, 60), y = U.ri(32, 34);
      if (m.get(x, y) === T.GRASS && m.obj[m.idx(x, y)] < 0) { const o = m.addObject({ type: 'pumpkin', tx: x, ty: y, w: 1, h: 1, solid: true, face: U.ri(0, 2) }); o.light = m.addLight({ x: o.x, y: o.y, r: 2.2 * TILE, color: [255, 140, 40], int: 0.5, on: U.chance(0.5), power: 'none', kind: 'pumpkin', flicker: 1 }); }
    }
    // the barn (generator + where he waits)
    clearRect(66, 16, 86, 40);
    const barn = buildHouse(m, 69, 22, 14, 11, 'S', { kind: 'shed', name: 'the Barn', generator: true, color: '#6a2a1e', address: 'the barn' });
    for (let k = 0; k < 6; k++) { const p = m.randomFloorIn(barn); if (p) m.decals.push({ type: 'meathook', tx: p.x, ty: p.y, w: 1, h: 1, top: true }); }
    for (let k = 0; k < 5; k++) { const p = m.randomFloorIn(barn); if (p && !m.reserved[m.idx(p.x, p.y)]) m.addObject({ type: U.chance(0.5) ? 'haybale' : 'barrel', tx: p.x, ty: p.y, w: 1, h: 1, solid: true }); }
    path(barn.frontDoor.x, barn.frontDoor.y + 1, barn.frontDoor.x, RY0);
    m.killerSpawn = { x: barn.x + (barn.w >> 1), y: barn.y + (barn.h >> 1) };
    // shacks and a trailer
    const shacks = [];
    for (const [x, y, name] of [[22, 55, 'the Hired Hand\'s Shack'], [60, 58, 'the Old Chapel'], [92, 46, 'the Trailer'], [88, 8, 'the Smokehouse']]) {
      clearRect(x - 2, y - 2, x + 11, y + 11);
      const front = y > RY0 ? 'N' : 'S';
      const c = buildHouse(m, x, y, 9, 9, front, { kind: 'cabin', name, color: U.pick(['#5a4430', '#4e3a28', '#6a5236']), address: name });
      shacks.push(c);
      const o = doorOut(c);
      path(o.x, o.y, o.x, RY0 + (front === 'N' ? 2 : 0));
    }
    // cornfields
    const field = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.get(x, y) === T.GRASS && m.house[m.idx(x, y)] < 0 && m.obj[m.idx(x, y)] < 0) {
        const near = shacks.some((c) => x >= c.x - 2 && x <= c.x + c.w + 1 && y >= c.y - 2 && y <= c.y + c.h + 1);
        if (!near) m.setT(x, y, T.CORN);
      }
      // rows cut through
      for (let k = 0; k < 2; k++) { const yy = U.ri(y0 + 2, y1 - 2); path(x0, yy, x1, yy + U.ri(-3, 3)); }
      const xx = U.ri(x0 + 3, x1 - 3); path(xx, y0, xx + U.ri(-3, 3), y1);
    };
    field(48, 48, 104, 80); field(88, 5, 106, 38); field(5, 62, 40, 80); field(5, 5, 32, 24);
    for (let k = 0; k < 7; k++) { // scarecrows watching over the corn
      const x = U.ri(10, 100), y = U.ri(8, 78);
      if (m.get(x, y) === T.CORN && m.obj[m.idx(x, y)] < 0) m.addObject({ type: 'scarecrow', tx: x, ty: y, w: 1, h: 1, solid: true });
    }
    for (let k = 0; k < 14; k++) {
      const p = m.randomOutdoor();
      if (m.get(p.x, p.y) === T.GRASS && m.obj[m.idx(p.x, p.y)] < 0) m.addObject({ type: U.pick(['haybale', 'barrel', 'crate']), tx: p.x, ty: p.y, w: 1, h: 1, solid: true, container: U.chance(0.4) ? { items: [], searched: false } : null });
    }
    // lamp posts along the road, powered from the barn
    for (let x = 8; x < W - 14; x += 13) {
      const y = RY0 - 1;
      if (m.get(x, y) === T.GRAVEL || m.get(x, y) === T.GRASS) {
        const o = m.addObject({ type: 'lamppost', tx: x, ty: y, w: 1, h: 1, solid: true });
        o.light = m.addLight({ x: o.x, y: o.y, r: 5 * TILE, color: [255, 190, 120], int: 0.75, on: true, power: 'street', kind: 'street' });
      }
    }
    for (const Hs of m.houses) if (Hs !== barn) Hs.grid = false;
    m.transformer = null;
    m.entry = { x: -2 * TILE, y: (RY0 + 1.5) * TILE, dir: 0 };
    m.exitX = 1.5 * TILE;
    m.car = m.addObject({ type: 'car', tx: 22, ty: 39, w: 2, h: 3, solid: true, car: { color: '#6a6a3a', sabotaged: false } });
    m.playerSpawn = m.randomFloorIn(gas);
    m.cemetery = null;
  }

  // Chucky's map: dolls everywhere (one of them may be him)
  function placeDolls(m) {
    let n = 0;
    for (let k = 0; k < 400 && n < 14; k++) {
      const H = U.pick(m.houses);
      const p = U.chance(0.7) ? m.randomFloorIn(H) : (H.frontDoor ? { x: H.frontDoor.x + U.ri(-2, 2), y: H.frontDoor.y + (H.front === 'S' ? 1 : -1) } : null);
      if (!p || !m.walkable(p.x, p.y) || m.reserved[m.idx(p.x, p.y)]) continue;
      if (m.objects.some((o) => o.type === 'doll' && Math.abs(o.tx - p.x) + Math.abs(o.ty - p.y) < 6)) continue;
      m.addObject({ type: 'doll', tx: p.x, ty: p.y, w: 1, h: 1, solid: false, face: U.rf(-0.5, 0.5) });
      n++;
    }
  }

  // ---------------------------------------------------------------- loot
  function distributeLoot(m) {
    const conts = m.objects.filter((o) => o.container);
    const byHouse = (pred) => conts.filter((o) => { const H = o.house >= 0 ? m.houses[o.house] : null; return pred(H, o); });
    const notHome = byHouse((H) => H && !H.isPlayerHome);
    const put = (list, item, n = 1) => {
      if (!list.length) list = conts;
      const o = U.pick(list); o.container.items.push({ id: item, n }); return o;
    };
    // car keys: in another house, in a bedroom or kitchen
    const keyCands = notHome.filter((o) => ['dresser', 'nightstand', 'counter', 'desk', 'footlocker', 'cabinet'].includes(o.type));
    const kc = put(keyCands, 'keys');
    m.keyHouse = kc.house >= 0 ? m.houses[kc.house] : null;
    const toolC = conts.filter((o) => ['workbench', 'crate', 'cabinet', 'counter'].includes(o.type) && !(o.house >= 0 && m.houses[o.house].isPlayerHome));
    put(toolC, 'toolkit');
    put(notHome, 'fuse'); put(conts, 'fuse');
    put(notHome.filter((o) => ['nightstand', 'dresser', 'desk', 'bookshelf'].includes(o.type)), 'cellphone');
    const kitchens = conts.filter((o) => o.type === 'counter');
    put(kitchens, 'knife'); if (U.chance(0.6)) put(kitchens, 'knife');
    put(conts.filter((o) => ['closet', 'crate', 'footlocker', 'workbench', 'dresser'].includes(o.type)), 'bat');
    for (let i = 0; i < 3; i++) put(conts, 'flare');
    for (let i = 0; i < 3; i++) put(conts, 'firecracker', U.ri(1, 2));
    if (m.kind === 'elmstreet') for (let i = 0; i < 7; i++) put(conts.filter((o) => ['counter', 'fridge', 'cabinet', 'desk'].includes(o.type)), 'coffee');
    for (let i = 0; i < 6; i++) put(conts, 'battery');
    for (let i = 0; i < 5; i++) put(conts.filter((o) => ['cabinet', 'nightstand', 'counter', 'footlocker'].includes(o.type)), 'bandage');
    for (const o of conts) {
      if (o.type === 'candybowl') o.container.items.push({ id: 'candy', n: U.ri(1, 3) });
      else if (o.type === 'fridge' && U.chance(0.5)) o.container.items.push({ id: 'candy', n: 1 });
      else if (!o.container.items.length && U.chance(0.25)) o.container.items.push({ id: U.pick(['candy', 'battery', 'candy']), n: 1 });
    }
    // the player's home has a flashlight battery and a bandage to start
    const homeC = conts.filter((o) => o.house >= 0 && m.houses[o.house].isPlayerHome);
    if (homeC.length) put(homeC, 'battery');
  }

  // ---------------------------------------------------------------- bake
  function scatterDecals(m) {
    const camp = m.kind === 'camp';
    const tryAt = (pred, type, n, extra = () => ({})) => {
      for (let k = 0, placed = 0; k < n * 25 && placed < n; k++) {
        const x = U.ri(3, m.w - 4), y = U.ri(3, m.h - 4);
        if (!pred(m.get(x, y), x, y) || m.obj[m.idx(x, y)] >= 0 || m.house[m.idx(x, y)] >= 0) continue;
        m.decals.push(Object.assign({ type, tx: x, ty: y, w: 1, h: 1 }, extra())); placed++;
      }
    };
    const nearTree = (x, y) => m.get(x + 1, y) === T.TREE || m.get(x - 1, y) === T.TREE || m.get(x, y + 1) === T.TREE || m.get(x, y - 1) === T.TREE;
    tryAt((t) => t === T.ROAD || t === T.SIDEWALK || t === T.DRIVE || t === T.DIRT || t === T.GRAVEL, 'puddle', camp ? 30 : 22, () => ({ s: Math.random() }));
    tryAt((t, x, y) => t === T.GRASS && nearTree(x, y), 'leafpile', camp ? 12 : 30);
    if (!camp) {
      tryAt((t) => t === T.ROAD || t === T.SIDEWALK, 'crack', 40);
      for (let x = 8; x < m.w - 6; x += 19) m.decals.push({ type: 'manhole', tx: x, ty: m.roadY0 + 1 + (x % 2), w: 1, h: 1 });
    }
  }

  function bake(m) {
    scatterDecals(m);
    const cv = document.createElement('canvas');
    cv.width = m.w * TILE; cv.height = m.h * TILE;
    const c = cv.getContext('2d');
    const up = document.createElement('canvas');
    up.width = cv.width; up.height = cv.height;
    const u = up.getContext('2d');
    const camp = m.kind === 'camp';
    const wallish = (t) => t === T.WALL || t === T.WINDOW || t === T.FENCE || t === T.HEDGE;
    // 1. ground
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (wallish(m.get(x, y))) drawTile2(m, c, x, y, camp); else drawTile(m, c, x, y, camp);
    }
    // road markings
    if (!camp) {
      c.fillStyle = '#9a8232';
      const ly = (m.roadY0 + 2) * TILE - 1;
      for (let x = 0; x < m.w * TILE - 4 * TILE; x += 64) c.fillRect(x + 8, ly, 30, 3);
      c.fillStyle = 'rgba(200,200,200,0.22)';
      c.fillRect(0, m.roadY0 * TILE + 3, (m.w - 3) * TILE, 2); c.fillRect(0, (m.roadY1 + 1) * TILE - 5, (m.w - 3) * TILE, 2);
    }
    // 2. ground-level decals (rugs, puddles, leaves...)
    for (const d of m.decals) if (!d.top) Sprites.drawObj(c, d);
    // 3. moon shadows cast down-right by walls and trees (outdoors)
    const sh = document.createElement('canvas'); sh.width = cv.width; sh.height = cv.height;
    const sx = sh.getContext('2d'); sx.fillStyle = '#000';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.get(x, y);
      if (t === T.WALL || t === T.WINDOW || t === T.HEDGE) {
        if (!m.isIndoor(x + 1, y) && !m.isIndoor(x, y + 1)) sx.fillRect(x * TILE + 8, y * TILE + 11, TILE, TILE);
      } else if (t === T.TREE) { sx.beginPath(); sx.ellipse(x * TILE + 26, y * TILE + 30, 20, 13, 0.5, 0, TAU); sx.fill(); }
      else if (t === T.FENCE) sx.fillRect(x * TILE + 6, y * TILE + 20, TILE, 5);
    }
    // keep shadows off interior floors
    sx.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.isIndoor(x, y) || m.get(x, y) === T.DOOR) sx.fillRect(x * TILE, y * TILE, TILE, TILE);
    c.globalAlpha = camp ? 0.42 : 0.36; c.drawImage(sh, 0, 0); c.globalAlpha = 1;
    // 4. ambient occlusion along interior walls
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!m.isIndoor(x, y)) continue;
      const px = x * TILE, py = y * TILE;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const n = m.get(x + dx, y + dy);
        if (n !== T.WALL && n !== T.WINDOW) continue;
        const d = 13;
        const x0 = dx > 0 ? px + TILE : px, y0 = dy > 0 ? py + TILE : py;
        const gr = dx ? c.createLinearGradient(x0, 0, x0 - dx * d, 0) : c.createLinearGradient(0, y0, 0, y0 - dy * d);
        gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr;
        if (dx) c.fillRect(dx > 0 ? px + TILE - d : px, py, d, TILE); else c.fillRect(px, dy > 0 ? py + TILE - d : py, TILE, d);
      }
    }
    // 5. walls, fences, hedges (wall faces overlap the tile below)
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (wallish(m.get(x, y))) drawTile(m, c, x, y, camp);
    // 6. objects + cobwebs
    for (const o of m.objects) {
      if (['pumpkin', 'car'].includes(o.type)) continue;
      Sprites.drawObj(c, o);
    }
    for (const d of m.decals) if (d.top) Sprites.drawObj(c, d);
    // 7. tree canopies on the upper layer (+ trunks on the ground)
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (m.get(x, y) === T.CORN) { Sprites.corn(u, x * TILE, y * TILE, U.hash2(x, y) * 100); continue; }
      if (m.get(x, y) !== T.TREE) continue;
      const cx = (x + 0.5) * TILE + (U.hash2(x, y) - 0.5) * 8, cy = (y + 0.5) * TILE + (U.hash2(y, x) - 0.5) * 8;
      c.fillStyle = '#2a1c12'; c.beginPath(); c.arc(cx, cy + 4, 6, 0, TAU); c.fill();
      c.fillStyle = '#3a281a'; c.fillRect(cx - 2, cy + 1, 2, 4);
      const r = 20 + U.hash2(x * 3, y * 7) * 10;
      const h = U.hash2(x, y * 3);
      const pal = camp ? ['#08120a', '#0e1c0e', '#142614', '#1c341a'] : (h < 0.25 ? ['#1a0c06', '#2e1408', '#46200c', '#5e3012'] : h < 0.45 ? ['#140e06', '#24180a', '#38260e', '#4e3814'] : ['#0b150c', '#122012', '#192c18', '#22381e']);
      Sprites.canopy(u, cx, cy - 6, r, pal, U.hash2(x, y));
      const deco = U.hash2(x * 13, y * 17);
      if (!camp && deco < 0.05 && m.get(x, y + 1) !== T.TREE) Sprites.hangingGhost(u, cx + 4, cy + 12);
      else if (!camp && deco < 0.12) Sprites.toiletPaper(u, cx, cy - 6, r, deco * 100);
    }
    // 8. film-like texture over everything baked
    const img = c.getImageData(0, 0, cv.width, cv.height), dd = img.data;
    let seed = 1234567;
    for (let i = 0; i < dd.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = ((seed >> 16) & 15) - 8;
      dd[i] += n; dd[i + 1] += n; dd[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    m.ground = cv; m.upper = up;
  }

  function drawTile(m, c, x, y, camp) {
    const t = m.get(x, y), px = x * TILE, py = y * TILE;
    const h = U.hash2(x, y), h2 = U.hash2(x + 99, y + 7);
    const i = m.idx(x, y);
    const speck = (base, n, cols, sz = 2) => {
      c.fillStyle = base; c.fillRect(px, py, TILE, TILE);
      for (let k = 0; k < n; k++) { c.fillStyle = cols[k % cols.length]; c.fillRect(px + U.hash2(x * 31 + k, y) * TILE, py + U.hash2(x, y * 17 + k) * TILE, sz, sz); }
    };
    switch (t) {
      case T.CORN:
        speck('#2a2414', 12, ['#3a2e1a', '#221c10', '#4a3e22']);
        c.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 4; k < TILE; k += 8) c.fillRect(px, py + k, TILE, 2);
        break;
      case T.GRASS: case T.TREE: {
        const cem = m.zone[i] === 1;
        const g = cem ? '#151c13' : camp ? '#17240f' : m.kind === 'texas' ? '#2a2814' : '#1b2a15';
        speck(g, 10, cem ? ['#20291c', '#0f140d', '#2a2a22'] : m.kind === 'texas' ? ['#3a3418', '#201c0c', '#4a4020'] : ['#24361b', '#13200e', '#2c401f']);
        if (!camp && h < 0.35) { // autumn leaves
          for (let k = 0; k < 3; k++) { c.fillStyle = ['#8a3a10', '#a85a14', '#6a2a0a'][k]; c.fillRect(px + U.hash2(k, x * y) * 28, py + U.hash2(y, k * x) * 28, 3, 2); }
        }
        break;
      }
      case T.ROAD: speck('#1f1f22', 14, ['#28282c', '#18181a', '#2c2c30']); break;
      case T.SIDEWALK:
        c.fillStyle = '#4e4d4a'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#3a3936'; c.fillRect(px, py, TILE, 1); c.fillRect(px, py, 1, TILE);
        if (h < 0.2) { c.fillStyle = '#353430'; c.fillRect(px + 6, py + 10, 14, 1); }
        break;
      case T.DRIVE: speck('#3e3d3a', 8, ['#46453f', '#353430']); if (h < 0.15) { c.fillStyle = 'rgba(20,20,20,.4)'; c.fillRect(px + 4, py + 8, 20, 12); } break;
      case T.DIRT: speck('#33281c', 9, ['#3e3222', '#2a2016', '#4a3a28']); break;
      case T.GRAVEL: speck('#3a3832', 16, ['#4a4840', '#2a2824', '#55534a']); break;
      case T.SAND: speck('#5a4e36', 10, ['#665a40', '#4e4430']); break;
      case T.WATER: {
        c.fillStyle = '#0b1824'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#10222f'; c.fillRect(px + h * 20, py + h2 * 26, 10, 1); c.fillRect(px + h2 * 18, py + h * 20 + 6, 7, 1);
        break;
      }
      case T.DOCK:
        c.fillStyle = '#4a3622'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#3a2816'; for (let k = 0; k < 4; k++) c.fillRect(px, py + k * 8, TILE, 1);
        break;
      case T.FLOOR: case T.DOOR: {
        // floor under doors uses the neighbour's look
        c.fillStyle = '#4e3622'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#5a4028'; for (let k = 0; k < 4; k++) c.fillRect(px, py + k * 8 + 1, TILE, 6);
        c.fillStyle = '#3e2a1a'; for (let k = 0; k < 4; k++) c.fillRect(px + ((k * 13 + x * 7) % 32), py + k * 8, 1, 8);
        break;
      }
      case T.TILEF: {
        const a = (x + y) % 2 === 0;
        c.fillStyle = a ? '#7a766c' : '#5e5a52'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = a ? '#5e5a52' : '#7a766c'; c.fillRect(px, py, 16, 16); c.fillRect(px + 16, py + 16, 16, 16);
        break;
      }
      case T.CARPET: speck('#3e2a32', 12, ['#46303a', '#36242a'], 1); break;
      case T.WALL: case T.WINDOW: {
        const hid = m.house[i];
        const Hh = hid >= 0 ? m.houses[hid] : null;
        const base = Hh ? Hh.color : '#4a4440';
        const top = U.shade(base, -0.32);
        c.fillStyle = top; c.fillRect(px, py, TILE, TILE);
        for (let k = 0; k < 6; k++) { c.fillStyle = U.shade(top, (U.hash2(x * 5 + k, y) - 0.5) * 0.3); c.fillRect(px + U.hash2(k, x + y) * 28, py + U.hash2(y, k * 3) * 28, 4, 3); }
        c.fillStyle = U.shade(base, 0.02); c.fillRect(px, py, TILE, 2);
        const wl = (tt) => tt === T.WALL || tt === T.WINDOW || tt === T.DOOR;
        if (!wl(m.get(x - 1, y))) { c.fillStyle = U.shade(top, 0.15); c.fillRect(px, py, 2, TILE); }
        if (!wl(m.get(x + 1, y))) { c.fillStyle = U.shade(top, -0.3); c.fillRect(px + TILE - 2, py, 2, TILE); }
        if (t === T.WINDOW) {
          const w = m.windows.get(i);
          c.fillStyle = '#1e1a16';
          if (w.orient === 'h') { c.fillRect(px, py + 10, TILE, 10); c.fillStyle = '#4a6a82'; c.fillRect(px + 2, py + 12, TILE - 4, 6); c.fillStyle = '#7aa0b8'; c.fillRect(px + 4, py + 13, 6, 1); c.fillStyle = '#1e1a16'; c.fillRect(px + 15, py + 10, 2, 10); }
          else { c.fillRect(px + 11, py, 10, TILE); c.fillStyle = '#4a6a82'; c.fillRect(px + 13, py + 2, 6, TILE - 4); c.fillStyle = '#7aa0b8'; c.fillRect(px + 14, py + 4, 1, 6); c.fillStyle = '#1e1a16'; c.fillRect(px + 11, py + 15, 10, 2); }
        }
        // the vertical face of the wall, seen at a 3/4 angle
        const below = m.get(x, y + 1);
        if (!wl(below)) {
          const inside = INDOOR_TILES.has(below);
          const face = inside ? (Hh ? Hh.wallpaper : '#5a5048') : U.shade(base, 0.05);
          const fy = py + TILE - 12, fh = 19;
          c.fillStyle = face; c.fillRect(px, fy, TILE, fh);
          if (inside) {
            c.fillStyle = U.shade(face, -0.14); for (let k = 2; k < TILE; k += 6) c.fillRect(px + k, fy, 2, fh - 4);
            c.fillStyle = U.shade(face, 0.12); c.fillRect(px, fy, TILE, 2);
            c.fillStyle = '#24180f'; c.fillRect(px, fy + fh - 4, TILE, 4);
            if (U.hash2(x * 3, y * 11) < 0.12) { // picture frame
              c.fillStyle = '#3a2a14'; c.fillRect(px + 9, fy + 3, 14, 9); c.fillStyle = U.pick(['#3a4a3a', '#4a3a3a', '#2a3448']); c.fillRect(px + 11, fy + 5, 10, 5);
            }
          } else {
            c.fillStyle = U.shade(face, -0.28); for (let k = 3; k < fh; k += 4) c.fillRect(px, fy + k, TILE, 1);
            c.fillStyle = U.shade(face, 0.18); c.fillRect(px, fy, TILE, 1);
            c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(px, fy + fh - 3, TILE, 3);
          }
          if (t === T.WINDOW) {
            c.fillStyle = '#1a1410'; c.fillRect(px + 6, fy + 2, 20, 12);
            c.fillStyle = inside ? '#20303e' : '#344a5e'; c.fillRect(px + 8, fy + 4, 16, 8);
            c.fillStyle = '#1a1410'; c.fillRect(px + 15, fy + 4, 2, 8); c.fillRect(px + 8, fy + 7, 16, 1);
            c.fillStyle = 'rgba(190,215,235,0.35)'; c.fillRect(px + 9, fy + 5, 4, 1);
          }
          c.fillStyle = 'rgba(0,0,0,0.38)'; c.fillRect(px, fy + fh, TILE, 4);
        }
        break;
      }
      case T.FENCE: {
        drawTile2(m, c, x, y, camp);
        const cem = m.zone[i] === 1;
        const col = cem ? '#1a1a1c' : camp ? '#4a3a28' : '#c8c4b8';
        const horiz = m.get(x - 1, y) === T.FENCE || m.get(x + 1, y) === T.FENCE;
        c.fillStyle = 'rgba(0,0,0,.35)';
        if (horiz) c.fillRect(px, py + 18, TILE, 4); else c.fillRect(px + 16, py, 4, TILE);
        c.fillStyle = col;
        if (horiz) { c.fillRect(px, py + 13, TILE, 3); for (let k = 2; k < TILE; k += 7) c.fillRect(px + k, py + 8, 3, 11); }
        else { c.fillRect(px + 13, py, 3, TILE); for (let k = 2; k < TILE; k += 7) c.fillRect(px + 9, py + k, 11, 3); }
        if (cem) { c.fillStyle = '#3a3a3e'; for (let k = 2; k < TILE; k += 7) if (horiz) c.fillRect(px + k, py + 6, 3, 2); }
        break;
      }
      case T.HEDGE: c.fillStyle = '#132412'; c.fillRect(px, py, TILE, TILE); c.fillStyle = '#1c3418'; c.fillRect(px + 2, py + 2, TILE - 4, TILE - 10); break;
      default: c.fillStyle = '#222'; c.fillRect(px, py, TILE, TILE);
    }
  }
  // ground under a fence
  function drawTile2(m, c, x, y, camp) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = m.zone[m.idx(x, y)] === 1 ? '#151c13' : camp ? '#17240f' : '#1b2a15';
    c.fillRect(px, py, TILE, TILE);
  }

  return { generate };
})();
