// scripts/sync-cards.mjs
// Gera data/cards.json automaticamente a partir do TheSportsDB,
// baixando portraits dos jogadores + badge do clube + flag do país.
// Compatível com Node que NÃO suporta `assert { type: "json" }`.
//
// Se seu Node for < 18 (não tem fetch global), rode:
//   npm i node-fetch
//
// .env recomendado:
//   TSDB_KEY=123
//   TSDB_DELAY_MS=2500

import "dotenv/config";
import { mkdir, readFile, writeFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import countries from "i18n-iso-countries";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const enLocale = require("i18n-iso-countries/langs/en.json");
countries.registerLocale(enLocale);

// fetch compat (Node 18+ já tem globalThis.fetch)
const fetchFn =
  globalThis.fetch ??
  (await import("node-fetch").then((m) => m.default)).bind(globalThis);

const API_KEY = process.env.TSDB_KEY || "123";
const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const DELAY_MS = Number(process.env.TSDB_DELAY_MS || "2500");

const CACHE_DIR = path.join(process.cwd(), ".cache", "tsdb");
const OUT_CARDS = path.join(process.cwd(), "data", "cards.json");
const SEEDS_PATH = path.join(process.cwd(), "data", "seeds.json");

const ASSETS_ABS = {
  portraits: path.join(process.cwd(), "assets", "portraits"),
  badges: path.join(process.cwd(), "assets", "badges"),
  flags: path.join(process.cwd(), "assets", "flags")
};

// Relativos (sempre com /, pra não quebrar em Windows/Linux)
const ASSETS_REL = {
  portraits: "assets/portraits",
  badges: "assets/badges",
  flags: "assets/flags"
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    .slice(0, 120);
}

function extFromUrl(url) {
  const clean = String(url || "").split("?")[0];
  const m = clean.match(/\.(png|jpg|jpeg|webp)$/i);
  return m ? `.${m[1].toLowerCase()}` : ".png";
}

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function fetchJsonCached(url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = hashKey(url);
  const file = path.join(CACHE_DIR, `${key}.json`);

  if (await exists(file)) {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  }

  let attempt = 0;
  let wait = 2000;

  while (true) {
    attempt++;

    const res = await fetchFn(url, {
      headers: { "User-Agent": "master-bot-sync/1.0" }
    });

    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") || "0");
      const ms = ra ? ra * 1000 : wait;
      console.log(`[429] rate limit. esperando ${Math.ceil(ms / 1000)}s...`);
      await sleep(ms);
      wait = Math.min(wait * 2, 60000);
      continue;
    }

    if (!res.ok) {
      if (res.status >= 500 && attempt < 6) {
        console.log(`[${res.status}] retry em ${Math.ceil(wait / 1000)}s...`);
        await sleep(wait);
        wait = Math.min(wait * 2, 60000);
        continue;
      }
      throw new Error(`HTTP ${res.status} em ${url}`);
    }

    const data = await res.json();
    await writeFile(file, JSON.stringify(data, null, 2), "utf8");
    await sleep(DELAY_MS);
    return data;
  }
}

async function downloadFile(url, outPath) {
  if (!url) return null;
  await mkdir(path.dirname(outPath), { recursive: true });

  if (await exists(outPath)) return outPath;

  // retry simples
  let attempt = 0;
  let wait = 1500;

  while (true) {
    attempt++;
    const res = await fetchFn(url);
    if (res.status === 429) {
      console.log(`[429] download rate limit. esperando ${Math.ceil(wait / 1000)}s...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
      continue;
    }
    if (!res.ok) {
      console.log(`Falha ao baixar: ${url} (${res.status})`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outPath, buf);
    await sleep(DELAY_MS);
    return outPath;
  }
}

function normalizeCountryName(n) {
  if (!n) return null;
  const s = String(n).trim();
  const map = {
    USA: "United States",
    "U.S.A.": "United States",
    England: "United Kingdom",
    Scotland: "United Kingdom",
    Wales: "United Kingdom",
    Korea: "South Korea",
    "Czech Republic": "Czechia"
  };
  return map[s] || s;
}

function countryCodeFromNationality(nationality) {
  const norm = normalizeCountryName(nationality);
  if (!norm) return null;
  return countries.getAlpha2Code(norm, "en") || null;
}

function flagUrlFromCode(code) {
  return `https://flagcdn.com/w80/${code.toLowerCase()}.png`;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededFromId(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return mulberry32(h >>> 0);
}

function posToPt(posRaw) {
  const p = String(posRaw || "").toLowerCase().trim();
  if (!p) return null;

  // Exclui comissão técnica / staff
  // TheSportsDB costuma usar: "Assistant Coach", "Goalkeeping Coach", "Manager", etc.
  const staffHints = ["coach", "manager", "trainer", "assistant", "goalkeeping", "keeper coach"];
  if (staffHints.some((h) => p.includes(h))) return null;

  // GK
  if (p.includes("goalkeeper") || (p.includes("goal") && p.includes("keep")) || p === "gk") return "GOL";

  // fullbacks
  if (p.includes("left back") || p.includes("left-back") || p === "lb" || p.includes("left fullback") || p.includes("left full-back"))
    return "LE";
  if (p.includes("right back") || p.includes("right-back") || p === "rb" || p.includes("right fullback") || p.includes("right full-back"))
    return "LD";

  // center backs / defenders
  if (p.includes("centre-back") || p.includes("center-back") || p === "cb" || p.includes("defender") || p.includes("back"))
    return "ZAG";

  // midfield
  if (p.includes("defensive midfield") || p.includes("holding midfield") || p === "cdm" || p.includes("dm")) return "VOL";
  if (p.includes("attacking midfield") || p === "cam") return "MEI";
  if (p.includes("central midfield") || p === "cm") return "MC";
  if (p.includes("midfield") || p.includes("midfielder") || p.includes("mid")) return "MEI";

  // wings
  if (p.includes("left wing") || p.includes("left winger") || p === "lw" || p.includes("left forward")) return "PE";
  if (p.includes("right wing") || p.includes("right winger") || p === "rw" || p.includes("right forward")) return "PD";

  // attack
  if (p.includes("centre-forward") || p.includes("center-forward") || p.includes("striker") || p.includes("forward") || p.includes("attack") || p === "st" || p === "cf")
    return "ATA";

  // generic winger
  if (p.includes("winger") || p.includes("wing")) return "ATA";

  return null;
}

function genOvrAndStats(playerId, pos) {
  const rng = seededFromId(playerId);
  const base = 60 + Math.floor(rng() * 35); // 60..94
  let ovr = base;

  let rarity = "common";
  if (ovr >= 90) rarity = "legendary";
  else if (ovr >= 84) rarity = "epic";
  else if (ovr >= 75) rarity = "rare";

  const bias =
    {
      GOL: { pac: 0.25, sho: 0.2, pas: 0.85, dri: 0.55, def: 0.65, phy: 0.65 },
      ZAG: { pac: 0.55, sho: 0.25, pas: 0.55, dri: 0.45, def: 1.0, phy: 0.85 },
      MEI: { pac: 0.65, sho: 0.55, pas: 1.0, dri: 0.9, def: 0.55, phy: 0.65 },
      ATA: { pac: 1.0, sho: 0.95, pas: 0.65, dri: 0.9, def: 0.25, phy: 0.7 }
    }[pos] || { pac: 0.7, sho: 0.6, pas: 0.7, dri: 0.7, def: 0.5, phy: 0.6 };

  const jitter = () => Math.floor((rng() - 0.5) * 10);
  const stat = (mult) => {
    const v = Math.round(ovr * mult) + jitter();
    return Math.max(20, Math.min(99, v));
  };

  const stats = {
    pac: stat(bias.pac),
    sho: stat(bias.sho),
    pas: stat(bias.pas),
    dri: stat(bias.dri),
    def: stat(bias.def),
    phy: stat(bias.phy)
  };

  const avg = Math.round((stats.pac + stats.sho + stats.pas + stats.dri + stats.def + stats.phy) / 6);
  ovr = Math.round((ovr + avg) / 2);

  return { ovr, rarity, stats };
}

async function findFileByName(rootDir, fileName, maxDepth = 6) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push({ dir: fullPath, depth: depth + 1 });
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
      }
    }
  }
  return null;
}

async function loadSeeds() {
  if (!(await exists(SEEDS_PATH))) {
    throw new Error(`Crie o arquivo data/seeds.json (não achei em ${SEEDS_PATH})`);
  }
  return JSON.parse(await readFile(SEEDS_PATH, "utf8"));
}

// ===== TSDB endpoints =====
async function lookupAllTeamsByLeague(leagueId) {
  const url = `${BASE}/lookup_all_teams.php?id=${leagueId}`;
  const data = await fetchJsonCached(url);
  return data?.teams || [];
}

async function lookupTeam(teamId) {
  const url = `${BASE}/lookupteam.php?id=${teamId}`;
  const data = await fetchJsonCached(url);
  return data?.teams?.[0] || null;
}

async function lookupAllPlayers(teamId) {
  const url = `${BASE}/lookup_all_players.php?id=${teamId}`;
  const data = await fetchJsonCached(url);
  return data?.player || [];
}

async function lookupPlayer(playerId) {
  const url = `${BASE}/lookupplayer.php?id=${playerId}`;
  const data = await fetchJsonCached(url);
  return data?.players?.[0] || null;
}

function bestPlayerImage(p) {
  return p?.strCutout || p?.strThumb || p?.strRender || p?.strFanart1 || null;
}

function normalizeBadgeUrl(url) {
  // TheSportsDB costuma aceitar /small e /preview em imagens.
  // Se der ruim no seu caso, remova o sufixo e use a URL pura.
  if (!url) return null;
  return url.includes("/") ? `${url}/small` : url;
}

function normalizePortraitUrl(url) {
  if (!url) return null;
  return url.includes("/") ? `${url}/medium` : url;
}

async function main() {
  const seeds = await loadSeeds();

  await mkdir(path.join(process.cwd(), "data"), { recursive: true });
  await mkdir(ASSETS_ABS.portraits, { recursive: true });
  await mkdir(ASSETS_ABS.badges, { recursive: true });
  await mkdir(ASSETS_ABS.flags, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const onlySoccer = seeds.onlySoccer ?? true;
  const maxTeams = seeds.maxTeams ?? 99999;
  const maxPlayersPerTeam = seeds.maxPlayersPerTeam ?? 35;

  // 1) Monta a lista de teams
  const teamIdSet = new Set((seeds.teams || []).map(String));

  for (const leagueId of seeds.leagues || []) {
    const teams = await lookupAllTeamsByLeague(leagueId);
    for (const t of teams) {
      if (onlySoccer && String(t.strSport || "").toLowerCase() !== "soccer") continue;
      if (t?.idTeam) teamIdSet.add(String(t.idTeam));
    }
  }

  const teamIds = Array.from(teamIdSet).slice(0, maxTeams);
  console.log(`Times para sync: ${teamIds.length}`);

  const cards = [];
  const seen = new Set();

  for (const teamId of teamIds) {
    const team = await lookupTeam(teamId);
    const teamName = team?.strTeam || `Team_${teamId}`;

    // badge do time
    const badgeUrlRaw = team?.strTeamBadge || null;
    const badgeUrl = normalizeBadgeUrl(badgeUrlRaw);
    const badgeExt = badgeUrl ? extFromUrl(badgeUrl) : ".png";
    const badgeRel = badgeUrl ? `${ASSETS_REL.badges}/${safeName(teamId)}${badgeExt}` : null;
    const badgeAbs = badgeUrl ? path.join(process.cwd(), badgeRel) : null;
    if (badgeUrl && badgeAbs) await downloadFile(badgeUrl, badgeAbs);

    console.log(`\n[${teamId}] ${teamName}`);

    const playersRaw = await lookupAllPlayers(teamId);
    const players = playersRaw.slice(0, maxPlayersPerTeam);

    for (const pr of players) {
      const playerId = pr?.idPlayer;
      if (!playerId) continue;

      const statusEarly = String(pr?.strStatus || "").trim().toLowerCase();
      if (statusEarly === "coaching") continue;

      // filtra staff cedo pelo position do pr (evita chamadas extras)
      const posEarly = posToPt(pr?.strPosition);
      if (!posEarly) continue;

      let p = pr;
      let imgUrl = bestPlayerImage(p);

      // chama lookupplayer só se precisar
      if (!imgUrl) {
        const full = await lookupPlayer(playerId);
        if (full) {
          p = full;
          imgUrl = bestPlayerImage(p);
        }
      }

      if (!imgUrl) continue;

      const status = String(p?.strStatus || pr?.strStatus || "").trim().toLowerCase();
      if (status === "coaching") continue;

      const portraitUrl = normalizePortraitUrl(imgUrl);
      const portraitExt = extFromUrl(portraitUrl);
      const portraitRel = `${ASSETS_REL.portraits}/${safeName(playerId)}${portraitExt}`;
      const portraitAbs = path.join(process.cwd(), portraitRel);
      await downloadFile(portraitUrl, portraitAbs);

      const nationality = p?.strNationality || null;
      const countryCode = countryCodeFromNationality(nationality);

      let flagRel = null;
      let flagUrl = null;
      if (countryCode) {
        flagUrl = flagUrlFromCode(countryCode);
        flagRel = `${ASSETS_REL.flags}/${countryCode.toLowerCase()}.png`;
        await downloadFile(flagUrl, path.join(process.cwd(), flagRel));
      }

      const rawPosition = String(p?.strPosition || pr?.strPosition || "");
      const pos = posToPt(rawPosition) ?? posEarly;
      if (!pos) continue;
      const { ovr, rarity, stats } = genOvrAndStats(playerId, pos);

      const cardId = `p_${playerId}`;
      if (seen.has(cardId)) continue;
      seen.add(cardId);

      cards.push({
        id: cardId,
        playerId: String(playerId),

        name: p?.strPlayer || pr?.strPlayer || "Unknown",
        rarity,
        ovr,
        pos,
        stats,

        clubId: String(teamId),
        clubName: teamName,
        clubBadgeFile: badgeRel,
        clubBadgeUrl: badgeUrlRaw,

        nationality,
        countryCode,
        flagFile: flagRel,
        flagUrl,

        portraitFile: portraitRel,
        portraitUrl,

        // metadados pra depuração / filtros futuros
        rawPosition,
        status: p?.strStatus || pr?.strStatus || null
      });
    }

    console.log(`Cards acumulados: ${cards.length}`);
  }

  await writeFile(OUT_CARDS, JSON.stringify(cards, null, 2), "utf8");
  console.log(`\n✅ Gerado: ${OUT_CARDS}`);
  console.log(`✅ Imagens em: ${ASSETS_REL.portraits}, ${ASSETS_REL.badges}, ${ASSETS_REL.flags}`);
  console.log(`✅ Cache em: .cache/tsdb (pra não estourar 429 nas próximas vezes)`);
}

main().catch(async (e) => {
  console.error("sync-cards ERROR:", e);

  // dica automática: se seeds.json não existir, tenta achar em outro lugar
  if (String(e?.message || "").includes("seeds.json")) {
    const found = await findFileByName(process.cwd(), "seeds.json", 6);
    if (found) console.error(`Achei um seeds.json em: ${found} (mova pra /data/seeds.json)`);
  }

  process.exit(1);
});
