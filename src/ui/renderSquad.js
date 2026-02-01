import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCardPng } from "./renderCard.js";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

const cardImgCache = new Map(); // cardId -> Image

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
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

function textStroke(ctx, text, x, y, fill = "white", stroke = "rgba(0,0,0,0.55)", lw = 10) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawShardedBg(ctx, W, H) {
  // dark neon gradient (non-FUTVERSE)
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#070a12");
  bg.addColorStop(0.5, "#0b1736");
  bg.addColorStop(1, "#2b0b3a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // glow bands
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 6; i++) {
    const x0 = (W * i) / 6 - 120;
    const g = ctx.createLinearGradient(x0, 0, x0 + 260, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, i % 2 ? "rgba(120,252,255,0.22)" : "rgba(255,70,170,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, 260, H);
  }
  ctx.restore();

  // faux shards
  ctx.save();
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 22; i++) {
    const x = (W * i) / 21;
    const y = (H * (i % 7)) / 7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + W * 0.14, y + H * 0.06);
    ctx.lineTo(x + W * 0.06, y + H * 0.18);
    ctx.closePath();
    ctx.fillStyle = i % 3 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.55)";
    ctx.fill();
  }
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, W * 0.9);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawPitch(ctx, { topLeft, topRight, bottomRight, bottomLeft }, { line = "#ff9aa5" } = {}) {
  // pitch fill
  ctx.save();
  const g = ctx.createLinearGradient(0, topLeft.y, 0, bottomLeft.y);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(1, "rgba(0,0,0,0.94)");
  ctx.fillStyle = g;

  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(bottomRight.x, bottomRight.y);
  ctx.lineTo(bottomLeft.x, bottomLeft.y);
  ctx.closePath();
  ctx.fill();

  // soft inner glow
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.20;
  const glow = ctx.createRadialGradient(
    (topLeft.x + topRight.x) / 2,
    lerp(topLeft.y, bottomLeft.y, 0.35),
    60,
    (topLeft.x + topRight.x) / 2,
    lerp(topLeft.y, bottomLeft.y, 0.35),
    820
  );
  glow.addColorStop(0, "rgba(255,255,255,0.10)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // lines
  ctx.save();
  ctx.strokeStyle = line;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.95;
  ctx.lineJoin = "round";

  // outline
  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(bottomRight.x, bottomRight.y);
  ctx.lineTo(bottomLeft.x, bottomLeft.y);
  ctx.closePath();
  ctx.stroke();

  // mid line
  const midY = (topLeft.y + bottomLeft.y) / 2;
  const midLeft = {
    x: lerp(topLeft.x, bottomLeft.x, 0.5),
    y: midY
  };
  const midRight = {
    x: lerp(topRight.x, bottomRight.x, 0.5),
    y: midY
  };
  ctx.beginPath();
  ctx.moveTo(midLeft.x, midLeft.y);
  ctx.lineTo(midRight.x, midRight.y);
  ctx.stroke();

  // center circle (elliptical due to perspective)
  const cx = (midLeft.x + midRight.x) / 2;
  const cy = midY;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.25, 0.78);
  ctx.beginPath();
  ctx.arc(0, 0, 120, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

async function getCardImage(card) {
  const id = String(card?.id ?? "");
  if (!id) return null;
  if (cardImgCache.has(id)) return cardImgCache.get(id);

  const buf = await renderCardPng(card);
  const img = await loadImage(buf);
  cardImgCache.set(id, img);
  return img;
}

function mapToPitch(pitch, nx, ny) {
  const leftX = lerp(pitch.topLeft.x, pitch.bottomLeft.x, ny);
  const rightX = lerp(pitch.topRight.x, pitch.bottomRight.x, ny);
  const x = lerp(leftX, rightX, nx);
  const y = lerp(pitch.topLeft.y, pitch.bottomLeft.y, ny);
  return { x, y, leftX, rightX };
}

function snapRowY(posLabel, fallbackNy) {
  const p = String(posLabel ?? "").toUpperCase();
  // normalized rows inside the pitch (more vertical spacing + easier alignment)
  if (["PE", "PD", "ATA", "CA"].includes(p)) return 0.18;
  if (["MEI", "MC", "VOL", "MA", "MD", "ME"].includes(p)) return 0.52;
  if (["LE", "LD", "ZAG"].includes(p)) return 0.80;
  if (["GOL"].includes(p)) return 0.95;
  return clamp(fallbackNy, 0, 1);
}

function safeCardRect(pitch, nx, ny, cardW, cardH, { W, H, allowBottomBleed = 0 } = {}) {
  const pad = 20;
  const { x, y, leftX, rightX } = mapToPitch(pitch, nx, ny);

  // clamp inside pitch bounds at that row
  const minX = Math.min(leftX, rightX) + pad + cardW / 2;
  const maxX = Math.max(leftX, rightX) - pad - cardW / 2;
  const cx = clamp(x, minX, maxX);

  const minY = pitch.topLeft.y + pad + cardH / 2;
  const maxY = pitch.bottomLeft.y - pad - cardH / 2 + allowBottomBleed;
  const cy = clamp(y, minY, typeof H === "number" ? Math.min(maxY, H - 18 - cardH / 2) : maxY);

  return { cx, cy };
}

function resolveRowCenters(items, { minX, maxX, gap }) {
  if (!items?.length) return;
  if (items.length === 1) {
    const it = items[0];
    it.cx = clamp(it.desiredCx, minX + it.cardW / 2, maxX - it.cardW / 2);
    return;
  }

  items.sort((a, b) => a.desiredCx - b.desiredCx);

  // forward pass: push to the right to avoid overlaps
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const minCenter = minX + it.cardW / 2;
    const maxCenter = maxX - it.cardW / 2;
    let cx = clamp(it.desiredCx, minCenter, maxCenter);

    if (i > 0) {
      const prev = items[i - 1];
      const minAfterPrev = prev.cx + prev.cardW / 2 + it.cardW / 2 + gap;
      cx = Math.max(cx, minAfterPrev);
    }

    it.cx = clamp(cx, minCenter, maxCenter);
  }

  // if overflowed on the right, shift row left
  const last = items[items.length - 1];
  const overflow = last.cx + last.cardW / 2 - maxX;
  if (overflow > 0) {
    for (const it of items) it.cx -= overflow;
  }

  // backward pass: keep inside left + preserve spacing
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const minCenter = minX + it.cardW / 2;
    const maxCenter = maxX - it.cardW / 2;
    let cx = clamp(it.cx, minCenter, maxCenter);

    if (i < items.length - 1) {
      const next = items[i + 1];
      const maxBeforeNext = next.cx - next.cardW / 2 - it.cardW / 2 - gap;
      cx = Math.min(cx, maxBeforeNext);
    }

    it.cx = clamp(cx, minCenter, maxCenter);
  }
}

export async function renderSquadPng({
  formation,
  lineup,
  overall = 0,
  title = process.env.SQUAD_BRAND ?? "MASTER BOT",
  subtitle = ""
} = {}) {
  const W = 1920;
  const H = 2000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  drawShardedBg(ctx, W, H);

  const pitch = {
    topLeft: { x: 360, y: 440 },
    topRight: { x: 1560, y: 440 },
    bottomRight: { x: 1820, y: 1960 },
    bottomLeft: { x: 100, y: 1960 }
  };

  drawPitch(ctx, pitch, { line: "#ff4da6" });

  // header
  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `900 68px ${FONT}`;
  ctx.textAlign = "center";
  textStroke(ctx, String(title).toUpperCase(), W / 2, 26, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.75)", 14);

  if (subtitle) {
    ctx.font = `900 26px ${FONT}`;
    textStroke(
      ctx,
      String(subtitle).toUpperCase(),
      W / 2,
      96,
      "rgba(255,255,255,0.85)",
      "rgba(0,0,0,0.70)",
      10
    );
  }

  ctx.font = `900 28px ${FONT}`;
  textStroke(ctx, `OVR ${overall || "—"}`, W / 2, subtitle ? 128 : 96, "rgba(255,255,255,0.82)", "rgba(0,0,0,0.70)", 10);

  ctx.textAlign = "right";
  ctx.font = `900 44px ${FONT}`;
  textStroke(
    ctx,
    String(formation?.displayName ?? formation?.name ?? "").toUpperCase(),
    W - 54,
    38,
    "rgba(255,255,255,0.88)",
    "rgba(0,0,0,0.75)",
    12
  );
  ctx.restore();

  const placed = lineup.map((item) => {
    const slotKey = item.slot.key;
    const posLabel = String(item.slot.label ?? "").toUpperCase();
    const coord = formation.coords?.[slotKey] ?? { x: 0.5, y: 0.5 };

    const ny = snapRowY(posLabel, coord.y);
    const nx = clamp(coord.x, 0, 1);

    const { x: desiredCx, leftX, rightX } = mapToPitch(pitch, nx, ny);
    const rowMin = Math.min(leftX, rightX) + 20;
    const rowMax = Math.max(leftX, rightX) - 20;

    return {
      item,
      posLabel,
      nx,
      ny,
      desiredCx,
      rowMin,
      rowMax,
      cardW: 0,
      cardH: 0,
      cx: 0,
      cy: 0
    };
  });

  // card sizes and x layout per row (avoid overlaps automatically)
  const rows = new Map(); // ny -> placed[]
  for (const p of placed) {
    const key = String(p.ny);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(p);
  }

  for (const entries of rows.values()) {
    const ny = entries[0].ny;
    const rowMin = entries[0].rowMin;
    const rowMax = entries[0].rowMax;
    const rowW = Math.max(10, rowMax - rowMin);
    const gap = 42;

    // perspective: near the bottom = larger, but still fit the row width
    const scale = lerp(0.70, 1.06, ny);
    const baseW = 380 * scale;
    const maxWByRow = (rowW - gap * (entries.length - 1)) / entries.length;
    const cardWBase = Math.round(Math.max(190, Math.min(baseW, maxWByRow)));

    for (const p of entries) {
      const mult = p.posLabel === "GOL" ? 0.86 : 1;
      p.cardW = Math.round(cardWBase * mult);
      p.cardH = Math.round(p.cardW * (1080 / 768));
    }

    resolveRowCenters(entries, { minX: rowMin, maxX: rowMax, gap });

    for (const p of entries) {
      const { cy } = safeCardRect(pitch, p.nx, ny, p.cardW, p.cardH, {
        W,
        H,
        allowBottomBleed: p.posLabel === "GOL" ? 170 : 95
      });
      // garante espaço pro label embaixo (sem jogar label pra cima da carta)
      const labelH = 72;
      const labelPad = 34;
      const labelY = cy + p.cardH / 2 + labelPad;
      const overflow = labelY + labelH - (H - 18);
      const cyAdjusted = overflow > 0 ? cy - overflow : cy;
      p.cy = Math.max(cyAdjusted, pitch.topLeft.y + 18 + p.cardH / 2);
    }
  }

  // draw cards + labels
  for (const p of placed) {
    const { item, posLabel, nx, ny, cardW, cardH, cx, cy } = p;
    const c = item.card;

    const labelY = cy + cardH / 2 + 26;

    if (c) {
      const img = await getCardImage(c);
      if (img) {
        const tilt = (nx - 0.5) * 0.045;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.shadowBlur = 40;
        ctx.shadowColor = "rgba(0,0,0,0.70)";
        ctx.shadowOffsetY = 18;
        ctx.drawImage(img, -cardW / 2, -cardH / 2, cardW, cardH);
        ctx.restore();
      }
    } else {
      // empty placeholder
      ctx.save();
      ctx.translate(cx, cy);
      ctx.shadowBlur = 26;
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowOffsetY = 16;

      const x0 = -cardW / 2;
      const y0 = -cardH / 2;
      const g = ctx.createLinearGradient(x0, y0, x0 + cardW, y0 + cardH);
      g.addColorStop(0, "rgba(255,255,255,0.10)");
      g.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = g;
      drawRoundedRect(ctx, x0, y0, cardW, cardH, 22);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      drawRoundedRect(ctx, x0, y0, cardW, cardH, 22);
      ctx.stroke();

      ctx.restore();
    }

    // position label
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labelW = clamp(cardW * 0.76, 210, 380);
    const labelH = 62;
    const labelX = cx - labelW / 2;
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(0,0,0,0.62)";
    ctx.shadowOffsetY = 10;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(0,0,0,0.56)";
    drawRoundedRect(ctx, labelX, labelY - 8, labelW, labelH, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    drawRoundedRect(ctx, labelX, labelY - 8, labelW, labelH, 16);
    ctx.stroke();

    ctx.font = `900 46px ${FONT}`;
    textStroke(ctx, posLabel, cx, labelY, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.70)", 12);
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}
