import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPackArtPng } from "./renderPackArt.js";
import { applyNoise } from "./noise.js";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function isFastRender() {
  return process.env.RENDER_FAST === "1";
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

function ellipsize(ctx, text, maxW) {
  const raw = String(text ?? "");
  if (!raw) return "";
  if (ctx.measureText(raw).width <= maxW) return raw;

  const suffix = "…";
  const suffixW = ctx.measureText(suffix).width;
  if (suffixW >= maxW) return suffix;

  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = raw.slice(0, mid);
    const w = ctx.measureText(slice).width + suffixW;
    if (w <= maxW) lo = mid;
    else hi = mid - 1;
  }

  const n = Math.max(0, lo);
  return raw.slice(0, n) + suffix;
}

function fitSubLine(ctx, text, maxW, { start = 28, min = 18, weight = 800 } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return { size: min, text: "" };

  let size = start;
  while (size >= min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(raw).width <= maxW) return { size, text: raw };
    size -= 1;
  }

  ctx.font = `${weight} ${min}px ${FONT}`;
  return { size: min, text: ellipsize(ctx, raw, maxW) };
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

function rgba(a, alpha) {
  return `rgba(${a.r},${a.g},${a.b},${alpha})`;
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

// Noise moved to src/ui/noise.js (pattern-based, much faster on low CPU)

function drawFloor(ctx, W, H, a) {
  ctx.save();
  const y = H * 0.74;
  const g = ctx.createLinearGradient(0, y, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.12, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, H - y);

  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.30;
  const spot = ctx.createRadialGradient(W * 0.5, y + 8, 40, W * 0.5, y + 8, 560);
  spot.addColorStop(0, rgba(a, 0.20));
  spot.addColorStop(0.35, rgba(a, 0.10));
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawSparks(ctx, W, H, rng, a, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.30 * strength;
  const fast = isFastRender();
  const count = Math.max(40, Math.floor(180 * strength * (fast ? 0.45 : 1)));
  for (let i = 0; i < count; i++) {
    const x = W * (0.10 + rng() * 0.80);
    const y = H * (0.12 + rng() * 0.70);
    const r = 0.8 + rng() * 2.4;
    ctx.fillStyle = i % 3 ? rgba(a, 0.45) : "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawConfetti(ctx, W, H, rng, a, strength = 1) {
  if (isFastRender()) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.40 * strength;
  const colors = [
    rgba(a, 0.9),
    "rgba(255,255,255,0.92)",
    "rgba(255,75,170,0.78)",
    "rgba(120,252,255,0.78)"
  ];
  for (let i = 0; i < Math.floor(180 * strength); i++) {
    const x = rng() * W;
    const y = rng() * H * 0.70;
    const w = 2 + rng() * 7;
    const h = 8 + rng() * 18;
    const rot = (rng() - 0.5) * 1.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawFlash(ctx, W, H, a, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.75 * strength;
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.45, W * 0.95);
  g.addColorStop(0, "rgba(255,255,255,0.68)");
  g.addColorStop(0.22, rgba(a, 0.36));
  g.addColorStop(0.55, rgba(a, 0.18));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawShockwave(ctx, W, H, a, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55 * strength;
  ctx.lineWidth = 8;

  const cx = W * 0.5;
  const cy = H * 0.56;
  for (let i = 0; i < 3; i++) {
    const r = (220 + i * 90) * (0.85 + strength * 0.25);
    const g = ctx.createRadialGradient(cx, cy, r * 0.40, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.62, rgba(a, 0.42));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.45, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawSmoke(ctx, W, H, rng, a, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.24 * strength;

  const cx = W * 0.5;
  const cy = H * 0.56;
  const fast = isFastRender();
  const count = Math.max(10, Math.floor(28 * strength * (fast ? 0.55 : 1)));
  for (let i = 0; i < count; i++) {
    const x = cx + (rng() - 0.5) * W * 0.46;
    const y = cy + (rng() - 0.5) * H * 0.34;
    const r = 60 + rng() * 190;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, rgba(a, 0.18));
    g.addColorStop(0.25, "rgba(255,255,255,0.10)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawMotionStreaks(ctx, W, H, rng, a, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.22 * strength;
  const fast = isFastRender();
  const count = Math.max(8, Math.floor(24 * strength * (fast ? 0.55 : 1)));
  for (let i = 0; i < count; i++) {
    const x = W * (0.18 + rng() * 0.64);
    const y = H * (0.12 + rng() * 0.62);
    const w = 180 + rng() * 420;
    const h = 2 + rng() * 5;
    const rot = (rng() - 0.5) * 0.35;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, rgba(a, 0.46));
    g.addColorStop(1, "rgba(255,255,255,0)");

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function asRgb(accent) {
  if (!accent) return { r: 180, g: 120, b: 255 };
  if (typeof accent === "string") {
    // #rrggbb
    const m = accent.trim().match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = Number.parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
  }
  if (typeof accent === "object" && accent.r != null) return accent;
  return { r: 180, g: 120, b: 255 };
}

export async function renderPackOpeningPng({
  packId = "",
  name,
  emoji = "🎁",
  title = "FUTPACK",
  accent,
  phase = "closed", // "closed" | "shake" | "burst"
  seedSalt = ""
} = {}) {
  const W = 1600;
  const H = 900;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const a = asRgb(accent);

  const seed = hash32(`${packId}|${name ?? ""}|${phase}|${seedSalt}|opening`);
  const rng = mulberry32(seed);

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "rgba(6,8,12,1)");
  bg.addColorStop(0.45, `rgba(${a.r},${a.g},${a.b},0.26)`);
  bg.addColorStop(1, "rgba(2,2,4,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, W);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // beams
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 10; i++) {
    const x = (W * (i + 1)) / 11;
    const g = ctx.createLinearGradient(x - 40, 0, x + 40, H);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(${a.r},${a.g},${a.b},0.35)`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 60, 0, 120, H);
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  drawFloor(ctx, W, H, a);

  // particles (feel animated even as static frames)
  const strength = phase === "burst" ? 1.25 : phase === "shake" ? 0.95 : 0.75;
  drawSparks(ctx, W, H, rng, a, strength);
  if (phase !== "closed") drawSmoke(ctx, W, H, rng, a, phase === "burst" ? 1.15 : 0.80);
  if (phase === "shake") drawMotionStreaks(ctx, W, H, rng, a, 1);
  if (phase === "burst") drawConfetti(ctx, W, H, rng, a, 1.15);

  // pack art (imagem do pack em vez de silhouette vazia)
  const packName = String(name ?? title ?? "PACK");
  const packKey = String(packId || packName);
  const packArt = renderPackArtPng({ packId: packKey, name: packName, emoji, accent });
  const packImg = await loadImage(packArt);

  const packW = phase === "burst" ? 470 : 430;
  const packH = Math.round(packW * (820 / 560));
  const cx = W / 2;
  const cy = phase === "burst" ? H / 2 + 10 : H / 2 + 32;

  const shakeX = phase === "shake" ? (rng() - 0.5) * 18 : 0;
  const shakeY = phase === "shake" ? (rng() - 0.5) * 14 : 0;
  const shakeR = phase === "shake" ? (rng() - 0.5) * 0.08 : 0;

  ctx.save();
  ctx.translate(cx + shakeX, cy + shakeY);
  ctx.rotate((phase === "burst" ? 0.04 : -0.06) + shakeR);
  ctx.shadowBlur = phase === "burst" ? 120 : 86;
  ctx.shadowColor = `rgba(${a.r},${a.g},${a.b},${phase === "burst" ? 0.85 : 0.70})`;
  ctx.shadowOffsetY = phase === "burst" ? 18 : 24;

  // pseudo motion blur in shake phase (2 ghost draws)
  if (phase === "shake") {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.drawImage(packImg, -packW / 2 - 10, -packH / 2 + 10, packW, packH);
    ctx.drawImage(packImg, -packW / 2 + 12, -packH / 2 - 8, packW, packH);
    ctx.restore();
  }
  ctx.drawImage(packImg, -packW / 2, -packH / 2, packW, packH);
  ctx.restore();

  // extra rim light
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.95)`;
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, cx - packW / 2 + 10, cy - packH / 2 + 10, packW - 20, packH - 20, 42);
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  if (phase === "burst") {
    drawFlash(ctx, W, H, a, 1);
    drawShockwave(ctx, W, H, a, 1);
  }

  // header text (with legibility plate)
  ctx.save();
  const plateW = Math.min(1180, W - 180);
  const plateH = 132;
  const plateX = Math.floor((W - plateW) / 2);
  const plateY = 58;
  ctx.globalAlpha = 0.70;
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  drawRoundedRect(ctx, plateX, plateY, plateW, plateH, 32);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.22)`;
  drawRoundedRect(ctx, plateX, plateY, plateW, plateH, 32);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  const header = phase === "burst" ? "REVELANDO!" : "ABRINDO…";
  const headerSize = fitText(ctx, header, plateW - 120, 64, 46, 900);
  ctx.font = `900 ${headerSize}px ${FONT}`;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(header, W / 2, 118);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(header, W / 2, 118);

  const packTitle = String(packName).toUpperCase();
  const packFit = fitSubLine(ctx, packTitle, plateW - 160, { start: 28, min: 18, weight: 800 });
  ctx.font = `800 ${packFit.size}px ${FONT}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(packFit.text, W / 2, 162);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(packFit.text, W / 2, 162);
  ctx.restore();

  // footer
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.fillText("MASTER BOT • PACK OPENING", W / 2, H - 70);
  ctx.restore();

  applyNoise(ctx, W, H, 0.06);
  return canvas.toBuffer("image/png");
}
