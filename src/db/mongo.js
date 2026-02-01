import mongoose from "mongoose";

function slugifyLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function migrateTickets() {
  const { default: Ticket } = await import("../models/Ticket.js");

  // Preenche categoryKey faltando em tickets abertos (necessário para a regra por categoria).
  const missing = await Ticket.find({
    status: "open",
    $or: [{ categoryKey: { $exists: false } }, { categoryKey: null }, { categoryKey: "" }]
  }).select({ _id: 1, categoryLabel: 1 });

  if (missing.length) {
    const ops = missing.map((t) => ({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { categoryKey: slugifyLabel(t.categoryLabel) || "geral" } }
      }
    }));
    await Ticket.bulkWrite(ops, { ordered: false });
  }

  // Normaliza categoryKey (mudanças antigas de acentuação/espacos podem permitir duplicados).
  const toNormalize = await Ticket.find({
    status: "open",
    categoryLabel: { $type: "string", $ne: "" }
  }).select({ _id: 1, categoryLabel: 1, categoryKey: 1 });

  const normalizeOps = [];
  for (const t of toNormalize) {
    const desired = slugifyLabel(t.categoryLabel) || "geral";
    if (t.categoryKey !== desired) {
      normalizeOps.push({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { categoryKey: desired } }
        }
      });
    }
  }
  if (normalizeOps.length) {
    await Ticket.bulkWrite(normalizeOps, { ordered: false });
  }

  // Fecha duplicados (mantém o mais recente aberto por categoria).
  const dupGroups = await Ticket.aggregate([
    {
      $match: {
        status: "open",
        categoryKey: { $type: "string", $ne: "" }
      }
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { guildId: "$guildId", ownerId: "$ownerId", categoryKey: "$categoryKey" },
        ids: { $push: "$_id" },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } }
    }
  ]);

  for (const g of dupGroups) {
    const toClose = g.ids.slice(1);
    if (!toClose.length) continue;
    await Ticket.updateMany(
      { _id: { $in: toClose } },
      { $set: { status: "closed", closedAt: new Date(), tag: "auto-dedupe" } }
    );
  }

  // Garante índices (inclui unique por categoria para tickets abertos).
  await Ticket.syncIndexes();
}

export async function connectMongo(mongoUri) {
  if (!mongoUri) {
    console.warn("MONGO_URI not set. Skipping MongoDB connection.");
    return;
  }

  try {
    await mongoose.connect(mongoUri, {
      autoIndex: true
    });
    console.log("MongoDB connected");
    try {
      await migrateTickets();
    } catch (error) {
      console.warn("MongoDB ticket migration/indexing failed:", error);
    }
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}
