import mongoose from "mongoose";

const GLOBAL_SCOPE_GUILD_ID = "global";

const invSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    counts: { type: Map, of: Number, default: {} }
  },
  { timestamps: true }
);

invSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Inventory =
  mongoose.models.Inventory || mongoose.model("Inventory", invSchema);

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function countsFromDoc(doc) {
  if (!doc) return {};
  if (doc.counts) {
    const raw = Object.fromEntries(Object.entries(doc.counts));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Math.trunc(Number(v ?? 0));
      if (!Number.isFinite(n) || n <= 0) continue;
      out[String(k)] = (out[String(k)] ?? 0) + n;
    }
    return out;
  }

  // compat: inventários antigos (cards: [{cardId,count}])
  if (Array.isArray(doc?.cards)) {
    const out = {};
    for (const it of doc.cards) {
      if (!it?.cardId) continue;
      const n = Math.trunc(Number(it.count ?? 0));
      if (!Number.isFinite(n) || n <= 0) continue;
      out[String(it.cardId)] = (out[String(it.cardId)] ?? 0) + n;
    }
    return out;
  }

  return {};
}

function toInc(counts) {
  const inc = {};
  for (const [k, v] of Object.entries(counts ?? {})) {
    const n = Math.trunc(Number(v ?? 0));
    if (!Number.isFinite(n) || n <= 0) continue;
    inc[`counts.${String(k)}`] = (inc[`counts.${String(k)}`] ?? 0) + n;
  }
  return inc;
}

export function hideLockedCounts(counts = {}, lockedCounts = {}) {
  const out = {};
  for (const [k, v] of Object.entries(counts ?? {})) {
    if (lockedCounts?.[k]) continue;
    const n = Math.trunc(Number(v ?? 0));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[String(k)] = n;
  }
  return out;
}

async function ensureGlobalInventoryMerged(userId, { session } = {}) {
  const global = await withSession(
    Inventory.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId })
      .select({ legacyMerged: 1 })
      .lean(),
    session
  );
  if (global?.legacyMerged) return;

  const legacy = await withSession(
    Inventory.find({ userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } }).lean(),
    session
  );

  if (!legacy.length) {
    await Inventory.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $set: { legacyMerged: true } },
      { upsert: true, session }
    );
    return;
  }

  const merged = {};
  for (const doc of legacy) {
    const counts = countsFromDoc(doc);
    for (const [k, v] of Object.entries(counts)) {
      merged[String(k)] = (merged[String(k)] ?? 0) + v;
    }
  }

  const inc = toInc(merged);
  await Inventory.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $set: { legacyMerged: true },
      $setOnInsert: { counts: {} }
    },
    { upsert: true, session }
  );

  await Inventory.deleteMany(
    { userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } },
    { session }
  );
}

export async function getInventoryCounts(guildId, userId) {
  await ensureGlobalInventoryMerged(userId);
  const doc = await Inventory.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).lean();
  return countsFromDoc(doc);
}

export function inventoryTotalCount(counts = {}) {
  let total = 0;
  for (const v of Object.values(counts ?? {})) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += Math.trunc(n);
  }
  return total;
}

export function subtractLockedCounts(counts = {}, lockedCounts = {}) {
  const out = {};

  // start with sanitized counts
  for (const [k, v] of Object.entries(counts ?? {})) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[String(k)] = Math.trunc(n);
  }

  for (const [k, v] of Object.entries(lockedCounts ?? {})) {
    const lock = Number(v ?? 0);
    if (!Number.isFinite(lock) || lock <= 0) continue;
    const id = String(k);
    const cur = Number(out[id] ?? 0);
    if (!Number.isFinite(cur) || cur <= 0) continue;
    const next = Math.max(0, Math.trunc(cur) - Math.trunc(lock));
    if (next > 0) out[id] = next;
    else delete out[id];
  }

  return out;
}

export function inventoryAvailableTotalCount(counts = {}, lockedCounts = {}) {
  return inventoryTotalCount(subtractLockedCounts(counts, lockedCounts));
}

export async function getInventoryTotalCount(guildId, userId) {
  const counts = await getInventoryCounts(guildId, userId);
  return inventoryTotalCount(counts);
}

export async function addCardsToInventory(guildId, userId, cards, { session } = {}) {
  await ensureGlobalInventoryMerged(userId, { session });
  const inc = {};
  for (const c of cards ?? []) {
    if (!c?.id) continue;
    inc[`counts.${c.id}`] = (inc[`counts.${c.id}`] ?? 0) + 1;
  }
  if (!Object.keys(inc).length) return;
  await Inventory.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    { $inc: inc },
    { upsert: true, session }
  );
}

export async function addCardsToInventorySmart(
  guildId,
  userId,
  cards,
  { session, maxNewAdds = Number.POSITIVE_INFINITY } = {}
) {
  await ensureGlobalInventoryMerged(userId, { session });

  const invDoc = await withSession(
    Inventory.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).lean(),
    session
  );
  const existing = countsFromDoc(invDoc);

  const cap = Number.isFinite(Number(maxNewAdds))
    ? Math.max(0, Math.trunc(Number(maxNewAdds)))
    : Number.POSITIVE_INFINITY;

  function rarityRank(r) {
    if (r === "legendary") return 4;
    if (r === "epic") return 3;
    if (r === "rare") return 2;
    return 1;
  }

  function cardRankKey(card) {
    const ovr = typeof card?.ovr === "number" ? card.ovr : 0;
    const rr = rarityRank(card?.rarity);
    const val = Number(card?.value ?? 0);
    const value = Number.isFinite(val) ? Math.trunc(val) : 0;
    return [ovr, rr, value];
  }

  function betterCard(a, b) {
    const [oa, ra, va] = cardRankKey(a);
    const [ob, rb, vb] = cardRankKey(b);
    if (oa !== ob) return oa > ob ? a : b;
    if (ra !== rb) return ra > rb ? a : b;
    if (va !== vb) return va > vb ? a : b;
    return a;
  }

  const groups = new Map(); // id -> { count, sample, best }
  for (const card of cards ?? []) {
    if (!card?.id) continue;
    const id = String(card.id);
    const cur = groups.get(id) ?? { count: 0, sample: card, best: card };
    cur.count += 1;
    cur.sample = cur.sample ?? card;
    cur.best = cur.best ? betterCard(cur.best, card) : card;
    groups.set(id, cur);
  }

  const candidates = [];
  const soldById = {};
  let earned = 0;
  let added = 0;
  let sold = 0;

  for (const [id, g] of groups.entries()) {
    const owned = Math.trunc(Number(existing[id] ?? 0)) || 0;
    if (owned >= 1) {
      soldById[id] = (soldById[id] ?? 0) + g.count;
      sold += g.count;
      const val = Number(g.sample?.value ?? 0);
      if (Number.isFinite(val) && val > 0) earned += Math.trunc(val) * g.count;
      continue;
    }

    candidates.push({ id, count: g.count, card: g.best, sample: g.sample });
  }

  // pick which new uniques to keep (one copy per id), prefer stronger cards.
  candidates.sort((a, b) => {
    const [oa, ra, va] = cardRankKey(a.card);
    const [ob, rb, vb] = cardRankKey(b.card);
    if (ob !== oa) return ob - oa;
    if (rb !== ra) return rb - ra;
    return vb - va;
  });

  const keepIds = new Set();
  for (const c of candidates) {
    const ovr = typeof c.card?.ovr === "number" ? c.card.ovr : 0;
    // Always keep 90+ uniques (even if inventory is "full").
    if (ovr >= 90) keepIds.add(c.id);
  }

  for (const c of candidates) {
    if (keepIds.has(c.id)) continue;
    if (keepIds.size >= cap) break;
    keepIds.add(c.id);
  }

  const inc = {};
  for (const c of candidates) {
    const keep = keepIds.has(c.id);
    if (keep) {
      inc[`counts.${c.id}`] = (inc[`counts.${c.id}`] ?? 0) + 1;
      added += 1;
    }

    const sellQty = keep ? Math.max(0, c.count - 1) : c.count;
    if (sellQty > 0) {
      soldById[c.id] = (soldById[c.id] ?? 0) + sellQty;
      sold += sellQty;
      const val = Number(c.sample?.value ?? 0);
      if (Number.isFinite(val) && val > 0) earned += Math.trunc(val) * sellQty;
    }
  }

  if (Object.keys(inc).length) {
    await Inventory.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $inc: inc },
      { upsert: true, session }
    );
  }

  return { added, sold, earned, soldById };
}
