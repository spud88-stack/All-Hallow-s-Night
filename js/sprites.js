'use strict';
// ---------------------------------------------------------------------------
// Procedural pixel-art: characters (4 directions, walk + attack frames),
// furniture/props, vehicles, trees and inventory icons.
// ---------------------------------------------------------------------------
const Sprites = (() => {
  const SW = 22, SH = 36, CX = 11, OY = 6;
  const SCALE = 2;
  const cache = new Map();

  const SPECS = {
    myers: { kind: 'myers', mask: 'myers', skin: '#ddd8c8', hand: '#c9b49a', hair: '#3a2c20', top: '#27324a', pants: '#27324a', shoes: '#16120e', build: 0, weapon: 'knife', outfit: 'coverall', scale: 1.12 },
    jason: { kind: 'jason', mask: 'jason', skin: '#9a8270', hand: '#8a7262', top: '#3c3e2a', shirt: '#5d5546', pants: '#2b2922', shoes: '#1a1612', build: 1, weapon: 'machete', outfit: 'jacket', scale: 1.2 },
    ghostface: { kind: 'ghostface', mask: 'ghost', skin: '#d0b8a0', hand: '#0a0a0c', top: '#0d0d12', pants: '#0d0d12', shoes: '#000000', build: 0, weapon: 'gknife', robe: true, outfit: 'robe', scale: 1.05 },
    player: { kind: 'player', skin: '#e3b48f', hair: '#6a3b1f', hairStyle: 'long', top: '#b4562a', pants: '#33445e', shoes: '#d8d4cc', outfit: 'hoodie', weapon: null },
    cop: { kind: 'cop', skin: '#c99a76', hair: '#2a1d14', hairStyle: 'cap', top: '#2a3a5e', pants: '#1b2236', shoes: '#0c0c0c', outfit: 'cop', weapon: 'gun' },
  };
  const SKINS = ['#f0c8a8', '#e3b48f', '#c99a76', '#a87452', '#7d5236', '#5c3a26'];
  const HAIRS = ['#1c1410', '#3a2618', '#6a3b1f', '#a8702a', '#d8b060', '#8a8a8a', '#5a1a10'];
  const TOPS = ['#6a2a2a', '#2a5a3a', '#4a3a6a', '#7a6a3a', '#2a4a6a', '#6a4a2a', '#8a2a5a', '#3a6a6a', '#5a5a5a', '#9a7a4a'];
  const PANTS = ['#2a2a3a', '#3a4a6a', '#4a3a2a', '#2a3a2a', '#1a1a1a', '#5a4a3a'];

  function randomSpec(female) {
    return {
      kind: 'res', skin: U.pick(SKINS), hair: U.pick(HAIRS), hairStyle: female ? U.pick(['long', 'long', 'short']) : U.pick(['short', 'short', 'bald']),
      top: U.pick(TOPS), pants: U.pick(PANTS), shoes: U.pick(['#1a1a1a', '#3a2a1a', '#d0d0d0']), outfit: U.pick(['shirt', 'shirt', 'sweater']), weapon: null,
      id: Math.random().toString(36).slice(2, 8),
    };
  }

  // ------------- character painter -------------
  function paint(c, s, dir, frame) {
    const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(CX + x, OY + y, w, h); };
    const lp = frame <= 3 ? [0, 1, 0, -1][frame] : 0;
    const atk = frame === 4;
    const bw = 8 + (s.build ? 2 : 0), hx = -bw / 2;
    const top = s.top, topD = U.shade(top, -0.35), topL = U.shade(top, 0.15);
    const pants = s.pants, shoes = s.shoes;
    const hand = s.hand || s.skin;
    const armW = s.robe ? 3 : 2;
    const legW = s.build ? 4 : 3;

    if (dir === 0 || dir === 1) {
      const back = dir === 1;
      // weapon behind body when facing away
      if (back && !atk) weapon(R, s, hx - armW, 18 + lp, 'down');
      // legs
      if (s.robe) {
        R(hx - 1, 15, bw + 2, 10, top);
        for (let x = hx - 1; x < hx + bw + 1; x++) if ((x + frame) % 3 === 0) R(x, 25, 1, 1, top);
        R(-1 + (back ? 0 : 0), 13, 1, 12, '#1d1d25'); R(hx + 1, 17, 1, 8, '#1a1a21'); R(hx + bw - 2, 17, 1, 8, '#1a1a21');
        R(-3, 25 - Math.max(0, lp), 2, 1, '#050505'); R(1, 25 - Math.max(0, -lp), 2, 1, '#050505');
      } else {
        const l1 = Math.max(0, lp), l2 = Math.max(0, -lp);
        R(-legW, 18, legW, 6 - l1, pants); R(0, 18, legW, 6 - l2, pants);
        R(-1, 18, 1, 5, U.shade(pants, -0.3));
        R(-legW, 24 - l1, legW, 2, shoes); R(0, 24 - l2, legW, 2, shoes);
      }
      // torso
      R(hx, 10, bw, 8, top); R(hx, 10, bw, 1, topL); R(hx, 17, bw, 1, topD);
      R(hx, 10, 1, 8, topD); R(hx + bw - 1, 10, 1, 8, topD);
      outfit(R, s, dir, hx, bw);
      // arms
      if (atk) {
        R(hx - armW, 11, armW, 6, topD); R(hx - armW, 17, armW, 1, hand);
        R(hx + bw, 3, armW, 8, topD); R(hx + bw, 2, armW, 1, hand);
        weapon(R, s, hx + bw, 2, 'up');
      } else {
        R(hx - armW, 11 + lp, armW, 6, topD); R(hx - armW, 17 + lp, armW, 1, hand);
        R(hx + bw, 11 - lp, armW, 6, topD); R(hx + bw, 17 - lp, armW, 1, hand);
        if (!back) weapon(R, s, hx + bw, 18 - lp, 'down');
      }
      head(R, s, dir);
    } else {
      // side view (facing right)
      const sw = 6 + (s.build ? 2 : 0), sx = -sw / 2;
      R(-1 - lp, 11, 2, 6, U.shade(topD, -0.25)); // back arm
      if (s.robe) {
        R(sx - 1, 15, sw + 2, 10, top);
        for (let x = sx - 1; x < sx + sw + 1; x++) if ((x + frame) % 3 === 0) R(x, 25, 1, 1, top);
        R(sx + 1, 16, 1, 9, '#1a1a21');
        R(-1 + lp, 25, 3, 1, '#050505');
      } else {
        R(-2 - lp, 18, legW, 6, U.shade(pants, -0.25)); R(-2 - lp, 24, legW + 1, 2, U.shade(shoes, -0.2));
        R(-1 + lp, 18, legW, 6, pants); R(-1 + lp, 24, legW + 1, 2, shoes);
      }
      R(sx, 10, sw, 8, top); R(sx, 10, sw, 1, topL); R(sx, 10, 1, 8, topD); R(sx, 17, sw, 1, topD);
      outfit(R, s, 2, sx, sw);
      if (atk) {
        R(0, 3, armW, 8, topD); R(0, 2, armW, 1, hand);
        weapon(R, s, 1, 2, 'up');
      } else {
        R(-1 + lp, 11, armW, 6, topD); R(-1 + lp, 17, armW, 1, hand);
        weapon(R, s, lp, 18, 'side');
      }
      head(R, s, 2);
    }
  }

  function outfit(R, s, dir, hx, bw) {
    const front = dir === 0;
    switch (s.outfit) {
      case 'coverall':
        if (front) { R(0, 11, 1, 7, '#18203a'); R(-2, 10, 4, 1, '#18203a'); R(hx + 1, 13, 2, 1, '#1d2640'); R(hx + bw - 3, 13, 2, 1, '#1d2640'); }
        else if (dir === 2) R(0, 12, 2, 1, '#1d2640');
        break;
      case 'jacket':
        if (front) { R(-1, 10, 2, 8, s.shirt); R(-2, 10, 1, 7, '#2b2c1e'); R(1, 10, 1, 7, '#2b2c1e'); }
        else if (dir === 1) R(hx + 2, 12, bw - 4, 1, '#2b2c1e');
        break;
      case 'hoodie':
        if (front) { R(-3, 10, 6, 1, U.shade(s.top, -0.3)); R(-1, 11, 1, 2, '#ddd'); R(1, 11, 1, 2, '#ddd'); R(-2, 15, 4, 2, U.shade(s.top, -0.2)); }
        else if (dir === 1) { R(-3, 9, 6, 3, U.shade(s.top, -0.15)); }
        else R(-3, 9, 3, 3, U.shade(s.top, -0.15));
        break;
      case 'cop':
        R(hx, 16, bw, 1, '#0d0d0d');
        if (front) { R(-3, 11, 1, 1, '#e8c650'); R(-1, 10, 2, 1, '#121212'); R(2, 11, 1, 2, '#111'); R(hx + 1, 16, 1, 1, '#777'); }
        if (dir === 2) R(1, 16, 2, 2, '#111');
        break;
      case 'robe':
        if (front) R(0, 10, 1, 8, '#1d1d25');
        break;
      case 'sweater':
        if (front) { R(hx, 12, bw, 1, U.shade(s.top, 0.25)); R(hx, 15, bw, 1, U.shade(s.top, 0.25)); }
        break;
      default:
        if (front) R(-1, 10, 2, 1, U.shade(s.top, -0.4));
    }
  }

  function weapon(R, s, x, y, mode) {
    const blade = '#d9dde2', bladeD = '#9aa1a8';
    switch (s.weapon) {
      case 'knife':
        if (mode === 'up') { R(x, y - 6, 1, 5, blade); R(x + 1, y - 5, 1, 3, bladeD); R(x, y - 1, 1, 1, '#2b1d12'); }
        else if (mode === 'side') { R(x + 1, y, 1, 5, blade); R(x + 2, y + 1, 1, 3, bladeD); }
        else { R(x, y, 1, 1, '#2b1d12'); R(x, y + 1, 1, 5, blade); R(x + 1, y + 1, 1, 3, bladeD); }
        break;
      case 'gknife':
        if (mode === 'up') { R(x, y - 5, 1, 4, blade); R(x + 1, y - 6, 1, 2, blade); }
        else if (mode === 'side') { R(x + 1, y, 1, 4, blade); R(x + 2, y + 3, 1, 1, blade); }
        else { R(x, y + 1, 1, 4, blade); R(x + 1, y + 4, 1, 1, blade); }
        break;
      case 'machete':
        if (mode === 'up') { R(x, y - 9, 2, 8, '#b9bdc2'); R(x, y - 10, 1, 1, '#b9bdc2'); R(x + 1, y - 9, 1, 8, '#8b9096'); R(x, y - 1, 2, 1, '#1a120c'); }
        else if (mode === 'side') { R(x + 1, y, 2, 1, '#1a120c'); R(x + 1, y + 1, 2, 7, '#b9bdc2'); R(x + 2, y + 1, 1, 7, '#8b9096'); }
        else { R(x, y, 2, 1, '#1a120c'); R(x, y + 1, 2, 7, '#b9bdc2'); R(x + 1, y + 1, 1, 7, '#8b9096'); R(x, y + 8, 1, 1, '#b9bdc2'); }
        break;
      case 'gun':
        if (mode === 'side') { R(x + 1, y - 1, 3, 1, '#222'); R(x + 1, y, 1, 1, '#222'); }
        else if (mode === 'down') { R(x, y, 1, 2, '#2a2a2a'); R(x, y + 2, 1, 1, '#ffe9a0'); }
        break;
      case 'bat':
        if (mode === 'up') R(x, y - 8, 2, 8, '#a87a4a');
        else if (mode === 'side') R(x + 1, y, 2, 7, '#a87a4a');
        else R(x, y, 2, 7, '#a87a4a');
        break;
      case 'flashlight':
        if (mode !== 'up') { R(x, y, 1, 3, '#333'); R(x, y + 3, 1, 1, '#ffe9a0'); }
        break;
      default: break;
    }
  }

  function head(R, s, dir) {
    const sk = s.skin;
    if (s.mask === 'myers') {
      // pale, blank, expressionless; dark hollow eyes; flat brown hair
      const H = '#2e2218', H2 = '#1e160f', M = '#ece8dc', Ml = '#f8f6ee', Md = '#c6c0ae', Ms = '#9e9888', E = '#000000';
      if (dir === 0) {
        R(-3, 1, 6, 2, H); R(-4, 2, 1, 4, H); R(3, 2, 1, 4, H); R(-2, 0, 4, 1, H2);
        R(-3, 3, 6, 7, M); R(-2, 3, 3, 1, Ml); R(-3, 9, 6, 1, Md); R(2, 4, 1, 5, Md);
        R(-3, 3, 1, 1, H); R(2, 3, 1, 1, H);
        R(-3, 5, 2, 2, Ms); R(1, 5, 2, 2, Ms); // sunken sockets
        R(-2, 5, 1, 2, E); R(1, 5, 1, 2, E);
        R(-1, 6, 1, 2, Md); R(-1, 8, 2, 1, '#77715f');
      } else if (dir === 1) {
        R(-3, 1, 6, 7, H); R(-4, 2, 1, 5, H); R(3, 2, 1, 5, H); R(-2, 0, 4, 1, H2); R(-1, 3, 1, 3, H2); R(1, 4, 1, 3, H2);
        R(-3, 8, 6, 2, Md); R(-4, 6, 1, 3, M); R(3, 6, 1, 3, M);
      } else {
        R(-2, 3, 5, 7, M); R(-1, 3, 3, 1, Ml); R(-2, 9, 5, 1, Md); R(3, 5, 1, 3, M);
        R(-3, 1, 5, 2, H); R(-3, 3, 1, 5, H); R(-4, 2, 1, 4, H2); R(-1, 0, 3, 1, H2);
        R(0, 5, 2, 2, Ms); R(1, 5, 1, 2, E); R(4, 6, 1, 1, Md); R(2, 8, 2, 1, '#77715f');
      }
      return;
    }
    if (s.mask === 'jason') {
      const M = '#e2dcc6', Md = '#c4bda4', red = '#a81c1c', sc = '#7a6050', st = '#2a1d14', hole = '#6f6958';
      if (dir === 0) {
        R(-3, 2, 6, 8, M); R(-3, 9, 6, 1, Md); R(-4, 5, 1, 1, st); R(3, 5, 1, 1, st);
        R(-2, 3, 1, 1, red); R(-1, 4, 2, 1, red); R(1, 3, 1, 1, red); R(-3, 6, 1, 2, red); R(2, 6, 1, 2, red);
        R(-2, 5, 1, 1, '#000'); R(1, 5, 1, 1, '#000');
        R(-1, 7, 1, 1, hole); R(0, 8, 1, 1, hole); R(-2, 8, 1, 1, hole); R(1, 7, 1, 1, hole); R(-1, 9, 1, 1, hole); R(0, 6, 1, 1, Md);
      } else if (dir === 1) {
        R(-3, 2, 6, 8, sc); R(-2, 3, 1, 1, '#5e4a3c'); R(1, 5, 1, 2, '#5e4a3c'); R(-1, 7, 2, 1, '#5e4a3c');
        R(-3, 4, 6, 1, st); R(-3, 7, 6, 1, st);
      } else {
        R(-3, 2, 3, 8, sc); R(0, 2, 3, 8, M); R(2, 2, 1, 8, Md); R(-3, 4, 3, 1, st);
        R(1, 5, 1, 1, '#000'); R(1, 3, 1, 1, red); R(2, 7, 1, 1, red); R(1, 8, 1, 1, hole);
      }
      return;
    }
    if (s.mask === 'ghost') {
      const W = '#f1f1ec', Wd = '#cfcfc8', hood = '#0b0b0f', hl = '#1d1d25';
      if (dir === 0) {
        R(-4, 1, 8, 10, hood); R(-4, 1, 8, 1, hl); R(-4, 1, 1, 10, '#16161c'); R(3, 1, 1, 10, '#16161c');
        R(-2, 2, 4, 8, W); R(-3, 3, 6, 6, W); R(-3, 8, 1, 1, Wd); R(2, 8, 1, 1, Wd);
        R(-2, 4, 1, 3, '#000'); R(1, 4, 1, 3, '#000'); R(-3, 5, 1, 1, '#000'); R(2, 5, 1, 1, '#000');
        R(-1, 7, 2, 3, '#000');
      } else if (dir === 1) {
        R(-4, 1, 8, 10, hood); R(-4, 1, 8, 1, hl); R(-1, 2, 1, 8, '#16161c'); R(2, 3, 1, 6, '#16161c');
      } else {
        R(-4, 1, 7, 10, hood); R(-4, 1, 7, 1, hl);
        R(0, 2, 3, 8, W); R(2, 3, 1, 6, W); R(3, 4, 1, 4, W);
        R(1, 4, 1, 3, '#000'); R(2, 7, 2, 3, '#000');
      }
      return;
    }
    const hair = s.hair, style = s.hairStyle || 'short';
    if (dir === 0) {
      R(-3, 3, 6, 7, sk); R(-3, 9, 6, 1, U.shade(sk, -0.15));
      if (style === 'cap') { R(-4, 2, 8, 2, '#141c2c'); R(-3, 1, 6, 1, '#141c2c'); R(-4, 4, 8, 1, '#0b0f18'); R(0, 2, 1, 1, '#d8b84a'); }
      else if (style === 'long') { R(-3, 2, 6, 2, hair); R(-4, 3, 1, 8, hair); R(3, 3, 1, 8, hair); R(-3, 4, 1, 2, hair); R(2, 4, 1, 2, hair); }
      else if (style === 'short') { R(-3, 2, 6, 2, hair); R(-3, 4, 1, 1, hair); R(2, 4, 1, 1, hair); }
      else R(-3, 2, 6, 1, U.shade(sk, -0.1));
      R(-2, 6, 1, 1, '#1a1010'); R(1, 6, 1, 1, '#1a1010');
      R(-1, 8, 2, 1, U.shade(sk, -0.35));
    } else if (dir === 1) {
      if (style === 'cap') { R(-3, 4, 6, 5, hair); R(-4, 2, 8, 3, '#141c2c'); R(-3, 1, 6, 1, '#141c2c'); }
      else if (style === 'long') { R(-4, 2, 8, 10, hair); R(-3, 2, 6, 1, U.shade(hair, 0.15)); }
      else if (style === 'short') { R(-3, 2, 6, 7, hair); R(-2, 9, 4, 1, sk); }
      else { R(-3, 2, 6, 8, sk); R(-3, 7, 6, 2, U.shade(sk, -0.12)); }
    } else {
      R(-2, 3, 5, 7, sk); R(3, 6, 1, 1, sk);
      if (style === 'cap') { R(-3, 2, 6, 2, '#141c2c'); R(-3, 1, 5, 1, '#141c2c'); R(2, 3, 3, 1, '#0b0f18'); R(-3, 4, 2, 3, hair); }
      else if (style === 'long') { R(-3, 2, 5, 2, hair); R(-4, 3, 3, 8, hair); }
      else if (style === 'short') { R(-3, 2, 5, 2, hair); R(-3, 4, 2, 3, hair); }
      R(1, 6, 1, 1, '#1a1010'); R(1, 8, 1, 1, U.shade(sk, -0.35));
    }
  }

  function key(s, dir, frame) { return (s.id || s.kind) + '|' + (s.weapon || '') + '|' + dir + '|' + frame; }
  function get(s, dir, frame) {
    // dir: 0 down, 1 up, 2 right, 3 left (mirrored)
    const k = key(s, dir, frame);
    let cv = cache.get(k);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
    const c = cv.getContext('2d');
    if (dir === 3) { c.translate(SW, 0); c.scale(-1, 1); paint(c, s, 2, frame); }
    else paint(c, s, dir, frame);
    // 1px dark outline for readability
    const out = document.createElement('canvas'); out.width = SW; out.height = SH;
    const o = out.getContext('2d');
    o.globalAlpha = 0.55;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) o.drawImage(cv, dx, dy);
    o.globalCompositeOperation = 'source-in'; o.globalAlpha = 1; o.fillStyle = '#000'; o.fillRect(0, 0, SW, SH);
    o.globalCompositeOperation = 'source-over'; o.drawImage(cv, 0, 0);
    cache.set(k, out);
    return out;
  }
  function dirFromAngle(a) {
    const c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(c) > Math.abs(s) * 1.1) return c > 0 ? 2 : 3;
    return s > 0 ? 0 : 1;
  }
  // draw character with feet at (x,y) world px
  function silhouette(s, dir, frame) {
    const k = 'sil|' + key(s, dir, frame);
    let cv = cache.get(k);
    if (cv) return cv;
    const src = get(s, dir, frame);
    cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
    const c = cv.getContext('2d');
    c.drawImage(src, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#000'; c.fillRect(0, 0, SW, SH);
    cache.set(k, cv);
    return cv;
  }
  function drawChar(ctx, s, x, y, angle, frame, opts = {}) {
    const dir = opts.dir != null ? opts.dir : dirFromAngle(angle);
    const img = get(s, dir, frame);
    const sc = SCALE * (s.scale || 1);
    const w = SW * sc, h = SH * sc;
    if (opts.dead) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2 * (opts.deadSide || 1));
      ctx.drawImage(img, -w / 2, -h * 0.62, w, h); ctx.restore();
      return;
    }
    const bob = frame === 1 || frame === 3 ? -1 : 0;
    const top = y - (OY + 26) * sc + bob * sc;
    if (opts.tilt) {
      // split at the neck so only the head tilts
      const split = OY + 10;
      ctx.drawImage(img, 0, split, SW, SH - split, x - w / 2, top + split * sc, w, (SH - split) * sc);
      ctx.save(); ctx.translate(x, top + split * sc); ctx.rotate(opts.tilt);
      ctx.drawImage(img, 0, 0, SW, split, -w / 2, -split * sc, w, split * sc);
      ctx.restore();
      return;
    }
    ctx.drawImage(img, Math.round(x - w / 2), Math.round(top), w, h);
  }
  function portrait(canvas, s, opts = {}) {
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const img = get(s, 0, opts.frame || 0);
    const sc = opts.scale || Math.floor(canvas.height / 22);
    const w = SW * sc, h = SH * sc;
    c.drawImage(img, (canvas.width - w) / 2 + (opts.dx || 0), opts.dy != null ? opts.dy : -OY * sc + 4, w, h);
  }

  // ------------- props / furniture -------------
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function box(c, x, y, w, h, col, edge) {
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + 2, y + 3, w, h);
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.fillStyle = edge || U.shade(col, 0.18); c.fillRect(x, y, w, 2);
    c.fillStyle = U.shade(col, -0.3); c.fillRect(x, y + h - 2, w, 2);
  }
  const WOOD = '#6b4a2e';

  function drawObj(c, o) {
    const x = o.tx * TILE, y = o.ty * TILE, w = o.w * TILE, h = o.h * TILE;
    const horiz = w >= h;
    switch (o.type) {
      case 'bed': {
        box(c, x + 2, y + 2, w - 4, h - 4, '#4a3020');
        const blanket = o.color || '#5a2a3a';
        c.fillStyle = '#d8d2c4'; c.fillRect(x + 5, y + 5, w - 10, h - 10);
        c.fillStyle = blanket;
        const ws = o.wall;
        if (horiz) { const px = ws === 'E' ? x + w - 20 : x + 6; c.fillRect(ws === 'E' ? x + 5 : x + 22, y + 5, w - 27, h - 10); c.fillStyle = '#efe9dc'; c.fillRect(px, y + 9, 12, h - 18); }
        else { const py = ws === 'S' ? y + h - 20 : y + 6; c.fillRect(x + 5, ws === 'S' ? y + 5 : y + 22, w - 10, h - 27); c.fillStyle = '#efe9dc'; c.fillRect(x + 9, py, w - 18, 12); }
        c.fillStyle = U.shade(blanket, -0.25);
        if (horiz) c.fillRect(ws === 'E' ? x + 5 : x + 22, y + h / 2 - 1, w - 27, 2); else c.fillRect(x + w / 2 - 1, ws === 'S' ? y + 5 : y + 22, 2, h - 27);
        break;
      }
      case 'bunk': box(c, x + 2, y + 2, w - 4, h - 4, '#5a4028'); c.fillStyle = '#4a5a3a'; c.fillRect(x + 6, y + 6, w - 12, h - 12); c.fillStyle = '#5a4028'; c.fillRect(x + 2, y + h / 2 - 2, w - 4, 4); break;
      case 'closet': {
        box(c, x + 1, y + 1, w - 2, h - 2, '#4e3522');
        c.fillStyle = '#3a2618';
        if (horiz) { c.fillRect(x + w / 2 - 1, y + 3, 2, h - 6); c.fillStyle = '#b89a5a'; c.fillRect(x + w / 2 - 5, y + h / 2 - 1, 2, 3); c.fillRect(x + w / 2 + 3, y + h / 2 - 1, 2, 3); }
        else { c.fillRect(x + 3, y + h / 2 - 1, w - 6, 2); c.fillStyle = '#b89a5a'; c.fillRect(x + w / 2 - 1, y + h / 2 - 5, 3, 2); c.fillRect(x + w / 2 - 1, y + h / 2 + 3, 3, 2); }
        c.strokeStyle = '#2a1a10'; c.lineWidth = 1; c.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
        break;
      }
      case 'dresser': case 'nightstand': case 'counter': case 'cabinet': case 'footlocker': case 'workbench': case 'desk': {
        const col = o.type === 'counter' ? '#8a8072' : o.type === 'footlocker' ? '#3a4a3a' : o.type === 'workbench' ? '#5a4632' : WOOD;
        box(c, x + 2, y + 2, w - 4, h - 4, col);
        c.fillStyle = U.shade(col, -0.35);
        const n = Math.max(1, Math.round((horiz ? w : h) / 16));
        for (let i = 1; i < n; i++) { if (horiz) c.fillRect(x + 2 + (w - 4) * i / n, y + 4, 1, h - 8); else c.fillRect(x + 4, y + 2 + (h - 4) * i / n, w - 8, 1); }
        c.fillStyle = '#c8b070';
        for (let i = 0; i < n; i++) { if (horiz) c.fillRect(x + 2 + (w - 4) * (i + 0.5) / n - 2, y + h / 2, 4, 2); else c.fillRect(x + w / 2 - 1, y + 2 + (h - 4) * (i + 0.5) / n - 2, 2, 4); }
        if (o.type === 'counter') { c.fillStyle = '#a49a8a'; c.fillRect(x + 2, y + 2, w - 4, 4); }
        if (o.type === 'workbench') { c.fillStyle = '#888'; c.fillRect(x + 8, y + 8, 6, 3); c.fillStyle = '#a33'; c.fillRect(x + w - 16, y + 7, 8, 5); }
        break;
      }
      case 'bookshelf': {
        box(c, x + 1, y + 1, w - 2, h - 2, '#4a3220');
        const cols = ['#7a2a2a', '#2a4a6a', '#5a6a2a', '#8a6a3a', '#3a2a5a', '#6a3a1a'];
        for (let i = 0; i < (horiz ? w : h) / 5 - 1; i++) {
          c.fillStyle = cols[(i * 7 + o.tx) % cols.length];
          if (horiz) c.fillRect(x + 4 + i * 5, y + 5, 4, h - 10); else c.fillRect(x + 5, y + 4 + i * 5, w - 10, 4);
        }
        break;
      }
      case 'couch': {
        const col = o.color || '#5a3a4a';
        box(c, x + 1, y + 2, w - 2, h - 4, U.shade(col, -0.2));
        c.fillStyle = col;
        const ws = o.wall;
        if (horiz) { const by = ws === 'S' ? y + h - 12 : y + 4; c.fillRect(x + 6, ws === 'S' ? y + 6 : y + 13, w - 12, h - 19); c.fillStyle = U.shade(col, -0.35); c.fillRect(x + 3, by, w - 6, 8); for (let i = 1; i < 3; i++) c.fillRect(x + w * i / 3, ws === 'S' ? y + 6 : y + 13, 1, h - 19); }
        else { const bx = ws === 'E' ? x + w - 12 : x + 4; c.fillRect(ws === 'E' ? x + 6 : x + 13, y + 6, w - 19, h - 12); c.fillStyle = U.shade(col, -0.35); c.fillRect(bx, y + 3, 8, h - 6); for (let i = 1; i < 3; i++) c.fillRect(ws === 'E' ? x + 6 : x + 13, y + h * i / 3, w - 19, 1); }
        break;
      }
      case 'armchair': box(c, x + 3, y + 3, w - 6, h - 6, '#4a3a2a'); c.fillStyle = '#6a4a3a'; c.fillRect(x + 7, y + 7, w - 14, h - 14); break;
      case 'tv': {
        box(c, x + 2, y + 6, w - 4, h - 10, '#2a2420');
        c.fillStyle = '#111'; if (horiz) c.fillRect(x + 6, y + 9, w - 12, h - 18); else c.fillRect(x + 8, y + 6, w - 16, h - 12);
        break;
      }
      case 'table': case 'picnic': {
        box(c, x + 3, y + 3, w - 6, h - 6, o.type === 'picnic' ? '#6a5236' : '#5e4228');
        c.fillStyle = 'rgba(0,0,0,0.2)'; for (let i = 8; i < w - 6; i += 8) c.fillRect(x + i, y + 4, 1, h - 8);
        break;
      }
      case 'coffeetable': box(c, x + 5, y + 7, w - 10, h - 14, '#4a3020'); break;
      case 'lamp': case 'lamppost': {
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x + 17, y + 19, 9, 6, 0, 0, TAU); c.fill();
        if (o.type === 'lamppost') { c.fillStyle = '#2a2a2a'; c.fillRect(x + 14, y + 12, 4, 10); }
        c.fillStyle = o.type === 'lamppost' ? '#3a3a38' : '#c8b48a'; c.beginPath(); c.arc(x + 16, y + 16, 8, 0, TAU); c.fill();
        c.fillStyle = U.shade(o.type === 'lamppost' ? '#3a3a38' : '#c8b48a', -0.25); c.beginPath(); c.arc(x + 16, y + 16, 4, 0, TAU); c.fill();
        break;
      }
      case 'phone': {
        box(c, x + 5, y + 6, w - 10, h - 12, '#5a3a24');
        c.fillStyle = o.color || '#9a2a22'; rr(c, x + 9, y + 10, 14, 10, 2); c.fill();
        c.fillStyle = '#222'; c.fillRect(x + 10, y + 9, 12, 3);
        break;
      }
      case 'fridge': box(c, x + 2, y + 1, w - 4, h - 3, '#d8d6cc'); c.fillStyle = '#9a988e'; c.fillRect(x + 4, y + h / 2 - 1, w - 8, 1); c.fillRect(x + w - 8, y + 6, 2, 8); break;
      case 'stove': box(c, x + 2, y + 2, w - 4, h - 4, '#3a3a3a'); c.fillStyle = '#1a1a1a'; for (const [a, b] of [[9, 9], [21, 9], [9, 21], [21, 21]]) { c.beginPath(); c.arc(x + a, y + b, 4, 0, TAU); c.fill(); } break;
      case 'sink': box(c, x + 2, y + 2, w - 4, h - 4, '#8a8072'); c.fillStyle = '#c8ccd0'; rr(c, x + 7, y + 7, w - 14, h - 14, 4); c.fill(); break;
      case 'toilet': c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(x + 9, y + 6, 16, 22); c.fillStyle = '#e4e4de'; c.fillRect(x + 8, y + 4, 16, 8); c.beginPath(); c.ellipse(x + 16, y + 20, 7, 9, 0, 0, TAU); c.fill(); break;
      case 'tub': box(c, x + 2, y + 2, w - 4, h - 4, '#e4e4de'); c.fillStyle = '#b8c4cc'; rr(c, x + 6, y + 6, w - 12, h - 12, 6); c.fill(); break;
      case 'breaker': case 'generator': case 'radio': {
        const col = o.type === 'generator' ? '#b8962a' : o.type === 'radio' ? '#3a3a32' : '#7a7e82';
        box(c, x + 5, y + 4, w - 10, h - 8, col);
        c.fillStyle = '#222';
        if (o.type === 'breaker') for (let i = 0; i < 4; i++) c.fillRect(x + 9 + (i % 2) * 8, y + 9 + Math.floor(i / 2) * 7, 5, 3);
        if (o.type === 'generator') { c.fillRect(x + 9, y + 9, 14, 6); c.fillStyle = '#444'; c.fillRect(x + 8, y + 18, 16, 3); }
        if (o.type === 'radio') { c.fillStyle = '#111'; c.fillRect(x + 8, y + 8, 10, 6); c.fillStyle = '#6a6'; c.fillRect(x + 20, y + 9, 3, 3); c.fillStyle = '#555'; c.fillRect(x + 24, y + 4, 1, 10); }
        break;
      }
      case 'phonebox': {
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 10, y + 10, 14, 16);
        c.fillStyle = '#3d5a3a'; c.fillRect(x + 8, y + 7, 14, 16); c.fillStyle = '#5a7a56'; c.fillRect(x + 8, y + 7, 14, 2);
        c.fillStyle = '#1a1a1a'; c.fillRect(x + 14, y + 2, 2, 6);
        break;
      }
      case 'transformer': {
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 18, y + 20, 10, 6, 0, 0, TAU); c.fill();
        c.fillStyle = '#4a3a2a'; c.beginPath(); c.arc(x + 16, y + 16, 6, 0, TAU); c.fill();
        c.fillStyle = '#6a6e72'; c.fillRect(x + 6, y + 4, 20, 10); c.fillStyle = '#8a8e92'; c.fillRect(x + 6, y + 4, 20, 2);
        c.fillStyle = '#d0b020'; c.fillRect(x + 14, y + 8, 4, 3);
        break;
      }
      case 'streetlight': {
        c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(x + 17, y + 18, 7, 5, 0, 0, TAU); c.fill();
        c.fillStyle = '#2d2d2f'; c.beginPath(); c.arc(x + 16, y + 16, 5, 0, TAU); c.fill();
        c.fillStyle = '#444'; c.beginPath(); c.arc(x + 16, y + 16, 2.5, 0, TAU); c.fill();
        break;
      }
      case 'gravestone': {
        c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 9, y + 12, 18, 14);
        c.fillStyle = '#6e6e6a'; rr(c, x + 7, y + 6, 18, 18, 7); c.fill(); c.fillRect(x + 7, y + 16, 18, 8);
        c.fillStyle = '#8a8a84'; c.fillRect(x + 8, y + 7, 16, 2);
        c.fillStyle = '#4a4a46'; c.fillRect(x + 15, y + 10, 2, 9); c.fillRect(x + 12, y + 13, 8, 2);
        c.fillStyle = '#3a3a30'; c.fillRect(x + 6, y + 25, 20, 4);
        break;
      }
      case 'bush': {
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 18, y + 20, 14, 10, 0, 0, TAU); c.fill();
        const g = ['#1c3a1c', '#244a22', '#2e5a2a'];
        for (let i = 0; i < 3; i++) { c.fillStyle = g[i]; c.beginPath(); c.arc(x + 16 + (i - 1) * 3, y + 16 - i * 2, 12 - i * 3, 0, TAU); c.fill(); }
        break;
      }
      case 'trash': c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 18, y + 19, 10, 7, 0, 0, TAU); c.fill(); c.fillStyle = '#5a5e5a'; c.beginPath(); c.arc(x + 16, y + 16, 10, 0, TAU); c.fill(); c.fillStyle = '#7a7e7a'; c.beginPath(); c.arc(x + 16, y + 16, 7, 0, TAU); c.fill(); c.fillStyle = '#3a3e3a'; c.fillRect(x + 12, y + 15, 8, 2); break;
      case 'mailbox': c.fillStyle = '#3a2a1a'; c.fillRect(x + 15, y + 14, 3, 12); c.fillStyle = '#2a2a3a'; rr(c, x + 9, y + 7, 14, 9, 3); c.fill(); c.fillStyle = '#b22'; c.fillRect(x + 21, y + 5, 2, 5); break;
      case 'pumpkin': break; // dynamic
      case 'candybowl': c.fillStyle = '#6a2a8a'; c.beginPath(); c.ellipse(x + 16, y + 17, 9, 7, 0, 0, TAU); c.fill(); for (let i = 0; i < 6; i++) { c.fillStyle = U.pick(['#e83', '#ec2', '#e44', '#5c5', '#fff']); c.fillRect(x + 10 + (i * 5) % 12, y + 13 + (i * 3) % 6, 3, 2); } break;
      case 'canoe': c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + w / 2 + 2, y + h / 2 + 3, w / 2 - 2, h / 2 - 6, 0, 0, TAU); c.fill(); c.fillStyle = '#8a3a1a'; c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 8, 0, 0, TAU); c.fill(); c.fillStyle = '#5a2a10'; c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2 - 6, h / 2 - 11, 0, 0, TAU); c.fill(); break;
      case 'log': c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(x + 4, y + 12, w - 6, 14); c.fillStyle = '#5a3a20'; rr(c, x + 2, y + 8, w - 4, 14, 6); c.fill(); c.fillStyle = '#7a5a3a'; c.beginPath(); c.arc(x + w - 8, y + 15, 6, 0, TAU); c.fill(); break;
      case 'campfire': c.fillStyle = '#4a4a46'; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.beginPath(); c.arc(x + 16 + Math.cos(a) * 11, y + 16 + Math.sin(a) * 11, 4, 0, TAU); c.fill(); } c.fillStyle = '#2a1a10'; c.fillRect(x + 8, y + 14, 16, 4); c.fillRect(x + 14, y + 8, 4, 16); break;
      case 'haybale': box(c, x + 2, y + 4, w - 4, h - 8, '#b8962a'); c.fillStyle = '#8a6e1a'; for (let i = 6; i < w - 4; i += 6) c.fillRect(x + i, y + 6, 1, h - 12); break;
      case 'crate': box(c, x + 3, y + 3, w - 6, h - 6, '#7a5a32'); c.strokeStyle = '#4a3a1a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 4, y + 4); c.lineTo(x + w - 4, y + h - 4); c.moveTo(x + w - 4, y + 4); c.lineTo(x + 4, y + h - 4); c.stroke(); break;
      case 'rug': {
        const col = o.color || '#5a1e1e';
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 2, y + 3, w, h);
        c.fillStyle = col; c.fillRect(x, y, w, h);
        c.strokeStyle = U.shade(col, 0.25); c.lineWidth = 2; c.strokeRect(x + 4, y + 4, w - 8, h - 8);
        c.strokeStyle = U.shade(col, -0.3); c.lineWidth = 1; c.strokeRect(x + 8.5, y + 8.5, w - 17, h - 17);
        c.fillStyle = U.shade(col, 0.15);
        for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(x + w / 2, y + 12 + i * (h - 24) / 3); c.lineTo(x + w / 2 + 6, y + 18 + i * (h - 24) / 3); c.lineTo(x + w / 2, y + 24 + i * (h - 24) / 3); c.lineTo(x + w / 2 - 6, y + 18 + i * (h - 24) / 3); c.fill(); }
        c.fillStyle = '#c8b898'; for (let i = 2; i < w; i += 4) { c.fillRect(x + i, y - 2, 1, 2); c.fillRect(x + i, y + h, 1, 2); }
        break;
      }
      case 'cobweb': {
        const cx = o.corner[0] ? x + TILE : x, cy = o.corner[1] ? y + TILE : y;
        const sx = o.corner[0] ? -1 : 1, sy = o.corner[1] ? -1 : 1;
        c.strokeStyle = 'rgba(210,210,220,0.28)'; c.lineWidth = 0.7;
        c.beginPath();
        for (let i = 0; i < 5; i++) { const a = i / 4 * Math.PI / 2; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * 26 * sx, cy + Math.sin(a) * 26 * sy); }
        for (let r = 7; r < 27; r += 6) { c.moveTo(cx + r * sx, cy); for (let i = 1; i <= 4; i++) { const a = i / 4 * Math.PI / 2; c.lineTo(cx + Math.cos(a) * r * sx * 0.92, cy + Math.sin(a) * r * sy * 0.92); } }
        c.stroke();
        break;
      }
      case 'puddle': {
        c.fillStyle = 'rgba(8,12,20,0.55)'; c.beginPath(); c.ellipse(x + 16, y + 16, 14 + o.s * 6, 8 + o.s * 3, o.s, 0, TAU); c.fill();
        c.fillStyle = 'rgba(150,170,210,0.18)'; c.beginPath(); c.ellipse(x + 12, y + 13, 6, 1.5, o.s, 0, TAU); c.fill();
        break;
      }
      case 'leafpile': {
        for (let i = 0; i < 26; i++) { c.fillStyle = ['#6a2a0a', '#8a4012', '#4a1e08', '#9a5a1a'][i % 4]; c.fillRect(x + 4 + U.hash2(o.tx * 9 + i, o.ty) * 24, y + 6 + U.hash2(o.ty + i, o.tx * 5) * 20, 4, 3); }
        break;
      }
      case 'manhole': c.fillStyle = '#18181a'; c.beginPath(); c.arc(x + 16, y + 16, 11, 0, TAU); c.fill(); c.strokeStyle = '#2e2e32'; c.lineWidth = 1; for (let r = 4; r < 11; r += 3) { c.beginPath(); c.arc(x + 16, y + 16, r, 0, TAU); c.stroke(); } break;
      case 'crack': { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); let px = x + 4, py = y + U.hash2(o.tx, o.ty) * 28; c.moveTo(px, py); for (let i = 0; i < 6; i++) { px += 5; py += U.rf(-5, 5); c.lineTo(px, py); } c.stroke(); break; }
      case 'fakegrave': {
        c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 10, y + 14, 16, 12);
        c.fillStyle = '#58585a'; rr(c, x + 8, y + 8, 16, 16, 6); c.fill(); c.fillRect(x + 8, y + 16, 16, 8);
        c.fillStyle = '#6e6e70'; c.fillRect(x + 9, y + 9, 14, 2);
        c.fillStyle = '#2a2a2c'; c.font = '6px monospace'; c.fillText('RIP', x + 10, y + 19);
        c.fillStyle = '#2a2018'; c.fillRect(x + 6, y + 24, 20, 3);
        break;
      }
      case 'skeleton': {
        c.save(); c.translate(x + 16, y + 16); c.rotate(o.rot || 0);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-4, -10, 10, 24);
        c.fillStyle = '#d8d4c4';
        c.beginPath(); c.arc(0, -11, 4.5, 0, TAU); c.fill();
        c.fillStyle = '#111'; c.fillRect(-2.5, -12, 2, 2); c.fillRect(0.5, -12, 2, 2); c.fillRect(-1, -9, 2, 1);
        c.fillStyle = '#d8d4c4'; c.fillRect(-0.5, -6, 1, 12);
        for (let i = 0; i < 4; i++) c.fillRect(-4, -5 + i * 2.5, 8, 1);
        c.fillRect(-7, -5, 3, 1); c.fillRect(4, -5, 3, 1); c.fillRect(-8, -5, 1, 8); c.fillRect(7, -5, 1, 8);
        c.fillRect(-3, 6, 1, 9); c.fillRect(2, 6, 1, 9); c.fillRect(-4, 5, 8, 2);
        c.restore();
        break;
      }
      case 'scarecrow': {
        c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(x + 18, y + 26, 12, 5, 0, 0, TAU); c.fill();
        c.fillStyle = '#4a3020'; c.fillRect(x + 15, y + 6, 3, 22); c.fillRect(x + 3, y + 12, 26, 3);
        c.fillStyle = '#6a4a2a'; c.fillRect(x + 10, y + 12, 13, 10);
        c.fillStyle = '#b89a3a'; c.fillRect(x + 3, y + 11, 3, 5); c.fillRect(x + 26, y + 11, 3, 5);
        c.fillStyle = '#c8a860'; c.beginPath(); c.arc(x + 16.5, y + 7, 5, 0, TAU); c.fill();
        c.fillStyle = '#111'; c.fillRect(x + 14, y + 6, 1.5, 1.5); c.fillRect(x + 18, y + 6, 1.5, 1.5); c.fillRect(x + 14, y + 9, 5, 1);
        c.fillStyle = '#2a1a10'; c.beginPath(); c.moveTo(x + 9, y + 4); c.lineTo(x + 24, y + 4); c.lineTo(x + 16.5, y - 4); c.fill();
        break;
      }
      default: box(c, x + 4, y + 4, w - 8, h - 8, '#555');
    }
  }
  // ------------- close-up faces (jump scares / death) -------------
  function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }
  function face(c, id, cx, cy, s, t = 0) {
    c.save(); c.translate(cx, cy);
    if (id === 'myers') {
      // hair
      c.fillStyle = '#0e0905'; ell(c, 0, -s * 0.12, s * 0.6, s * 0.62); c.fill();
      for (let i = 0; i < 14; i++) { const a = -Math.PI + i / 13 * Math.PI; c.fillStyle = i % 2 ? '#1a120a' : '#0a0604'; ell(c, Math.cos(a) * s * 0.5, -s * 0.12 + Math.sin(a) * s * 0.55, s * 0.12, s * 0.2, a); c.fill(); }
      // the mask
      const gr = c.createRadialGradient(-s * 0.08, -s * 0.18, s * 0.02, 0, s * 0.05, s * 0.6);
      gr.addColorStop(0, '#f6f3e8'); gr.addColorStop(0.55, '#cfc8b4'); gr.addColorStop(1, '#4a4436');
      c.fillStyle = gr; ell(c, 0, s * 0.06, s * 0.42, s * 0.56); c.fill();
      // hair falling over the brow
      c.fillStyle = '#0e0905';
      c.save(); ell(c, 0, -s * 0.12, s * 0.6, s * 0.62); c.clip();
      c.beginPath(); c.moveTo(-s * 0.44, -s * 0.2); c.quadraticCurveTo(-s * 0.2, -s * 0.42, s * 0.05, -s * 0.3); c.quadraticCurveTo(s * 0.25, -s * 0.44, s * 0.44, -s * 0.18); c.lineTo(s * 0.7, -s * 0.8); c.lineTo(-s * 0.7, -s * 0.8); c.fill();
      c.restore();
      // sunken sockets
      for (const sx of [-1, 1]) {
        const eg = c.createRadialGradient(sx * s * 0.16, -s * 0.03, 0, sx * s * 0.16, -s * 0.03, s * 0.16);
        eg.addColorStop(0, 'rgba(0,0,0,1)'); eg.addColorStop(0.45, 'rgba(0,0,0,0.95)'); eg.addColorStop(1, 'rgba(40,34,26,0)');
        c.fillStyle = eg; ell(c, sx * s * 0.16, -s * 0.03, s * 0.16, s * 0.12); c.fill();
      }
      // nose ridge + nostrils
      c.fillStyle = 'rgba(80,72,58,0.45)'; c.beginPath(); c.moveTo(-s * 0.02, -s * 0.02); c.lineTo(-s * 0.07, s * 0.17); c.lineTo(s * 0.04, s * 0.18); c.fill();
      c.fillStyle = 'rgba(40,34,26,0.7)'; ell(c, -s * 0.04, s * 0.19, s * 0.025, s * 0.012); c.fill(); ell(c, s * 0.04, s * 0.19, s * 0.025, s * 0.012); c.fill();
      // the flat mouth
      c.strokeStyle = 'rgba(30,24,18,0.85)'; c.lineWidth = s * 0.012; c.beginPath(); c.moveTo(-s * 0.1, s * 0.33); c.quadraticCurveTo(0, s * 0.35, s * 0.1, s * 0.33); c.stroke();
      c.fillStyle = 'rgba(60,52,40,0.12)'; ell(c, 0, s * 0.47, s * 0.16, s * 0.05); c.fill();
    } else if (id === 'jason') {
      c.fillStyle = '#2a1e14'; ell(c, 0, 0, s * 0.58, s * 0.62); c.fill();
      const gr = c.createRadialGradient(-s * 0.1, -s * 0.2, s * 0.02, 0, 0, s * 0.6);
      gr.addColorStop(0, '#f0ead6'); gr.addColorStop(0.6, '#cdc5a8'); gr.addColorStop(1, '#5a5440');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(-s * 0.38, -s * 0.3); c.quadraticCurveTo(0, -s * 0.62, s * 0.38, -s * 0.3); c.quadraticCurveTo(s * 0.46, s * 0.2, s * 0.2, s * 0.52); c.quadraticCurveTo(0, s * 0.62, -s * 0.2, s * 0.52); c.quadraticCurveTo(-s * 0.46, s * 0.2, -s * 0.38, -s * 0.3); c.fill();
      // red chevrons
      c.fillStyle = '#a81616';
      const chev = (x, y, w, h, flip) => { c.beginPath(); c.moveTo(x - w, y); c.lineTo(x, y + h * (flip ? -1 : 1)); c.lineTo(x + w, y); c.lineTo(x + w * 0.6, y); c.lineTo(x, y + h * 0.5 * (flip ? -1 : 1)); c.lineTo(x - w * 0.6, y); c.fill(); };
      chev(0, -s * 0.38, s * 0.12, s * 0.12); chev(-s * 0.27, s * 0.06, s * 0.07, s * 0.14, true); chev(s * 0.27, s * 0.06, s * 0.07, s * 0.14, true);
      c.fillRect(-s * 0.03, -s * 0.5, s * 0.06, s * 0.1);
      // eye holes
      for (const sx of [-1, 1]) {
        c.fillStyle = '#000'; ell(c, sx * s * 0.16, -s * 0.08, s * 0.09, s * 0.07, sx * 0.2); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, sx * s * 0.16, -s * 0.06, s * 0.13, s * 0.1); c.fill();
      }
      // breathing holes
      c.fillStyle = '#16100a';
      for (let row = 0; row < 4; row++) for (let i = -3; i <= 3; i++) {
        const x = i * s * 0.07 + (row % 2) * s * 0.035, y = s * (0.12 + row * 0.09);
        if (Math.abs(x) > s * (0.32 - row * 0.05)) continue;
        ell(c, x, y, s * 0.014, s * 0.014); c.fill();
      }
      c.fillStyle = '#16100a'; for (let i = 0; i < 6; i++) { ell(c, -s * 0.22 + i * s * 0.088, -s * 0.24, s * 0.012, s * 0.012); c.fill(); }
      // strap
      c.fillStyle = '#1a120a'; c.fillRect(-s * 0.6, -s * 0.1, s * 0.2, s * 0.05); c.fillRect(s * 0.4, -s * 0.1, s * 0.2, s * 0.05);
    } else {
      // Ghostface
      c.fillStyle = '#050507';
      c.beginPath(); c.moveTo(-s * 0.62, s * 0.9); c.quadraticCurveTo(-s * 0.7, -s * 0.5, 0, -s * 0.78); c.quadraticCurveTo(s * 0.7, -s * 0.5, s * 0.62, s * 0.9); c.fill();
      c.fillStyle = '#121218'; c.beginPath(); c.moveTo(-s * 0.48, s * 0.9); c.quadraticCurveTo(-s * 0.52, -s * 0.35, 0, -s * 0.6); c.quadraticCurveTo(s * 0.52, -s * 0.35, s * 0.48, s * 0.9); c.fill();
      const gr = c.createRadialGradient(-s * 0.08, -s * 0.2, s * 0.02, 0, 0, s * 0.6);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#d8d8d4'); gr.addColorStop(1, '#6a6a68');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(0, -s * 0.5); c.bezierCurveTo(s * 0.42, -s * 0.5, s * 0.4, s * 0.2, s * 0.22, s * 0.55); c.quadraticCurveTo(0, s * 0.72, -s * 0.22, s * 0.55); c.bezierCurveTo(-s * 0.4, s * 0.2, -s * 0.42, -s * 0.5, 0, -s * 0.5); c.fill();
      // drooping eyes
      for (const sx of [-1, 1]) {
        c.fillStyle = '#000';
        c.beginPath(); c.moveTo(sx * s * 0.06, -s * 0.22); c.quadraticCurveTo(sx * s * 0.26, -s * 0.3, sx * s * 0.25, -s * 0.12); c.quadraticCurveTo(sx * s * 0.22, s * 0.06, sx * s * 0.13, s * 0.02); c.quadraticCurveTo(sx * s * 0.04, -s * 0.06, sx * s * 0.06, -s * 0.22); c.fill();
      }
      // the scream
      c.fillStyle = '#000';
      c.beginPath(); c.moveTo(0, s * 0.12); c.bezierCurveTo(s * 0.11, s * 0.12, s * 0.1, s * 0.48, 0, s * 0.52); c.bezierCurveTo(-s * 0.1, s * 0.48, -s * 0.11, s * 0.12, 0, s * 0.12); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)'; ell(c, -s * 0.01, s * 0.06, s * 0.04, s * 0.02); c.fill();
    }
    c.restore();
  }

  // decorations hung in the trees (upper layer)
  function hangingGhost(c, cx, cy) {
    c.strokeStyle = 'rgba(20,20,20,0.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx, cy - 18); c.lineTo(cx, cy - 8); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(cx + 5, cy + 10, 8, 10, 0, 0, TAU); c.fill();
    c.fillStyle = '#e8e6e0';
    c.beginPath(); c.arc(cx, cy - 2, 7, Math.PI, 0); c.lineTo(cx + 9, cy + 14);
    for (let i = 0; i < 4; i++) c.lineTo(cx + 9 - (i + 0.5) * 4.5, cy + 10 + (i % 2) * 5);
    c.lineTo(cx - 9, cy + 14); c.closePath(); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.ellipse(cx - 3, cy - 1, 1.6, 2.6, 0, 0, TAU); c.ellipse(cx + 3, cy - 1, 1.6, 2.6, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(cx, cy + 5, 2, 3, 0, 0, TAU); c.fill();
  }
  function toiletPaper(c, cx, cy, r, seed) {
    c.strokeStyle = 'rgba(232,230,224,0.75)'; c.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const a0 = seed * 7 + i * 1.6;
      c.beginPath(); c.moveTo(cx + Math.cos(a0) * r * 0.8, cy + Math.sin(a0) * r * 0.8);
      c.bezierCurveTo(cx + Math.cos(a0 + 0.8) * r * 0.3, cy + r * 0.6, cx + Math.cos(a0 + 1.6) * r * 0.9, cy + r * 0.2, cx + Math.cos(a0 + 2) * r * 0.85, cy + r * 1.2);
      c.stroke();
    }
  }

  // ------------- vehicles (top-down) -------------
  function drawCar(c, x, y, len, wid, ang, o = {}) {
    c.save(); c.translate(x, y); c.rotate(ang);
    const L = len, W = wid;
    c.fillStyle = 'rgba(0,0,0,0.45)'; rr(c, -L / 2 + 3, -W / 2 + 4, L, W, 8); c.fill();
    const body = o.color || '#6a2a22';
    c.fillStyle = body; rr(c, -L / 2, -W / 2, L, W, 9); c.fill();
    c.fillStyle = U.shade(body, 0.15); c.fillRect(-L / 2 + 6, -W / 2 + 2, L - 12, 3);
    c.fillStyle = U.shade(body, -0.3); c.fillRect(-L / 2 + 6, W / 2 - 5, L - 12, 3);
    // cabin
    c.fillStyle = o.police ? '#e8e8e8' : U.shade(body, -0.15); rr(c, -L * 0.22, -W / 2 + 4, L * 0.48, W - 8, 5); c.fill();
    c.fillStyle = '#1a2430'; rr(c, L * 0.12, -W / 2 + 5, L * 0.13, W - 10, 3); c.fill(); // windshield
    c.fillStyle = '#16202a'; rr(c, -L * 0.24, -W / 2 + 6, L * 0.08, W - 12, 2); c.fill(); // rear
    if (o.police) {
      c.fillStyle = '#111'; c.fillRect(-L / 2, -W / 2, L * 0.24, W); c.fillRect(L * 0.3, -W / 2, L * 0.2, W);
      const ph = o.flash || 0;
      c.fillStyle = ph ? '#ff2a2a' : '#5a0a0a'; c.fillRect(-4, -W / 2 + 4, 6, W / 2 - 4);
      c.fillStyle = ph ? '#2a2a5a' : '#2a5aff'; c.fillRect(-4, 0, 6, W / 2 - 4);
    }
    // lights
    c.fillStyle = o.lightsOn ? '#fff6c8' : '#bdb59a'; c.fillRect(L / 2 - 3, -W / 2 + 3, 3, 6); c.fillRect(L / 2 - 3, W / 2 - 9, 3, 6);
    c.fillStyle = '#8a1010'; c.fillRect(-L / 2, -W / 2 + 3, 2, 6); c.fillRect(-L / 2, W / 2 - 9, 2, 6);
    if (o.sabotaged) { c.fillStyle = '#111'; c.fillRect(-L / 2 + 8, -W / 2 - 2, 10, 3); c.fillRect(L / 2 - 18, W / 2 - 1, 10, 3); }
    c.restore();
  }

  // ------------- tree canopy -------------
  function canopy(c, cx, cy, r, pal, seed) {
    const p = pal || ['#0e1a10', '#152616', '#1d321c', '#26401f'];
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(cx + 6, cy + 8, r, 0, TAU); c.fill();
    for (let i = 0; i < 4; i++) {
      c.fillStyle = p[i];
      const k = 5 + i;
      c.beginPath();
      for (let j = 0; j < k; j++) {
        const a = j / k * TAU + seed * 3 + i;
        const rr2 = r * (1 - i * 0.18) * (0.55 + 0.25 * U.hash2(seed * 100 + j, i));
        c.moveTo(cx - i * 2 + Math.cos(a) * r * 0.25, cy - i * 2 + Math.sin(a) * r * 0.25);
        c.arc(cx - i * 2 + Math.cos(a) * r * 0.32 * (1 - i * 0.2), cy - i * 2 + Math.sin(a) * r * 0.32 * (1 - i * 0.2), rr2, 0, TAU);
      }
      c.fill();
    }
    // moonlit leaf speckles on the upper-left, dark clusters lower-right
    for (let i = 0; i < 26; i++) {
      const a = U.hash2(seed * 999 + i, 3) * TAU, d = Math.sqrt(U.hash2(i, seed * 777)) * r * 0.85;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const lit = (px - cx) + (py - cy) < 0;
      c.fillStyle = lit ? U.shade(p[3], 0.25) : U.shade(p[0], -0.3);
      c.fillRect(px, py, 2, 2);
    }
  }

  // ------------- item icons -------------
  const iconCache = {};
  function icon(id) {
    if (iconCache[id]) return iconCache[id];
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    const c = cv.getContext('2d');
    const P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    switch (id) {
      case 'battery': P(10, 6, 12, 22, '#222'); P(10, 6, 12, 8, '#d8a020'); P(13, 3, 6, 3, '#aaa'); P(11, 7, 2, 18, 'rgba(255,255,255,.25)'); break;
      case 'bandage': P(6, 9, 20, 14, '#e8e2d4'); P(14, 11, 4, 10, '#c22'); P(11, 14, 10, 4, '#c22'); P(6, 9, 20, 2, '#fff'); break;
      case 'candy': P(10, 11, 12, 10, '#e8701a'); P(4, 12, 6, 8, '#d85a10'); P(22, 12, 6, 8, '#d85a10'); P(12, 13, 8, 2, '#f8a050'); P(13, 16, 6, 2, '#222'); break;
      case 'flare': c.save(); c.translate(16, 16); c.rotate(-0.7); P(-3, -12, 6, 22, '#c41818'); P(-3, -12, 6, 3, '#eee'); P(-1, -16, 2, 4, '#ffd060'); c.restore(); break;
      case 'knife': c.save(); c.translate(16, 16); c.rotate(-0.78); P(-2, -14, 4, 17, '#d8dce0'); P(0, -14, 2, 17, '#9aa0a6'); P(-3, 3, 6, 9, '#3a2414'); P(-2, 5, 1, 1, '#c8b070'); P(-2, 8, 1, 1, '#c8b070'); c.restore(); break;
      case 'bat': c.save(); c.translate(16, 16); c.rotate(-0.78); P(-4, -15, 8, 18, '#b88a5a'); P(-3, 3, 6, 10, '#9a6e40'); P(-3, 10, 6, 3, '#222'); P(-4, 13, 8, 2, '#6a4a2a'); c.restore(); break;
      case 'keys': c.strokeStyle = '#d8c060'; c.lineWidth = 3; c.beginPath(); c.arc(11, 11, 6, 0, TAU); c.stroke(); P(15, 14, 12, 4, '#c8c8c8'); P(22, 18, 2, 4, '#c8c8c8'); P(25, 18, 2, 3, '#c8c8c8'); P(4, 20, 8, 6, '#222'); break;
      case 'fuse': P(9, 10, 14, 12, 'rgba(180,220,255,.5)'); P(6, 10, 4, 12, '#bbb'); P(22, 10, 4, 12, '#bbb'); P(10, 15, 12, 2, '#d8a050'); break;
      case 'toolkit': P(5, 11, 22, 15, '#b82a22'); P(5, 11, 22, 3, '#d84a3a'); P(12, 6, 8, 2, '#333'); P(11, 6, 2, 6, '#333'); P(19, 6, 2, 6, '#333'); P(14, 17, 4, 3, '#ddd'); break;
      case 'cellphone': P(10, 4, 12, 24, '#2a2a2e'); P(12, 6, 8, 8, '#6a9a6a'); for (let i = 0; i < 9; i++) P(12 + (i % 3) * 3, 16 + Math.floor(i / 3) * 3, 2, 2, '#888'); P(19, 1, 2, 4, '#2a2a2e'); break;
      default: P(8, 8, 16, 16, '#888');
    }
    iconCache[id] = cv;
    return cv;
  }

  return { SPECS, SKINS, randomSpec, get, silhouette, drawChar, portrait, drawObj, drawCar, canopy, icon, dirFromAngle, rr, SCALE, SW, SH, CX, OY, hangingGhost, toiletPaper, face };
})();
