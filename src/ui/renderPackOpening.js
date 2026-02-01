import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPackArtPng } from "./renderPackArt.js";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

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

function drawNoise(ctx, w, h, strength = 0.02) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * strength;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
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

export async function renderPackOpeningPng({ packId = "", name, emoji = "🎁", title = "FUTPACK", accent } = {}) {
  const W = 1600;
  const H = 900;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const a = asRgb(accent);

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

  // pack art (imagem do pack em vez de silhouette vazia)
  const packName = String(name ?? title ?? "PACK");
  const packKey = String(packId || packName);
  const packArt = renderPackArtPng({ packId: packKey, name: packName, emoji, accent });
  const packImg = await loadImage(packArt);

  const packW = 430;
  const packH = Math.round(packW * (820 / 560));
  const cx = W / 2;
  const cy = H / 2 + 30;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.06);
  ctx.shadowBlur = 80;
  ctx.shadowColor = `rgba(${a.r},${a.g},${a.b},0.70)`;
  ctx.shadowOffsetY = 24;
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

  // header text
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 64px ${FONT}`;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText("ABRINDO…", W / 2, 110);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText("ABRINDO…", W / 2, 110);

  ctx.font = `800 28px ${FONT}`;
  const t = String(packName).toUpperCase();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(t, W / 2, 160);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(t, W / 2, 160);
  ctx.restore();

  // footer
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.fillText("MASTER BOT • PACK OPENING", W / 2, H - 70);
  ctx.restore();

  drawNoise(ctx, W, H, 0.022);
  return canvas.toBuffer("image/png");
}
