import { EmbedBuilder } from "discord.js";

export function formatCoins(n) {
  const v = Math.max(0, Number(n ?? 0));
  if (!Number.isFinite(v)) return "0";

  if (v < 1000) return Math.floor(v).toString();

  // futebol: mil / milhão (100 mil, 1 mi, 10 mi...)
  if (v < 1_000_000) {
    const k = v / 1000;
    const digits = k >= 100 ? 0 : 1;
    const txt = k.toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return `${txt} mil`;
  }

  const m = v / 1_000_000;
  const digits = m >= 100 ? 0 : m >= 10 ? 1 : 2;
  const txt = m.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  return `${txt} mi`;
}

export function economyEmbed({ title, description, color = 0x2ecc71, footer }) {
  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  if (footer) e.setFooter({ text: footer });
  return e;
}

export function rarityColor(rarity) {
  if (rarity === "legendary") return 0xf1c40f;
  if (rarity === "epic") return 0x9b59b6;
  if (rarity === "rare") return 0x3498db;
  return 0x95a5a6;
}

export function emojiByRarity(rarity) {
  if (rarity === "legendary") return "\u{1F31F}";
  if (rarity === "epic") return "\u{1F7E3}";
  if (rarity === "rare") return "\u{1F535}";
  return "\u26AA";
}

export function rarityLabel(rarity) {
  if (rarity === "legendary") return `${emojiByRarity(rarity)} LEND\u00c1RIA`;
  if (rarity === "epic") return `${emojiByRarity(rarity)} \u00c9PICA`;
  if (rarity === "rare") return `${emojiByRarity(rarity)} RARA`;
  return `${emojiByRarity(rarity)} COMUM`;
}

