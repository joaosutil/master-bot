import mongoose from "mongoose";
import { MatchProfile } from "./matchModel.js";
import { hydrateSquad } from "../squad/squadService.js";

const GLOBAL_SCOPE_GUILD_ID = "global";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function samplePoisson(lambda, rng) {
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function weightedPick(items, weightFn, rng) {
  let total = 0;
  for (const it of items) total += Math.max(0, Number(weightFn(it)) || 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, Number(weightFn(it)) || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function cardStat(card, key, fallback = 50) {
  const s = card?.stats ?? {};
  const v = s?.[key] ?? s?.[String(key).toUpperCase()] ?? s?.[String(key).toLowerCase()];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePos(pos) {
  const p = String(pos ?? "").trim().toUpperCase();
  if (!p) return "MEI";
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

function buildTeamRatings(lineup) {
  const starters = (lineup ?? []).map((x) => x.card).filter(Boolean);
  if (!starters.length) return { ovr: 0, atk: 0, mid: 0, def: 0 };

  const ovr = Math.round(starters.reduce((acc, c) => acc + (Number(c.ovr) || 0), 0) / starters.length);

  const atkCards = starters.filter((c) => ["ATA", "PE", "PD", "MEI", "MC"].includes(normalizePos(c.pos)));
  const defCards = starters.filter((c) => ["GOL", "ZAG", "LE", "LD", "VOL"].includes(normalizePos(c.pos)));

  const atk = Math.round(
    (atkCards.length ? atkCards : starters).reduce((acc, c) => {
      const sho = cardStat(c, "SHO", 50);
      const pac = cardStat(c, "PAC", 50);
      const dri = cardStat(c, "DRI", 50);
      const pas = cardStat(c, "PAS", 50);
      return acc + sho * 0.42 + pac * 0.18 + dri * 0.22 + pas * 0.18;
    }, 0) / Math.max(1, (atkCards.length ? atkCards : starters).length)
  );

  const mid = Math.round(
    starters.reduce((acc, c) => {
      const pas = cardStat(c, "PAS", 50);
      const dri = cardStat(c, "DRI", 50);
      const def = cardStat(c, "DEF", 50);
      const phy = cardStat(c, "PHY", 50);
      return acc + pas * 0.34 + dri * 0.22 + def * 0.24 + phy * 0.20;
    }, 0) / starters.length
  );

  const def = Math.round(
    (defCards.length ? defCards : starters).reduce((acc, c) => {
      const defv = cardStat(c, "DEF", 50);
      const phy = cardStat(c, "PHY", 50);
      const pas = cardStat(c, "PAS", 50);
      const pac = cardStat(c, "PAC", 50);
      return acc + defv * 0.52 + phy * 0.26 + pas * 0.12 + pac * 0.10;
    }, 0) / Math.max(1, (defCards.length ? defCards : starters).length)
  );

  return { ovr, atk, mid, def };
}

function expectedGoals({ team, opp, rng }) {
  const base = 1.18;
  const diffAtkDef = (team.atk - opp.def) / 32;
  const diffOvr = (team.ovr - opp.ovr) / 55;
  const diffMid = (team.mid - opp.mid) / 60;

  let lambda = base + diffAtkDef + diffOvr + diffMid;

  // upset factor: underdog sometimes gets a strong momentum swing
  const ovrGap = opp.ovr - team.ovr;
  if (ovrGap >= 6 && rng() < 0.28) {
    const boost = 1 + rng() * 0.38;
    lambda *= boost;
  }

  // small global randomness
  lambda *= 0.88 + rng() * 0.30;

  return clamp(lambda, 0.25, 3.9);
}

function pickScorer(lineup, rng) {
  const starters = (lineup ?? []).map((x) => x.card).filter(Boolean);
  const eligible = starters.filter((c) => ["ATA", "PE", "PD", "MEI", "MC"].includes(normalizePos(c.pos)));
  const pool = eligible.length ? eligible : starters;
  return weightedPick(
    pool,
    (c) => cardStat(c, "SHO", 50) * 1.0 + cardStat(c, "PAC", 50) * 0.25 + cardStat(c, "DRI", 50) * 0.35,
    rng
  );
}

function pickAssist(lineup, scorerId, rng) {
  const starters = (lineup ?? []).map((x) => x.card).filter(Boolean);
  const eligible = starters.filter((c) => c?.id !== scorerId && ["PE", "PD", "MEI", "MC", "VOL"].includes(normalizePos(c.pos)));
  const pool = eligible.length ? eligible : starters.filter((c) => c?.id !== scorerId);
  if (!pool.length) return null;
  return weightedPick(pool, (c) => cardStat(c, "PAS", 50) * 1.0 + cardStat(c, "DRI", 50) * 0.25, rng);
}

function buildTimeline({ goalsA, goalsB, rng, lineupA, lineupB }) {
  const events = [];
  const minutesTaken = new Set();

  function sampleMinute() {
    // more goals in 2nd half
    const t = rng();
    const min = t < 0.46 ? randInt(rng, 3, 45) : randInt(rng, 46, 90);
    return min;
  }

  function nextMinute() {
    for (let i = 0; i < 30; i++) {
      const m = sampleMinute();
      if (!minutesTaken.has(m)) {
        minutesTaken.add(m);
        return m;
      }
    }
    let m = sampleMinute();
    while (minutesTaken.has(m)) m = sampleMinute();
    minutesTaken.add(m);
    return m;
  }

  for (let i = 0; i < goalsA; i++) {
    const minute = nextMinute();
    const scorer = pickScorer(lineupA, rng);
    const assist = rng() < 0.62 ? pickAssist(lineupA, scorer?.id, rng) : null;
    events.push({ minute, side: "A", scorer: scorer?.name ?? "Jogador", assist: assist?.name ?? null });
  }

  for (let i = 0; i < goalsB; i++) {
    const minute = nextMinute();
    const scorer = pickScorer(lineupB, rng);
    const assist = rng() < 0.62 ? pickAssist(lineupB, scorer?.id, rng) : null;
    events.push({ minute, side: "B", scorer: scorer?.name ?? "Jogador", assist: assist?.name ?? null });
  }

  events.sort((a, b) => a.minute - b.minute);
  return events;
}

function scoreAtMinute(events, minute) {
  let a = 0;
  let b = 0;
  for (const e of events) {
    if (e.minute > minute) break;
    if (e.side === "A") a++;
    else b++;
  }
  return { a, b };
}

function buildHighlights(events, minute, { teamAName, teamBName }) {
  const shown = events.filter((e) => e.minute <= minute).slice(-6);
  if (!shown.length) return "• (sem lances ainda)";
  return shown
    .map((e) => {
      const team = e.side === "A" ? teamAName : teamBName;
      const assist = e.assist ? ` (assist: ${e.assist})` : "";
      return `• **${e.minute}'** — ${team}: **${e.scorer}**${assist}`;
    })
    .join("\n");
}

function eloDelta(a, b, scoreA, { k = 32 } = {}) {
  const ea = 1 / (1 + Math.pow(10, (b - a) / 400));
  const delta = Math.round(k * (scoreA - ea));
  return delta;
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function ensureGlobalProfileMerged(userId, { session } = {}) {
  const global = await withSession(
    MatchProfile.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId })
      .select({ legacyMerged: 1, rankedMmr: 1 })
      .lean(),
    session
  );
  if (global?.legacyMerged) return;

  const legacy = await withSession(
    MatchProfile.find({ userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } })
      .select({ rankedMmr: 1, rankedWins: 1, rankedDraws: 1, rankedLosses: 1 })
      .lean(),
    session
  );

  if (!legacy.length) {
    await MatchProfile.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $set: { legacyMerged: true } },
      { upsert: true, session }
    );
    return;
  }

  let maxLegacyMmr = 1000;
  let sumWins = 0;
  let sumDraws = 0;
  let sumLosses = 0;

  for (const doc of legacy) {
    const mmr = Number(doc?.rankedMmr ?? 1000);
    if (Number.isFinite(mmr)) maxLegacyMmr = Math.max(maxLegacyMmr, Math.trunc(mmr));
    sumWins += Math.max(0, Math.trunc(Number(doc?.rankedWins ?? 0) || 0));
    sumDraws += Math.max(0, Math.trunc(Number(doc?.rankedDraws ?? 0) || 0));
    sumLosses += Math.max(0, Math.trunc(Number(doc?.rankedLosses ?? 0) || 0));
  }

  const nextMmr = Math.max(
    1000,
    Math.trunc(Number(global?.rankedMmr ?? 1000) || 1000),
    maxLegacyMmr
  );

  await MatchProfile.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      $inc: { rankedWins: sumWins, rankedDraws: sumDraws, rankedLosses: sumLosses },
      $set: { rankedMmr: nextMmr, legacyMerged: true },
      $setOnInsert: { rankedMmr: nextMmr, rankedWins: 0, rankedDraws: 0, rankedLosses: 0 }
    },
    { upsert: true, session }
  );

  await MatchProfile.deleteMany(
    { userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } },
    { session }
  );
}

async function getOrCreateProfile(guildId, userId, { session } = {}) {
  if (mongoose.connection?.readyState !== 1) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  await MatchProfile.findOneAndUpdate(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      $setOnInsert: {
        rankedMmr: 1000,
        rankedWins: 0,
        rankedDraws: 0,
        rankedLosses: 0,
        legacyMerged: false
      }
    },
    { new: true, upsert: true, session }
  );

  await ensureGlobalProfileMerged(userId, { session });

  const doc = await withSession(
    MatchProfile.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).lean(),
    session
  );

  return doc;
}

async function applyRankedResult(guildId, aUserId, bUserId, result) {
  // result: "A" | "B" | "D"
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const a = await getOrCreateProfile(guildId, aUserId, { session });
    const b = await getOrCreateProfile(guildId, bUserId, { session });

    const scoreA = result === "A" ? 1 : result === "D" ? 0.5 : 0;
    const scoreB = 1 - scoreA;

    const da = eloDelta(a.rankedMmr, b.rankedMmr, scoreA, { k: 34 });
    const db = -da;

    const aInc =
      result === "A" ? { rankedWins: 1 } :
      result === "B" ? { rankedLosses: 1 } :
      { rankedDraws: 1 };

    const bInc =
      result === "B" ? { rankedWins: 1 } :
      result === "A" ? { rankedLosses: 1 } :
      { rankedDraws: 1 };

    const updatedA = await MatchProfile.findOneAndUpdate(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId: aUserId },
      { $inc: { rankedMmr: da, ...aInc } },
      { new: true, session }
    ).lean();

    const updatedB = await MatchProfile.findOneAndUpdate(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId: bUserId },
      { $inc: { rankedMmr: db, ...bInc } },
      { new: true, session }
    ).lean();

    await session.commitTransaction();
    return { a: updatedA, b: updatedB, deltaA: da, deltaB: db, scoreA, scoreB };
  } finally {
    session.endSession();
  }
}

function queueKey(guildId, mode) {
  return `${guildId}:${mode}`;
}

const queues = new Map(); // key -> { list: entry[], timeouts: Map<userId, Timeout> }

function getQueue(guildId, mode) {
  const key = queueKey(guildId, mode);
  if (!queues.has(key)) queues.set(key, { list: [], timeouts: new Map() });
  return queues.get(key);
}

function removeFromQueue(guildId, mode, userId) {
  const q = getQueue(guildId, mode);
  q.list = q.list.filter((e) => e.userId !== userId);
  const t = q.timeouts.get(userId);
  if (t) clearTimeout(t);
  q.timeouts.delete(userId);
}

export async function ensureFullSquad(guildId, userId) {
  const data = await hydrateSquad(guildId, userId);
  const missing = data.lineup.filter((x) => !x.card);
  return {
    ok: missing.length === 0,
    data,
    missing
  };
}

async function editMessageSafe(client, channelId, messageId, payload) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return null;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return null;
  await msg.edit(payload).catch(() => null);
  return msg;
}

export async function enqueueOrMatch({ client, interaction, mode, buildQueuedView }) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const q = getQueue(guildId, mode);

  // already queued?
  if (q.list.some((e) => e.userId === userId)) {
    return { status: "already_queued" };
  }

  // try match
  const opponent = q.list.shift();
  if (opponent) {
    const t = q.timeouts.get(opponent.userId);
    if (t) clearTimeout(t);
    q.timeouts.delete(opponent.userId);
    return { status: "matched", opponent };
  }

  // enqueue
  const view = buildQueuedView();
  await interaction.editReply(view);
  const msg = await interaction.fetchReply().catch(() => null);
  if (!msg) return { status: "queued_no_message" };

  const entry = {
    mode,
    guildId,
    userId,
    channelId: msg.channelId,
    messageId: msg.id,
    queuedAt: Date.now()
  };

  q.list.push(entry);

  const timeout = setTimeout(async () => {
    const still = q.list.some((e) => e.userId === userId);
    if (!still) return;
    removeFromQueue(guildId, mode, userId);
    await editMessageSafe(client, entry.channelId, entry.messageId, {
      content: `⏱️ <@${userId}> ninguém foi encontrado. Use /jogar ${mode === "ranked" ? "rank" : "casual"} para tentar de novo.`,
      embeds: [],
      components: []
    });
  }, 120_000);

  q.timeouts.set(userId, timeout);
  return { status: "queued", entry };
}

export async function runMatch({
  client,
  guildId,
  mode,
  teamA,
  teamB,
  messageA,
  messageB
}) {
  const seed = hash32(`${Date.now()}|${guildId}|${teamA.userId}|${teamB.userId}|${mode}`);
  const rng = mulberry32(seed);

  const ratingsA = buildTeamRatings(teamA.lineup);
  const ratingsB = buildTeamRatings(teamB.lineup);

  const lambdaA = expectedGoals({ team: ratingsA, opp: ratingsB, rng });
  const lambdaB = expectedGoals({ team: ratingsB, opp: ratingsA, rng });

  const goalsA = clamp(samplePoisson(lambdaA, rng), 0, 8);
  const goalsB = clamp(samplePoisson(lambdaB, rng), 0, 8);

  const events = buildTimeline({
    goalsA,
    goalsB,
    rng,
    lineupA: teamA.lineup,
    lineupB: teamB.lineup
  });

  const nameA = teamA.userName;
  const nameB = teamB.userName;

  const minutes = [0, 15, 30, 45, 60, 75, 90];
  const tickMs = 5000; // total ~30s

  for (let i = 0; i < minutes.length; i++) {
    const m = minutes[i];
    const score = scoreAtMinute(events, m);
    const header =
      m === 0 ? "🟢 Início de jogo" :
      m === 45 ? "⏸️ Intervalo" :
      m === 90 ? "🏁 Fim de jogo" :
      `⏱️ ${m}'`;

    const highlights = buildHighlights(events, m, { teamAName: nameA, teamBName: nameB });

    const content =
      `⚽ **${nameA}** ${score.a} x ${score.b} **${nameB}**\n` +
      `${header}\n\n` +
      `**Lances:**\n${highlights}\n\n` +
      `**Força (OVR/ATK/DEF):** ${ratingsA.ovr}/${ratingsA.atk}/${ratingsA.def} vs ${ratingsB.ovr}/${ratingsB.atk}/${ratingsB.def}`;

    const payload = { content, embeds: [], components: [] };

    await Promise.all([
      messageA.edit(payload).catch(() => null),
      messageB.edit(payload).catch(() => null)
    ]);

    if (m !== 90) await sleep(tickMs);
  }

  const final = scoreAtMinute(events, 90);
  const result =
    final.a > final.b ? "A" :
    final.b > final.a ? "B" :
    "D";

  let rankedInfo = null;
  if (mode === "ranked") {
    rankedInfo = await applyRankedResult(guildId, teamA.userId, teamB.userId, result);
  }

  return { final, result, events, rankedInfo };
}
