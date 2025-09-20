import { burnCredits } from '../db.auto.mjs';

export default async function handleTakeCredits(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: say('❌ Only my trusted staff may burn another Kitten’s Credits.', '❌ You do not have permission.'), ephemeral: true });
  }
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || null;
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: say('❌ Bring me a positive amount if you want to burn Credits, Kitten.', 'Amount must be a positive integer.'), ephemeral: true });
  }
  try {
    const { credits } = await burnCredits(interaction.guild?.id, target.id, amount, reason, interaction.user.id);
    const nf = new Intl.NumberFormat('en-US');
    const logLines = kittenMode
      ? [
          '🔥 **Burn Credits**',
          `User: My devoted Kitten <@${target.id}> • Amount: **${nf.format(amount)}** credits${reason ? ` • Reason: ${reason}` : ''}`,
          `User Credits (after): **${nf.format(credits)}**`
        ]
      : [
          '🔥 **Burn Credits**',
          `User: <@${target.id}> • Amount: **${nf.format(amount)}** credits${reason ? ` • Reason: ${reason}` : ''}`,
          `User Credits (after): **${nf.format(credits)}**`
        ];
    await ctx.postCashLog(interaction, logLines);
    const fmt = new Intl.NumberFormat('en-US');
    return interaction.reply({ content: say(`🔥 Burned **${fmt.format(amount)}** Credits from my daring Kitten <@${target.id}>${reason ? ` (${reason})` : ''}.\n• Your remaining indulgence: **${fmt.format(credits)}**`, `🔥 Burned **${fmt.format(amount)}** Credits from <@${target.id}>${reason ? ` (${reason})` : ''}.\n• <@${target.id}>'s Credits: **${fmt.format(credits)}**`), ephemeral: true });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_USER_CREDITS') {
      return interaction.reply({ content: say('❌ That Kitten doesn’t have enough Credits to scorch.', '❌ That user does not have enough Credits.'), ephemeral: true });
    }
    console.error(err);
    return interaction.reply({ content: say('❌ Something went wrong while burning those Credits, Kitten.', '❌ Something went wrong.'), ephemeral: true });
  }
}
