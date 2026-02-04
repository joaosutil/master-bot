import { readFile, access } from "node:fs/promises";
import path from "node:path";

let CACHE = null;

const ALLOWED_POS = new Set(["GOL", "ZAG", "LE", "LD", "VOL", "MC", "MEI", "PE", "PD", "ATA"]);

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function safeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .slice(0, 120);
}

function normalizeStats(stats) {
  const s = stats ?? {};
  const get = (k) => Number(s[k] ?? s[k.toLowerCase()] ?? s[k.toUpperCase()] ?? 0);

  return {
    PAC: clamp(get("PAC"), 1, 99),
    SHO: clamp(get("SHO"), 1, 99),
    PAS: clamp(get("PAS"), 1, 99),
    DRI: clamp(get("DRI"), 1, 99),
    DEF: clamp(get("DEF"), 1, 99),
    PHY: clamp(get("PHY"), 1, 99)
  };
}

function normalizePos(pos) {
  const p = String(pos ?? "").trim().toUpperCase();
  if (!p) return "MEI";

  if (["TEC", "TECNICO", "TÉCNICO", "TREINADOR", "COACH", "TRAINER", "MANAGER"].includes(p)) return "TEC";

  if (["GOL", "GK"].includes(p)) return "GOL";
  if (["ZAG", "CB", "ZC"].includes(p)) return "ZAG";
  if (["LE", "LB"].includes(p)) return "LE";
  if (["LD", "RB"].includes(p)) return "LD";

  if (["VOL", "CDM"].includes(p)) return "VOL";
  if (["MC", "CM"].includes(p)) return "MC";
  if (["MEI", "CAM"].includes(p)) return "MEI";

  if (["PE", "LW"].includes(p)) return "PE";
  if (["PD", "RW"].includes(p)) return "PD";

  if (["ATA", "ST", "CF"].includes(p)) return "ATA";
  return p;
}

function isStaffLike(rawPosition, status) {
  const st = String(status ?? "").trim().toLowerCase();
  if (st === "coaching") return true;

  const rp = String(rawPosition ?? "").trim().toLowerCase();
  if (!rp) return false;
  const hints = ["coach", "manager", "trainer", "assistant", "goalkeeping", "keeper coach"];
  return hints.some((h) => rp.includes(h));
}

function weightsByPos(pos) {
  const p = normalizePos(pos);

  if (p === "GOL") {
    return { DEF: 0.34, PAS: 0.22, PHY: 0.18, DRI: 0.14, PAC: 0.07, SHO: 0.05 };
  }

  if (["ZAG", "LD", "LE"].includes(p)) {
    return { DEF: 0.30, PHY: 0.20, PAC: 0.16, PAS: 0.14, DRI: 0.10, SHO: 0.10 };
  }

  if (["VOL", "MC", "MEI"].includes(p)) {
    return { PAS: 0.26, DRI: 0.20, DEF: 0.18, PAC: 0.14, SHO: 0.10, PHY: 0.12 };
  }

  // ATA / pontas
  return { PAC: 0.24, SHO: 0.24, DRI: 0.20, PAS: 0.14, PHY: 0.10, DEF: 0.08 };
}

function computeOvrRaw(stats, pos) {
  const w = weightsByPos(pos);
  const raw =
    stats.PAC * w.PAC +
    stats.SHO * w.SHO +
    stats.PAS * w.PAS +
    stats.DRI * w.DRI +
    stats.DEF * w.DEF +
    stats.PHY * w.PHY;
  return clamp(raw, 1, 99);
}

function rarityFromRank(rank, total) {
  const pct = (rank + 1) / Math.max(1, total); // 0..1 (1=melhor)

  // distribuição “FIFA-like” mais balanceada (menos 90+ no pool)
  if (pct >= 0.985) return "legendary";
  if (pct >= 0.92) return "epic";
  if (pct >= 0.65) return "rare";
  return "common";
}

function rarityBand(pct) {
  if (pct >= 0.985) return { key: "legendary", lo: 0.985, hi: 1.0, min: 90, max: 99 };
  if (pct >= 0.92) return { key: "epic", lo: 0.92, hi: 0.985, min: 84, max: 93 };
  if (pct >= 0.65) return { key: "rare", lo: 0.65, hi: 0.92, min: 72, max: 88 };
  return { key: "common", lo: 0.0, hi: 0.65, min: 55, max: 80 };
}

function scaleStatsToOvr(stats, scale) {
  const s = stats ?? {};
  const keys = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  for (const k of keys) {
    const v = Number(s[k] ?? 0);
    if (!Number.isFinite(v) || v <= 0) continue;
    s[k] = clamp(Math.round(v * scale), 20, 99);
  }
  return s;
}

function pruneBalanced(cards, limit) {
  if (cards.length <= limit) return cards;

  const byPos = new Map();
  for (const c of cards) {
    const p = String(c.pos ?? "");
    if (!byPos.has(p)) byPos.set(p, []);
    byPos.get(p).push(c);
  }

  for (const arr of byPos.values()) {
    arr.sort((a, b) => (b.ovr - a.ovr) || a.name.localeCompare(b.name, "pt-BR"));
  }

  const share = new Map([
    ["GOL", 0.12],
    ["ZAG", 0.28],
    ["LE", 0.10],
    ["LD", 0.10],
    ["VOL", 0.10],
    ["MC", 0.12],
    ["MEI", 0.10],
    ["PE", 0.04],
    ["PD", 0.04],
    ["ATA", 0.10]
  ]);

  const picks = [];
  const pickedIds = new Set();

  for (const [pos, arr] of byPos.entries()) {
    const s = share.get(pos) ?? 0.06;
    let q = Math.round(limit * s);
    if (pos === "GOL") q = Math.max(q, 10);
    q = clamp(q, 0, arr.length);

    for (const c of arr.slice(0, q)) {
      if (pickedIds.has(c.id)) continue;
      pickedIds.add(c.id);
      picks.push(c);
    }
  }

  if (picks.length < limit) {
    const rest = cards
      .filter((c) => !pickedIds.has(c.id))
      .sort((a, b) => (b.ovr - a.ovr) || a.name.localeCompare(b.name, "pt-BR"));

    for (const c of rest) {
      if (picks.length >= limit) break;
      pickedIds.add(c.id);
      picks.push(c);
    }
  }

  return picks.slice(0, limit);
}

export function cardValue(card) {
  const ovr = Number(card?.ovr ?? 0);
  const rarity = card?.rarity ?? "common";

  // economia em "mercado do futebol": casa de 100 mil, 1 mi, 10 mi...
  const base =
    rarity === "legendary" ? 6_000_000 :
    rarity === "epic" ? 1_800_000 :
    rarity === "rare" ? 450_000 :
    120_000;

  const t = clamp((ovr - 55) / 44, 0, 1); // 55..99
  const curve = Math.pow(0.65 + 1.95 * t, 2.15);
  const raw = base * curve;

  // arredonda pra números "bonitos"
  const step = raw >= 10_000_000 ? 100_000 : 10_000;
  const rounded = Math.round(raw / step) * step;
  return Math.max(10_000, rounded);
}

function normalizeCard(c) {
  const id = String(c?.id ?? "").trim();
  const playerId = c?.playerId ? String(c.playerId).trim() : null;
  const name = String(c?.name ?? "").trim() || "Jogador";

  const stats = normalizeStats(c?.stats);
  const pos = normalizePos(c?.pos);
  const ovrRaw = computeOvrRaw(stats, pos);

  const portraitFile = c?.portraitFile ? path.basename(String(c.portraitFile)) : null;
  const countryCode = c?.countryCode ? String(c.countryCode).toLowerCase() : null;
  const rawPosition = c?.rawPosition ? String(c.rawPosition) : null;
  const status = c?.status ? String(c.status) : null;

  let clubBadgeFile = c?.clubBadgeFile ? path.basename(String(c.clubBadgeFile)) : null;
  const clubId = c?.clubId ? String(c.clubId) : null;
  const clubName = c?.clubName ? String(c.clubName) : null;
  if (!clubBadgeFile && clubId && clubName) {
    clubBadgeFile = `${safeName(clubName)}_${clubId}.png`;
  }

  const out = {
    id,
    playerId,
    name,
    pos,
    ovrRaw,
    ovr: Math.round(ovrRaw),
    stats,
    clubId,
    clubName,
    clubBadgeFile,
    countryCode,
    nationality: c?.nationality ?? null,
    portraitFile,
    portraitUrl: c?.portraitUrl ?? null,
    rawPosition,
    status
  };

  out.rarity = c?.rarity ?? "common"; // placeholder, ajustado depois por ranking
  out.value = cardValue(out);
  return out;
}

async function loadFromDisk() {
  const rel = process.env.CARDS_PATH || "data/cards.json";
  const p = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);

  if (!(await exists(p))) {
    throw new Error(`cards.json não encontrado em: ${p}`);
  }

  const raw = await readFile(p, "utf8");
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.cards ?? [];
  if (!Array.isArray(arr)) throw new Error("cards.json inválido (esperava array).");

  const includeCoaches = String(process.env.INCLUDE_COACHES ?? "").trim() === "1";
  const includeStaff = String(process.env.INCLUDE_STAFF ?? "").trim() === "1";
  let cards = arr
    .map(normalizeCard)
    .filter((c) => c.id && c.name)
    // remove cards that don't belong to the squad game (ex.: técnicos)
    .filter((c) => (includeCoaches ? true : c.pos !== "TEC"))
    // remove staff (TheSportsDB às vezes mistura comissão técnica)
    .filter((c) => (includeStaff ? true : !isStaffLike(c.rawPosition, c.status)))
    .filter((c) => ALLOWED_POS.has(c.pos) || (includeCoaches && c.pos === "TEC"));

  // escala OVR pra ficar mais “FIFA-like” (range mais gostoso)
  // raridade/OVR por percentil no pool completo (evita "OVR alto pra todo mundo")
  cards.sort((a, b) => (a.ovrRaw - b.ovrRaw) || a.name.localeCompare(b.name, "pt-BR")); // pior -> melhor
  const totalAll = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const pct = (i + 1) / Math.max(1, totalAll);
    const band = rarityBand(pct);
    const localT = clamp((pct - band.lo) / Math.max(1e-6, band.hi - band.lo), 0, 1);

    cards[i].rarity = band.key;
    cards[i].ovr = clamp(Math.round(band.min + localT * (band.max - band.min)), 45, 99);

    // ajusta levemente os stats pra acompanharem o OVR final (evita card 90+ com stats baixos)
    const rawNow = computeOvrRaw(cards[i].stats, cards[i].pos);
    const scale = clamp(cards[i].ovr / Math.max(1, rawNow), 0.82, 1.28);
    cards[i].stats = scaleStatsToOvr(cards[i].stats, scale);
    cards[i].ovrRaw = computeOvrRaw(cards[i].stats, cards[i].pos);

    cards[i].value = cardValue(cards[i]);
  }

  // prune leve (diminuir um pouco a quantidade) + balanceado por posição (garante GOL)
  const limitRaw = process.env.CARDS_LIMIT ? Number(process.env.CARDS_LIMIT) : 200;
  const limit = Number.isFinite(limitRaw) ? clamp(Math.floor(limitRaw), 50, 2000) : 200;

  if (cards.length > limit) cards = pruneBalanced(cards, limit);

  // melhor -> pior por padrão (pra UX)
  cards.sort((a, b) => (b.ovr - a.ovr) || a.name.localeCompare(b.name, "pt-BR"));
  return cards;
}

export async function getCardPool() {
  if (CACHE) return CACHE;
  CACHE = await loadFromDisk();
  console.log(`[cardsStore] carregado: ${CACHE.length} cards`);
  return CACHE;
}

export async function pickRandomCardByRarity(rarity) {
  const cards = await getCardPool();
  const r = String(rarity ?? "").toLowerCase();
  const pool = cards.filter((c) => String(c?.rarity ?? "").toLowerCase() === r);
  const arr = pool.length ? pool : cards;
  const picked = arr[Math.floor(Math.random() * arr.length)];
  return structuredClone ? structuredClone(picked) : JSON.parse(JSON.stringify(picked));
}
