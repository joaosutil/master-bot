import mongoose from "mongoose";
import { CARD_POOL } from "./cardPool.js";
import { addCardsToInventory } from "./inventoryModel.js";
import { trySpendBalance } from "../economy/economyService.js";

export const PACK_COST = 250000;

function pickRarity() {
  const roll = Math.random() * 100;
  if (roll < 1) return "legendary"; // 1%
  if (roll < 5) return "epic";      // +4% = 5%
  if (roll < 25) return "rare";     // +20% = 25%
  return "common";                  // 75%
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function openPack(guildId, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const spent = await trySpendBalance(guildId, userId, PACK_COST, session);
    if (!spent.ok) {
      await session.abortTransaction();
      return { ok: false, reason: spent.reason, balance: spent.balance, cost: PACK_COST };
    }

    const rarity = pickRarity();
    const pool = CARD_POOL.filter((c) => c.rarity === rarity);
    const card = pool.length ? randomFrom(pool) : randomFrom(CARD_POOL);

    await addCardsToInventory(guildId, userId, [card], { session });

    await session.commitTransaction();
    return { ok: true, card, balance: spent.balance, cost: PACK_COST };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
