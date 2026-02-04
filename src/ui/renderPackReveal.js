import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCardPng } from "./renderCard.js";
import { applyNoise } from "./noise.js";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function rgba(rgb, a) {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
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
function fitText(ctx, text, maxW, start, min, weight = 900) {
  let size = start;
  while (size >= min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return size;
    size -= 2;
  }
  return min;
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

function background(ctx, W, H, accent) {
  const a = asRgb(accent);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "rgba(6,8,12,1)");
  g.addColorStop(0.45, `rgba(${a.r},${a.g},${a.b},0.30)`);
  g.addColorStop(1, "rgba(2,2,4,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.30;
  const sh = ctx.createLinearGradient(-W * 0.2, H * 0.25, W * 1.2, H * 0.65);
  sh.addColorStop(0, "rgba(255,255,255,0)");
  sh.addColorStop(0.5, `rgba(${a.r},${a.g},${a.b},0.28)`);
  sh.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  const v = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, W);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  applyNoise(ctx, W, H, 0.05);
}

function drawHeader(ctx, W, title) {
  const pad = 54;

  // header bar (helps with legibility)
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  drawRoundedRect(ctx, pad - 10, pad - 18, W - (pad - 10) * 2, 108, 34);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  drawRoundedRect(ctx, pad - 10, pad - 18, W - (pad - 10) * 2, 108, 34);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  drawRoundedRect(ctx, pad, pad - 6, 52, 52, 12);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.stroke();
  ctx.restore();

  const maxW = W - pad * 2 - 80;
  const size = fitText(ctx, title, maxW, 62, 34, 900);

  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(title, pad + 70, pad - 14);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(title, pad + 70, pad - 14);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 66);
  ctx.lineTo(W - pad, pad + 66);
  ctx.stroke();
  ctx.restore();
}

export async function renderPackRevealPng({ cards, title = "FUTPACK", qty = 1, accent } = {}) {
  const W = 1920;
  // Taller canvas so cards can be bigger/legible (Discord will scale it down anyway).
  const H = 1350;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  background(ctx, W, H, accent);
  drawHeader(ctx, W, `${title} x${qty}`);

  const padX = 56;
  const topY = 136;
  const areaH = H - topY - 84;
  const areaW = W - padX * 2;

  // stage panel behind cards (more "arena" feel, less empty background)
  const a = asRgb(accent);
  ctx.save();
  ctx.globalAlpha = 0.95;
  const panelX = padX - 12;
  const panelY = topY - 12;
  const panelW = areaW + 24;
  const panelH = areaH + 24;
  const pg = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
  pg.addColorStop(0, rgba(a, 0.10));
  pg.addColorStop(0.45, "rgba(255,255,255,0.04)");
  pg.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = pg;
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 48);
  ctx.fill();

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = rgba(a, 0.22);
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 48);
  ctx.stroke();
  ctx.restore();

  const display = cards.slice(0, 7);
  const n = display.length;
  const gap = 22;

  // layout (bigger cards to keep text legible)
  let rows = [];
  if (n <= 0) rows = [];
  else if (n === 1) rows = [[0]];
  else if (n === 2) rows = [[0, 1]];
  else if (n === 3) rows = [[0, 1, 2]];
  else if (n === 4) rows = [[0, 1], [2, 3]];
  else if (n === 5) rows = [[0, 1, 2], [3, 4]];
  else if (n === 6) rows = [[0, 1, 2], [3, 4, 5]];
  else rows = [[0, 1, 2, 3], [4, 5, 6]]; // 7

  const rowCount = rows.length || 1;
  const cardAspect = 1080 / 768;
  const rowGapY = 46;
  const maxRowLen = Math.max(...rows.map((r) => r.length));

  const cardWByWidth = Math.floor((areaW - gap * (maxRowLen - 1)) / maxRowLen);
  const cardHByWidth = Math.floor(cardWByWidth * cardAspect);
  const cardHByHeight = Math.floor((areaH - rowGapY * (rowCount - 1)) / rowCount);
  const cardWByHeight = Math.floor(cardHByHeight / cardAspect);

  const cardW = Math.max(290, Math.min(cardWByWidth, cardWByHeight));
  const cardH = Math.floor(cardW * cardAspect);

  const totalH = rowCount * cardH + (rowCount - 1) * rowGapY;
  let y0 = topY + Math.floor((areaH - totalH) / 2);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowW = row.length * cardW + (row.length - 1) * gap;
    const x0 = padX + Math.floor((areaW - rowW) / 2);
    const y = y0 + r * (cardH + rowGapY);

    for (let i = 0; i < row.length; i++) {
      const idx = row[i];
      const x = x0 + i * (cardW + gap);

      // slot/backplate
      ctx.save();
      ctx.shadowBlur = 44;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowOffsetY = 22;
      const slotG = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
      slotG.addColorStop(0, "rgba(0,0,0,0.25)");
      slotG.addColorStop(0.55, rgba(a, 0.10));
      slotG.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = slotG;
      drawRoundedRect(ctx, x - 8, y - 8, cardW + 16, cardH + 16, 34);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      drawRoundedRect(ctx, x - 8, y - 8, cardW + 16, cardH + 16, 34);
      ctx.stroke();
      ctx.restore();

      const png = await renderCardPng(display[idx]);
      const img = await loadImage(png);

      ctx.save();
      const rarity = String(display[idx]?.rarity ?? "");
      const ovr = typeof display[idx]?.ovr === "number" ? display[idx].ovr : 0;
      const glow = ovr >= 90 || rarity === "legendary" || rarity === "epic" ? 0.52 : 0.24;
      ctx.shadowBlur = 42;
      ctx.shadowColor = "rgba(0,0,0,0.60)";
      ctx.shadowOffsetY = 18;

      const centerBias = (i - (row.length - 1) / 2) / Math.max(1, row.length);
      const tilt = centerBias * 0.018;
      ctx.translate(x + cardW / 2, y + cardH / 2);
      ctx.rotate(tilt);

      // glow behind the card
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = glow;
      const halo = ctx.createRadialGradient(0, 10, 40, 0, 10, Math.max(cardW, cardH) * 0.80);
      halo.addColorStop(0, rgba(a, 0.22));
      halo.addColorStop(0.42, "rgba(255,255,255,0.10)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(0, 80, cardW * 0.60, cardH * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      ctx.drawImage(img, -cardW / 2, -cardH / 2, cardW, cardH);
      ctx.restore();
    }
  }

  return canvas.toBuffer("image/png");
}
