import { PACKS } from "./packCatalog.js";
import { pickRandomCardByRarity } from "../../cards/cardsStore.js";

function rollWeighted(odds) {
  const entries = Object.entries(odds);
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export async function generatePackCards(packId) {
  const pack = PACKS[packId];
  if (!pack) throw new Error("Pack inválido");

  const pulled = [];
  for (const slot of pack.slots) {
    for (let i = 0; i < slot.count; i++) {
      const rarity = rollWeighted(slot.odds);
      const card = await pickRandomCardByRarity(rarity);
      pulled.push(card);
    }
  }
  return pulled;
}

