export const FORMATIONS = {
  "4-4-2": {
    id: "4-4-2",
    name: "4-4-2",
    displayName: "4-4-2",
    slots: [
      { key: "GK", label: "GOL", allow: ["GOL"] },
      { key: "LB", label: "LE", allow: ["LE", "ZAG"] },
      { key: "CB1", label: "ZAG", allow: ["ZAG"] },
      { key: "CB2", label: "ZAG", allow: ["ZAG"] },
      { key: "RB", label: "LD", allow: ["LD", "ZAG"] },
      { key: "LM", label: "ME", allow: ["PE", "MEI", "MC", "ATA"] },
      { key: "CM1", label: "MC", allow: ["VOL", "MC", "MEI"] },
      { key: "CM2", label: "MC", allow: ["VOL", "MC", "MEI"] },
      { key: "RM", label: "MD", allow: ["PD", "MEI", "MC", "ATA"] },
      { key: "ST1", label: "ATA", allow: ["ATA", "PD", "PE"] },
      { key: "ST2", label: "ATA", allow: ["ATA", "PD", "PE"] }
    ],
    coords: {
      GK: { x: 0.50, y: 0.86 },
      LB: { x: 0.18, y: 0.70 },
      CB1: { x: 0.38, y: 0.72 },
      CB2: { x: 0.62, y: 0.72 },
      RB: { x: 0.82, y: 0.70 },
      LM: { x: 0.20, y: 0.50 },
      CM1: { x: 0.42, y: 0.54 },
      CM2: { x: 0.58, y: 0.54 },
      RM: { x: 0.80, y: 0.50 },
      ST1: { x: 0.42, y: 0.28 },
      ST2: { x: 0.58, y: 0.28 }
    }
  },

  "4-3-3": {
    id: "4-3-3",
    name: "4-3-3",
    displayName: "4-3-3 EQUILIBRADO",
    slots: [
      { key: "GK", label: "GOL", allow: ["GOL"] },
      { key: "LB", label: "LE", allow: ["LE", "ZAG"] },
      { key: "CB1", label: "ZAG", allow: ["ZAG"] },
      { key: "CB2", label: "ZAG", allow: ["ZAG"] },
      { key: "RB", label: "LD", allow: ["LD", "ZAG"] },
      { key: "CM1", label: "MC", allow: ["VOL", "MC", "MEI"] },
      { key: "CM2", label: "MEI", allow: ["MEI", "MC"] },
      { key: "CM3", label: "MC", allow: ["VOL", "MC", "MEI"] },
      { key: "LW", label: "PE", allow: ["PE", "ATA", "MEI"] },
      { key: "ST", label: "ATA", allow: ["ATA", "PD", "PE"] },
      { key: "RW", label: "PD", allow: ["PD", "ATA", "MEI"] }
    ],
    coords: {
      GK: { x: 0.50, y: 0.86 },
      LB: { x: 0.18, y: 0.70 },
      CB1: { x: 0.38, y: 0.72 },
      CB2: { x: 0.62, y: 0.72 },
      RB: { x: 0.82, y: 0.70 },
      CM1: { x: 0.35, y: 0.56 },
      CM2: { x: 0.50, y: 0.52 },
      CM3: { x: 0.65, y: 0.56 },
      LW: { x: 0.22, y: 0.32 },
      ST: { x: 0.50, y: 0.26 },
      RW: { x: 0.78, y: 0.32 }
    }
  }
};

export const FORMATION_LIST = Object.values(FORMATIONS);
