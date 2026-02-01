export const PACKS = {
  bronze: {
    id: "bronze",
    name: "Futpack Bronze",
    emoji: "🥉",
    price: 250000,
    description: "3 cartas por pack.\nOdds por carta: ⚪ 75% | 🔵 20% | 🟣 4% | 🌟 1%.",
    slots: [
      { count: 3, odds: { common: 75, rare: 20, epic: 4, legendary: 1 } }
    ]
  },

  silver: {
    id: "silver",
    name: "Futpack Silver",
    emoji: "🥈",
    price: 900000,
    description: "5 cartas por pack.\nOdds por carta: ⚪ 75% | 🔵 20% | 🟣 4% | 🌟 1%.",
    slots: [
      { count: 5, odds: { common: 75, rare: 20, epic: 4, legendary: 1 } }
    ]
  },

  gold: {
    id: "gold",
    name: "Futpack Gold",
    emoji: "🥇",
    price: 2500000,
    description: "7 cartas por pack.\nOdds por carta: ⚪ 75% | 🔵 20% | 🟣 4% | 🌟 1%.",
    slots: [
      { count: 7, odds: { common: 75, rare: 20, epic: 4, legendary: 1 } }
    ]
  }
};

export const PACK_LIST = Object.values(PACKS);
