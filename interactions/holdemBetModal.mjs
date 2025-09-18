import { onHoldemBetModal } from '../games/holdem.mjs';

export default async function handleHoldemBetModal(interaction, ctx) {
  return onHoldemBetModal(interaction, ctx);
}
// Interaction: Hold’em bet modal submit (Bet/Raise amount)
