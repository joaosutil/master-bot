import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCardPng } from "./renderCard.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export async function renderCardsGridPng(cards) {
  // thumbs pra caberem bem no Discord
  const thumbW = 300;
  const thumbH = 422; // 300 * (1080/768) ~ 422
  const gap = 18;
  const pad = 24;

  const n = cards.length;
  const cols = n <= 5 ? n : 5;
  const rows = Math.ceil(n / cols);

  const width = pad * 2 + cols * thumbW + (cols - 1) * gap;
  const height = pad * 2 + rows * thumbH + (rows - 1) * gap;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // background
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "rgba(10,10,16,1)");
  bg.addColorStop(1, "rgba(2,2,5,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // desenha cada card
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const x = pad + col * (thumbW + gap);
    const y = pad + row * (thumbH + gap);

    // render da carta (usa seu renderCard.js)
    const png = await renderCardPng(cards[i]);
    const img = await loadImage(png);

    // shadow
    ctx.save();
    ctx.shadowBlur = 22;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowOffsetY = 10;

    // draw
    ctx.drawImage(img, x, y, thumbW, thumbH);
    ctx.restore();

    // borda leve
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, thumbW - 2, thumbH - 2);
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}
