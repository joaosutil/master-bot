import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { transferMoney } from "../../economy/economyService.js";
import { economyEmbed, formatCoins } from "../../ui/embeds.js";

const data = new SlashCommandBuilder()
  .setName("pay")
  .setDescription("Envia moedas para outro usuário")
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName("usuario").setDescription("Quem vai receber").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("quantidade")
      .setDescription("Quantidade de moedas")
      .setRequired(true)
      .setMinValue(1)
  );

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;
    const fromId = interaction.user.id;
    const target = interaction.options.getUser("usuario", true);
    const amount = interaction.options.getInteger("quantidade", true);

    if (target.id === fromId) {
      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "❌ Transferência inválida",
            description: "Você não pode enviar moedas para você mesmo.",
            color: 0xe74c3c
          })
        ],
        ephemeral: true
      });
      return;
    }

    if (target.bot) {
      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "❌ Transferência inválida",
            description: "Você não pode enviar moedas para bots.",
            color: 0xe74c3c
          })
        ],
        ephemeral: true
      });
      return;
    }

    const confirmId = `pay_confirm:${interaction.id}`;
    const cancelId = `pay_cancel:${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel("Confirmar ✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("Cancelar ❌")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [
        economyEmbed({
          title: "💸 Confirmar pagamento",
          description:
            `Você quer enviar **${formatCoins(amount)}** 🪙 para <@${target.id}>?\n\n` +
            `Se confirmar, a transferência será feita na hora.`,
          color: 0x3498db,
          footer: "Você tem 15s para confirmar"
        })
      ],
      components: [row],
      ephemeral: true
    });

    const msg = await interaction.fetchReply();
    const filter = (i) =>
      i.user.id === fromId &&
      (i.customId === confirmId || i.customId === cancelId);

    try {
      const btn = await msg.awaitMessageComponent({ filter, time: 15_000 });

      if (btn.customId === cancelId) {
        await btn.update({
          embeds: [
            economyEmbed({
              title: "✅ Cancelado",
              description: "Pagamento cancelado.",
              color: 0x95a5a6
            })
          ],
          components: []
        });
        return;
      }

      await btn.update({
        embeds: [
          economyEmbed({
            title: "⏳ Processando…",
            description: "Fazendo a transferência no banco…",
            color: 0xf39c12
          })
        ],
        components: []
      });

      const result = await transferMoney(guildId, fromId, target.id, amount);

      if (!result.ok) {
        if (result.reason === "insufficient_funds") {
          await interaction.editReply({
            embeds: [
              economyEmbed({
                title: "💸 Saldo insuficiente",
                description:
                  `Você tentou enviar **${formatCoins(amount)}** 🪙.\n` +
                  `Seu saldo atual é **${formatCoins(result.balance)}** 🪙.`,
                color: 0xe67e22
              })
            ]
          });
          return;
        }

        if (result.reason === "amount_invalid") {
          await interaction.editReply({
            embeds: [
              economyEmbed({
                title: "❌ Quantidade inválida",
                description: "Escolha um valor maior que 0.",
                color: 0xe74c3c
              })
            ]
          });
          return;
        }

        await interaction.editReply({
          embeds: [
            economyEmbed({
              title: "❌ Falha",
              description: "Não consegui completar a transferência.",
              color: 0xe74c3c
            })
          ]
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "✅ Pagamento concluído",
            description:
              `Você enviou **${formatCoins(amount)}** 🪙 para <@${target.id}>.\n\n` +
              `Seu saldo: **${formatCoins(result.fromBalance)}** 🪙\n` +
              `Saldo dele: **${formatCoins(result.toBalance)}** 🪙`,
            color: 0x2ecc71
          })
        ]
      });
    } catch {
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "⌛ Tempo esgotado",
            description: "Você não confirmou a tempo. Rode o comando novamente.",
            color: 0x95a5a6
          })
        ],
        components: []
      });
    }
  }
};

