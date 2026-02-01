import { GENERATED_CARD_POOL } from "./generatedCardPool.js";

export const CARD_POOL = [
  ...GENERATED_CARD_POOL
  // ...aqui você pode somar cartas “manual premium” se quiser
];

export function pickRandomCardByRarity(rarity) {
  const r = String(rarity ?? "").toLowerCase();
  const pool = CARD_POOL.filter((c) => String(c?.rarity ?? "").toLowerCase() === r);
  const arr = pool.length ? pool : CARD_POOL;
  const picked = arr[Math.floor(Math.random() * arr.length)];
  return structuredClone ? structuredClone(picked) : JSON.parse(JSON.stringify(picked));
}
