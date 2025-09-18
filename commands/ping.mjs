export default async function handlePing(interaction) {
  return interaction.reply({ content: 'Pong 🏓', ephemeral: true });
}

