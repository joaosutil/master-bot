import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPackArtPng } from "./renderPackArt.js";

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

function countChip(ctx, x, y, text, accent) {
  const a = asRgb(accent);
  const padX = 16;
  const h = 46;
  ctx.save();
  ctx.font = `900 22px ${FONT}`;
  const w = clamp(Math.ceil(ctx.measureText(text).width) + padX * 2, 78, 180);

  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowOffsetY = 10;

  ctx.fillStyle = `rgba(${a.r},${a.g},${a.b},0.24)`;
  drawRoundedRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.80)`;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.70)";
  ctx.strokeText(text, x + w / 2, y + h / 2 + 1);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.restore();
  return { w, h };
}

export async function renderPackStashBannerPng({
  title = "MOCHILA DE PACKS",
  subtitle = "",
  packs = [],
  counts = {},
  accent = "#7c3aed"
} = {}) {
  const key = JSON.stringify({
    title,
    subtitle,
    accent,
    packs: packs.map((p) => p.id),
    counts
  });
  if (cache.has(key)) return cache.get(key);

  const W = 1600;
  const H = 520;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const a = asRgb(accent);

  // background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "rgba(8,10,18,1)");
  bg.addColorStop(0.50, `rgba(${a.r},${a.g},${a.b},0.26)`);
  bg.addColorStop(1, "rgba(2,2,6,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // glow
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.32;
  const glow = ctx.createRadialGradient(W * 0.28, H * 0.42, 40, W * 0.28, H * 0.42, W * 0.80);
  glow.addColorStop(0, `rgba(${a.r},${a.g},${a.b},0.45)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // header
  const pad = 36;
  const titleText = String(title).toUpperCase();
  const subtitleText = String(subtitle || "").trim().toUpperCase();

  ctx.save();
  const titleSize = fitText(ctx, titleText, 780, 56, 34, 900);
  ctx.font = `900 ${titleSize}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(0,0,0,0.70)";
  ctx.strokeText(titleText, pad, pad);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(titleText, pad, pad);

  if (subtitleText) {
    ctx.font = `900 22px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(subtitleText, pad, pad + titleSize + 8);
  }
  ctx.restore();

  // pack fan (right side)
  const list = [...packs].slice(0, 7);
  const centerX = 1120;
  const baseY = 108;
  const cardW = 260;
  const cardH = Math.round(cardW * (820 / 560));
  const step = 108;
  const startX = centerX - ((list.length - 1) * step) / 2;

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const rot = (i - (list.length - 1) / 2) * 0.11;
    const x = startX + i * step;
    const y = baseY + Math.abs(i - (list.length - 1) / 2) * 8;

    const buf = renderPackArtPng({ packId: p.id, name: p.name, emoji: p.emoji, accent: p.accent ?? accent });
    const img = await loadImage(buf);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.shadowBlur = 34;
    ctx.shadowColor = "rgba(0,0,0,0.60)";
    ctx.shadowOffsetY = 18;
    ctx.drawImage(img, -cardW / 2, 0, cardW, cardH);
    ctx.restore();

    const owned = Number(counts?.[p.id] ?? 0);
    countChip(ctx, x - 74, y + cardH - 66, `${owned}x`, p.accent ?? accent);
  }

  // subtle border
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(${a.r},${a.g},${a.b},0.55)`;
  drawRoundedRect(ctx, 16, 16, W - 32, H - 32, 28);
  ctx.stroke();
  ctx.restore();

  const out = canvas.toBuffer("image/png");
  cache.set(key, out);
  return out;
}

