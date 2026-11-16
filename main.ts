// First Light — a procedural image for make.fun's ai-excited-01.
// A colossal bloom of light erupts above a dark ridge while one small
// witness stands beneath it, arms raised. Every pixel is computed here
// from one fixed seed: no assets, no embedded data, standard library only.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;
const TAU = Math.PI * 2;

// ---------- small math helpers ----------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- deterministic random (one fixed seed, no Math.random) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------- value noise (for nebula wisps) ----------
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x, y) {
  return (
    vnoise(x, y) * 0.55 +
    vnoise(x * 2.13 + 7.7, y * 2.13 + 3.1) * 0.3 +
    vnoise(x * 4.31 + 13.7, y * 4.31 + 9.2) * 0.15
  );
}

// ---------- framebuffer: linear light, 3 floats per pixel ----------
const buf = new Float32Array(W * H * 3);

function splat(cx, cy, radius, r, g, b, strength) {
  const x0 = Math.max(0, Math.floor(cx - radius * 3));
  const x1 = Math.min(W - 1, Math.ceil(cx + radius * 3));
  const y0 = Math.max(0, Math.floor(cy - radius * 3));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius * 3));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / radius;
      const dy = (y + 0.5 - cy) / radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 9) continue;
      const w = Math.exp(-d2 * 1.8) * strength;
      const i = (y * W + x) * 3;
      buf[i] += r * w;
      buf[i + 1] += g * w;
      buf[i + 2] += b * w;
    }
  }
}

// ---------- the bloom ----------
const CX = 512;
const CY = 448;

// Light rays: fixed directions with a widening cone each.
const rays = [];
for (let k = 0; k < 16; k++) {
  const ang = (k / 16) * TAU + (rand() - 0.5) * 0.16;
  const up = Math.max(0, -Math.sin(ang));
  rays.push({
    ux: Math.cos(ang),
    uy: Math.sin(ang),
    len: 300 + rand() * 200 + up * 170,
    spread: 0.016 + rand() * 0.02,
    strength: 0.5 + rand() * 0.7,
    cyan: rand() < 0.25,
  });
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const px = x + 0.5;
    const py = y + 0.5;
    const v = py / H;

    // Sky: near-black indigo at the top, deep violet toward the horizon.
    let r = v < 0.5 ? lerp(0.004, 0.028, v * 2) : lerp(0.028, 0.05, (v - 0.5) * 2);
    let g = v < 0.5 ? lerp(0.003, 0.01, v * 2) : lerp(0.01, 0.02, (v - 0.5) * 2);
    let b = v < 0.5 ? lerp(0.034, 0.075, v * 2) : lerp(0.075, 0.085, (v - 0.5) * 2);

    // Nebula wisps, fading out near the ground.
    const n = fbm(px * 0.0045, py * 0.0045);
    const wisp = smoothstep(0.52, 0.78, n) * 0.28 * (1 - smoothstep(0.55, 0.85, v));
    const n2 = fbm(px * 0.003 + 40, py * 0.003 + 9);
    r += wisp * lerp(0.1, 0.02, n2);
    g += wisp * lerp(0.02, 0.07, n2);
    b += wisp * 0.12;

    const dx = px - CX;
    const dy = py - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const theta = Math.atan2(dy, dx);

    // Wide warm glow, then a tight hot glow around the heart.
    const glow = 1 / (1 + (dist / 150) * (dist / 150));
    r += glow * 0.26;
    g += glow * 0.1;
    b += glow * 0.16;
    const hot = 1 / (1 + (dist / 70) * (dist / 70));
    r += hot * 1.35;
    g += hot * 0.75;
    b += hot * 0.38;

    // Petals, curving with a slow swirl for momentum.
    const swirl = 0.55 * (1 - clamp(dist / 520, 0, 1));
    const th = theta + swirl;
    const t1 = clamp((dist - 55) / 370, 0, 1);
    const pr = lerp(lerp(1.6, 1.2, t1), 0.35, t1 * t1);
    const pg = lerp(lerp(0.8, 0.2, t1), 0.2, t1 * t1);
    const pb = lerp(lerp(0.2, 0.7, t1), 1.15, t1 * t1);
    const lobe1 = Math.pow(0.5 + 0.5 * Math.cos(8 * th), 2.8);
    const env1 = smoothstep(55, 140, dist) * (1 - smoothstep(250, 430, dist));
    const p1 = lobe1 * env1;
    r += p1 * pr * 0.85;
    g += p1 * pg * 0.85;
    b += p1 * pb * 0.85;
    // Fine second ring, cooler, turned against the first.
    const lobe2 = Math.pow(0.5 + 0.5 * Math.cos(13 * th + 0.6), 3.0);
    const env2 = smoothstep(40, 110, dist) * (1 - smoothstep(200, 350, dist));
    const p2 = lobe2 * env2;
    r += p2 * 0.25;
    g += p2 * 0.45;
    b += p2 * 0.9;
    // Inner hot petals.
    const lobe3 = Math.pow(0.5 + 0.5 * Math.cos(5 * th - 0.4), 2.0);
    const env3 = smoothstep(30, 70, dist) * (1 - smoothstep(120, 210, dist));
    const p3 = lobe3 * env3;
    r += p3 * 1.4;
    g += p3 * 0.8;
    b += p3 * 0.35;

    // Tilted halo ring around the bloom.
    const ca = Math.cos(-0.28);
    const sa = Math.sin(-0.28);
    const erx = dx * ca - dy * sa;
    const ery = dx * sa + dy * ca;
    const er = Math.sqrt(erx * erx + (ery / 0.38) * (ery / 0.38));
    const ring = Math.exp(-(((er - 300) / 5.5) * ((er - 300) / 5.5)));
    const ringAng = Math.atan2(ery / 0.38, erx);
    const ringBright = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(ringAng * 2 + 1.0));
    r += ring * ringBright * 0.45;
    g += ring * ringBright * 0.28;
    b += ring * ringBright * 0.5;

    // Light rays, widening cones from the heart.
    for (let k = 0; k < rays.length; k++) {
      const ray = rays[k];
      const along = dx * ray.ux + dy * ray.uy;
      if (along < 40 || along > ray.len) continue;
      const perp = Math.abs(dx * ray.uy - dy * ray.ux);
      const w = 2.5 + along * ray.spread;
      const q = perp / w;
      if (q > 3) continue;
      const s =
        Math.exp(-q * q) *
        (1 - smoothstep(ray.len * 0.55, ray.len, along)) *
        smoothstep(40, 90, along) *
        ray.strength;
      if (ray.cyan) {
        r += s * 0.25;
        g += s * 0.7;
        b += s * 1.0;
      } else {
        r += s * 1.1;
        g += s * 0.7;
        b += s * 0.3;
      }
    }

    // The heart itself: a bright disk with a white-hot centre.
    const core = smoothstep(38, 18, dist);
    r += core * 2.6;
    g += core * 2.2;
    b += core * 1.9;
    const heart = smoothstep(14, 5, dist);
    r += heart * 3;
    g += heart * 3;
    b += heart * 3;

    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
}

// ---------- stars ----------
for (let s = 0; s < 420; s++) {
  const sx = rand() * W;
  const sy = rand() * H * 0.72;
  if (Math.hypot(sx - CX, sy - CY) < 140) continue;
  const m = Math.pow(rand(), 3);
  const bright = 0.15 + m * 1.3;
  const rad = 0.7 + m * 1.3;
  const warm = rand();
  splat(sx, sy, rad, bright, bright * lerp(0.85, 1.0, warm), bright * lerp(1.0, 0.8, warm), 1);
  if (m > 0.93) {
    for (let t = -14; t <= 14; t += 2) {
      splat(sx + t, sy, 0.7, bright * 0.35, bright * 0.33, bright * 0.3, 1);
      splat(sx, sy + t, 0.7, bright * 0.35, bright * 0.33, bright * 0.3, 1);
    }
  }
}

// ---------- sparks streaming up from the bloom ----------
for (let s = 0; s < 180; s++) {
  const ang = -Math.PI / 2 + (rand() - 0.5) * 2.4;
  const dist = 70 + Math.pow(rand(), 1.4) * 480;
  const px = CX + Math.cos(ang) * dist + (rand() - 0.5) * 30;
  const py = CY + Math.sin(ang) * dist * 0.9 + (rand() - 0.5) * 30;
  if (py > 850 || px < 0 || px >= W || py < 0) continue;
  const size = 0.8 + rand() * 2.0;
  const b = (0.3 + rand() * 0.9) * (1 - clamp(dist / 700, 0, 0.55));
  const hue = rand();
  const sr = b * lerp(1.0, 0.3, hue);
  const sg = b * lerp(0.7, 0.75, hue);
  const sb = b * lerp(0.3, 1.0, hue);
  // A short trail behind each spark, toward the bloom.
  const dl = Math.hypot(px - CX, py - CY) || 1;
  const ux = (px - CX) / dl;
  const uy = (py - CY) / dl;
  for (let k = 5; k >= 0; k--) {
    splat(px - ux * k * 2.2, py - uy * k * 2.2, size, sr, sg, sb, 1 - k * 0.15);
  }
}

// ---------- soft floating orbs for depth ----------
for (let s = 0; s < 26; s++) {
  const px = rand() * W;
  const py = rand() * H * 0.62;
  if (Math.hypot(px - CX, py - CY) < 170) continue;
  const rad = 4 + rand() * 5;
  const a = 0.05 + rand() * 0.07;
  const hue = rand();
  splat(px, py, rad, a * lerp(1.0, 0.3, hue), a * lerp(0.6, 0.7, hue), a * lerp(0.3, 1.0, hue), 1);
}

// ---------- the ridge ----------
const ridge = new Float32Array(W);
for (let x = 0; x < W; x++) {
  ridge[x] =
    872 +
    14 * Math.sin(x * 0.008 + 1.3) +
    8 * Math.sin(x * 0.021 + 4.1) +
    7 * Math.sin(x * 0.055 + 0.7) +
    3 * Math.sin(x * 0.13 + 2.9);
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const h = ridge[x];
    const yy = y + 0.5;
    if (yy < h - 2) continue;
    const i = (y * W + x) * 3;
    const edge = smoothstep(h - 2, h + 2, yy);
    const depth = clamp((yy - h) / 130, 0, 1);
    let gr = lerp(0.008, 0.004, depth);
    let gg = lerp(0.007, 0.002, depth);
    let gb = lerp(0.034, 0.01, depth);
    // A pool of bloom light on the ridge.
    const pool =
      Math.exp(-(((x + 0.5 - CX) / 160) * ((x + 0.5 - CX) / 160))) *
      Math.exp(-Math.max(0, yy - h) / 42);
    gr += pool * 0.1;
    gg += pool * 0.045;
    gb += pool * 0.025;
    // Rim light along the crest.
    const rim =
      Math.exp(-Math.abs(yy - h) / 1.3) *
      (0.12 + 0.88 * Math.exp(-(((x + 0.5 - CX) / 380) * ((x + 0.5 - CX) / 380))));
    gr += rim * 0.65;
    gg += rim * 0.34;
    gb += rim * 0.16;
    buf[i] = lerp(buf[i], gr, edge);
    buf[i + 1] = lerp(buf[i + 1], gg, edge);
    buf[i + 2] = lerp(buf[i + 2], gb, edge);
  }
}

// ---------- the witness ----------
const FX = 512;
const FY = ridge[FX];

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  const dx = wx - t * vx;
  const dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}
function sdRoundBox(px, py, cx, cy, hx, hy, rad) {
  const qx = Math.abs(px - cx) - (hx - rad);
  const qy = Math.abs(py - cy) - (hy - rad);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - rad;
}

// A soft glow behind the figure so the silhouette separates from the ridge.
splat(FX, FY - 42, 62, 0.5, 0.25, 0.1, 0.16);

for (let y = Math.floor(FY - 88); y <= Math.floor(FY + 2); y++) {
  for (let x = Math.floor(FX - 40); x <= Math.floor(FX + 40); x++) {
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const px = x + 0.5;
    const py = y + 0.5;
    let d = Math.hypot(px - FX, py - (FY - 66)) - 8; // head
    d = Math.min(d, sdRoundBox(px, py, FX, FY - 43, 10.5, 15, 6)); // torso
    d = Math.min(d, sdSegment(px, py, FX - 8, FY - 54, FX - 28, FY - 76) - 3.2); // left arm
    d = Math.min(d, sdSegment(px, py, FX + 8, FY - 54, FX + 28, FY - 76) - 3.2); // right arm
    d = Math.min(d, Math.hypot(px - (FX - 28), py - (FY - 76)) - 3.5); // left hand
    d = Math.min(d, Math.hypot(px - (FX + 28), py - (FY - 76)) - 3.5); // right hand
    d = Math.min(d, sdSegment(px, py, FX - 4, FY - 30, FX - 8, FY - 1) - 3.6); // left leg
    d = Math.min(d, sdSegment(px, py, FX + 4, FY - 30, FX + 8, FY - 1) - 3.6); // right leg
    const sil = 1 - smoothstep(-0.6, 0.9, d);
    if (sil <= 0) {
      // A warm backlit rim just outside the silhouette.
      const rim = smoothstep(3.2, 0.4, d);
      if (rim > 0) {
        const i = (y * W + x) * 3;
        buf[i] += rim * 0.55;
        buf[i + 1] += rim * 0.28;
        buf[i + 2] += rim * 0.1;
      }
      continue;
    }
    const i = (y * W + x) * 3;
    buf[i] = lerp(buf[i], 0.004, sil);
    buf[i + 1] = lerp(buf[i + 1], 0.002, sil);
    buf[i + 2] = lerp(buf[i + 2], 0.012, sil);
  }
}

// ---------- grade: vignette, tonemap, gamma ----------
const rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) / 724;
    const vig = 1 - 0.3 * smoothstep(0.55, 1.05, d);
    const r = Math.pow(1 - Math.exp(-buf[i] * vig * 1.25), 1 / 2.2);
    const g = Math.pow(1 - Math.exp(-buf[i + 1] * vig * 1.25), 1 / 2.2);
    const b = Math.pow(1 - Math.exp(-buf[i + 2] * vig * 1.25), 1 / 2.2);
    rgb[i] = clamp(Math.round(r * 255), 0, 255);
    rgb[i + 1] = clamp(Math.round(g * 255), 0, 255);
    rgb[i + 2] = clamp(Math.round(b * 255), 0, 255);
  }
}

// ---------- PNG encoder (hand-written, standard library only) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcData), 8 + data.length);
  return out;
}

// Scanlines with the Sub filter, which suits smooth gradients.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 3);
  raw[rowStart] = 1;
  for (let x = 0; x < W * 3; x++) {
    const px = rgb[y * W * 3 + x];
    const left = x >= 3 ? rgb[y * W * 3 + x - 3] : 0;
    raw[rowStart + 1 + x] = (px - left) & 0xff;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "entry.png");
writeFileSync(outPath, png);
console.log(`wrote ${png.length} bytes to ${outPath}`);
