import { createCanvas } from "@napi-rs/canvas";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

const cache = new Map(); // key -> Buffer

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

  // pattern beams
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

  // pack body
  const pad = 54;
  const x = pad;
  const y = 84;
  const w = W - pad * 2;
  const h = H - 210;

  ctx.save();
  ctx.shadowBlur = 56;
  ctx.shadowColor = `rgba(${a.r},${a.g},${a.b},0.55)`;
  ctx.shadowOffsetY = 18;
  const pg = ctx.createLinearGradient(x, y, x + w, y + h);
  pg.addColorStop(0, "rgba(255,255,255,0.14)");
  pg.addColorStop(0.55, "rgba(255,255,255,0.06)");
  pg.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = pg;
  drawRoundedRect(ctx, x, y, w, h, 44);
  ctx.fill();
  ctx.restore();

  // border
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.92)`;
  drawRoundedRect(ctx, x + 10, y + 10, w - 20, h - 20, 38);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  drawRoundedRect(ctx, x + 26, y + 26, w - 52, h - 52, 30);
  ctx.stroke();
  ctx.restore();

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

  // name
  ctx.save();
  const title = String(name).toUpperCase();
  const size = fitText(ctx, title, w - 60, 52, 30, 900);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0,0,0,0.62)";
  ctx.strokeText(title, W / 2, y + h - 120);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(title, W / 2, y + h - 120);
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
  const v = ctx.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, W);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  const buf = canvas.toBuffer("image/png");
  cache.set(key, buf);
  return buf;
}

