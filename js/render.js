'use strict';
// ---------------------------------------------------------------------------
// Renderer
//  1. world (baked ground, props, cast shadows, characters, canopy, mist)
//  2. colored light map (moonlight ambient + additive lights) MULTIPLIED over it
//  3. soft fog of war (what you can't see), bloom, beam haze, dust
//  4. screen-space horror FX: static, chromatic aberration, VHS tearing,
//     blood, jump scares, vignette, grain, fear-driven color grading
// ---------------------------------------------------------------------------
const Render = (() => {
  let cv, ctx, lcv, lctx, fcv, fctx, W = 0, H = 0, LW = 0, LH = 0, zoom = 1.6, baseZoom = 1.6;
  let scv = null, sctx = null; // scratch for chromatic aberration
  const LS = 0.5; // light buffer scale
  const cam = { x: 0, y: 0 };
  let grain = null, fog = null;
  const parts = [], motes = [], drips = [], splats = [], bats = [], embers = [];
  const rain = [], leaves = [];
  const settings = { shake: true, grain: true, weather: true, brightness: 1 };
  let batT = 20, breathT = 1, lastFilter = '', ambientFor = null;
  const fx = { punch: 0, glitch: 0, rgb: 0 };

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    lcv = document.createElement('canvas'); lctx = lcv.getContext('2d');
    fcv = document.createElement('canvas'); fctx = fcv.getContext('2d');
    scv = document.createElement('canvas'); sctx = scv.getContext('2d');
    grain = makeGrain(); fog = makeFog();
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W; cv.height = H;
    scv.width = W; scv.height = H;
    LW = Math.ceil(W * LS); LH = Math.ceil(H * LS);
    lcv.width = LW; lcv.height = LH; fcv.width = LW; fcv.height = LH;
    baseZoom = U.clamp(H / (14.5 * TILE), 1.2, 2.8);
  }
  function makeGrain() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d'); const d = x.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); return c;
  }
  function makeFog() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const px = Math.random() * 512, py = Math.random() * 512, r = U.rf(40, 130);
      for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512], [512, 512], [-512, -512], [512, -512], [-512, 512]]) {
        const gr = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
        gr.addColorStop(0, 'rgba(170,180,200,0.13)'); gr.addColorStop(1, 'rgba(170,180,200,0)');
        x.fillStyle = gr; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
      }
    }
    return c;
  }
  // per-tile moonlight / darkness, smoothed by scaling up
  function ambientMap(m) {
    const c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
    const x = c.getContext('2d'); const d = x.createImageData(m.w, m.h);
    const camp = m.kind === 'camp';
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      const i = ty * m.w + tx, t = m.tiles[i];
      let r, g, b;
      if (INDOOR_TILES.has(t)) { r = 17; g = 16; b = 24; }
      else if (t === T.DOOR) { r = 20; g = 20; b = 30; }
      else if (t === T.WATER) { r = 34; g = 46; b = 80; }
      else if (t === T.TREE || t === T.CORN) { r = 16; g = 18; b = 24; }
      else if (m.zone[i] === 1) { r = 26; g = 34; b = 58; }
      else { r = camp ? 32 : 36; g = camp ? 40 : 42; b = camp ? 64 : 72; }
      const n = (U.hash2(tx * 7, ty * 3) - 0.5) * 6;
      d.data[i * 4] = r + n; d.data[i * 4 + 1] = g + n; d.data[i * 4 + 2] = b + n; d.data[i * 4 + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  function toScreen(x, y) { return { x: (x - cam.x) * zoom + W / 2, y: (y - cam.y) * zoom + H / 2 }; }
  function toWorld(sx, sy) { return { x: (sx - W / 2) / zoom + cam.x, y: (sy - H / 2) / zoom + cam.y }; }
  function snapCam(x, y) { cam.x = x; cam.y = y; }

  function pathPoly(c, p) { c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); }
  // additive colored light
  function glow(c, x, y, r, col, a, poly, mid = 0.55) {
    const [cr, cg, cb] = col;
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    gr.addColorStop(0.45, `rgba(${cr},${cg},${cb},${a * mid})`);
    gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    c.fillStyle = gr; c.beginPath();
    if (poly) pathPoly(c, poly); else c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  function flick(L, g) {
    const t = g.time;
    let f;
    switch (L.kind) {
      case 'pumpkin': f = 0.75 + 0.25 * Math.sin(t * 11 + L.x) * Math.sin(t * 7.3 + L.y); break;
      case 'fire': f = 0.82 + 0.18 * Math.sin(t * 9 + L.x) * Math.sin(t * 5.1); break;
      case 'tv': f = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.3 + Math.sin(t * 13) * 2)); break;
      case 'flare': f = 0.85 + Math.random() * 0.15; break;
      default: f = 1;
    }
    // electric lights stutter and die when HE is close
    const k = g.killer;
    if (k && k.downed <= 0 && !k.offworld && !k.doll && L.kind !== 'fire' && L.kind !== 'flare') {
      const d = Math.hypot(k.x - L.x, k.y - L.y);
      if (d < 6 * TILE) {
        const n = Math.sin(t * 37 + L.x) * Math.sin(t * 23 + L.y);
        if (n > 0.35 - (1 - d / (6 * TILE)) * 0.6) f *= 0.08 + Math.random() * 0.3;
      }
    }
    return f;
  }

  // ======================================================================
  function draw(g, dt) {
    const P = g.player, m = g.map;
    if (ambientFor !== m) { m.ambient = ambientMap(m); ambientFor = m; }
    // effects that bend the camera
    fx.punch = Math.max(0, fx.punch - dt * 2.5);
    const heart = Sound.state.heart || 0;
    const beat = heart > 0.35 ? Math.pow(Math.max(0, Math.sin(g.time * (58 + heart * 100) / 60 * Math.PI)), 12) * heart * 0.018 : 0;
    zoom = baseZoom * (1 + fx.punch * 0.07 + beat) * (P.hidden ? 1.08 : 1);
    // camera
    const mx = g.input.mouse.x - W / 2, my = g.input.mouse.y - H / 2;
    const look = P.hidden ? 0 : 0.2;
    if (g.camOverride) { cam.x = U.smooth(cam.x, g.camOverride.x, 3, dt); cam.y = U.smooth(cam.y, g.camOverride.y, 3, dt); }
    else { cam.x = U.smooth(cam.x, P.x + mx / zoom * look, 7, dt); cam.y = U.smooth(cam.y, P.y + my / zoom * look, 7, dt); }
    let shx = 0, shy = 0;
    if (g.shakeAmt > 0 && settings.shake) { shx = U.rf(-1, 1) * g.shakeAmt; shy = U.rf(-1, 1) * g.shakeAmt; }
    const vw = W / zoom, vh = H / zoom, x0 = cam.x - vw / 2, y0 = cam.y - vh / 2;
    const view = { x0: x0 - TILE * 2, y0: y0 - TILE * 2, x1: x0 + vw + TILE * 2, y1: y0 + vh + TILE * 2 };
    const inView = (x, y, pad = 0) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
    const worldT = () => ctx.setTransform(zoom, 0, 0, zoom, W / 2 - cam.x * zoom + shx, H / 2 - cam.y * zoom + shy);

    // player's line of sight + flashlight geometry
    const visR = P.hidden ? 2.6 * TILE : 17 * TILE * (P.fear > 70 ? 0.82 : 1);
    g.pvis = m.visPoly(P.x, P.y, visR, P.aim, P.aim + TAU, 300, 13);
    const flashR = 9.5 * TILE * (P.battery < 15 ? 0.6 : 1);
    g.flashPoly = P.lightOn ? conePoly(m, P.x, P.y, P.aim, 0.44, flashR) : null;
    // active lights on screen
    const lights = [];
    for (const L of m.lights) {
      if (!m.lightActive(L) || !inView(L.x, L.y, L.r)) continue;
      if (!L.poly) L.poly = m.visPoly(L.x, L.y, L.r, 0, TAU, L.r > 5 * TILE ? 120 : 80);
      L.f = flick(L, g);
      lights.push(L);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    worldT();
    ctx.imageSmoothingEnabled = false;
    // ground
    const sx0 = Math.max(0, Math.floor(x0) - 2), sy0 = Math.max(0, Math.floor(y0) - 2);
    const sw = Math.min(m.ground.width - sx0, Math.ceil(vw) + 4), sh = Math.min(m.ground.height - sy0, Math.ceil(vh) + 4);
    if (sw > 0 && sh > 0) ctx.drawImage(m.ground, sx0, sy0, sw, sh, sx0, sy0, sw, sh);
    if (m.kind === 'camp') waterShimmer(g, view);

    drawDoors(g, view);
    drawDynamicObjects(g, view, inView);
    drawFlares(g, inView);
    for (const b of g.bodies) if (inView(b.x, b.y)) Sprites.drawChar(ctx, b.spec, b.x, b.y, 0, 0, { dead: true, deadSide: b.side });
    for (const c of g.police.cars) if (inView(c.x, c.y, 80)) Sprites.drawCar(ctx, c.x, c.y, 92, 46, c.ang, { police: true, flash: c.flash, lightsOn: true, color: c.color });
    if (g.escapeCar) Sprites.drawCar(ctx, g.escapeCar.x, g.escapeCar.y, 92, 50, g.escapeCar.ang, { color: g.escapeCar.color, lightsOn: true });

    // entities
    const ents = [];
    if (!P.hidden && !(g.ending && g.ending.win && g.ending.type !== 'dawn')) ents.push(P);
    const dreaming = g.dream && g.dream.active;
    if (!dreaming) {
      for (const r of g.residents) if (!r.dead && !r.hidden && inView(r.x, r.y) && seenByP(g, r)) ents.push(r);
      for (const c of g.police.cops) if (!c.dead && inView(c.x, c.y) && seenByP(g, c)) ents.push(c);
    }
    const k = g.killer;
    const kDraw = k && !k.hiddenIn && !k.offworld && inView(k.x, k.y) && seenByP(g, k) && (!k.shrouded || k.seenByPlayer || P.dist(k) < 3.5 * TILE);
    if (kDraw) ents.push(k);
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) if (!e.doll) castShadows(g, e, lights);
    for (const p of g.projectiles || []) { ctx.fillStyle = '#c8201a'; ctx.fillRect(p.x - 3, p.y - 1.5, 6, 3); ctx.fillStyle = '#e8d080'; ctx.fillRect(p.x + 2, p.y - 1.5, 1, 3); }
    for (const e of ents) drawEntity(g, e);

    drawParticles(dt, false);
    breath(g, dt);
    if (sw > 0 && sh > 0) ctx.drawImage(m.upper, sx0, sy0, sw, sh, sx0, sy0, sw, sh);
    // mist: lit by whatever lights it
    if (settings.weather) {
      ctx.globalAlpha = (m.kind === 'camp' ? 0.28 : 0.22) + P.fear / 100 * 0.12;
      const ox = (g.time * 9) % 512, oy = (g.time * 3) % 512;
      const fx0 = Math.floor((view.x0 + ox) / 512) * 512 - ox, fy0 = Math.floor((view.y0 + oy) / 512) * 512 - oy;
      for (let fy = fy0; fy < view.y1; fy += 512) for (let fxx = fx0; fxx < view.x1; fxx += 512) ctx.drawImage(fog, fxx, fy);
      ctx.globalAlpha = 1;
    }

    // ------------- colored light map -------------
    lightMap(g, shx, shy, view, inView, lights);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lcv, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.13;
    ctx.drawImage(lcv, 0, 0, W, H); // a touch of bloom where it's lit
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // fog of war
    fogOfWar(g, shx, shy, view);
    ctx.drawImage(fcv, 0, 0, W, H);
    worldT();
    ctx.imageSmoothingEnabled = false;

    // ------------- light cores, beam haze, dust -------------
    ctx.globalCompositeOperation = 'lighter';
    for (const L of lights) {
      if (L.kind === 'ceiling' || !m.los(P.x, P.y, L.x, L.y)) continue;
      const [r, gg, b] = L.color;
      const rad = L.kind === 'street' ? 22 : L.kind === 'fire' || L.kind === 'flare' ? 34 : L.kind === 'tv' ? 18 : 13;
      const gr = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, rad);
      gr.addColorStop(0, `rgba(${r},${gg},${b},${0.6 * L.f})`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = gr; ctx.fillRect(L.x - rad, L.y - rad, rad * 2, rad * 2);
      if (L.kind === 'street' && settings.weather) { // haze cone under streetlights
        const h2 = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 0.5);
        h2.addColorStop(0, `rgba(${r},${gg},${b},${0.06 * L.f})`); h2.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        ctx.fillStyle = h2; ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
      }
    }
    if (g.flashPoly) {
      const gr = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, flashR);
      gr.addColorStop(0, 'rgba(255,235,200,0.10)'); gr.addColorStop(0.5, 'rgba(255,235,200,0.05)'); gr.addColorStop(1, 'rgba(255,235,200,0)');
      ctx.fillStyle = gr; ctx.beginPath(); pathPoly(ctx, g.flashPoly); ctx.fill();
      dust(g, dt, flashR);
    }
    for (const c of g.police.cars) {
      if (!inView(c.x, c.y, 100)) continue;
      const gr = ctx.createRadialGradient(c.x, c.y - 4, 0, c.x, c.y - 4, 60);
      gr.addColorStop(0, c.flash ? 'rgba(255,40,40,0.55)' : 'rgba(40,90,255,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(c.x - 60, c.y - 64, 120, 120);
    }
    for (const p of parts) if (p.type === 'muzzle') { const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 40); gr.addColorStop(0, `rgba(255,220,140,${p.life / p.max})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(p.x - 40, p.y - 40, 80, 80); }
    drawParticles(0, true);
    // the blade catches the light
    if (kDraw && k.downed <= 0 && !k.doll && (g.inPlayerFlash(k.x, k.y) || m.lightAt(k.x, k.y) > 0.35)) {
      const ph = Math.sin(g.time * 2.7 + k.x * 0.01);
      if (ph > 0.55 || k.atk) {
        const sc = Sprites.SCALE * (k.spec.scale || 1), dir = Sprites.dirFromAngle(k.facing);
        const gx = k.x + (dir === 0 ? 6 : dir === 1 ? -6 : dir === 2 ? 3 : -3) * sc, gy = k.y - (k.atk ? 26 : 6) * sc;
        const a = k.atk ? 0.9 : (ph - 0.55) * 2;
        const s = 5 + a * 6;
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx - s, gy); ctx.lineTo(gx + s, gy); ctx.moveTo(gx, gy - s); ctx.lineTo(gx, gy + s); ctx.stroke();
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 6); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.fillRect(gx - 6, gy - 6, 12, 12);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // the pale mask catches what little light there is
    if (g.halluc) { // a glimpse of him that isn't really there
      const h = g.halluc;
      ctx.globalAlpha = (h.t / h.max) * (0.35 + Math.random() * 0.4);
      Sprites.drawChar(ctx, Sprites.SPECS.freddy, h.x + U.rf(-2, 2), h.y, Math.atan2(g.player.y - h.y, g.player.x - h.x), 0, {});
      ctx.globalAlpha = 1;
    }
    if (kDraw && !k.shrouded && !k.doll && m.lightAt(k.x, k.y) < 0.3 && !g.inPlayerFlash(k.x, k.y)) {
      ctx.globalAlpha = 0.14 + (P.fear / 100) * 0.1;
      drawEntity(g, k, true);
      ctx.globalAlpha = 1;
    }
    drawWorldUI(g, inView);

    // ------------- screen space -------------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (settings.weather) weather(g, dt);
    drawBats(g, dt);
    post(g, dt);
    drawIndicators(g);
  }

  function conePoly(m, x, y, a, half, range) {
    const poly = m.visPoly(x, y, range, a - half, a + half, 44, 6);
    const pts = new Float32Array(poly.length + 2);
    pts[0] = x; pts[1] = y; pts.set(poly, 2);
    return pts;
  }

  function seenByP(g, e) {
    const P = g.player;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (P.hidden) return d < 3 * TILE && g.map.los(P.x, P.y, e.x, e.y);
    return d < 18 * TILE && g.map.los(P.x, P.y, e.x, e.y);
  }

  // ---------------- characters ----------------
  function entFrame(e) { return e.atkAnim > 0 ? 4 : e.frame; }
  function castShadows(g, e, lights) {
    if (e.kind === 'killer' && e.downed > 0) return;
    const P = g.player;
    const casts = [];
    if (e !== P && g.flashPoly && g.inPlayerFlash(e.x, e.y)) casts.push({ x: P.x, y: P.y, r: 9.5 * TILE, a: 0.75, poly: g.flashPoly });
    let best = null, bs = 0;
    for (const L of lights) {
      const d = Math.hypot(e.x - L.x, e.y - L.y);
      if (d > L.r * 0.85 || d < 6) continue;
      const s = L.int * L.f * (1 - d / L.r);
      if (s > bs && g.map.los(L.x, L.y, e.x, e.y)) { bs = s; best = L; }
    }
    if (best) casts.push({ x: best.x, y: best.y, r: best.r, a: Math.min(0.6, bs * 1.2), poly: best.poly });
    if (!casts.length) return;
    const sil = Sprites.silhouette(e.spec, Sprites.dirFromAngle(e.facing), entFrame(e));
    const sc = Sprites.SCALE * (e.spec.scale || 1);
    for (const c of casts) {
      const d = Math.hypot(e.x - c.x, e.y - c.y);
      const a = Math.atan2(e.y - c.y, e.x - c.x);
      const stretch = U.clamp(0.55 + d / (2.4 * TILE), 0.7, 2.8);
      ctx.save();
      ctx.beginPath(); pathPoly(ctx, c.poly); ctx.clip();
      ctx.translate(e.x, e.y); ctx.rotate(a + Math.PI / 2); ctx.scale(0.95, stretch);
      ctx.globalAlpha = c.a * (1 - d / c.r * 0.6);
      ctx.drawImage(sil, -Sprites.SW / 2 * sc, -32 * sc, Sprites.SW * sc, Sprites.SH * sc);
      ctx.restore();
    }
  }
  function drawEntity(g, e, ghost) {
    const sp = e.spec;
    if (e === g.player) sp.weapon = g.player.equipped === 'revolver' ? 'gun' : g.player.equipped;
    if (e.kind === 'killer' && e.doll) { Sprites.drawChar(ctx, sp, e.x, e.y + 6, 0, 0, { sit: true }); return; }
    const frame = entFrame(e);
    let x = e.x, y = e.y;
    const opts = {};
    if (!ghost) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, e.r + 3, 5, 0, 0, TAU); ctx.fill();
    }
    if (e.kind === 'killer') {
      if (e.downed > 0) { Sprites.drawChar(ctx, sp, x, y, 0, 0, { dead: true, deadSide: 1 }); return; }
      if (e.stun > 0) x += Math.sin(g.time * 40) * 1.5;
      if (e.p.id === 'ghostface' && e.shrouded && !ghost) ctx.globalAlpha = e.seenByPlayer ? 0.85 : 0.35;
      // The Shape tilts his head while he stares at you
      const sub = e.goal && e.goal.sub;
      if (sub && (sub.phase === 'stare' || sub.phase === 'watch') && !e.moving) {
        e.tilt = U.smooth(e.tilt || 0, e.p.id === 'myers' ? 0.22 : 0.08, 1.5, 1 / 60);
      } else e.tilt = U.smooth(e.tilt || 0, 0, 6, 1 / 60);
      if (Math.abs(e.tilt) > 0.01) opts.tilt = e.tilt;
    }
    if (e.kind === 'player' && e.crouch) y += 4;
    Sprites.drawChar(ctx, sp, x, y, e.facing, frame, opts);
    if (!ghost) ctx.globalAlpha = 1;
  }

  function breath(g, dt) {
    const P = g.player;
    if (P.hidden || g.ending || g.map.kind === 'woodsboro') return;
    breathT -= dt * (1 + P.fear / 60) * (P.running ? 2.2 : 1);
    if (breathT <= 0) {
      breathT = 2.6;
      const hx = P.x + Math.cos(P.aim) * 7, hy = P.y - 46 + Math.sin(P.aim) * 4;
      for (let i = 0; i < 4; i++) parts.push({ type: 'vapor', x: hx, y: hy, vx: Math.cos(P.aim) * U.rf(8, 18) + U.rf(-4, 4), vy: U.rf(-12, -4), life: U.rf(1.2, 1.8), max: 1.8, size: U.rf(2, 4) });
    }
  }
  function dust(g, dt, range) {
    const P = g.player;
    while (motes.length < 36) motes.push({ d: U.rf(20, range), a: U.rf(-0.42, 0.42), z: Math.random(), s: U.rf(0.5, 1.6), ph: Math.random() * 6 });
    for (const mo of motes) {
      mo.ph += dt * mo.s;
      mo.d += Math.sin(mo.ph) * 4 * dt; mo.a += Math.cos(mo.ph * 0.7) * 0.02 * dt;
      const x = P.x + Math.cos(P.aim + mo.a) * mo.d, y = P.y + Math.sin(P.aim + mo.a) * mo.d - 14 - mo.z * 10;
      if (!g.map.los(P.x, P.y, x, y + 14)) { mo.d = U.rf(20, range * 0.5); continue; }
      ctx.fillStyle = `rgba(255,240,210,${0.35 * (1 - mo.d / range)})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  // ---------------- props ----------------
  function drawDoors(g, view) {
    const m = g.map;
    for (const d of m.doors.values()) {
      const px = d.x * TILE, py = d.y * TILE;
      if (px < view.x0 || px > view.x1 || py < view.y0 || py > view.y1) continue;
      const wood = d.exterior ? '#4a2c1a' : '#6a4a2e';
      if (d.broken) {
        ctx.fillStyle = '#2a1a10';
        for (let i = 0; i < 4; i++) ctx.fillRect(px + 4 + i * 7, py + (i % 2) * 18 + 6, 5, 3);
        ctx.fillStyle = '#1a120c'; ctx.fillRect(px + 2, py + 12, 8, 3); ctx.fillRect(px + 20, py + 18, 9, 2);
        continue;
      }
      if (d.orient === 'h') {
        ctx.fillStyle = '#140d08'; ctx.fillRect(px, py + 8, 3, 16); ctx.fillRect(px + TILE - 3, py + 8, 3, 16);
        if (d.open) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px + 7, py + 3, 4, 30); ctx.fillStyle = wood; ctx.fillRect(px + 2, py + 1, 6, 30); ctx.fillStyle = U.shade(wood, 0.2); ctx.fillRect(px + 2, py + 1, 1, 30); }
        else {
          ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(px + 2, py + 21, TILE - 4, 3);
          ctx.fillStyle = wood; ctx.fillRect(px + 2, py + 11, TILE - 4, 10);
          ctx.fillStyle = U.shade(wood, 0.2); ctx.fillRect(px + 2, py + 11, TILE - 4, 2);
          ctx.fillStyle = U.shade(wood, -0.25); ctx.fillRect(px + 9, py + 13, 1, 7); ctx.fillRect(px + 22, py + 13, 1, 7);
          ctx.fillStyle = d.locked ? '#d8b040' : '#9a8a5a'; ctx.fillRect(px + TILE - 9, py + 15, 3, 3);
        }
      } else {
        ctx.fillStyle = '#140d08'; ctx.fillRect(px + 8, py, 16, 3); ctx.fillRect(px + 8, py + TILE - 3, 16, 3);
        if (d.open) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px + 3, py + 7, 30, 4); ctx.fillStyle = wood; ctx.fillRect(px + 1, py + 2, 30, 6); ctx.fillStyle = U.shade(wood, 0.2); ctx.fillRect(px + 1, py + 2, 30, 1); }
        else {
          ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(px + 21, py + 2, 3, TILE - 4);
          ctx.fillStyle = wood; ctx.fillRect(px + 11, py + 2, 10, TILE - 4);
          ctx.fillStyle = U.shade(wood, 0.2); ctx.fillRect(px + 11, py + 2, 2, TILE - 4);
          ctx.fillStyle = d.locked ? '#d8b040' : '#9a8a5a'; ctx.fillRect(px + 15, py + TILE - 9, 3, 3);
        }
      }
    }
    for (const w of m.windows.values()) {
      if (!w.broken) continue;
      const px = w.x * TILE, py = w.y * TILE;
      if (px < view.x0 || px > view.x1 || py < view.y0 || py > view.y1) continue;
      ctx.fillStyle = '#050505';
      if (w.orient === 'h') ctx.fillRect(px + 2, py + 11, TILE - 4, 8); else ctx.fillRect(px + 12, py + 2, 8, TILE - 4);
      ctx.fillStyle = '#9ab8cc';
      for (let i = 0; i < 7; i++) ctx.fillRect(px + U.hash2(w.x, i) * 30, py + U.hash2(i, w.y) * 30, 2, 2);
      // jagged teeth of glass still in the frame
      ctx.fillStyle = '#7a98ac';
      if (w.orient === 'h') { ctx.beginPath(); ctx.moveTo(px + 2, py + 11); ctx.lineTo(px + 8, py + 16); ctx.lineTo(px + 12, py + 11); ctx.lineTo(px + 20, py + 18); ctx.lineTo(px + 26, py + 11); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(px + 12, py + 2); ctx.lineTo(px + 17, py + 9); ctx.lineTo(px + 12, py + 14); ctx.lineTo(px + 18, py + 22); ctx.lineTo(px + 12, py + 28); ctx.fill(); }
    }
  }

  function drawDynamicObjects(g, view, inView) {
    const m = g.map, t = g.time;
    for (const o of m.objects) {
      if (!inView(o.x, o.y, 64)) continue;
      const px = o.tx * TILE, py = o.ty * TILE;
      switch (o.type) {
        case 'pumpkin': {
          ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(px + 18, py + 22, 12, 6, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#b84e14'; ctx.beginPath(); ctx.ellipse(px + 16, py + 17, 12, 10, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#d06a20'; ctx.beginPath(); ctx.ellipse(px + 14, py + 15, 7, 7, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#8a3a0c'; ctx.fillRect(px + 9, py + 9, 2, 16); ctx.fillRect(px + 15, py + 7, 2, 19); ctx.fillRect(px + 21, py + 9, 2, 16);
          ctx.fillStyle = '#3a5a1a'; ctx.fillRect(px + 15, py + 4, 3, 5); ctx.fillStyle = '#2a4210'; ctx.fillRect(px + 17, py + 4, 4, 2);
          const on = o.light && m.lightActive(o.light);
          const f = on ? o.light.f || 1 : 0;
          ctx.fillStyle = on ? `rgb(255,${150 + f * 90},${40 + f * 30})` : '#2a1206';
          ctx.beginPath(); ctx.moveTo(px + 8, py + 15); ctx.lineTo(px + 13, py + 15); ctx.lineTo(px + 11, py + 10); ctx.fill();
          ctx.beginPath(); ctx.moveTo(px + 19, py + 15); ctx.lineTo(px + 24, py + 15); ctx.lineTo(px + 21, py + 10); ctx.fill();
          if (o.face === 0) { ctx.fillRect(px + 9, py + 19, 14, 3); ctx.fillStyle = '#b84e14'; ctx.fillRect(px + 12, py + 19, 2, 2); ctx.fillRect(px + 18, py + 20, 2, 2); }
          else { ctx.beginPath(); ctx.moveTo(px + 8, py + 18); ctx.lineTo(px + 24, py + 18); ctx.lineTo(px + 20, py + 24); ctx.lineTo(px + 16, py + 21); ctx.lineTo(px + 12, py + 24); ctx.fill(); }
          break;
        }
        case 'doll':
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 10, 8, 3, 0, 0, TAU); ctx.fill();
          Sprites.drawChar(ctx, Sprites.SPECS.chucky, o.x, o.y + 6, 0, 0, { sit: true });
          break;
        case 'tv':
          if (o.light && m.lightActive(o.light)) {
            const horiz = o.w >= o.h;
            const f = o.light.f || 1;
            ctx.fillStyle = `rgba(${110 + f * 80},${140 + f * 80},255,0.95)`;
            if (horiz) ctx.fillRect(px + 6, py + 9, o.w * TILE - 12, o.h * TILE - 18); else ctx.fillRect(px + 8, py + 6, o.w * TILE - 16, o.h * TILE - 12);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            for (let i = 0; i < 3; i++) ctx.fillRect(px + 7 + Math.random() * (o.w * TILE - 16), py + 9 + Math.random() * (o.h * TILE - 20), 6, 1);
          }
          break;
        case 'lamp': case 'lamppost':
          if (o.light && m.lightActive(o.light)) { ctx.fillStyle = `rgba(255,242,200,${0.4 + 0.6 * (o.light.f || 1)})`; ctx.beginPath(); ctx.arc(px + 16, py + 16, 4, 0, TAU); ctx.fill(); }
          break;
        case 'streetlight':
          if (o.light && m.lightActive(o.light)) { ctx.fillStyle = `rgba(255,232,176,${0.3 + 0.7 * (o.light.f || 1)})`; ctx.beginPath(); ctx.arc(px + 16, py + 16, 3, 0, TAU); ctx.fill(); }
          break;
        case 'breaker': {
          const H = m.houses[o.house];
          ctx.fillStyle = H && H.power ? '#3c3' : (Math.floor(t * 3) % 2 ? '#f22' : '#600');
          ctx.fillRect(px + 22, py + 8, 3, 3);
          break;
        }
        case 'phonebox': {
          const H = m.houses[o.house];
          if (H && !H.phoneLine) {
            ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px + 15, py + 22); ctx.quadraticCurveTo(px + 22, py + 30, px + 18, py + 34); ctx.stroke();
            if (Math.random() < 0.04) spark(o.x, o.y + 6);
          }
          break;
        }
        case 'transformer': case 'generator':
          if (!m.streetPower && Math.random() < 0.03) spark(o.x, o.y - 6);
          if (o.type === 'generator' && m.streetPower) { ctx.fillStyle = '#3c3'; ctx.fillRect(px + 22, py + 7, 3, 3); }
          break;
        case 'campfire': {
          for (let i = 0; i < 6; i++) {
            const a = t * 3 + i * 1.3, r = 3 + Math.sin(t * 7 + i) * 2;
            ctx.fillStyle = i % 3 === 0 ? '#ffe070' : i % 2 ? '#ffb030' : '#ff5a10';
            ctx.beginPath(); ctx.arc(px + 16 + Math.sin(a) * 3, py + 14 - Math.abs(Math.cos(a * 1.3)) * 7, r + 2, 0, TAU); ctx.fill();
          }
          if (Math.random() < 0.2) parts.push({ type: 'ember', x: o.x + U.rf(-4, 4), y: o.y - 4, vx: U.rf(-8, 8), vy: U.rf(-40, -20), life: 1.4, max: 1.4 });
          break;
        }
        case 'car': {
          const c = o.car;
          if (g.escapeCar) break;
          Sprites.drawCar(ctx, o.x, o.y, 92, 50, o.h > o.w ? Math.PI / 2 : 0, { color: c.color, sabotaged: c.sabotaged });
          break;
        }
        default: break;
      }
    }
  }

  function drawFlares(g, inView) {
    for (const f of g.flares) {
      if (!inView(f.x, f.y)) continue;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.fillStyle = '#b01010'; ctx.fillRect(-7, -2, 14, 4); ctx.fillStyle = '#fff0e0'; ctx.fillRect(6, -2, 3, 4); ctx.restore();
      if (Math.random() < 0.7) parts.push({ type: 'spark', x: f.x + U.rf(-3, 3), y: f.y, vx: U.rf(-30, 30), vy: U.rf(-50, -10), life: 0.4, max: 0.4, col: '#ff6a5a', glow: true });
      if (Math.random() < 0.25) parts.push({ type: 'smoke', x: f.x, y: f.y - 4, vx: U.rf(-6, 6), vy: U.rf(-25, -12), life: 2, max: 2, size: U.rf(3, 6), col: '#5a2020' });
    }
  }

  function waterShimmer(g, view) {
    const m = g.map, t = g.time;
    const tx0 = Math.max(0, Math.floor(view.x0 / TILE)), tx1 = Math.min(m.w - 1, Math.ceil(view.x1 / TILE));
    const ty0 = Math.max(0, Math.floor(view.y0 / TILE)), ty1 = Math.min(m.h - 1, Math.ceil(view.y1 / TILE));
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      if (m.tiles[y * m.w + x] !== T.WATER) continue;
      const ph = Math.sin(t * 1.5 + x * 0.7 + y * 0.4);
      if (ph > 0.4) { ctx.fillStyle = `rgba(140,170,210,${(ph - 0.4) * 0.35})`; ctx.fillRect(x * TILE + 6 + ph * 8, y * TILE + 10 + U.hash2(x, y) * 12, 12, 1); }
      const ph2 = Math.sin(t * 0.9 + x * 0.3 - y * 0.8);
      if (ph2 > 0.7) { ctx.fillStyle = 'rgba(160,190,230,0.12)'; ctx.fillRect(x * TILE + U.hash2(y, x) * 20, y * TILE + 22, 8, 1); }
    }
  }

  // ---------------- particles ----------------
  function spark(x, y) { for (let i = 0; i < 6; i++) parts.push({ type: 'spark', x, y, vx: U.rf(-60, 60), vy: U.rf(-80, -10), life: U.rf(0.2, 0.5), max: 0.5, col: '#ffe080', glow: true }); }
  function puff(x, y) { for (let i = 0; i < 30; i++) parts.push({ type: 'smoke', x: x + U.rf(-10, 10), y: y + U.rf(-30, 4), vx: U.rf(-25, 25), vy: U.rf(-35, 0), life: U.rf(0.8, 2), max: 2, size: U.rf(6, 16) }); }
  function glass(x, y) { for (let i = 0; i < 22; i++) parts.push({ type: 'glass', x, y, vx: U.rf(-110, 110), vy: U.rf(-110, 90), life: U.rf(0.3, 0.8), max: 0.8 }); }
  function splinters(x, y) { for (let i = 0; i < 18; i++) parts.push({ type: 'wood', x, y, vx: U.rf(-130, 130), vy: U.rf(-130, 110), life: U.rf(0.3, 0.8), max: 0.8 }); }
  function blood(x, y, n = 8) { for (let i = 0; i < n; i++) parts.push({ type: 'blood', x, y: y - 12, vx: U.rf(-90, 90), vy: U.rf(-110, 20), life: U.rf(0.3, 0.7), max: 0.7, size: U.rf(1.5, 3.5) }); }
  function muzzle(x, y) { parts.push({ type: 'muzzle', x, y, life: 0.08, max: 0.08 }); }
  function drawParticles(dt, glowPass) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (!glowPass) {
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (p.type !== 'muzzle') {
          p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
          if (p.type === 'blood' || p.type === 'glass' || p.type === 'wood') p.vy += 220 * dt;
        }
      }
      const a = Math.max(0, p.life / p.max);
      const glowy = p.glow || p.type === 'ember';
      if (glowPass !== !!glowy || p.type === 'muzzle') continue;
      switch (p.type) {
        case 'spark': ctx.fillStyle = p.col; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'ember': ctx.fillStyle = '#ff9a3a'; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'smoke': ctx.fillStyle = p.col || '#16181a'; ctx.globalAlpha = a * 0.55; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, TAU); ctx.fill(); break;
        case 'vapor': ctx.fillStyle = '#c8ccd8'; ctx.globalAlpha = a * 0.22; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2.2 - a), 0, TAU); ctx.fill(); break;
        case 'glass': ctx.fillStyle = '#c8e0f4'; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'wood': ctx.fillStyle = '#6a4a2a'; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, 4, 2); break;
        case 'blood': ctx.fillStyle = '#7a0606'; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, p.size, p.size); break;
        default: break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- lighting ----------------
  function lightMap(g, shx, shy, view, inView, lights) {
    const P = g.player, m = g.map;
    const s = zoom * LS;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = '#000'; lctx.fillRect(0, 0, LW, LH);
    lctx.setTransform(s, 0, 0, s, LW / 2 - cam.x * s + shx * LS, LH / 2 - cam.y * s + shy * LS);
    // moonlight ambient (per-tile, smoothed)
    lctx.imageSmoothingEnabled = true;
    const tx0 = Math.max(0, Math.floor(view.x0 / TILE) - 1), ty0 = Math.max(0, Math.floor(view.y0 / TILE) - 1);
    const tw = Math.min(m.w - tx0, Math.ceil((view.x1 - view.x0) / TILE) + 3), th = Math.min(m.h - ty0, Math.ceil((view.y1 - view.y0) / TILE) + 3);
    if (tw > 0 && th > 0) lctx.drawImage(m.ambient, tx0, ty0, tw, th, tx0 * TILE, ty0 * TILE, tw * TILE, th * TILE);
    lctx.globalCompositeOperation = 'lighter';
    const br = settings.brightness - 1;
    const add = (r, gg, b) => { lctx.save(); lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`; lctx.fillRect(0, 0, LW, LH); lctx.restore(); };
    if (br > 0) add(br * 26, br * 28, br * 38);
    if (g.flash > 0) add(150 * g.flash, 160 * g.flash, 210 * g.flash);
    if (g.dawn > 0) add(170 * g.dawn, 120 * g.dawn, 100 * g.dawn);
    const dr = g.dream ? g.dream.amount : 0;
    if (dr > 0.01) add(70 * dr * (0.85 + Math.sin(g.time * 3) * 0.15), 18 * dr, 8 * dr);
    for (const L of lights) glow(lctx, L.x, L.y, L.r, L.color, Math.min(1, L.int * L.f * 1.3), L.poly, 0.72);
    // eyes adjusted to the dark
    glow(lctx, P.x, P.y, (P.hidden ? 1.8 : 4.2) * TILE, [120, 125, 160], P.hidden ? 0.32 : 0.5, g.pvis);
    if (g.flashPoly) {
      const fr = 9.5 * TILE * (P.battery < 15 ? 0.6 : 1);
      const gr = lctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, fr);
      gr.addColorStop(0, 'rgba(255,244,220,1)'); gr.addColorStop(0.55, 'rgba(255,236,200,0.85)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
      lctx.fillStyle = gr; lctx.beginPath(); pathPoly(lctx, g.flashPoly); lctx.fill();
      glow(lctx, P.x + Math.cos(P.aim) * 20, P.y + Math.sin(P.aim) * 20, 2.2 * TILE, [255, 236, 200], 0.3, g.pvis);
    }
    for (const c of g.police.cops) if (!c.dead && c.flashOn && inView(c.x, c.y, 300)) beam(m, c.x, c.y, c.facing, 0.38, 8 * TILE, [230, 236, 255], 0.9);
    for (const r of g.residents) if (!r.dead && !r.hidden && r.flashOn && r.state !== 'home' && inView(r.x, r.y, 300)) beam(m, r.x, r.y, r.facing, 0.4, 6 * TILE, [255, 236, 200], 0.75);
    if (g.escapeCar) beam(m, g.escapeCar.x, g.escapeCar.y, g.escapeCar.ang, 0.35, 12 * TILE, [255, 248, 220], 1);
    for (const c of g.police.cars) {
      if (!inView(c.x, c.y, 300)) continue;
      if (!c.poly || c.polyX !== c.x) { c.poly = m.visPoly(c.x, c.y, 6 * TILE, 0, TAU, 70); c.polyX = c.x; }
      glow(lctx, c.x, c.y, 6 * TILE, c.flash ? [255, 30, 30] : [40, 80, 255], 0.75, c.poly);
      beam(m, c.x + Math.cos(c.ang) * 40, c.y + Math.sin(c.ang) * 40, c.ang, 0.3, 7 * TILE, [255, 248, 220], 0.5);
    }
    for (const p of parts) if (p.type === 'muzzle') glow(lctx, p.x, p.y, 4 * TILE, [255, 220, 150], 1);
  }
  function beam(m, x, y, a, half, range, col, alpha) {
    const pts = conePoly(m, x, y, a, half, range);
    const [r, g, b] = col;
    const gr = lctx.createRadialGradient(x, y, 0, x, y, range);
    gr.addColorStop(0, `rgba(${r},${g},${b},${alpha})`); gr.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.75})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    lctx.fillStyle = gr; lctx.beginPath(); pathPoly(lctx, pts); lctx.fill();
  }
  function fogOfWar(g, shx, shy, view) {
    const P = g.player;
    const s = zoom * LS;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, LW, LH);
    fctx.setTransform(s, 0, 0, s, LW / 2 - cam.x * s + shx * LS, LH / 2 - cam.y * s + shy * LS);
    fctx.fillStyle = `rgba(0,0,0,${P.hidden ? 0.95 : 0.88})`;
    fctx.beginPath();
    fctx.rect(view.x0 - 300, view.y0 - 300, view.x1 - view.x0 + 600, view.y1 - view.y0 + 600);
    pathPoly(fctx, g.pvis);
    fctx.fill('evenodd');
    if (!P.hidden) {
      const gr = fctx.createRadialGradient(P.x, P.y, 1.5 * TILE, P.x, P.y, 6 * TILE);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
      fctx.fillStyle = gr; fctx.beginPath(); fctx.moveTo(P.x, P.y);
      fctx.arc(P.x, P.y, 30 * TILE, P.aim + 1.95, P.aim + TAU - 1.95); fctx.closePath(); fctx.fill();
    }
  }

  // ---------------- world UI ----------------
  function drawWorldUI(g, inView) {
    const P = g.player;
    ctx.imageSmoothingEnabled = true;
    ctx.textAlign = 'center';
    for (const s of g.speeches) {
      const e = s.ent;
      if (e.dead && e.kind !== 'resident') continue;
      if (!inView(e.x, e.y)) continue;
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d > 16 * TILE) continue;
      const vis = g.map.los(P.x, P.y, e.x, e.y);
      const a = Math.min(1, s.t * 2) * (vis ? 1 : 0.55);
      const fs = 11;
      ctx.font = `${vis ? '' : 'italic '}${fs}px "Special Elite", monospace`;
      const lines = wrap(s.text, 34);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
      const h = lines.length * (fs + 3) + 6;
      const bx = e.x, by = e.y - 66 - h;
      ctx.globalAlpha = a * 0.78; ctx.fillStyle = '#0a0808';
      Sprites.rr(ctx, bx - w / 2, by, w, h, 4); ctx.fill();
      ctx.globalAlpha = a; ctx.fillStyle = e.kind === 'cop' ? '#a8c0ff' : '#efe6d2';
      lines.forEach((l, i) => ctx.fillText(l, bx, by + 4 + fs + i * (fs + 3) - 2));
    }
    ctx.globalAlpha = 1;
    ctx.font = '9px "Special Elite", monospace';
    for (const r of g.residents) {
      if (r.dead || r.hidden || !inView(r.x, r.y)) continue;
      if (Math.hypot(r.x - P.x, r.y - P.y) > 5 * TILE || !g.map.los(P.x, P.y, r.x, r.y)) continue;
      ctx.fillStyle = r.state === 'follow' ? '#9fd09f' : '#bbb';
      ctx.fillText(r.first, r.x, r.y - 62);
    }
    ctx.imageSmoothingEnabled = false;
  }
  function wrap(t, n) {
    const words = t.split(' '); const out = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > n) { out.push(cur.trim()); cur = w; } else cur += ' ' + w; }
    if (cur.trim()) out.push(cur.trim());
    return out.slice(0, 4);
  }

  function drawIndicators(g) {
    const arrow = (x, y, col, label) => {
      const s = toScreen(x, y);
      if (s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) return;
      const a = Math.atan2(s.y - H / 2, s.x - W / 2);
      const ex = U.clamp(W / 2 + Math.cos(a) * W, 26, W - 26), ey = U.clamp(H / 2 + Math.sin(a) * H, 26, H - 26);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill(); ctx.restore();
      ctx.fillStyle = col; ctx.font = '11px "Special Elite"'; ctx.textAlign = 'center';
      ctx.fillText(label, ex - Math.cos(a) * 22, ey - Math.sin(a) * 18);
    };
    for (const r of g.residents) if (!r.dead && r.state === 'follow') arrow(r.x, r.y, '#9fd09f', r.first);
    for (const c of g.police.cars) arrow(c.x, c.y, c.flash ? '#ff6060' : '#6080ff', 'POLICE');
  }

  // ---------------- screen space ----------------
  function weather(g, dt) {
    const raining = g.map.kind === 'camp' || g.rain;
    if (raining) {
      while (rain.length < 180) rain.push({ x: Math.random() * W, y: Math.random() * H, s: U.rf(550, 850) });
      ctx.strokeStyle = 'rgba(150,170,200,0.18)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const r of rain) {
        r.y += r.s * dt; r.x -= r.s * 0.15 * dt;
        if (r.y > H) { r.y = -10; r.x = Math.random() * W * 1.1; }
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + 3, r.y - 13);
      }
      ctx.stroke();
    }
    if (g.map.kind !== 'camp') {
      while (leaves.length < 16) leaves.push({ x: Math.random() * W, y: Math.random() * H, vx: U.rf(30, 80), vy: U.rf(10, 30), r: Math.random() * 6, c: U.pick(['#5a2408', '#6a3410', '#3a1a06']) });
      for (const l of leaves) {
        l.x += l.vx * dt + Math.sin(g.time * 2 + l.r) * 0.6; l.y += l.vy * dt; l.r += dt * 3;
        if (l.x > W + 10) { l.x = -10; l.y = Math.random() * H; }
        if (l.y > H + 10) l.y = -10;
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.r); ctx.globalAlpha = 0.45; ctx.fillStyle = l.c; ctx.fillRect(-3, -1.5, 6, 3); ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
  function drawBats(g, dt) {
    batT -= dt;
    if (batT <= 0 && !g.ending) {
      batT = U.rf(35, 80);
      const fromL = U.chance(0.5), y0 = U.rf(H * 0.05, H * 0.5);
      for (let i = 0; i < U.ri(4, 9); i++) bats.push({ x: fromL ? -40 - i * U.rf(15, 40) : W + 40 + i * U.rf(15, 40), y: y0 + U.rf(-40, 40), vx: (fromL ? 1 : -1) * U.rf(260, 380), ph: Math.random() * 6, s: U.rf(0.7, 1.3) });
    }
    for (let i = bats.length - 1; i >= 0; i--) {
      const b = bats[i];
      b.x += b.vx * dt; b.ph += dt * 22; b.y += Math.sin(b.ph * 0.3) * 30 * dt;
      if (b.x < -300 || b.x > W + 300) { bats.splice(i, 1); continue; }
      const f = Math.sin(b.ph) * 6 * b.s;
      ctx.fillStyle = 'rgba(4,3,5,0.85)';
      ctx.beginPath(); ctx.moveTo(b.x - 10 * b.s, b.y - f); ctx.quadraticCurveTo(b.x - 4 * b.s, b.y - 2, b.x, b.y + 2 * b.s);
      ctx.quadraticCurveTo(b.x + 4 * b.s, b.y - 2, b.x + 10 * b.s, b.y - f); ctx.quadraticCurveTo(b.x, b.y - 3 * b.s, b.x - 10 * b.s, b.y - f); ctx.fill();
    }
  }

  // called by the game
  function hurt(amount) {
    const n = Math.round(4 + amount / 4);
    for (let i = 0; i < n; i++) drips.push({ x: Math.random() * W, len: U.rf(10, 40), v: U.rf(8, 40), w: U.rf(2, 6), a: 1 });
    for (let i = 0; i < 4; i++) splats.push({ x: U.rf(0, W), y: U.rf(0, H), r: U.rf(30, 110), a: 0.7, seed: Math.random() * 1000 });
    fx.glitch = Math.max(fx.glitch, 0.6); fx.rgb = Math.max(fx.rgb, 1);
  }
  function reset() { parts.length = 0; drips.length = 0; splats.length = 0; embers.length = 0; bats.length = 0; motes.length = 0; fx.punch = 0; fx.rgb = 0; fx.glitch = 0; }
  function punch(n = 1) { fx.punch = Math.max(fx.punch, n); fx.rgb = Math.max(fx.rgb, n * 0.8); fx.glitch = Math.max(fx.glitch, n * 0.4); }

  function post(g, dt) {
    const P = g.player, fear = P.fear / 100, k = g.killer;
    // HIS presence: static and interference when he is close
    let presence = 0;
    if (k && k.downed <= 0 && !k.offworld && !g.ending) presence = Math.max(0, 1 - P.dist(k) / ((k.has('doll') ? 5 : 9) * TILE));
    fx.rgb = Math.max(0, fx.rgb - dt * 1.5); fx.glitch = Math.max(0, fx.glitch - dt * 1.2);
    if (settings.grain && presence > 0.05) {
      ctx.globalAlpha = presence * presence * 0.22; ctx.globalCompositeOperation = 'screen';
      const ox = Math.random() * 256, oy = Math.random() * 256;
      for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(grain, x, y);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // chromatic aberration
    const ca = settings.grain ? Math.max(fx.rgb * 8, fear > 0.55 ? (fear - 0.55) * 9 : 0, presence > 0.4 ? (presence - 0.4) * 8 : 0) : 0;
    if (ca > 0.6) {
      sctx.globalCompositeOperation = 'copy'; sctx.drawImage(cv, 0, 0);
      sctx.globalCompositeOperation = 'multiply'; sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#00ffff'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(scv, ca, ca * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    // VHS tearing
    const gl = settings.grain ? Math.max(fx.glitch, presence > 0.6 && Math.random() < 0.08 ? 0.5 : 0) : 0;
    if (gl > 0.05) {
      const n = Math.ceil(gl * 6);
      for (let i = 0; i < n; i++) {
        const y = Math.random() * H, h = U.rf(3, 26) * gl, dx = U.rf(-30, 30) * gl;
        ctx.drawImage(cv, 0, y, W, h, dx, y, W, h);
      }
    }
    // the nightmare: the world breathes and bends
    const dr = g.dream ? g.dream.amount : 0;
    if (dr > 0.02) {
      const bands = 36, bh = Math.ceil(H / bands);
      for (let i = 0; i < bands; i++) {
        const y = i * bh, dx = Math.sin(y * 0.018 + g.time * 2.4) * 7 * dr;
        ctx.drawImage(cv, 0, y, W, bh, dx, y, W, bh);
      }
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(255,${Math.round(150 + 60 * (1 - dr))},${Math.round(120 + 100 * (1 - dr))},1)`; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      const eg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, `rgba(20,60,20,${0.35 * dr})`);
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 3; i++) if (Math.random() < dr) embers.push({ x: Math.random() * W, y: H + 5, vy: U.rf(-60, -140), vx: U.rf(-20, 20), life: U.rf(2, 4) });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.life -= dt; e.x += e.vx * dt + Math.sin(e.y * 0.03) * 0.5; e.y += e.vy * dt;
      if (e.life <= 0) { embers.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(255,${120 + Math.random() * 80},40,${Math.min(1, e.life) * 0.8})`; ctx.fillRect(e.x, e.y, 2, 2);
    }
    // hiding: peeking through the slats
    if (P.hidden) {
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      const gap = 24, bar = 20;
      for (let y = 0; y < H; y += gap + bar) if (Math.abs(y + bar / 2 - H / 2) > 18) ctx.fillRect(0, y, W, bar);
    }
    // vignette
    const vr = Math.max(W, H);
    const inner = vr * (0.3 - fear * 0.13 - (P.hidden ? 0.08 : 0));
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.max(10, inner), W / 2, H / 2, vr * 0.72);
    const pulse = fear > 0.6 ? Math.sin(g.time * (4 + fear * 6)) * 0.05 : 0;
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(${fear > 0.5 ? 34 : 0},0,${fear > 0.5 ? 14 : 0},${Math.min(1, 0.8 + fear * 0.2 + pulse)})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // low health
    if (P.hp < 45) {
      const a = (1 - P.hp / 45) * (0.35 + Math.sin(g.time * 5) * 0.12);
      const rg = ctx.createRadialGradient(W / 2, H / 2, vr * 0.25, W / 2, H / 2, vr * 0.7);
      rg.addColorStop(0, 'rgba(120,0,0,0)'); rg.addColorStop(1, `rgba(140,0,0,${a})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    if (g.hurtFlash > 0) { ctx.fillStyle = `rgba(160,0,0,${g.hurtFlash * 0.45})`; ctx.fillRect(0, 0, W, H); }
    if (g.scareFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${g.scareFlash * 0.22})`; ctx.fillRect(0, 0, W, H); }
    if (g.senseFlash > 0) {
      const rg = ctx.createRadialGradient(W / 2, H / 2, vr * 0.2, W / 2, H / 2, vr * 0.7);
      rg.addColorStop(0, 'rgba(160,0,0,0)'); rg.addColorStop(1, `rgba(200,0,0,${g.senseFlash * 0.5})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    bloodOnScreen(dt);
    // film grain + scratches
    if (settings.grain) {
      ctx.globalAlpha = 0.06 + fear * 0.06; ctx.globalCompositeOperation = 'overlay';
      const ox = Math.random() * 256, oy = Math.random() * 256;
      for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(grain, x, y);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (Math.random() < 0.15 + fear * 0.4) {
        ctx.fillStyle = `rgba(220,210,190,${U.rf(0.04, 0.12)})`;
        ctx.fillRect(Math.random() * W, 0, 1, H);
        if (Math.random() < 0.3) { ctx.fillRect(Math.random() * W, Math.random() * H, U.rf(1, 3), U.rf(1, 3)); }
      }
    }
    drawJumpscare(g, dt);
    if (g.fadeIn > 0) { ctx.fillStyle = `rgba(0,0,0,${g.fadeIn})`; ctx.fillRect(0, 0, W, H); }
    // color grading through CSS filters (cheap, GPU)
    const lowhp = Math.max(0, 1 - P.hp / 50);
    const filt = settings.grain ? `saturate(${(1 - fear * 0.55 - lowhp * 0.2 + dr * 0.7).toFixed(2)}) contrast(${(1.08 + fear * 0.22 + dr * 0.15).toFixed(2)}) brightness(${(1 + (settings.brightness - 1) * 0.15).toFixed(2)})${dr > 0.05 ? ` hue-rotate(${(-12 * dr).toFixed(1)}deg)` : ''}` : '';
    if (filt !== lastFilter) { cv.style.filter = filt; lastFilter = filt; }
  }
  function bloodOnScreen(dt) {
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.a -= dt * 0.12;
      if (s.a <= 0) { splats.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(90,0,0,${s.a * 0.55})`;
      ctx.beginPath();
      for (let j = 0; j < 9; j++) {
        const a = j / 9 * TAU, r = s.r * (0.5 + U.hash2(Math.floor(s.seed), j) * 0.6);
        ctx.moveTo(s.x, s.y); ctx.arc(s.x + Math.cos(a) * r * 0.3, s.y + Math.sin(a) * r * 0.3, r * 0.45, 0, TAU);
      }
      ctx.fill();
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.len += d.v * dt; d.v *= 0.995; d.a -= dt * 0.1;
      if (d.a <= 0) { drips.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(110,0,0,${d.a * 0.8})`;
      ctx.fillRect(d.x, 0, d.w, d.len);
      ctx.beginPath(); ctx.arc(d.x + d.w / 2, d.len, d.w * 0.8, 0, TAU); ctx.fill();
    }
  }
  function drawJumpscare(g, dt) {
    const j = g.jumpscare;
    if (!j || j.t <= 0) return;
    j.t -= dt;
    const life = j.max - j.t;
    const a = life < 0.05 ? life / 0.05 : j.t < 0.2 ? j.t / 0.2 : 1;
    const fs = H * 0.78 * (1 + life * 0.45);
    const jx = W / 2 + U.rf(-1, 1) * 16, jy = H / 2 + U.rf(-1, 1) * 16 + H * 0.04;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    Sprites.face(ctx, j.spec.kind, jx, jy, fs, life);
    ctx.globalCompositeOperation = 'multiply';
    const ul = ctx.createLinearGradient(0, H, 0, 0);
    ul.addColorStop(0, 'rgb(255,120,100)'); ul.addColorStop(0.6, 'rgb(170,70,70)'); ul.addColorStop(1, 'rgb(60,20,30)');
    ctx.fillStyle = ul; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a * 0.35; ctx.globalCompositeOperation = 'overlay';
    for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(grain, x, y);
    ctx.restore();
    for (let i = 0; i < 5; i++) { const y = Math.random() * H, h = U.rf(4, 30); ctx.drawImage(cv, 0, y, W, h, U.rf(-40, 40), y, W, h); }
  }

  // ---------------- minimap ----------------
  function minimap(g, canvas) {
    const m = g.map, s = 4;
    canvas.width = m.w * s; canvas.height = m.h * s;
    const c = canvas.getContext('2d');
    c.fillStyle = '#050505'; c.fillRect(0, 0, canvas.width, canvas.height);
    const col = {
      [T.GRASS]: '#16220f', [T.FLOOR]: '#5a4028', [T.TILEF]: '#6a665c', [T.CARPET]: '#4a3038', [T.WALL]: '#9a8a7a', [T.WINDOW]: '#6a8aa2', [T.DOOR]: '#c08040',
      [T.ROAD]: '#2a2a2e', [T.SIDEWALK]: '#4e4d4a', [T.TREE]: '#0c160c', [T.WATER]: '#10263a', [T.FENCE]: '#5a5a5a', [T.DIRT]: '#4a3a24', [T.HEDGE]: '#13240f',
      [T.DRIVE]: '#3e3d3a', [T.SAND]: '#6a5a3a', [T.DOCK]: '#5a4026', [T.GRAVEL]: '#4a4840', [T.CORN]: '#4a4a1e',
    };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!m.explored[y * m.w + x]) continue;
      c.fillStyle = col[m.tiles[y * m.w + x]] || '#333'; c.fillRect(x * s, y * s, s, s);
    }
    c.font = '10px "Special Elite"'; c.textAlign = 'center';
    for (const H of m.houses) {
      const cx = (H.x + H.w / 2) * s, cy = (H.y + H.h / 2) * s;
      if (!m.explored[m.idx(H.x + (H.w >> 1), H.y + (H.h >> 1))] && !m.explored[m.idx(H.frontDoor.x, H.frontDoor.y)]) continue;
      c.fillStyle = H.power ? '#e8d8b0' : '#806060';
      c.fillText((H.isPlayerHome ? '★ ' : '') + (H.surname || H.name.replace(/^the /, '')), cx, cy);
    }
    if (m.car && m.explored[m.idx(m.car.tx, m.car.ty)]) { c.fillStyle = '#e8c070'; c.fillRect(m.car.tx * s, m.car.ty * s, m.car.w * s, m.car.h * s); }
    for (const car of g.police.cars) { c.fillStyle = '#6080ff'; c.fillRect(car.x / TILE * s - 6, car.y / TILE * s - 3, 12, 6); }
    for (const r of g.residents) if (!r.dead && r.state === 'follow') { c.fillStyle = '#9fd09f'; c.beginPath(); c.arc(r.x / TILE * s, r.y / TILE * s, 3, 0, TAU); c.fill(); }
    c.fillStyle = '#ff8a2a'; c.beginPath(); c.arc(g.player.x / TILE * s, g.player.y / TILE * s, 4, 0, TAU); c.fill();
  }

  return {
    init, resize, draw, toWorld, toScreen, snapCam, settings, minimap, spark, puff, glass, splinters, blood, muzzle, hurt, punch, reset,
    get zoom() { return zoom; }, cam, parts,
  };
})();
