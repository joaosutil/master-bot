import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { formatCoins, rarityColor, rarityLabel } from "./embeds.js";
import { applyNoise } from "./noise.js";

const W = 768;
const H = 1080;
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

const cache = new Map(); // key -> Image|null

const renderedCache = new Map(); // key -> Buffer
const maxRenderedCache = Math.max(
  0,
  Number.parseInt(process.env.CARD_RENDER_CACHE ?? "50", 10) || 50
);

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .slice(0, 120);
}

function hexToRgb(hex) {
  const c = Number(hex);
  return { r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 };
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

function shadow(ctx, { blur = 18, color = "rgba(0,0,0,0.45)", x = 0, y = 10 }) {
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.shadowOffsetX = x;
  ctx.shadowOffsetY = y;
}

function resetShadow(ctx) {
  ctx.shadowBlur = 0;
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
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

function cacheSet(map, key, value, maxSize) {
  if (maxSize <= 0) return;
  map.set(key, value);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest == null) break;
    map.delete(oldest);
  }
}

function stableCardKey(card) {
  const stats = card?.stats ?? {};
  const orderedStats = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"].map((k) => [
    k,
    stats?.[k] ?? null
  ]);

  return JSON.stringify({
    id: card?.id ?? null,
    name: card?.name ?? null,
    pos: card?.pos ?? null,
    ovr: card?.ovr ?? null,
    rarity: card?.rarity ?? null,
    value: card?.value ?? null,
    portraitFile: card?.portraitFile ?? null,
    clubBadgeFile: card?.clubBadgeFile ?? null,
    clubName: card?.clubName ?? null,
    countryCode: card?.countryCode ?? null,
    stats: orderedStats
  });
}

async function loadLocalImage(relParts) {
  const key = relParts.join("/");
  if (cache.has(key)) return cache.get(key);

  try {
    const full = path.join(process.cwd(), ...relParts);
    const buf = await readFile(full);
    const img = await loadImage(buf);
    cache.set(key, img);
    return img;
  } catch {
    cache.set(key, null);
    return null;
  }
}

let clubBadgeIndexPromise = null;
async function getClubBadgeIndex() {
  if (clubBadgeIndexPromise) return clubBadgeIndexPromise;
  clubBadgeIndexPromise = (async () => {
    const dir = path.join(process.cwd(), "assets", "badges", "clubs");
    try {
      const files = await readdir(dir);
      const out = new Map();
      for (const f of files) {
        const m = /^(.+)_\d+\.png$/i.exec(f);
        if (!m) continue;
        const key = String(m[1] ?? "").toLowerCase();
        if (!key || out.has(key)) continue;
        out.set(key, f);
      }
      return out;
    } catch {
      return new Map();
    }
  })();
  return clubBadgeIndexPromise;
}

async function loadClubBadge(card) {
  if (card?.clubBadgeFile) {
    const byFile = await loadLocalImage(["assets", "badges", "clubs", card.clubBadgeFile]);
    if (byFile) return byFile;
  }

  const clubName = card?.clubName ? String(card.clubName) : "";
  if (!clubName) return null;

  const idx = await getClubBadgeIndex();
  const key = safeName(clubName);
  const file = idx.get(key);
  if (!file) return null;

  return await loadLocalImage(["assets", "badges", "clubs", file]);
}

function drawCover(ctx, img, x, y, w, h, anchorX = 0.5, anchorY = 0.46) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  const dx = w - sw;
  const dy = h - sh;
  const sx = x + dx * anchorX;
  const sy = y + dy * anchorY;
  ctx.drawImage(img, sx, sy, sw, sh);
}

function drawCircleImage(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2, 0.5, 0.5);
  ctx.restore();
}

function textStroke(ctx, text, x, y, fill = "rgba(255,255,255,0.96)", stroke = "rgba(0,0,0,0.72)", lw = 10) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function bg(ctx, accent) {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "rgba(6,8,12,1)");
  base.addColorStop(0.45, rgba(accent, 0.14));
  base.addColorStop(1, "rgba(2,2,4,1)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // stadium lights
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.75;

  const s1 = ctx.createRadialGradient(W * 0.18, H * 0.12, 40, W * 0.18, H * 0.12, W * 0.78);
  s1.addColorStop(0, rgba(accent, 0.26));
  s1.addColorStop(0.35, "rgba(255,255,255,0.06)");
  s1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = s1;
  ctx.fillRect(0, 0, W, H);

  const s2 = ctx.createRadialGradient(W * 0.88, H * 0.16, 40, W * 0.88, H * 0.16, W * 0.90);
  s2.addColorStop(0, rgba(accent, 0.22));
  s2.addColorStop(0.35, "rgba(255,255,255,0.05)");
  s2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = s2;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // diagonal texture
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  for (let y = -H; y < H * 2; y += 26) {
    ctx.beginPath();
    ctx.moveTo(-W * 0.2, y);
    ctx.lineTo(W * 1.2, y + H * 0.22);
    ctx.stroke();
  }
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 160, W / 2, H / 2, 900);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function border(ctx, accent, rarity) {
  ctx.save();
  shadow(ctx, { blur: 44, color: rgba(accent, rarity === "legendary" ? 0.42 : 0.32), y: 0 });
  ctx.lineWidth = 10;
  ctx.strokeStyle = rgba(accent, 0.90);
  drawRoundedRect(ctx, 22, 22, W - 44, H - 44, 44);
  ctx.stroke();
  resetShadow(ctx);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  drawRoundedRect(ctx, 46, 46, W - 92, H - 92, 34);
  ctx.stroke();
  ctx.restore();
}

function pill(ctx, x, y, w, h, accent, text, { weight = 900, alpha = 0.12 } = {}) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba(accent, alpha));
  g.addColorStop(0.4, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = g;
  drawRoundedRect(ctx, x, y, w, h, 18);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.55);
  drawRoundedRect(ctx, x, y, w, h, 18);
  ctx.stroke();

  ctx.font = `${weight} 20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function drawStat(ctx, x, y, w, h, accent, label, value) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0.06)");
  ctx.fillStyle = g;
  drawRoundedRect(ctx, x, y, w, h, 16);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.52);
  drawRoundedRect(ctx, x, y, w, h, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `900 22px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 14, y + h / 2);

  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.font = `900 30px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(String(value), x + w - 14, y + h / 2);
  ctx.restore();
}

function initialsFromName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const out = (a + b).toUpperCase();
  return out || "?";
}

function drawBadgeFallback(ctx, cx, cy, r, accent, text) {
  ctx.save();
  shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();
  resetShadow(ctx);

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, rgba(accent, 0.22));
  g.addColorStop(1, "rgba(255,255,255,0.06)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(accent, 0.78);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = `900 20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(String(text ?? "?").slice(0, 4).toUpperCase(), cx, cy + 0.5);
  ctx.restore();
}

export async function renderCardPng(card) {
  const key = stableCardKey(card);
  if (maxRenderedCache > 0) {
    const hit = renderedCache.get(key);
    if (hit) return hit;
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const rarity = String(card?.rarity ?? "common");
  const accent = hexToRgb(rarityColor(rarity));

  bg(ctx, accent);
  border(ctx, accent, rarity);

  const PAD = 64;
  const innerX = PAD;
  const innerW = W - PAD * 2;

  // Header
  const ovr = typeof card?.ovr === "number" ? card.ovr : "??";
  const pos = String(card?.pos ?? "??").toUpperCase();
  const rarityText = rarityLabel(rarity).toUpperCase();

  pill(ctx, innerX, 64, 170, 64, accent, `${ovr}  ${pos}`, { weight: 900, alpha: 0.18 });
  pill(ctx, innerX + innerW - 220, 72, 220, 50, accent, rarityText, { weight: 900, alpha: 0.10 });

  // Portrait frame
  const artX = innerX;
  const artY = 152;
  const artW = innerW;
  const artH = 520;

  ctx.save();
  shadow(ctx, { blur: 26, color: "rgba(0,0,0,0.70)", y: 18 });
  const g = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0.03)");
  ctx.fillStyle = g;
  drawRoundedRect(ctx, artX, artY, artW, artH, 34);
  ctx.fill();
  resetShadow(ctx);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  drawRoundedRect(ctx, artX, artY, artW, artH, 34);
  ctx.stroke();
  ctx.restore();

  const portrait = card?.portraitFile
    ? await loadLocalImage(["assets", "portraits", card.portraitFile])
    : null;
  const flag = card?.countryCode
    ? await loadLocalImage(["assets", "badges", "flags", `${String(card.countryCode).toLowerCase()}.png`])
    : null;
  const clubBadge = await loadClubBadge(card);

  if (portrait) {
    ctx.save();
    drawRoundedRect(ctx, artX, artY, artW, artH, 34);
    ctx.clip();
    // prioriza o rosto (corte mais alto)
    drawCover(ctx, portrait, artX, artY, artW, artH, 0.5, 0.18);
    ctx.restore();
  } else {
    // portrait fallback (não deixa "vazio" parecer bug)
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    drawRoundedRect(ctx, artX, artY, artW, artH, 34);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = `900 92px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillText(initialsFromName(card?.name), artX + artW / 2, artY + artH * 0.45);
    ctx.restore();
  }

  // overlay for readability
  ctx.save();
  const ov = ctx.createLinearGradient(artX, artY + artH * 0.1, artX, artY + artH);
  ov.addColorStop(0, "rgba(0,0,0,0.02)");
  ov.addColorStop(0.55, "rgba(0,0,0,0.18)");
  ov.addColorStop(1, "rgba(0,0,0,0.74)");
  ctx.fillStyle = ov;
  drawRoundedRect(ctx, artX, artY, artW, artH, 34);
  ctx.fill();
  ctx.restore();

  // Value chip (overlay no retrato para não colidir com os stats)
  const value = typeof card?.value === "number" ? `${formatCoins(card.value)} 🪙` : null;
  if (value) {
    const chipW = 240;
    const chipH = 52;
    const chipX = artX + artW - chipW - 18;
    const chipY = artY + 18;
    pill(ctx, chipX, chipY, chipW, chipH, accent, value, { weight: 900, alpha: 0.14 });
  }

  // Badges (circles)
  const badgeR = 38;
  const badgeY = artY + artH - badgeR - 22;
  const leftCx = artX + badgeR + 22;
  const rightCx = artX + artW - badgeR - 22;

  if (clubBadge) {
    ctx.save();
    shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(leftCx, badgeY, badgeR + 5, 0, Math.PI * 2);
    ctx.fill();
    resetShadow(ctx);
    drawCircleImage(ctx, clubBadge, leftCx, badgeY, badgeR);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(accent, 0.78);
    ctx.beginPath();
    ctx.arc(leftCx, badgeY, badgeR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (!clubBadge && card?.clubName) {
    drawBadgeFallback(ctx, leftCx, badgeY, badgeR, accent, initialsFromName(String(card.clubName)));
  }

  if (flag) {
    ctx.save();
    shadow(ctx, { blur: 18, color: "rgba(0,0,0,0.60)", y: 12 });
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(rightCx, badgeY, badgeR + 5, 0, Math.PI * 2);
    ctx.fill();
    resetShadow(ctx);
    drawCircleImage(ctx, flag, rightCx, badgeY, badgeR);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(accent, 0.78);
    ctx.beginPath();
    ctx.arc(rightCx, badgeY, badgeR + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (!flag && card?.countryCode) {
    drawBadgeFallback(ctx, rightCx, badgeY, badgeR, accent, String(card.countryCode).toUpperCase());
  }

  // Name + club line
  const name = String(card?.name ?? "Jogador");
  const club = card?.clubName ? String(card.clubName).toUpperCase() : "";
  const cc = card?.countryCode ? String(card.countryCode).toUpperCase() : "";
  const sub = [club, cc].filter(Boolean).join(" • ");

  const nameY = 706;
  const nameH = 92;

  ctx.save();
  shadow(ctx, { blur: 24, color: "rgba(0,0,0,0.70)", y: 14 });
  const ng = ctx.createLinearGradient(innerX, nameY, innerX + innerW, nameY + nameH);
  ng.addColorStop(0, rgba(accent, 0.12));
  ng.addColorStop(0.5, "rgba(255,255,255,0.10)");
  ng.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = ng;
  drawRoundedRect(ctx, innerX, nameY, innerW, nameH, 28);
  ctx.fill();
  resetShadow(ctx);

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(accent, 0.55);
  drawRoundedRect(ctx, innerX, nameY, innerW, nameH, 28);
  ctx.stroke();
  ctx.restore();

  const nameSize = fitText(ctx, name, innerW - 80, 52, 28, 900);
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 ${nameSize}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  textStroke(ctx, name, innerX + innerW / 2, nameY + 58, "rgba(255,255,255,0.96)", "rgba(0,0,0,0.72)", 10);
  if (sub) {
    const subSize = fitText(ctx, sub, innerW - 120, 18, 12, 800);
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.font = `800 ${subSize}px ${FONT}`;
    ctx.fillText(sub, innerX + innerW / 2, nameY + 84);
  }
  ctx.restore();

  // Stats
  const stats = card?.stats ?? {};
  const order = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const entries = order.map((k) => [k, stats[k] ?? "—"]);

  const statsY = nameY + nameH + 22;
  const gap = 14;
  const pillW = Math.floor((innerW - gap) / 2);
  const pillH = 60;

  for (let i = 0; i < entries.length; i++) {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const x = innerX + col * (pillW + gap);
    const y = statsY + row * (pillH + 12);
    const [k, v] = entries[i];
    drawStat(ctx, x, y, pillW, pillH, accent, k, v);
  }

  // Footer
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.26)";
  ctx.font = `800 16px ${FONT}`;
  ctx.fillText(`ID: ${card?.id ?? "—"}`, innerX, H - 56);
  ctx.textAlign = "right";
  ctx.fillText("MASTER BOT • FUT STYLE", innerX + innerW, H - 56);
  ctx.restore();

  applyNoise(ctx, W, H, 0.08);
  const out = canvas.toBuffer("image/png");
  cacheSet(renderedCache, key, out, maxRenderedCache);
  return out;
}
