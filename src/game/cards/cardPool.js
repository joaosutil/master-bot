// src/game/cards/cardPool.js
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";

let CACHE = null;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(rootDir, fileName, maxDepth = 5) {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next"]);

  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase() === fileName.toLowerCase()) {
          return path.join(dir, entry.name);
        }
      }
    }
  }

  return null;
}

async function loadCards() {
  if (CACHE) return CACHE;

  // 1) se você quiser, pode setar CARDS_PATH no .env
  if (process.env.CARDS_PATH) {
    const p = path.isAbsolute(process.env.CARDS_PATH)
      ? process.env.CARDS_PATH
      : path.join(process.cwd(), process.env.CARDS_PATH);

    if (await exists(p)) {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.cards ?? [];
      CACHE = arr;
      console.log(`[cardPool] usando CARDS_PATH: ${p} (${CACHE.length} cards)`);
      return CACHE;
    }
  }

  // 2) caminhos “padrão”
  const candidates = [
    path.join(process.cwd(), "data", "cards.json"),
    path.join(process.cwd(), "src", "data", "cards.json"),
    path.join(process.cwd(), "cards.json")
  ];

  for (const p of candidates) {
    if (await exists(p)) {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.cards ?? [];
      CACHE = arr;
      console.log(`[cardPool] usando: ${p} (${CACHE.length} cards)`);
      return CACHE;
    }
  }

  // 3) modo “detetive”: procura em qualquer lugar do projeto
  const found = await findFileByName(process.cwd(), "cards.json", 6);
  if (found) {
    const raw = await readFile(found, "utf8");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.cards ?? [];
    CACHE = arr;
    console.log(`[cardPool] encontrado em: ${found} (${CACHE.length} cards)`);
    return CACHE;
  }

  throw new Error(
    "Não achei cards.json no projeto. Crie em /data/cards.json (recomendado) " +
      "ou defina CARDS_PATH no .env apontando pro arquivo."
  );
}

export async function pickRandomCardByRarity(rarity) {
  const cards = await loadCards();

  const pool = cards.filter((c) => (c?.rarity || "").toLowerCase() === rarity);
  if (!pool.length) {
    throw new Error(`Sem cartas pra raridade: ${rarity}. Seu cards.json tem essa raridade?`);
  }

  const picked = pool[Math.floor(Math.random() * pool.length)];
  return structuredClone ? structuredClone(picked) : JSON.parse(JSON.stringify(picked));
}
