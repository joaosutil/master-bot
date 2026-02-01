import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import {
  buildCategorySelect,
  formatConfigSummary,
  getOrCreateGuildConfig,
  handleTicketOpen,
  resolveTicketConfig,
  updateCategories
} from "../tickets/ticketService.js";
import { saveGuildConfigDoc } from "../services/guildConfigService.js";

const data = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Tickets do servidor")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand.setName("abrir").setDescription("Abre um ticket")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("painel")
      .setDescription("Cria uma mensagem fixa para abrir tickets")
      .addChannelOption((option) =>
        option
          .setName("canal")
          .setDescription("Canal onde o painel sera enviado")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("titulo")
          .setDescription("Titulo do painel")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("mensagem")
          .setDescription("Texto do painel")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("fixar")
          .setDescription("Fixar a mensagem no canal")
          .setRequired(false)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("config")
      .setDescription("Configura tickets")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("tipo")
          .setDescription("Define o tipo de ticket")
          .addStringOption((option) =>
            option
              .setName("tipo")
              .setDescription("Canal privado ou thread")
              .setRequired(true)
              .addChoices(
                { name: "canal", value: "channel" },
                { name: "thread", value: "thread" }
              )
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("canal_abertura")
          .setDescription("Define o canal de abertura")
          .addChannelOption((option) =>
            option
              .setName("canal")
              .setDescription("Canal onde os tickets serao abertos")
              .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement
              )
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("categoria_add")
          .setDescription("Adiciona uma categoria de ticket")
          .addStringOption((option) =>
            option
              .setName("nome")
              .setDescription("Nome da categoria")
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("descricao")
              .setDescription("Descricao curta")
              .setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("categoria_remove")
          .setDescription("Remove uma categoria de ticket")
          .addStringOption((option) =>
            option
              .setName("nome")
              .setDescription("Nome da categoria")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("staff_add")
          .setDescription("Adiciona um cargo de staff")
          .addRoleOption((option) =>
            option
              .setName("cargo")
              .setDescription("Cargo que pode atender tickets")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("staff_remove")
          .setDescription("Remove um cargo de staff")
          .addRoleOption((option) =>
            option
              .setName("cargo")
              .setDescription("Cargo que nao pode mais atender")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("status")
          .setDescription("Mostra a configuracao atual")
      )
  );

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export default {
  data,
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "abrir") {
      await handleTicketOpen(interaction);
      return;
    }

    if (!hasManageGuild(interaction)) {
      await interaction.reply({
        content: "Voce precisa de Manage Guild para configurar tickets.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "painel") {
      const targetChannel =
        interaction.options.getChannel("canal") ?? interaction.channel;

      if (
        !targetChannel ||
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(targetChannel.type)
      ) {
        await interaction.reply({
          content: "Escolha um canal de texto valido.",
          ephemeral: true
        });
        return;
      }

      const title =
        interaction.options.getString("titulo") ?? "Abrir ticket";
      const message =
        interaction.options.getString("mensagem") ??
        "Selecione a categoria abaixo para abrir um ticket.";
      const shouldPin = interaction.options.getBoolean("fixar") ?? false;

      const configDoc = await getOrCreateGuildConfig(interaction.guildId);
      const ticketConfig = resolveTicketConfig(configDoc);

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(message)
        .setColor(0x2f3136);

      const panelMessage = await targetChannel.send({
        embeds: [embed],
        components: buildCategorySelect(null, ticketConfig.categories)
      });

      if (shouldPin) {
        try {
          await panelMessage.pin();
        } catch (error) {
          console.warn("Nao foi possivel fixar o painel:", error);
        }
      }

      await interaction.reply({
        content: `Painel criado: ${panelMessage.url}`,
        ephemeral: true
      });
      return;
    }

    if (group !== "config") return;

    const configDoc = await getOrCreateGuildConfig(interaction.guildId);
    if (!configDoc.tickets) configDoc.tickets = {};
    const ticketConfig = configDoc.tickets;

    if (subcommand === "tipo") {
      const tipo = interaction.options.getString("tipo", true);
      ticketConfig.type = tipo;
      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Tipo atualizado para: ${tipo}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "canal_abertura") {
      const channel = interaction.options.getChannel("canal", true);
      ticketConfig.openChannelId = channel.id;
      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Canal de abertura definido: ${channel.toString()}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "categoria_add") {
      const label = interaction.options.getString("nome", true);
      const description = interaction.options.getString("descricao");

      const result = updateCategories(ticketConfig, "add", {
        label,
        description
      });

      if (!result.changed) {
        await interaction.reply({
          content: result.reason ?? "Nao foi possivel adicionar.",
          ephemeral: true
        });
        return;
      }

      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Categoria adicionada: ${label}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "categoria_remove") {
      const label = interaction.options.getString("nome", true);
      const result = updateCategories(ticketConfig, "remove", { label });

      if (!result.changed) {
        await interaction.reply({
          content: result.reason ?? "Nao foi possivel remover.",
          ephemeral: true
        });
        return;
      }

      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Categoria removida: ${label}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "staff_add") {
      const role = interaction.options.getRole("cargo", true);
      const current = ticketConfig.staffRoleIds ?? [];
      ticketConfig.staffRoleIds = Array.from(new Set([...current, role.id]));
      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Cargo adicionado: ${role.toString()}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "staff_remove") {
      const role = interaction.options.getRole("cargo", true);
      const current = ticketConfig.staffRoleIds ?? [];
      ticketConfig.staffRoleIds = current.filter((id) => id !== role.id);
      await saveGuildConfigDoc(configDoc);
      await interaction.reply({
        content: `Cargo removido: ${role.toString()}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "status") {
      const summary = formatConfigSummary(resolveTicketConfig(configDoc));
      await interaction.reply({ content: summary, ephemeral: true });
    }
  }
};
