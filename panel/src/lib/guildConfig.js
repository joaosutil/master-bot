import mongoose from "mongoose";
import GuildConfig from "../models/GuildConfig.js";

async function migrateLegacyConfig(guildId) {
  try {
    const legacy = await mongoose.connection
      .collection("guildconfigpanels")
      .findOne({ guildId });

    if (!legacy) return null;

    const { _id, __v, createdAt, updatedAt, ...rest } = legacy;
    const config = new GuildConfig({ ...rest, guildId });
    try {
      await config.save();
      return config;
    } catch (error) {
      if (error?.code === 11000) {
        return GuildConfig.findOne({ guildId });
      }
      throw error;
    }
  } catch (error) {
    console.warn("Falha ao migrar config antiga:", error);
    return null;
  }
}

export async function getOrCreateGuildConfig(guildId) {
  let config = await GuildConfig.findOne({ guildId });
  if (config) return config;

  const migrated = await migrateLegacyConfig(guildId);
  if (migrated) return migrated;

  return new GuildConfig({ guildId });
}
