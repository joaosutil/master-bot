import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { formatCoins, rarityColor, rarityLabel } from "./embeds.js";
import { applyNoise } from "./noise.js";

const W = 768;
const H = 1080;
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

const cache = new Map(); // key -> Image|null

const renderedCache = new Map(); // key -> Buffer
const maxRenderedCache = Math.max(
  0,
  Number.parseInt(process.env.CARD_RENDER_CACHE ?? "50", 10) || 50
);

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .slice(0, 120);
}

function hexToRgb(hex) {
  const c = Number(hex);
  return { r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 };
}

function rgba(rgb, a) {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

function hash32(str) {
  // FNV-1a
  let h = 2166136261;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = clamp(Number(s) / 100, 0, 1);
  const ll = clamp(Number(l) / 100, 0, 1);

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh < 60) [r1, g1, b1] = [c, x, 0];
  else if (hh < 120) [r1, g1, b1] = [x, c, 0];
  else if (hh < 180) [r1, g1, b1] = [0, c, x];
  else if (hh < 240) [r1, g1, b1] = [0, x, c];
  else if (hh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

function mixRgb(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * tt),
    g: Math.round(a.g + (b.g - a.g) * tt),
    b: Math.round(a.b + (b.b - a.b) * tt)
  };
}

function eliteTheme(card) {
  const seed = hash32(`${card?.id ?? ""}|${card?.name ?? ""}|${card?.clubId ?? ""}`);
  const rng = mulberry32(seed);

  const hueA = Math.floor(rng() * 360);
  const hueB = (hueA + 35 + Math.floor(rng() * 140)) % 360;
  const hueC = (hueA + 170 + Math.floor(rng() * 80)) % 360;

  const a = hslToRgb(hueA, 92, 56);
  const b = hslToRgb(hueB, 94, 50);
  const c = hslToRgb(hueC, 92, 62);

  const variant = Math.floor(rng() * 6); // 0..5
  return { seed, rng, variant, a, b, c };
}

function shieldPath(ctx, x, y, w, h) {
  const topCurve = h * 0.075;
  const notchW = w * 0.26;
  const notchH = h * 0.07;
  const sideCurve = w * 0.10;

  const x0 = x;
  const y0 = y;
  const x1 = x + w;
  const y1 = y + h;

  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.14, y0);

  // top-left to notch
  ctx.quadraticCurveTo(x0 + w * 0.04, y0, x0 + w * 0.04, y0 + topCurve);
  ctx.lineTo(x0 + w * 0.04, y0 + topCurve);
  ctx.quadraticCurveTo(x0 + w * 0.5 - notchW / 2, y0 + topCurve * 0.55, x0 + w * 0.5, y0 + notchH);
  ctx.quadraticCurveTo(x0 + w * 0.5 + notchW / 2, y0 + topCurve * 0.55, x1 - w * 0.04, y0 + topCurve);

  // top-right
  ctx.quadraticCurveTo(x1 - w * 0.04, y0, x1 - w * 0.14, y0);

  // right side down
  ctx.quadraticCurveTo(x1, y0 + h * 0.10, x1, y0 + h * 0.22);
  ctx.lineTo(x1, y0 + h * 0.70);
  ctx.quadraticCurveTo(x1, y0 + h * 0.86, x0 + w * 0.5 + sideCurve, y0 + h * 0.94);

  // bottom point
  ctx.quadraticCurveTo(x0 + w * 0.5, y1, x0 + w * 0.5 - sideCurve, y0 + h * 0.94);

  // left side up
  ctx.quadraticCurveTo(x0, y0 + h * 0.86, x0, y0 + h * 0.70);
  ctx.lineTo(x0, y0 + h * 0.22);
  ctx.quadraticCurveTo(x0, y0 + h * 0.10, x0 + w * 0.14, y0);

  ctx.closePath();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function cutCornerRectPath(ctx, x, y, w, h, cut) {
  const c = Math.min(cut, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function baseSilhouettePath(ctx, x, y, w, h, variant = 0) {
  const v = ((Number(variant) || 0) % 4 + 4) % 4;
  const cut = w * 0.10;
  const r = w * 0.06;

  const x0 = x;
  const y0 = y;
  const x1 = x + w;
  const y1 = y + h;

  if (v === 0) {
    // modern shield (clean + legible)
    ctx.beginPath();
    ctx.moveTo(x0 + cut, y0);
    ctx.lineTo(x1 - cut, y0);
    ctx.quadraticCurveTo(x1, y0, x1, y0 + cut);
    ctx.lineTo(x1, y0 + h * 0.76);
    ctx.quadraticCurveTo(x1, y0 + h * 0.90, x0 + w * 0.56, y0 + h * 0.95);
    ctx.quadraticCurveTo(x0 + w * 0.5, y1, x0 + w * 0.44, y0 + h * 0.95);
    ctx.quadraticCurveTo(x0, y0 + h * 0.90, x0, y0 + h * 0.76);
    ctx.lineTo(x0, y0 + cut);
    ctx.quadraticCurveTo(x0, y0, x0 + cut, y0);
    ctx.closePath();
    return;
  }

  if (v === 1) {
    // ticket / arena pass (side notches)
    const bite = w * 0.055;
    const biteY = y0 + h * 0.46;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
    ctx.lineTo(x1, biteY - bite);
    ctx.quadraticCurveTo(x1 - bite * 0.3, biteY, x1, biteY + bite);
    ctx.lineTo(x1, y1 - r);
    ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
    ctx.lineTo(x0 + w * 0.56, y1);
    ctx.quadraticCurveTo(x0 + w * 0.5, y1 - h * 0.035, x0 + w * 0.44, y1);
    ctx.lineTo(x0 + r, y1);
    ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
    ctx.lineTo(x0, biteY + bite);
    ctx.quadraticCurveTo(x0 + bite * 0.3, biteY, x0, biteY - bite);
    ctx.lineTo(x0, y0 + r);
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
    return;
  }

  if (v === 2) {
    // hex badge (non-rectangular, clean)
    const inset = w * 0.13;
    ctx.beginPath();
    ctx.moveTo(x0 + inset, y0);
    ctx.lineTo(x1 - inset, y0);
    ctx.lineTo(x1, y0 + h * 0.18);
    ctx.lineTo(x1 - inset * 0.55, y1);
    ctx.lineTo(x0 + inset * 0.55, y1);
    ctx.lineTo(x0, y0 + h * 0.18);
    ctx.closePath();
    return;
  }

  // v === 3: crown-top shield (more "desenhado")
  const crownH = h * 0.075;
  const crownW = w * 0.26;
  const crownInset = w * 0.16;
  ctx.beginPath();
  ctx.moveTo(x0 + crownInset, y0 + crownH);
  ctx.quadraticCurveTo(x0 + w * 0.20, y0, x0 + w * 0.32, y0 + crownH);
  ctx.quadraticCurveTo(x0 + w * 0.5 - crownW / 2, y0 + crownH * 0.65, x0 + w * 0.5, y0 + crownH * 0.15);
  ctx.quadraticCurveTo(x0 + w * 0.5 + crownW / 2, y0 + crownH * 0.65, x1 - crownInset, y0 + crownH);
  ctx.quadraticCurveTo(x1 - w * 0.20, y0, x1 - w * 0.12, y0 + crownH * 1.25);
  ctx.lineTo(x1, y0 + h * 0.22);
  ctx.lineTo(x1, y0 + h * 0.76);
  ctx.quadraticCurveTo(x1, y0 + h * 0.90, x0 + w * 0.56, y0 + h * 0.95);
  ctx.quadraticCurveTo(x0 + w * 0.5, y1, x0 + w * 0.44, y0 + h * 0.95);
  ctx.quadraticCurveTo(x0, y0 + h * 0.90, x0, y0 + h * 0.76);
  ctx.lineTo(x0, y0 + h * 0.22);
  ctx.lineTo(x0 + w * 0.12, y0 + crownH * 1.25);
  ctx.closePath();
}

function hexPattern(ctx, x, y, w, h, { alpha = 0.08, size = 56 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  const s = Math.max(18, Number(size) || 56);
  const r = s / 2;
  const hStep = s * 0.86;
  const wStep = s;
  for (let yy = y - s; yy < y + h + s; yy += hStep) {
    const row = Math.round((yy - y) / hStep);
    const offset = row % 2 ? wStep / 2 : 0;
    for (let xx = x - s; xx < x + w + s; xx += wStep) {
      const cx = xx + offset;
      const cy = yy;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function shadow(ctx, { blur = 18, color = "rgba(0,0,0,0.45)", x = 0, y = 10 }) {
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.shadowOffsetX = x;
  ctx.shadowOffsetY = y;
}

function resetShadow(ctx) {
  ctx.shadowBlur = 0;
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function fitText(ctx, text, maxW, start, min, weight = 900) {
  let size = start;
  while (size >= min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return size;
    size -= 2;
  }
  return min;
}

function cacheSet(map, key, value, maxSize) {
  if (maxSize <= 0) return;
  map.set(key, value);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest == null) break;
    map.delete(oldest);
  }
}

function stableCardKey(card) {
  const stats = card?.stats ?? {};
  const orderedStats = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"].map((k) => [
    k,
    stats?.[k] ?? null
  ]);

  return JSON.stringify({
    id: card?.id ?? null,
    name: card?.name ?? null,
    pos: card?.pos ?? null,
    ovr: card?.ovr ?? null,
    rarity: card?.rarity ?? null,
    value: card?.value ?? null,
    portraitFile: card?.portraitFile ?? null,
    clubBadgeFile: card?.clubBadgeFile ?? null,
    clubName: card?.clubName ?? null,
    countryCode: card?.countryCode ?? null,
    stats: orderedStats
  });
}

async function loadLocalImage(relParts) {
  const key = relParts.join("/");
  if (cache.has(key)) return cache.get(key);

  try {
    const full = path.join(process.cwd(), ...relParts);
    const buf = await readFile(full);
    const img = await loadImage(buf);
    cache.set(key, img);
    return img;
  } catch {
    cache.set(key, null);
    return null;
  }
}

let clubBadgeIndexPromise = null;
async function getClubBadgeIndex() {
  if (clubBadgeIndexPromise) return clubBadgeIndexPromise;
  clubBadgeIndexPromise = (async () => {
    const dir = path.join(process.cwd(), "assets", "badges", "clubs");
    try {
      const files = await readdir(dir);
      const out = new Map();
      for (const f of files) {
        const m = /^(.+)_\d+\.png$/i.exec(f);
        if (!m) continue;
        const key = String(m[1] ?? "").toLowerCase();
        if (!key || out.has(key)) continue;
        out.set(key, f);
      }
      return out;
    } catch {
      return new Map();
    }
  })();
  return clubBadgeIndexPromise;
}

async function loadClubBadge(card) {
  if (card?.clubBadgeFile) {
    // compat: o sync antigo salvava em assets/badges/<id>.png (sem /clubs)
    const direct = await loadLocalImage(["assets", "badges", card.clubBadgeFile]);
    if (direct) return direct;

    const byFile = await loadLocalImage(["assets", "badges", "clubs", card.clubBadgeFile]);
    if (byFile) return byFile;
  }

  const clubName = card?.clubName ? String(card.clubName) : "";
  if (!clubName) return null;

  const idx = await getClubBadgeIndex();
  const key = safeName(clubName);
  const file = idx.get(key);
  if (!file) return null;

  return await loadLocalImage(["assets", "badges", "clubs", file]);
}

function drawCover(ctx, img, x, y, w, h, anchorX = 0.5, anchorY = 0.46) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  const dx = w - sw;
  const dy = h - sh;
  const sx = x + dx * anchorX;
  const sy = y + dy * anchorY;
  ctx.drawImage(img, sx, sy, sw, sh);
}

function drawCircleImage(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2, 0.5, 0.5);
  ctx.restore();
}

function textStroke(ctx, text, x, y, fill = "rgba(255,255,255,0.96)", stroke = "rgba(0,0,0,0.72)", lw = 10) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function bg(ctx, accent) {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "rgba(6,8,12,1)");
  base.addColorStop(0.45, rgba(accent, 0.14));
  base.addColorStop(1, "rgba(2,2,4,1)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // stadium lights
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.75;

  const s1 = ctx.createRadialGradient(W * 0.18, H * 0.12, 40, W * 0.18, H * 0.12, W * 0.78);
  s1.addColorStop(0, rgba(accent, 0.26));
  s1.addColorStop(0.35, "rgba(255,255,255,0.06)");
  s1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = s1;
  ctx.fillRect(0, 0, W, H);

  const s2 = ctx.createRadialGradient(W * 0.88, H * 0.16, 40, W * 0.88, H * 0.16, W * 0.90);
  s2.addColorStop(0, rgba(accent, 0.22));
  s2.addColorStop(0.35, "rgba(255,255,255,0.05)");
  s2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = s2;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // diagonal texture
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  for (let y = -H; y < H * 2; y += 26) {
    ctx.beginPath();
    ctx.moveTo(-W * 0.2, y);
    ctx.lineTo(W * 1.2, y + H * 0.22);
    ctx.stroke();
  }
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 160, W / 2, H / 2, 900);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function border(ctx, accent, secondary, rarity) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, rgba(accent, 0.92));
  grad.addColorStop(0.5, rgba(secondary ?? accent, 0.92));
  grad.addColorStop(1, rgba(accent, 0.92));

  shadow(ctx, { blur: 44, color: rgba(accent, rarity === "legendary" ? 0.42 : 0.32), y: 0 });
  ctx.lineWidth = 10;
  ctx.strokeStyle = grad;
  cutCornerRectPath(ctx, 22, 22, W - 44, H - 44, 42);
  ctx.stroke();
  resetShadow(ctx);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  cutCornerRectPath(ctx, 46, 46, W - 92, H - 92, 30);
  ctx.stroke();

  // micro highlights
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  cutCornerRectPath(ctx, 58, 58, W - 116, H - 116, 24);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function baseTheme(card, accent) {
  const seed = hash32(`${card?.id ?? ""}|${card?.name ?? ""}|${card?.clubId ?? ""}`);
  const rng = mulberry32(seed);
  const variant = Math.floor(rng() * 4); // 0..3
  const hue = Math.floor(rng() * 360);
  const secondary = mixRgb(accent, hslToRgb(hue, 92, 56), 0.55);
  return { seed, rng, variant, secondary };
}

function drawBaseBackground(ctx, { rng, variant, accent, secondary }) {
  // richer two-tone gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "rgba(6,8,12,1)");
  g.addColorStop(0.30, rgba(accent, 0.22));
  g.addColorStop(0.68, rgba(secondary, 0.18));
  g.addColorStop(1, "rgba(2,2,6,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // big soft glow
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55;
  const glow = ctx.createRadialGradient(W * 0.32, H * 0.22, 40, W * 0.32, H * 0.22, W * 0.92);
  glow.addColorStop(0, rgba(accent, 0.22));
  glow.addColorStop(0.55, rgba(secondary, 0.10));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // variant patterns
  if (variant === 0) {
    hexPattern(ctx, 0, 0, W, H, { alpha: 0.07, size: 62 });
  } else if (variant === 1) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = rgba(accent, 0.20);
    ctx.lineWidth = 4;
    for (let i = -H; i < H * 2; i += 34) {
      ctx.beginPath();
      ctx.moveTo(-W * 0.2, i);
      ctx.lineTo(W * 1.2, i + H * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  } else if (variant === 2) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.26;
    for (let i = 0; i < 18; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const w = 160 + rng() * 260;
      const h = 80 + rng() * 180;
      const rot = (rng() - 0.5) * 1.2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const gg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gg.addColorStop(0, rgba(accent, 0.22));
      gg.addColorStop(1, rgba(secondary, 0.12));
      ctx.fillStyle = gg;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 160; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = 1 + rng() * 4;
      ctx.fillStyle = i % 2 ? rgba(accent, 0.20) : rgba(secondary, 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 160, W / 2, H / 2, 900);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.80)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function pill(ctx, x, y, w, h, accent, text, { weight = 900, alpha = 0.12 } = {}) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba(accent, alpha));
  g.addColorStop(0.4, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = g;
  cutCornerRectPath(ctx, x, y, w, h, 16);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.55);
  cutCornerRectPath(ctx, x, y, w, h, 16);
  ctx.stroke();

  ctx.font = `${weight} 20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function drawStat(ctx, x, y, w, h, accent, label, value) {
  ctx.save();
  const cut = 14;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0.06)");
  ctx.fillStyle = g;
  cutCornerRectPath(ctx, x, y, w, h, cut);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.52);
  cutCornerRectPath(ctx, x, y, w, h, cut);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `900 24px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, x + 14, y + 34);

  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.font = `900 44px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(value), x + w - 14, y + h - 18);
  ctx.restore();
}

function initialsFromName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const out = (a + b).toUpperCase();
  return out || "?";
}

function drawBadgeFallback(ctx, cx, cy, r, accent, text) {
  ctx.save();
  shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();
  resetShadow(ctx);

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, rgba(accent, 0.22));
  g.addColorStop(1, "rgba(255,255,255,0.06)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(accent, 0.78);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = `900 20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(String(text ?? "?").slice(0, 4).toUpperCase(), cx, cy + 0.5);
  ctx.restore();
}

function eliteNumberFill(ctx, text, x, y, { size = 140, align = "left" } = {}) {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(10, Math.round(size * 0.10));
  ctx.strokeStyle = "rgba(0,0,0,0.78)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawElitePattern(ctx, x, y, w, h, theme) {
  const { rng, variant, a, b, c } = theme;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  if (variant === 0) {
    // diagonal beams
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      const xx = x + (w * (i + 1)) / 14;
      const g = ctx.createLinearGradient(xx - 80, y, xx + 80, y + h);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, rgba(mixRgb(a, b, rng()), 0.45));
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(xx - 140, y - 40, 280, h + 80);
    }
  } else if (variant === 1) {
    // starburst
    ctx.globalAlpha = 0.26;
    const cx = x + w * 0.5;
    const cy = y + h * 0.28;
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2 + rng() * 0.04;
      const r0 = 40 + rng() * 70;
      const r1 = w * (0.55 + rng() * 0.25);
      ctx.strokeStyle = rgba(i % 2 ? a : b, 0.22);
      ctx.lineWidth = i % 3 ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
  } else if (variant === 2) {
    // neon waves
    ctx.globalAlpha = 0.30;
    for (let k = 0; k < 8; k++) {
      const yy = y + h * (0.12 + k * 0.10);
      ctx.strokeStyle = rgba(mixRgb(b, c, k / 8), 0.22);
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let t = 0; t <= 1.01; t += 0.05) {
        const xx = x + w * t;
        const amp = 18 + k * 2;
        const phase = (k * 0.7 + rng() * 1.2) * Math.PI;
        const yv = yy + Math.sin(t * Math.PI * 2 + phase) * amp;
        if (t === 0) ctx.moveTo(xx, yv);
        else ctx.lineTo(xx, yv);
      }
      ctx.stroke();
    }
  } else if (variant === 3) {
    // shards / triangles
    ctx.globalAlpha = 0.26;
    for (let i = 0; i < 22; i++) {
      const p1x = x + rng() * w;
      const p1y = y + rng() * h * 0.75;
      const p2x = p1x + (rng() - 0.5) * w * 0.30;
      const p2y = p1y + (0.25 + rng() * 0.25) * h * 0.22;
      const p3x = p1x + (rng() - 0.5) * w * 0.26;
      const p3y = p1y + (0.25 + rng() * 0.25) * h * 0.26;
      ctx.fillStyle = rgba(i % 2 ? a : c, 0.18);
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.lineTo(p3x, p3y);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // holographic dots
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < 140; i++) {
      const rr = 2 + rng() * 5;
      const xx = x + rng() * w;
      const yy = y + rng() * h;
      ctx.fillStyle = rgba(i % 3 ? a : i % 2 ? b : c, 0.20);
      ctx.beginPath();
      ctx.arc(xx, yy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // sparkles (always)
  ctx.globalAlpha = 0.34;
  for (let i = 0; i < 26; i++) {
    const xx = x + rng() * w;
    const yy = y + rng() * h * 0.62;
    const r = 2 + rng() * 4;
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.beginPath();
    ctx.arc(xx, yy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawEliteOrnaments(ctx, x, y, w, h, theme) {
  const { a, b, c, rng, variant } = theme;
  const accent = mixRgb(a, c, 0.5);

  function wingPath(ctx2, x2, y2, w2, h2, dir) {
    const d = dir === "right" ? 1 : -1;
    ctx2.beginPath();
    ctx2.moveTo(x2 + (d > 0 ? 0 : w2), y2 + h2 * 0.55);
    ctx2.quadraticCurveTo(x2 + w2 * 0.5, y2 - h2 * 0.15, x2 + (d > 0 ? w2 : 0), y2 + h2 * 0.35);
    ctx2.quadraticCurveTo(x2 + w2 * 0.75, y2 + h2 * 0.75, x2 + (d > 0 ? w2 : 0), y2 + h2);
    ctx2.quadraticCurveTo(x2 + w2 * 0.5, y2 + h2 * 0.72, x2 + (d > 0 ? 0 : w2), y2 + h2 * 0.55);
    ctx2.closePath();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.80;

  const wingW = w * 0.18;
  const wingH = h * 0.075;
  const wingY = y + 10;
  const leftX = x + w * 0.06;
  const rightX = x + w - wingW - w * 0.06;

  const g1 = ctx.createLinearGradient(leftX, wingY, leftX + wingW, wingY + wingH);
  g1.addColorStop(0, rgba(a, 0.0));
  g1.addColorStop(0.35, rgba(a, 0.55));
  g1.addColorStop(1, rgba(b, 0.0));
  ctx.fillStyle = g1;
  ctx.shadowBlur = 42;
  ctx.shadowColor = rgba(accent, 0.42);
  wingPath(ctx, leftX, wingY, wingW, wingH, "left");
  ctx.fill();

  const g2 = ctx.createLinearGradient(rightX, wingY, rightX + wingW, wingY + wingH);
  g2.addColorStop(0, rgba(b, 0.0));
  g2.addColorStop(0.35, rgba(c, 0.55));
  g2.addColorStop(1, rgba(c, 0.0));
  ctx.fillStyle = g2;
  wingPath(ctx, rightX, wingY, wingW, wingH, "right");
  ctx.fill();

  // crown gem / flare
  const gemX = x + w * 0.5;
  const gemY = y + 18;
  const gemR = 10 + rng() * 9;
  ctx.shadowBlur = 36;
  ctx.shadowColor = rgba(accent, 0.55);
  ctx.fillStyle = variant % 2 ? rgba(accent, 0.55) : "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(gemX, gemY - gemR);
  ctx.lineTo(gemX + gemR, gemY);
  ctx.lineTo(gemX, gemY + gemR);
  ctx.lineTo(gemX - gemR, gemY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

async function renderEliteCardPng(card) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const theme = eliteTheme(card);
  const { a, b, c, rng } = theme;
  const shapeVariant = theme.variant % 4;

  // Extra padding to avoid glow/frame being clipped by the canvas.
  const pad = 44;
  const x = pad;
  const y = pad;
  const w = W - pad * 2;
  const h = H - pad * 2;

  // soft drop shadow
  ctx.save();
  shadow(ctx, { blur: 78, color: "rgba(0,0,0,0.75)", y: 24 });
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.fill();
  resetShadow(ctx);
  ctx.restore();

  // main clip (non-rectangular card)
  ctx.save();
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.clip();

  // background gradient
  const bgG = ctx.createLinearGradient(x, y, x + w, y + h);
  bgG.addColorStop(0, rgba(a, 0.92));
  bgG.addColorStop(0.46, rgba(b, 0.82));
  bgG.addColorStop(1, rgba(c, 0.92));
  ctx.fillStyle = bgG;
  ctx.fillRect(x, y, w, h);

  // deep vignette
  const v = ctx.createRadialGradient(x + w * 0.52, y + h * 0.36, 80, x + w * 0.52, y + h * 0.50, w * 1.0);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);

  drawElitePattern(ctx, x, y, w, h, theme);

  // portrait
  const portrait = card?.portraitFile
    ? await loadLocalImage(["assets", "portraits", card.portraitFile])
    : null;
  const flag = card?.countryCode
    ? (await loadLocalImage(["assets", "badges", "flags", `${String(card.countryCode).toLowerCase()}.png`])) ??
      (await loadLocalImage(["assets", "flags", `${String(card.countryCode).toLowerCase()}.png`]))
    : null;
  const clubBadge = await loadClubBadge(card);

  const portraitX = x + 44;
  const portraitY = y + 132;
  const portraitW = w - 88;
  const portraitH = Math.round(h * 0.52);

  ctx.save();
  drawRoundedRect(ctx, portraitX, portraitY, portraitW, portraitH, 54);
  ctx.clip();
  if (portrait) {
    drawCover(ctx, portrait, portraitX, portraitY, portraitW, portraitH, 0.5, 0.16);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(portraitX, portraitY, portraitW, portraitH);
    ctx.globalAlpha = 0.8;
    ctx.font = `900 120px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillText(initialsFromName(card?.name), portraitX + portraitW / 2, portraitY + portraitH * 0.46);
    ctx.globalAlpha = 1;
  }

  // portrait overlay for readability
  const ov = ctx.createLinearGradient(portraitX, portraitY, portraitX, portraitY + portraitH);
  ov.addColorStop(0, "rgba(0,0,0,0.04)");
  ov.addColorStop(0.55, "rgba(0,0,0,0.12)");
  ov.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = ov;
  ctx.fillRect(portraitX, portraitY, portraitW, portraitH);
  ctx.restore();

  // top-left OVR + POS (bigger + legible)
  const ovr = typeof card?.ovr === "number" ? String(card.ovr) : "??";
  const pos = String(card?.pos ?? "??").toUpperCase();

  ctx.save();
  ctx.shadowBlur = 26;
  ctx.shadowColor = rgba(mixRgb(a, b, 0.5), 0.62);
  ctx.shadowOffsetY = 10;
  eliteNumberFill(ctx, ovr, x + 54, y + 132, { size: 156, align: "left" });
  ctx.restore();

  ctx.save();
  ctx.font = `900 64px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  textStroke(ctx, pos, x + 60, y + 142, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.78)", 12);
  ctx.restore();

  // flag + club (left column like FUT)
  const badgeX = x + 62;
  const flagY = y + 268;
  const flagW = 98;
  const flagH = 64;

  if (flag) {
    ctx.save();
    shadow(ctx, { blur: 22, color: "rgba(0,0,0,0.65)", y: 14 });
    drawRoundedRect(ctx, badgeX, flagY, flagW, flagH, 12);
    ctx.clip();
    drawCover(ctx, flag, badgeX, flagY, flagW, flagH, 0.5, 0.5);
    ctx.restore();
  }

  const clubCy = flagY + 116;
  const clubR = 38;
  if (clubBadge) {
    ctx.save();
    shadow(ctx, { blur: 24, color: "rgba(0,0,0,0.65)", y: 14 });
    drawCircleImage(ctx, clubBadge, badgeX + flagW / 2, clubCy, clubR);
    ctx.restore();
  } else if (card?.clubName) {
    drawBadgeFallback(ctx, badgeX + flagW / 2, clubCy, clubR, a, initialsFromName(String(card.clubName)));
  }

  // bottom panel (name + stats)
  const panelY = y + Math.round(h * 0.56);
  ctx.save();
  const pg = ctx.createLinearGradient(x, panelY, x, y + h);
  pg.addColorStop(0, "rgba(0,0,0,0.28)");
  pg.addColorStop(1, "rgba(0,0,0,0.70)");
  ctx.fillStyle = pg;
  ctx.fillRect(x, panelY, w, y + h - panelY);
  ctx.restore();

  const name = String(card?.name ?? "Jogador");
  const club = card?.clubName ? String(card.clubName).toUpperCase() : "";
  const cc = card?.countryCode ? String(card.countryCode).toUpperCase() : "";
  const sub = [club, cc].filter(Boolean).join(" • ");

  const nameBoxX = x + 44;
  const nameBoxW = w - 88;
  const nameY = panelY + 28;

  const nameSize = fitText(ctx, name, nameBoxW - 40, 66, 34, 900);
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 ${nameSize}px ${FONT}`;
  textStroke(ctx, name, x + w / 2, nameY + 60, "rgba(255,255,255,0.98)", "rgba(0,0,0,0.82)", 14);
  if (sub) {
    const subSize = fitText(ctx, sub, nameBoxW - 80, 22, 14, 900);
    ctx.font = `900 ${subSize}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(sub, x + w / 2, nameY + 92);
  }
  ctx.restore();

  // stats (bigger pills)
  const stats = card?.stats ?? {};
  const order = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const entries = order.map((k) => [k, stats[k] ?? "—"]);

  const statsY = nameY + 108;
  const gap = 16;
  const pillW = Math.floor((nameBoxW - gap) / 2);
  const pillH = 66;

  for (let i = 0; i < entries.length; i++) {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const sx = nameBoxX + col * (pillW + gap);
    const sy = statsY + row * (pillH + 12);
    const [k, v] = entries[i];
    drawStat(ctx, sx, sy, pillW, pillH, mixRgb(a, b, 0.35), k, v);
  }

  // subtle noise only inside clip
  applyNoise(ctx, W, H, 0.06);
  ctx.restore(); // end clip

  // outer frame (glow)
  ctx.save();
  const frameG = ctx.createLinearGradient(x, y, x + w, y + h);
  frameG.addColorStop(0, rgba(a, 0.95));
  frameG.addColorStop(0.45, rgba(b, 0.95));
  frameG.addColorStop(1, rgba(c, 0.95));
  shadow(ctx, { blur: 52, color: rgba(mixRgb(a, c, 0.5), 0.58), y: 0 });
  ctx.lineWidth = 12;
  ctx.strokeStyle = frameG;
  baseSilhouettePath(ctx, x + 2, y + 2, w - 4, h - 4, shapeVariant);
  ctx.stroke();
  resetShadow(ctx);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  baseSilhouettePath(ctx, x + 20, y + 20, w - 40, h - 40, shapeVariant);
  ctx.stroke();
  ctx.restore();

  // ornaments outside the silhouette (effects "saindo" do card)
  drawEliteOrnaments(ctx, x, y, w, h, theme);

  return canvas.toBuffer("image/png");
}

export async function renderCardPng(card) {
  const key = stableCardKey(card);
  if (maxRenderedCache > 0) {
    const hit = renderedCache.get(key);
    if (hit) return hit;
  }

  const ovrNum = typeof card?.ovr === "number" ? card.ovr : 0;
  if (ovrNum >= 90) {
    const out = await renderEliteCardPng(card);
    cacheSet(renderedCache, key, out, maxRenderedCache);
    return out;
  }

  const rarity = String(card?.rarity ?? "common");
  const accent = hexToRgb(rarityColor(rarity));
  const theme = baseTheme(card, accent);

  const shapeVariant =
    rarity === "legendary" ? 3 :
    rarity === "epic" ? 2 :
    rarity === "rare" ? 1 :
    theme.variant;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // non-rectangular silhouette (more "desenhado" + less card padrão)
  const pad = 36;
  const x = pad;
  const y = pad;
  const w = W - pad * 2;
  const h = H - pad * 2;

  // soft shadow under the card
  ctx.save();
  shadow(ctx, { blur: 68, color: "rgba(0,0,0,0.78)", y: 28 });
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.fill();
  resetShadow(ctx);
  ctx.restore();

  // clip + background inside card
  ctx.save();
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.clip();
  drawBaseBackground(ctx, { rng: theme.rng, variant: theme.variant, accent, secondary: theme.secondary });

  // inner lighting for readability
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = rarity === "common" ? 0.20 : rarity === "rare" ? 0.26 : 0.30;
  const light = ctx.createRadialGradient(x + w * 0.35, y + h * 0.22, 40, x + w * 0.35, y + h * 0.22, w * 1.05);
  light.addColorStop(0, rgba(accent, 0.22));
  light.addColorStop(0.55, rgba(theme.secondary, 0.12));
  light.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // subtle noise only inside the clip
  applyNoise(ctx, W, H, 0.06);
  ctx.restore(); // end clip

  // outer frame (glow) around silhouette
  ctx.save();
  const frameG = ctx.createLinearGradient(x, y, x + w, y + h);
  frameG.addColorStop(0, rgba(accent, 0.92));
  frameG.addColorStop(0.5, rgba(theme.secondary ?? accent, 0.88));
  frameG.addColorStop(1, rgba(accent, 0.92));
  shadow(ctx, { blur: 58, color: rgba(accent, rarity === "common" ? 0.26 : 0.42), y: 0 });
  ctx.lineWidth = 12;
  ctx.strokeStyle = frameG;
  baseSilhouettePath(ctx, x + 2, y + 2, w - 4, h - 4, shapeVariant);
  ctx.stroke();
  resetShadow(ctx);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  baseSilhouettePath(ctx, x + 22, y + 22, w - 44, h - 44, shapeVariant);
  ctx.stroke();
  ctx.restore();

  const innerPad = 64;
  const innerX = x + innerPad;
  const innerW = w - innerPad * 2;

  // Keep every UI element inside the card silhouette (prevents text/OVR "vazando" fora do card,
  // especially when the card is scaled down in pack reveals).
  ctx.save();
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.clip();

  // Header (bigger + legible, but auto-fit to avoid weird overflow)
  const ovr = typeof card?.ovr === "number" ? String(card.ovr) : "??";
  const pos = String(card?.pos ?? "??").toUpperCase();
  const rarityText = rarityLabel(rarity).toUpperCase();
  const headerMaxW = Math.floor(innerW * 0.52);
  const ovrSize = fitText(ctx, ovr, headerMaxW, 150, 116, 900);
  const posSize = fitText(ctx, pos, headerMaxW, 60, 44, 900);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 ${ovrSize}px ${FONT}`;
  shadow(ctx, { blur: 26, color: rgba(accent, 0.30), y: 10 });
  textStroke(ctx, ovr, innerX + 2, y + 174, "rgba(255,255,255,0.98)", "rgba(0,0,0,0.80)", 18);
  resetShadow(ctx);
  ctx.font = `900 ${posSize}px ${FONT}`;
  textStroke(ctx, pos, innerX + 6, y + 216, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.80)", 12);
  ctx.restore();

  // rarity badge
  ctx.save();
  const badgeW = 290;
  const badgeH = 58;
  const badgeX = innerX + innerW - badgeW;
  const rarityBadgeY = y + 64;
  shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
  const bgB = ctx.createLinearGradient(badgeX, rarityBadgeY, badgeX + badgeW, rarityBadgeY + badgeH);
  bgB.addColorStop(0, rgba(accent, 0.14));
  bgB.addColorStop(0.6, "rgba(255,255,255,0.10)");
  bgB.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = bgB;
  cutCornerRectPath(ctx, badgeX, rarityBadgeY, badgeW, badgeH, 20);
  ctx.fill();
  resetShadow(ctx);
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.65);
  cutCornerRectPath(ctx, badgeX, rarityBadgeY, badgeW, badgeH, 20);
  ctx.stroke();
  ctx.font = `900 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(rarityText, badgeX + badgeW / 2, rarityBadgeY + badgeH / 2 + 1);
  ctx.restore();

  // Portrait frame
  const artX = innerX;
  const artY = y + 240;
  const artW = innerW;
  const artH = 470;

  ctx.save();
  shadow(ctx, { blur: 26, color: "rgba(0,0,0,0.70)", y: 18 });
  const g = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0.03)");
  ctx.fillStyle = g;
  cutCornerRectPath(ctx, artX, artY, artW, artH, 34);
  ctx.fill();
  resetShadow(ctx);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  cutCornerRectPath(ctx, artX, artY, artW, artH, 34);
  ctx.stroke();
  ctx.restore();

  const portrait = card?.portraitFile
    ? await loadLocalImage(["assets", "portraits", card.portraitFile])
    : null;
  const flag = card?.countryCode
    ? (await loadLocalImage(["assets", "badges", "flags", `${String(card.countryCode).toLowerCase()}.png`])) ??
      (await loadLocalImage(["assets", "flags", `${String(card.countryCode).toLowerCase()}.png`]))
    : null;
  const clubBadge = await loadClubBadge(card);

  if (portrait) {
    ctx.save();
    cutCornerRectPath(ctx, artX, artY, artW, artH, 34);
    ctx.clip();
    // prioriza o rosto (corte mais alto)
    drawCover(ctx, portrait, artX, artY, artW, artH, 0.5, 0.18);
    ctx.restore();
  } else {
    // portrait fallback (não deixa "vazio" parecer bug)
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    cutCornerRectPath(ctx, artX, artY, artW, artH, 34);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = `900 92px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillText(initialsFromName(card?.name), artX + artW / 2, artY + artH * 0.45);
    ctx.restore();
  }

  // overlay for readability
  ctx.save();
  const ov = ctx.createLinearGradient(artX, artY + artH * 0.1, artX, artY + artH);
  ov.addColorStop(0, "rgba(0,0,0,0.02)");
  ov.addColorStop(0.55, "rgba(0,0,0,0.18)");
  ov.addColorStop(1, "rgba(0,0,0,0.74)");
  ctx.fillStyle = ov;
  cutCornerRectPath(ctx, artX, artY, artW, artH, 34);
  ctx.fill();
  ctx.restore();

  // Value chip (overlay no retrato para não colidir com os stats)
  const value = typeof card?.value === "number" ? `${formatCoins(card.value)} 🪙` : null;
  if (value) {
    const chipW = 248;
    const chipH = 54;
    const chipX = artX + artW - chipW - 18;
    const chipY = artY + 18;
    pill(ctx, chipX, chipY, chipW, chipH, accent, value, { weight: 900, alpha: 0.16 });
  }

  // Badges (better positioned)
  const badgeR = 38;
  const badgeY = artY + artH - badgeR - 16;
  const leftCx = artX + badgeR + 20;
  const rightCx = artX + artW - badgeR - 20;

  if (clubBadge) {
    ctx.save();
    shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(leftCx, badgeY, badgeR + 5, 0, Math.PI * 2);
    ctx.fill();
    resetShadow(ctx);
    drawCircleImage(ctx, clubBadge, leftCx, badgeY, badgeR);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(accent, 0.78);
    ctx.beginPath();
    ctx.arc(leftCx, badgeY, badgeR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (!clubBadge && card?.clubName) {
    drawBadgeFallback(ctx, leftCx, badgeY, badgeR, accent, initialsFromName(String(card.clubName)));
  }

  if (flag) {
    ctx.save();
    shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(rightCx, badgeY, badgeR + 5, 0, Math.PI * 2);
    ctx.fill();
    resetShadow(ctx);
    drawCircleImage(ctx, flag, rightCx, badgeY, badgeR);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(accent, 0.78);
    ctx.beginPath();
    ctx.arc(rightCx, badgeY, badgeR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (!flag && card?.countryCode) {
    drawBadgeFallback(ctx, rightCx, badgeY, badgeR, accent, String(card.countryCode).toUpperCase());
  }

  // Name + club line
  const name = String(card?.name ?? "Jogador");
  const club = card?.clubName ? String(card.clubName).toUpperCase() : "";
  const cc = card?.countryCode ? String(card.countryCode).toUpperCase() : "";
  const sub = [club, cc].filter(Boolean).join(" • ");

  const nameY = artY + artH + 24;
  const nameH = 96;

  ctx.save();
  shadow(ctx, { blur: 24, color: "rgba(0,0,0,0.70)", y: 14 });
  const ng = ctx.createLinearGradient(innerX, nameY, innerX + innerW, nameY + nameH);
  ng.addColorStop(0, rgba(accent, 0.12));
  ng.addColorStop(0.5, "rgba(255,255,255,0.10)");
  ng.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = ng;
  cutCornerRectPath(ctx, innerX, nameY, innerW, nameH, 28);
  ctx.fill();
  resetShadow(ctx);

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.55);
  cutCornerRectPath(ctx, innerX, nameY, innerW, nameH, 28);
  ctx.stroke();
  ctx.restore();

  const nameSize = fitText(ctx, name, innerW - 80, 58, 30, 900);
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 ${nameSize}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  textStroke(ctx, name, innerX + innerW / 2, nameY + 58, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.72)", 10);
  if (sub) {
    const subSize = fitText(ctx, sub, innerW - 120, 18, 12, 800);
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.font = `800 ${subSize}px ${FONT}`;
    ctx.fillText(sub, innerX + innerW / 2, nameY + 84);
  }
  ctx.restore();

  // Stats
  const stats = card?.stats ?? {};
  const order = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const entries = order.map((k) => [k, stats[k] ?? "—"]);

  const statsY = nameY + nameH + 22;
  const gap = 16;
  const pillW = Math.floor((innerW - gap) / 2);
  const pillH = 78;

  for (let i = 0; i < entries.length; i++) {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const x = innerX + col * (pillW + gap);
    const y = statsY + row * (pillH + 12);
    const [k, v] = entries[i];
    drawStat(ctx, x, y, pillW, pillH, accent, k, v);
  }

  // Footer (minimal)
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.font = `800 15px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("MASTER BOT", x + w - 18, y + h - 22);
  ctx.restore();

  // final micro-noise (only inside card)
  ctx.save();
  baseSilhouettePath(ctx, x, y, w, h, shapeVariant);
  ctx.clip();
  applyNoise(ctx, W, H, 0.05);
  ctx.restore();

  ctx.restore(); // end silhouette clip for the whole card UI
  const out = canvas.toBuffer("image/png");
  cacheSet(renderedCache, key, out, maxRenderedCache);
  return out;
}
