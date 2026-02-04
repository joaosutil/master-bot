export const PACKS = {
  bronze: {
    id: "bronze",
    name: "Futpack Bronze",
    emoji: "🥉",
    price: 250000,
    description: "3 cartas por pack.\nOdds por carta: ⚪ 84% | 🔵 14% | 🟣 1.7% | 🌟 0.3%.",
    slots: [{ count: 3, odds: { common: 84, rare: 14, epic: 1.7, legendary: 0.3 } }]
  },

  silver: {
    id: "silver",
    name: "Futpack Silver",
    emoji: "🥈",
    price: 900000,
    description: "5 cartas por pack.\nOdds por carta: ⚪ 75% | 🔵 20% | 🟣 4% | 🌟 1%.",
    slots: [{ count: 5, odds: { common: 75, rare: 20, epic: 4, legendary: 1 } }]
  },

  gold: {
    id: "gold",
    name: "Futpack Gold",
    emoji: "🥇",
    price: 2500000,
    description: "7 cartas por pack.\nOdds por carta: ⚪ 64% | 🔵 25% | 🟣 8% | 🌟 3%.",
    slots: [{ count: 7, odds: { common: 64, rare: 25, epic: 8, legendary: 3 } }]
  }
};

export const PACK_LIST = Object.values(PACKS);

