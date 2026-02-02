import { createCanvas } from "@napi-rs/canvas";

let cachedPatternCanvas = null;

function getNoiseCanvas(size = 256) {
  if (cachedPatternCanvas) return cachedPatternCanvas;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  cachedPatternCanvas = canvas;
  return canvas;
}

export function applyNoise(ctx, w, h, alpha = 0.06) {
  if (!ctx || !w || !h) return;
  if (alpha <= 0) return;
  if (process.env.RENDER_NOISE === "0") return;
  if (process.env.RENDER_FAST === "1") return;

  const noiseCanvas = getNoiseCanvas(256);
  const pattern = ctx.createPattern(noiseCanvas, "repeat");
  if (!pattern) return;

  const ox = Math.floor(Math.random() * 256);
  const oy = Math.floor(Math.random() * 256);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pattern;
  ctx.fillRect(ox, oy, w + 256, h + 256);
  ctx.restore();
}

