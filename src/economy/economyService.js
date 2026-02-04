import mongoose from "mongoose";
import { EconomyUser } from "./economyModel.js";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const START_BALANCE = Number(process.env.START_BALANCE ?? 500000); // 500 mil
const DAILY_REWARD = Number(process.env.DAILY_REWARD ?? 250000); // 250 mil
const WEEKLY_REWARD = Number(process.env.WEEKLY_REWARD ?? 1500000); // 1.5 mi
const ECONOMY_VERSION = 2;
const ECONOMY_MIGRATE_MULT = Number(process.env.ECONOMY_MIGRATE_MULT ?? 10000);
const GLOBAL_SCOPE_GUILD_ID = "global";

function safeMoney(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.trunc(v));
}

function safeDelta(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

function safeExistingBalance(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

function isMongoConnected() {
  return mongoose.connection?.readyState === 1;
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

export function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

async function ensureGlobalEconomyUserMerged(userId, { session } = {}) {
  const global = await withSession(
    EconomyUser.findOne({
      guildId: GLOBAL_SCOPE_GUILD_ID,
      userId
    }).select({ legacyMerged: 1, initialized: 1, balance: 1 }),
    session
  );

  if (global?.legacyMerged) return;

  const legacy = await withSession(
    EconomyUser.find({
      userId,
      guildId: { $ne: GLOBAL_SCOPE_GUILD_ID }
    })
      .select({ balance: 1, lastDaily: 1, lastWeekly: 1, version: 1 })
      .lean(),
    session
  );

  if (!legacy.length) {
    const initial = safeMoney(START_BALANCE, 0);
    await EconomyUser.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      {
        $set: {
          legacyMerged: true,
          initialized: true,
          ...(global?.initialized ? {} : { balance: safeExistingBalance(global?.balance ?? 0) || initial })
        }
      },
      { upsert: true, session }
    );
    return;
  }

  let sumBalance = 0;
  let maxDaily = 0;
  let maxWeekly = 0;
  const mult = safeMoney(ECONOMY_MIGRATE_MULT, 10000);

  for (const doc of legacy) {
    const v = Number(doc?.version ?? 1);
    const rawBal = safeExistingBalance(doc?.balance ?? 0);
    const bal = v !== ECONOMY_VERSION && rawBal > 0 ? safeMoney(rawBal * mult, rawBal) : rawBal;
    sumBalance += bal;
    maxDaily = Math.max(maxDaily, Number(doc?.lastDaily ?? 0) || 0);
    maxWeekly = Math.max(maxWeekly, Number(doc?.lastWeekly ?? 0) || 0);
  }

  await EconomyUser.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      $inc: { balance: sumBalance },
      $max: { lastDaily: maxDaily, lastWeekly: maxWeekly },
      $set: { version: ECONOMY_VERSION, legacyMerged: true, initialized: true }
    },
    { upsert: true, session }
  );

  await EconomyUser.deleteMany(
    { userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } },
    { session }
  );
}

export async function getOrCreateEconomyUser(guildId, userId, session) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const scopeGuildId = GLOBAL_SCOPE_GUILD_ID;

  await EconomyUser.findOneAndUpdate(
    { guildId: scopeGuildId, userId },
    {
      $setOnInsert: {
        version: ECONOMY_VERSION,
        balance: 0,
        lastDaily: 0,
        lastWeekly: 0,
        legacyMerged: false,
        initialized: false
      }
    },
    { new: true, upsert: true, session }
  );

  await ensureGlobalEconomyUserMerged(userId, { session });

  const doc = await withSession(
    EconomyUser.findOne({ guildId: scopeGuildId, userId }),
    session
  );

  // migração automática (v1 -> v2): valores antigos eram muito pequenos
  if (Number(doc?.version ?? 1) !== ECONOMY_VERSION) {
    const mult = safeMoney(ECONOMY_MIGRATE_MULT, 10000);
    const next = doc.balance > 0 ? safeMoney(doc.balance * mult, doc.balance) : 0;
    doc.balance = next;
    doc.version = ECONOMY_VERSION;
    await doc.save({ session });
  }

  return doc;
}

export async function getBalance(guildId, userId) {
  const user = await getOrCreateEconomyUser(guildId, userId);
  return user.balance;
}

export async function addBalance(guildId, userId, delta, session) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  // Garante o doc existir para evitar conflito de update ($inc + $setOnInsert no mesmo path)
  await getOrCreateEconomyUser(guildId, userId, session);

  const doc = await EconomyUser.findOneAndUpdate(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    { $inc: { balance: safeDelta(delta) } },
    { new: true, session }
  );

  return doc.balance;
}

export async function trySpendBalance(guildId, userId, amount, session) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const v = Number(amount ?? 0);
  if (!Number.isFinite(v) || v <= 0) {
    return { ok: false, reason: "amount_invalid", balance: 0 };
  }

  // garante existência do doc (principalmente pra usuários novos)
  await getOrCreateEconomyUser(guildId, userId, session);

  const updated = await EconomyUser.findOneAndUpdate(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId, balance: { $gte: v } },
    { $inc: { balance: -v } },
    { new: true, session }
  );

  if (!updated) {
    const balance = await getBalance(guildId, userId);
    return { ok: false, reason: "insufficient_funds", balance };
  }

  return { ok: true, balance: updated.balance };
}

export async function claimDaily(guildId, userId) {
  const user = await getOrCreateEconomyUser(guildId, userId);

  const now = Date.now();
  const elapsed = now - (user.lastDaily || 0);

  if (user.lastDaily && elapsed < COOLDOWN_MS) {
    return {
      ok: false,
      remainingMs: COOLDOWN_MS - elapsed,
      balance: user.balance
    };
  }

  const reward = safeMoney(DAILY_REWARD, 0);
  user.balance += reward;
  user.lastDaily = now;
  await user.save();

  return {
    ok: true,
    reward,
    balance: user.balance
  };
}

export async function claimWeekly(guildId, userId) {
  const user = await getOrCreateEconomyUser(guildId, userId);

  const now = Date.now();
  const elapsed = now - (user.lastWeekly || 0);

  if (user.lastWeekly && elapsed < WEEKLY_COOLDOWN_MS) {
    return {
      ok: false,
      remainingMs: WEEKLY_COOLDOWN_MS - elapsed,
      balance: user.balance
    };
  }

  const reward = safeMoney(WEEKLY_REWARD, 0);
  user.balance += reward;
  user.lastWeekly = now;
  await user.save();

  return {
    ok: true,
    reward,
    balance: user.balance
  };
}

export async function getTopBalances(guildId, limit = 10) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const docs = await EconomyUser.find({ guildId: GLOBAL_SCOPE_GUILD_ID })
    .sort({ balance: -1 })
    .limit(limit)
    .select({ userId: 1, balance: 1, _id: 0 })
    .lean();

  return docs;
}

// Opcional (se você quiser usar depois)
export async function transferMoney(guildId, fromUserId, toUserId, amount) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  if (amount <= 0) return { ok: false, reason: "amount_invalid" };
  if (fromUserId === toUserId) return { ok: false, reason: "same_user" };

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const from = await getOrCreateEconomyUser(guildId, fromUserId, session);
    const to = await getOrCreateEconomyUser(guildId, toUserId, session);

    if (from.balance < amount) {
      await session.abortTransaction();
      return { ok: false, reason: "insufficient_funds", balance: from.balance };
    }

    from.balance -= amount;
    to.balance += amount;

    await from.save({ session });
    await to.save({ session });

    await session.commitTransaction();
    return { ok: true, fromBalance: from.balance, toBalance: to.balance };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
