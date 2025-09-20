import { setKittenMode } from '../db.auto.mjs';

export default async function handleKittenMode(interaction, ctx) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ This command can only be used inside a server.', ephemeral: true });
  }
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission to toggle Kitten mode.', ephemeral: true });
  }

  const enabled = interaction.options.getBoolean('enabled', true);
  const settings = await setKittenMode(interaction.guild.id, enabled);
  const active = !!settings?.kitten_mode_enabled;

  let message;
  if (active) {
    message = '💋 Kitten mode is now purring across this server. I\'ll slip into that mature, sultry tone and call everyone my Kitten.';
  } else {
    message = 'Kitten mode has been disabled for this server. I\'ll return to the standard casino voice.';
  }

  if (typeof ctx.kittenizeText === 'function') {
    message = ctx.kittenizeText(message);
  }

  return interaction.reply({ content: message, ephemeral: true });
}
