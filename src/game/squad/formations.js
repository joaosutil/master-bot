export const FORMATIONS = {
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
