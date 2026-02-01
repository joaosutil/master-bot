import { SlashCommandBuilder } from "discord.js";
import { showPackShop } from "../../game/packs/packUi.js";

const data = new SlashCommandBuilder()
  .setName("pack")
  .setDescription("Abre a loja de packs");

export default {
  data,
  async execute(interaction) {
    await showPackShop(interaction);
  }
};
