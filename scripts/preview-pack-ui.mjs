import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderCardPng } from "../src/ui/renderCard.js";
import { renderPackArtPng } from "../src/ui/renderPackArt.js";
import { renderPackOpeningPng } from "../src/ui/renderPackOpening.js";
import { renderPackRevealPng } from "../src/ui/renderPackReveal.js";
import { renderWalkoutScenePng } from "../src/ui/renderWalkoutScene.js";

function card({
  id,
  name,
  pos = "MEI",
  ovr = 75,
  rarity = "common",
  value = 120000,
  clubName = "Clube Exemplo",
  countryCode = "BR",
  stats
} = {}) {
  const baseStats = stats ?? { PAC: 75, SHO: 74, PAS: 76, DRI: 77, DEF: 55, PHY: 64 };
  return {
    id: String(id ?? name ?? Math.random()),
    name,
    pos,
    ovr,
    rarity,
    value,
    clubName,
    countryCode,
    stats: baseStats
  };
}

async function main() {
  const outDir = path.join(process.cwd(), "tmp", "previews");
  await mkdir(outDir, { recursive: true });

  const cards = [
    card({
      id: "c1",
      name: "RONALDO",
      pos: "ATA",
      ovr: 92,
      rarity: "legendary",
      clubName: "REAL MADRID CLUB DE FUTBOL",
      countryCode: "PT",
      stats: { PAC: 90, SHO: 93, PAS: 82, DRI: 91, DEF: 44, PHY: 88 }
    }),
    card({
      id: "c2",
      name: "MUITO NOME GRANDE PRA TESTAR QUEBRA DE LINHA NO CARD",
      pos: "MEI",
      ovr: 88,
      rarity: "epic",
      clubName: "ASSOCIACAO DESPORTIVA DO BAIRRO MUITO LONGO",
      countryCode: "BR",
      stats: { PAC: 82, SHO: 84, PAS: 90, DRI: 88, DEF: 68, PHY: 74 }
    }),
    card({
      id: "c3",
      name: "Kylian Mbappé Lottin",
      pos: "PE",
      ovr: 91,
      rarity: "epic",
      clubName: "PARIS SAINT-GERMAIN FOOTBALL CLUB",
      countryCode: "FR",
      stats: { PAC: 97, SHO: 90, PAS: 82, DRI: 92, DEF: 40, PHY: 76 }
    }),
    card({
      id: "c4",
      name: "ZÉ",
      pos: "VOL",
      ovr: 71,
      rarity: "common",
      clubName: "CLUBE",
      countryCode: "BR",
      stats: { PAC: 68, SHO: 60, PAS: 71, DRI: 69, DEF: 72, PHY: 73 }
    })
  ];

  const extra = Array.from({ length: 12 }, (_, i) =>
    card({
      id: `e${i + 1}`,
      name: `Jogador ${i + 1}`,
      pos: i % 3 === 0 ? "ATA" : i % 3 === 1 ? "MC" : "ZAG",
      ovr: 60 + (i % 30),
      rarity: i % 11 === 0 ? "rare" : "common",
      clubName: i % 2 ? "CLUBE ATLÉTICO EXEMPLO" : "SPORT CLUB EXEMPLO",
      countryCode: i % 2 ? "BR" : "AR"
    })
  );

  for (const c of cards) {
    const png = await renderCardPng(c);
    await writeFile(path.join(outDir, `card-${c.id}.png`), png);
  }

  const packArt = renderPackArtPng({
    packId: "preview_pack",
    name: "PACK COM UM NOME MUITO GRANDE PRA TESTE DE RESPONSIVIDADE",
    emoji: "🎁",
    accent: "#7c3aed"
  });
  await writeFile(path.join(outDir, "pack-art.png"), packArt);

  const openingClosed = await renderPackOpeningPng({
    packId: "preview_pack",
    name: "PACK COM UM NOME MUITO GRANDE PRA TESTE DE RESPONSIVIDADE",
    emoji: "🎁",
    accent: "#7c3aed",
    phase: "closed",
    seedSalt: "preview"
  });
  await writeFile(path.join(outDir, "opening-closed.png"), openingClosed);

  const openingShake = await renderPackOpeningPng({
    packId: "preview_pack",
    name: "PACK COM UM NOME MUITO GRANDE PRA TESTE DE RESPONSIVIDADE",
    emoji: "🎁",
    accent: "#7c3aed",
    phase: "shake",
    seedSalt: "preview"
  });
  await writeFile(path.join(outDir, "opening-shake.png"), openingShake);

  const openingBurst = await renderPackOpeningPng({
    packId: "preview_pack",
    name: "PACK COM UM NOME MUITO GRANDE PRA TESTE DE RESPONSIVIDADE",
    emoji: "🎁",
    accent: "#7c3aed",
    phase: "burst",
    seedSalt: "preview"
  });
  await writeFile(path.join(outDir, "opening-burst.png"), openingBurst);

  const reveal = await renderPackRevealPng({
    cards: [...cards, ...extra],
    title: "PACK TESTE",
    qty: cards.length + extra.length,
    accent: "#7c3aed"
  });
  await writeFile(path.join(outDir, "reveal.png"), reveal);

  const walkout = await renderWalkoutScenePng({
    card: cards[1],
    title: "WALKOUT",
    subtitle: "PACK TESTE COM TÍTULO LONGO PARA VALIDAR FIT",
    badge: `${cards[1].ovr} OVR`,
    seedSalt: "preview"
  });
  await writeFile(path.join(outDir, "walkout.png"), walkout);

  console.log(`Wrote previews to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

