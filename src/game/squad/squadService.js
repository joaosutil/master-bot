import mongoose from "mongoose";
import { Squad } from "./squadModel.js";
import { FORMATIONS } from "./formations.js";
import { getInventoryCounts } from "../../packs/inventoryModel.js";
import { getCardPool } from "../../cards/cardsStore.js";

function isMongoConnected() {
  return mongoose.connection?.readyState === 1;
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

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
}

function cardRankKey(card) {
  const ovr = typeof card?.ovr === "number" ? card.ovr : -1;
  return [ovr, rarityRank(card?.rarity), String(card?.name ?? "")];
}

function compareCard(a, b) {
  const [oa, ra, na] = cardRankKey(a);
  const [ob, rb, nb] = cardRankKey(b);
  if (ob !== oa) return ob - oa;
  if (rb !== ra) return rb - ra;
  return na.localeCompare(nb, "pt-BR");
}

function normalizeNameKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function playerUniqKey(card) {
  const pid = card?.playerId ? String(card.playerId).trim() : "";
  if (pid) return `p:${pid}`;
  return `n:${normalizeNameKey(card?.name ?? "")}`;
}

export async function getOrCreateSquad(guildId, userId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const doc = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $setOnInsert: { formationId: "4-3-3", slots: {} } },
    { new: true, upsert: true }
  ).lean();

  return doc;
}

export function getFormation(formationId) {
  return FORMATIONS[formationId] ?? FORMATIONS["4-3-3"];
}

export async function setFormation(guildId, userId, formationId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const f = getFormation(formationId);

  const existing = await getOrCreateSquad(guildId, userId);
  const prevSlots = existing?.slots ? Object.fromEntries(Object.entries(existing.slots)) : {};
  const nextSlots = {};

  // mantém o que ainda faz sentido (mesma key existe)
  for (const s of f.slots) {
    if (prevSlots[s.key]) nextSlots[s.key] = prevSlots[s.key];
  }

  const updated = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $set: { formationId: f.id, slots: nextSlots } },
    { new: true }
  ).lean();

  return updated;
}

export async function clearSquad(guildId, userId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const updated = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $set: { slots: {} } },
    { new: true, upsert: true }
  ).lean();

  return updated;
}

export async function setSquadSlot(guildId, userId, slotKey, cardId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const squad = await getOrCreateSquad(guildId, userId);
  const formation = getFormation(squad.formationId);
  const slot = formation.slots.find((s) => s.key === slotKey);
  if (!slot) return { ok: false, reason: "slot_invalid" };

  const counts = await getInventoryCounts(guildId, userId);
  const owned = Number(counts?.[cardId] ?? 0);
  if (owned <= 0) return { ok: false, reason: "not_owned" };

  const pool = await getCardPool();
  const poolMap = new Map(pool.map((c) => [c.id, c]));
  const card = poolMap.get(cardId);
  if (!card) return { ok: false, reason: "card_not_found" };

  const pos = normalizePos(card.pos);
  if (!slot.allow.includes(pos)) {
    return { ok: false, reason: "wrong_position", cardPos: pos, allowed: slot.allow };
  }

  const current = squad?.slots ? Object.fromEntries(Object.entries(squad.slots)) : {};
  const assignedCounts = {};
  for (const v of Object.values(current)) {
    if (!v) continue;
    assignedCounts[v] = (assignedCounts[v] ?? 0) + 1;
  }

  // Nunca permitir o mesmo jogador 2x no time (mesmo se o usuário tiver duplicata)
  const pkey = playerUniqKey(card);
  for (const [k, v] of Object.entries(current)) {
    if (!v) continue;
    if (k === slotKey) continue; // substitui o próprio slot
    const other = poolMap.get(v);
    if (!other) continue;
    if (playerUniqKey(other) === pkey) {
      return { ok: false, reason: "player_already_used" };
    }
  }

  // se já tá usando a carta em outro slot, precisa ter duplicata
  const nextAssigned = (assignedCounts[cardId] ?? 0) + 1;
  if (nextAssigned > owned) {
    return { ok: false, reason: "duplicate_not_owned", owned };
  }

  current[slotKey] = cardId;

  const updated = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $set: { slots: current } },
    { new: true }
  ).lean();

  return { ok: true, squad: updated, card };
}

export async function removeSquadSlot(guildId, userId, slotKey) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const squad = await getOrCreateSquad(guildId, userId);
  const current = squad?.slots ? Object.fromEntries(Object.entries(squad.slots)) : {};
  delete current[slotKey];

  const updated = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $set: { slots: current } },
    { new: true }
  ).lean();

  return updated;
}

export async function autoSquad(guildId, userId, formationId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const formation = getFormation(formationId);
  const counts = await getInventoryCounts(guildId, userId);
  const pool = await getCardPool();
  const poolMap = new Map(pool.map((c) => [c.id, c]));

  // monta lista de cards que o usuário tem (com duplicatas via count)
  const ownedCards = [];
  for (const [id, cnt] of Object.entries(counts)) {
    const n = Number(cnt);
    if (!Number.isFinite(n) || n <= 0) continue;
    const c = poolMap.get(id);
    if (!c) continue;
    ownedCards.push({ card: c, count: n });
  }

  // ordem por força (ovr/raridade)
  ownedCards.sort((a, b) => compareCard(a.card, b.card));

  const used = {}; // cardId -> usedCount
  const usedPlayers = new Set(); // playerId/name key
  const slots = {};

  for (const slot of formation.slots) {
    let picked = null;

    for (const oc of ownedCards) {
      const pos = normalizePos(oc.card.pos);
      if (!slot.allow.includes(pos)) continue;

      const usedCount = used[oc.card.id] ?? 0;
      if (usedCount >= oc.count) continue;

      const pkey = playerUniqKey(oc.card);
      if (usedPlayers.has(pkey)) continue;

      picked = oc.card;
      used[oc.card.id] = usedCount + 1;
      usedPlayers.add(pkey);
      break;
    }

    if (picked) slots[slot.key] = picked.id;
  }

  const updated = await Squad.findOneAndUpdate(
    { guildId, userId },
    { $set: { formationId: formation.id, slots } },
    { new: true, upsert: true }
  ).lean();

  return updated;
}

export async function hydrateSquad(guildId, userId) {
  const squad = await getOrCreateSquad(guildId, userId);
  const formation = getFormation(squad.formationId);
  const pool = await getCardPool();
  const poolMap = new Map(pool.map((c) => [c.id, c]));

  const slots = squad?.slots ? Object.fromEntries(Object.entries(squad.slots)) : {};
  const lineup = formation.slots.map((s) => ({
    slot: s,
    cardId: slots[s.key] ?? null,
    card: slots[s.key] ? poolMap.get(slots[s.key]) ?? null : null
  }));

  const starters = lineup.filter((x) => x.card);
  const overall = starters.length
    ? Math.round(starters.reduce((acc, x) => acc + (Number(x.card.ovr) || 0), 0) / starters.length)
    : 0;

  return { squad, formation, lineup, overall };
}
