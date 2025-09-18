import { onHoldemCustomModal } from '../games/holdem.mjs';

export default async function handleHoldemCustomModal(interaction, ctx) {
  return onHoldemCustomModal(interaction, ctx);
}
// Interaction: Hold’em custom table modal submit (SB/Min/Max/Cap)
