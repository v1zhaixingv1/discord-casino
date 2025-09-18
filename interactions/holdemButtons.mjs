import { onHoldemButton } from '../games/holdem.mjs';

export default async function handleHoldemButtons(interaction, ctx) {
  return onHoldemButton(interaction, ctx);
}
// Interaction: Hold’em table buttons (create/join/leave/start/act/peek)
