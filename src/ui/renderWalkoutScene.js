import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCardPng } from "./renderCard.js";
import { applyNoise } from "./noise.js";
import { rarityColor } from "./embeds.js";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

function drawTextStroke(ctx, text, x, y, { size = 72, align = "left", fill = "rgba(255,255,255,0.96)", stroke = "rgba(0,0,0,0.72)", lw = 14 } = {}) {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function smokeBlob(ctx, cx, cy, r, color, alpha) {
  ctx.save();
  ctx.shadowBlur = r * 0.55;
  ctx.shadowColor = color;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSmoke(ctx, W, H, rng, accent) {
  const a = accent;
  for (let i = 0; i < 38; i++) {
    const cx = W * (0.18 + rng() * 0.64);
    const cy = H * (0.22 + rng() * 0.70);
    const r = 90 + rng() * 260;
    const tint = i % 3 ? rgba(a, 0.16) : "rgba(255,255,255,0.10)";
    smokeBlob(ctx, cx, cy, r, tint, 0.10 + rng() * 0.14);
  }
}

function drawStars(ctx, W, H, rng) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 160; i++) {
    const x = rng() * W;
    const y = rng() * H * 0.75;
    const r = 0.8 + rng() * 2.6;
    const a = 0.10 + rng() * 0.30;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawBeams(ctx, W, H, rng, accent) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.42;
  for (let i = 0; i < 9; i++) {
    const x = W * (0.15 + rng() * 0.70);
    const w = 160 + rng() * 340;
    const rot = (rng() - 0.5) * 0.5;
    ctx.save();
    ctx.translate(x, H * 0.55);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-w / 2, -H, w / 2, H);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, rgba(accent, 0.22));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -H, w, H * 2);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawConfetti(ctx, W, H, rng, accent) {
  const colors = [
    rgba(accent, 0.9),
    "rgba(255,255,255,0.92)",
    "rgba(255,75,170,0.82)",
    "rgba(120,252,255,0.82)"
  ];
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 160; i++) {
    const x = rng() * W;
    const y = rng() * H * 0.62;
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

function drawFirebursts(ctx, W, H, rng, accent, { cx, cy } = {}) {
  const centerX = cx ?? W * 0.70;
  const centerY = cy ?? H * 0.58;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55;

  const rays = 56;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2 + (rng() - 0.5) * 0.16;
    const len = 520 + rng() * 720;
    const w = 8 + rng() * 22;
    const x2 = centerX + Math.cos(ang) * len;
    const y2 = centerY + Math.sin(ang) * len;

    const g = ctx.createLinearGradient(centerX, centerY, x2, y2);
    g.addColorStop(0, rgba(accent, 0.0));
    g.addColorStop(0.15, rgba(accent, 0.55));
    g.addColorStop(0.55, "rgba(255,255,255,0.20)");
    g.addColorStop(1, "rgba(255,255,255,0)");

    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawSparks(ctx, W, H, rng, accent) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 220; i++) {
    const x = W * (0.12 + rng() * 0.78);
    const y = H * (0.18 + rng() * 0.76);
    const r = 0.8 + rng() * 2.8;
    ctx.fillStyle = i % 3 ? rgba(accent, 0.55) : "rgba(255,255,255,0.40)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawFloor(ctx, W, H, accent) {
  ctx.save();
  const floorY = H * 0.78;
  const g = ctx.createLinearGradient(0, floorY, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.12, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, floorY, W, H - floorY);

  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.38;
  const spot = ctx.createRadialGradient(W * 0.70, floorY + 10, 40, W * 0.70, floorY + 10, 520);
  spot.addColorStop(0, rgba(accent, 0.20));
  spot.addColorStop(0.35, rgba(accent, 0.10));
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

export async function renderWalkoutScenePng({
  card,
  title = "WALKOUT",
  subtitle = "",
  badge = "",
  seedSalt = ""
} = {}) {
  const W = 1920;
  const H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Keep the "style" deterministic per player (unique look), while still allowing optional salt.
  const seed = hash32(`${card?.id ?? ""}|${card?.name ?? ""}|${card?.ovr ?? ""}|${seedSalt}|walkout`);
  const rng = mulberry32(seed);

  const accent = hexToRgb(rarityColor(card?.rarity ?? "legendary"));
  const variant = Math.floor(rng() * 4); // 0..3

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "rgba(5,7,16,1)");
  bg.addColorStop(0.45, rgba(accent, 0.26));
  bg.addColorStop(1, "rgba(8,2,12,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, W * 0.95);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  const cardCx = W * 0.70;
  // Keep the card + shadow fully inside the canvas (avoid "cortada")
  const cardCy = H * 0.56;

  // scene variants (each player 90+ feels different)
  if (variant === 0) {
    drawBeams(ctx, W, H, rng, accent);
    drawFirebursts(ctx, W, H, rng, accent, { cx: cardCx, cy: cardCy });
    drawSmoke(ctx, W, H, rng, accent);
    drawStars(ctx, W, H, rng);
    drawConfetti(ctx, W, H, rng, accent);
  } else if (variant === 1) {
    drawFirebursts(ctx, W, H, rng, accent, { cx: cardCx, cy: cardCy });
    drawSparks(ctx, W, H, rng, accent);
    drawSmoke(ctx, W, H, rng, accent);
    drawBeams(ctx, W, H, rng, accent);
  } else if (variant === 2) {
    drawStars(ctx, W, H, rng);
    drawBeams(ctx, W, H, rng, accent);
    drawSmoke(ctx, W, H, rng, accent);
    drawConfetti(ctx, W, H, rng, accent);
    drawSparks(ctx, W, H, rng, accent);
  } else {
    drawBeams(ctx, W, H, rng, accent);
    drawStars(ctx, W, H, rng);
    drawSmoke(ctx, W, H, rng, accent);
    drawFirebursts(ctx, W, H, rng, accent, { cx: cardCx, cy: cardCy });
  }

  drawFloor(ctx, W, H, accent);

  // card
  const cardBuf = await renderCardPng(card);
  const cardImg = await loadImage(cardBuf);
  const cardW = 620;
  const cardH = Math.round(cardW * (1080 / 768));
  const cx = cardCx;
  const cy = cardCy;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rng() - 0.5) * 0.10);
  ctx.shadowBlur = 92;
  ctx.shadowColor = rgba(accent, 0.65);
  ctx.shadowOffsetY = 12;

  // extra glow behind the card (no "cortada" edges)
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.60;
  const halo = ctx.createRadialGradient(0, -20, 40, 0, -20, 520);
  halo.addColorStop(0, rgba(accent, 0.26));
  halo.addColorStop(0.42, "rgba(255,255,255,0.14)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 40, cardW * 0.62, cardH * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  ctx.drawImage(cardImg, -cardW / 2, -cardH / 2, cardW, cardH);
  ctx.restore();

  // left text
  const ovr = typeof card?.ovr === "number" ? String(card.ovr) : "??";
  const name = String(card?.name ?? "Jogador");
  const pos = String(card?.pos ?? "").toUpperCase();

  drawTextStroke(ctx, title.toUpperCase(), 110, 140, { size: 92, align: "left", lw: 18 });
  if (subtitle) drawTextStroke(ctx, subtitle.toUpperCase(), 110, 210, { size: 34, fill: "rgba(255,255,255,0.78)", lw: 10 });

  drawTextStroke(ctx, `${ovr} ${pos}`.trim(), 110, 330, { size: 110, align: "left", lw: 22 });
  drawTextStroke(ctx, name.toUpperCase(), 110, 420, { size: 72, align: "left", lw: 18 });

  if (badge) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(110, 462, 420, 8);
    ctx.restore();
    drawTextStroke(ctx, badge.toUpperCase(), 110, 520, { size: 28, align: "left", fill: "rgba(255,255,255,0.72)", lw: 10 });
  }

  applyNoise(ctx, W, H, 0.06);
  return canvas.toBuffer("image/png");
}
