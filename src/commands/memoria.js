import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import {
  handleMemoryAdd,
  postRandomMemory,
  setMemoryConfig,
  ensureMemoryChannel
} from "../services/memoryCapsuleService.js";

const data = new SlashCommandBuilder()
  .setName("memoria")
  .setDescription("Cápsula do tempo do servidor")
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub.setName("adicionar").setDescription("Salvar uma mensagem como memória")
  )
  .addSubcommand((sub) =>
    sub.setName("postar").setDescription("Postar uma memória aleatória agora")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("config")
      .setDescription("Configurar cápsula do tempo")
      .addSubcommand((sub) =>
        sub
          .setName("canal")
          .setDescription("Define o canal onde a cápsula posta")
          .addChannelOption((opt) =>
            opt
              .setName("canal")
              .setDescription("Canal de texto")
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("ativar")
          .setDescription("Ativa ou desativa a cápsula")
          .addBooleanOption((opt) =>
            opt.setName("ativo").setDescription("Ativo?").setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("agenda")
          .setDescription("Define frequência e horário")
          .addStringOption((opt) =>
            opt
              .setName("cadencia")
              .setDescription("diário ou semanal")
              .setRequired(true)
              .addChoices(
                { name: "diário", value: "daily" },
                { name: "semanal", value: "weekly" }
              )
          )
          .addIntegerOption((opt) =>
            opt
              .setName("hora")
              .setDescription("Hora (0-23)")
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(23)
          )
      )
  );

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export default {
  data,
  async execute(interaction, { client }) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group && sub === "adicionar") {
      await handleMemoryAdd(interaction);
      return;
    }

    if (!group && sub === "postar") {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: "Você precisa de Manage Guild.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await postRandomMemory({ client, guildId: interaction.guildId, force: true });
      if (result.ok) {
        await interaction.editReply("Postado.");
      } else {
        await interaction.editReply(`Não foi possível postar agora (${result.reason}).`);
      }
      return;
    }

    if (group !== "config") return;
    if (!hasManageGuild(interaction)) {
      await interaction.reply({ content: "Você precisa de Manage Guild.", ephemeral: true });
      return;
    }

    if (sub === "canal") {
      const ch = interaction.options.getChannel("canal", true);
      const channelId = await ensureMemoryChannel(interaction, ch);
      if (!channelId) return;
      await setMemoryConfig(interaction, { channelId });
      return;
    }

    if (sub === "ativar") {
      const active = interaction.options.getBoolean("ativo", true);
      await setMemoryConfig(interaction, { enabled: active });
      return;
    }

    if (sub === "agenda") {
      const cadence = interaction.options.getString("cadencia", true);
      const hour = interaction.options.getInteger("hora", true);
      await setMemoryConfig(interaction, {
        cadence,
        hour
      });
      return;
    }
  }
};
