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

function fitText(ctx, text, maxW, start, min, weight = 900) {
  let size = start;
  while (size >= min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return size;
    size -= 2;
  }
  return min;
}

function bestTwoLineSplit(ctx, words, maxW) {
  if (!Array.isArray(words) || words.length < 2) return null;

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const wa = ctx.measureText(a).width;
    const wb = ctx.measureText(b).width;
    if (wa > maxW || wb > maxW) continue;
    const score = Math.max(wa, wb);
    if (!best || score < best.score) best = { a, b, score };
  }

  return best ? [best.a, best.b] : null;
}

function fitWrappedText(ctx, text, maxW, { start = 60, min = 30, weight = 900, maxLines = 2 } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return { size: min, lines: [""] };

  const words = raw.split(/\s+/g).filter(Boolean);

  let size = start;
  while (size >= min) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(raw).width <= maxW) return { size, lines: [raw] };

    if (maxLines >= 2 && words.length >= 2) {
      const split = bestTwoLineSplit(ctx, words, maxW);
      if (split) return { size, lines: split };
    }

    size -= 2;
  }

  ctx.font = `${weight} ${min}px ${FONT}`;
  return { size: min, lines: [ellipsize(ctx, raw, maxW)] };
}

function fitSubLine(ctx, text, maxW, { start = 34, min = 18, weight = 800 } = {}) {
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

function isFastRender() {
  return process.env.RENDER_FAST === "1";
}

function drawTextStroke(ctx, text, x, y, { size = 72, weight = 900, align = "left", fill = "rgba(255,255,255,0.96)", stroke = "rgba(0,0,0,0.72)", lw = 14 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
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
  const count = isFastRender() ? 18 : 38;
  for (let i = 0; i < count; i++) {
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
  const count = isFastRender() ? 90 : 160;
  for (let i = 0; i < count; i++) {
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
  const count = isFastRender() ? 6 : 9;
  for (let i = 0; i < count; i++) {
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
  if (isFastRender()) return;
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

  const rays = isFastRender() ? 34 : 56;
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
  const count = isFastRender() ? 120 : 220;
  for (let i = 0; i < count; i++) {
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

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

  const textX = 110;
  const leftMaxW = Math.floor(cardCx - cardW / 2 - textX - 42);
  const safeMaxW = Math.max(280, leftMaxW);

  const titleText = String(title ?? "").toUpperCase();
  const titleSize = fitText(ctx, titleText, safeMaxW, 92, 62, 900);
  drawTextStroke(ctx, titleText, textX, 140, { size: titleSize, align: "left", lw: 18 });

  let cursorY = 210;
  if (subtitle) {
    const subText = String(subtitle ?? "").toUpperCase();
    const subFit = fitSubLine(ctx, subText, safeMaxW, { start: 34, min: 22, weight: 800 });
    drawTextStroke(ctx, subFit.text, textX, cursorY, {
      size: subFit.size,
      weight: 800,
      align: "left",
      fill: "rgba(255,255,255,0.78)",
      lw: 10
    });
    cursorY += 120;
  } else {
    cursorY += 120;
  }

  const ovrPosText = `${ovr} ${pos}`.trim();
  const ovrPosSize = fitText(ctx, ovrPosText, safeMaxW, 110, 78, 900);
  drawTextStroke(ctx, ovrPosText, textX, 330, { size: ovrPosSize, align: "left", lw: 22 });

  const nameText = String(name ?? "").toUpperCase();
  const nameFit = fitWrappedText(ctx, nameText, safeMaxW, { start: 72, min: 44, weight: 900, maxLines: 2 });
  const nameLineH = Math.round(nameFit.size * 0.92);
  const nameTopY = 420;
  for (let i = 0; i < nameFit.lines.length; i++) {
    drawTextStroke(ctx, nameFit.lines[i], textX, nameTopY + i * nameLineH, { size: nameFit.size, align: "left", lw: 18 });
  }

  const afterNameY = nameTopY + nameFit.lines.length * nameLineH + 26;
  if (badge) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(textX, afterNameY - 58, Math.min(520, safeMaxW), 8);
    ctx.restore();

    const badgeText = String(badge ?? "").toUpperCase();
    const badgeFit = fitSubLine(ctx, badgeText, safeMaxW, { start: 28, min: 18, weight: 800 });
    drawTextStroke(ctx, badgeFit.text, textX, afterNameY, {
      size: badgeFit.size,
      weight: 800,
      align: "left",
      fill: "rgba(255,255,255,0.72)",
      lw: 10
    });
  }

  applyNoise(ctx, W, H, 0.06);
  return canvas.toBuffer("image/png");
}
