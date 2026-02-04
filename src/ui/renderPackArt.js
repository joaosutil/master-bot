import { createCanvas } from "@napi-rs/canvas";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

const cache = new Map(); // key -> Buffer

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

function packSilhouettePath(ctx, x, y, w, h) {
  const crimpH = h * 0.085;
  const crimpW = w * 0.10;
  const sideInset = w * 0.06;
  const bottomInset = w * 0.08;

  ctx.beginPath();
  // top-left crimp
  ctx.moveTo(x + sideInset, y + crimpH);
  ctx.quadraticCurveTo(x + sideInset * 0.55, y, x + sideInset + crimpW, y + crimpH * 0.22);
  ctx.quadraticCurveTo(
    x + w * 0.5,
    y + crimpH * 0.95,
    x + w - sideInset - crimpW,
    y + crimpH * 0.22
  );
  ctx.quadraticCurveTo(x + w - sideInset * 0.55, y, x + w - sideInset, y + crimpH);

  // right side
  ctx.quadraticCurveTo(x + w, y + h * 0.18, x + w, y + h * 0.28);
  ctx.lineTo(x + w, y + h * 0.74);
  ctx.quadraticCurveTo(x + w, y + h * 0.90, x + w - bottomInset * 0.75, y + h * 0.96);

  // bottom point
  ctx.quadraticCurveTo(x + w * 0.5, y + h, x + bottomInset * 0.75, y + h * 0.96);

  // left side up
  ctx.quadraticCurveTo(x, y + h * 0.90, x, y + h * 0.74);
  ctx.lineTo(x, y + h * 0.28);
  ctx.quadraticCurveTo(x, y + h * 0.18, x + sideInset, y + crimpH);

  ctx.closePath();
}

function asRgb(accent) {
  if (!accent) return { r: 180, g: 120, b: 255 };
  if (typeof accent === "string") {
    const m = accent.trim().match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = Number.parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
  }
  if (typeof accent === "object" && accent.r != null) return accent;
  return { r: 180, g: 120, b: 255 };
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

export function renderPackArtPng({ packId = "", name = "PACK", emoji = "🎁", accent } = {}) {
  const key = `${packId}|${name}|${emoji}|${typeof accent === "string" ? accent : ""}`;
  if (cache.has(key)) return cache.get(key);

  const W = 560;
  const H = 820;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const a = asRgb(accent);

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "rgba(6,8,12,1)");
  bg.addColorStop(0.45, `rgba(${a.r},${a.g},${a.b},0.30)`);
  bg.addColorStop(1, "rgba(2,2,4,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // holographic beams
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 9; i++) {
    const x = (W * (i + 1)) / 10;
    const g = ctx.createLinearGradient(x - 40, 0, x + 40, H);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(${a.r},${a.g},${a.b},0.35)`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, 0, 140, H);
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // pack body (booster silhouette)
  const pad = 54;
  const x = pad;
  const y = 84;
  const w = W - pad * 2;
  const h = H - 210;

  // shadow under pack
  ctx.save();
  ctx.shadowBlur = 62;
  ctx.shadowColor = "rgba(0,0,0,0.80)";
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  packSilhouettePath(ctx, x, y, w, h);
  ctx.fill();
  ctx.restore();

  // main foil
  ctx.save();
  packSilhouettePath(ctx, x, y, w, h);
  ctx.clip();

  const foil = ctx.createLinearGradient(x, y, x + w, y + h);
  foil.addColorStop(0, "rgba(255,255,255,0.18)");
  foil.addColorStop(0.24, rgba(a, 0.10));
  foil.addColorStop(0.52, "rgba(255,255,255,0.08)");
  foil.addColorStop(0.78, rgba(a, 0.14));
  foil.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = foil;
  ctx.fillRect(x, y, w, h);

  // foil waves
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55;
  for (let i = -8; i < 18; i++) {
    const yy = y + (i / 18) * h;
    const g = ctx.createLinearGradient(x, yy, x + w, yy + h * 0.12);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.35, rgba(a, 0.22));
    g.addColorStop(0.65, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.2, yy, w * 1.4, h * 0.08);
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // inner vignette for depth
  const v = ctx.createRadialGradient(x + w * 0.5, y + h * 0.35, 60, x + w * 0.5, y + h * 0.5, w * 0.95);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);

  ctx.restore(); // end clip

  // border
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowBlur = 44;
  ctx.shadowColor = rgba(a, 0.55);
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 12;
  ctx.strokeStyle = rgba(a, 0.92);
  packSilhouettePath(ctx, x + 8, y + 8, w - 16, h - 16);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  packSilhouettePath(ctx, x + 24, y + 24, w - 48, h - 48);
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // emoji badge
  ctx.save();
  const badgeR = 54;
  const cx = W / 2;
  const cy = y + 92;
  ctx.shadowBlur = 22;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${a.r},${a.g},${a.b},0.18)`;
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.85)`;
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `900 64px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(String(emoji).slice(0, 2), cx, cy + 1);
  ctx.restore();

  // name plate (stronger)
  ctx.save();
  const title = String(name).toUpperCase();
  const size = fitText(ctx, title, w - 70, 56, 30, 900);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const plateY = y + h - 170;
  ctx.shadowBlur = 22;
  ctx.shadowColor = "rgba(0,0,0,0.70)";
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  drawRoundedRect(ctx, x + 40, plateY, w - 80, 96, 26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(a, 0.62);
  drawRoundedRect(ctx, x + 40, plateY, w - 80, 96, 26);
  ctx.stroke();

  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  ctx.strokeText(title, W / 2, plateY + 48);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText(title, W / 2, plateY + 48);
  ctx.restore();

  // footer tag
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `800 20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("MASTER BOT • PACK", W / 2, H - 64);
  ctx.restore();

  // vignette
  const vignette = ctx.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, W);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const buf = canvas.toBuffer("image/png");
  cache.set(key, buf);
  return buf;
}
