import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

const data = new SlashCommandBuilder()
  .setName("ajuda")
  .setDescription("Mostra lista de comandos e dicas rapidas")
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("comando")
      .setDescription("Nome de um comando (ex: ticket, pack, ban)")
      .setRequired(false)
  );

function renderCommandList() {
  const groups = [
    {
      title: "Tickets",
      items: ["/ticket abrir", "/ticket painel", "/ticket config ..."]
    },
    {
      title: "Moderacao",
      items: ["/ban", "/kick", "/timeout", "/mute", "/warn", "/infractions", "/limpar"]
    },
    {
      title: "Economia",
      items: ["/balance", "/daily", "/weekly", "/pay", "/ranking"]
    },
    {
      title: "Packs & Cards",
      items: ["/pack", "/packgratis", "/cards", "/card", "/inventory"]
    },
    {
      title: "Eventos",
      items: ["/sorteio", "/expedicao iniciar", "/memoria adicionar"]
    },
    {
      title: "Comunidade",
      items: ["/vibe postar", "/vibe status", "/vibe desativar"]
    },
    {
      title: "Verificação",
      items: ["/verificacao painel", "/verificacao desativar"]
    }
  ];

  return groups.map((group) => ({
    name: group.title,
    value: group.items.map((item) => `• ${item}`).join("\n"),
    inline: false
  }));
}

export default {
  data,
  async execute(interaction) {
    const query = interaction.options.getString("comando")?.trim()?.toLowerCase();
    const commands = interaction.client?.commands;

    if (query && commands?.get) {
      const command = commands.get(query);
      if (command?.data?.name) {
        const json =
          typeof command.data.toJSON === "function" ? command.data.toJSON() : null;

        const embed = new EmbedBuilder()
          .setTitle(`Ajuda: /${command.data.name}`)
          .setDescription(command.data.description || "Sem descricao.")
          .setColor(0x2fffe0);

        const options = Array.isArray(json?.options) ? json.options : [];
        const subcommands = options
          .filter((opt) => opt.type === 1 || opt.type === 2)
          .map((opt) => opt.name);

        if (subcommands.length) {
          embed.addFields({
            name: "Subcomandos",
            value: subcommands.slice(0, 20).map((s) => `• ${s}`).join("\n"),
            inline: false
          });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      await interaction.reply({
        content: `Nao encontrei o comando **/${query}**. Use \`/ajuda\` sem parametros para ver a lista.`,
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Master Bot • Ajuda")
      .setDescription(
        "Aqui vai um resumo dos principais comandos. Dica: use `/<comando>` no Discord para ver opcoes e descricoes."
      )
      .setColor(0x2fffe0)
      .addFields(...renderCommandList())
      .setFooter({ text: "Nexus • Tickets, Moderação, Economia e Packs" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
