import { onHoldemJoinModal } from '../games/holdem.mjs';

export default async function handleHoldemJoinModal(interaction, ctx) {
  return onHoldemJoinModal(interaction, ctx);
}
// Interaction: Hold’em join modal submit (buy-in amount)
