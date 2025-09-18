export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2..14
export const SUITS = ['C', 'D', 'H', 'S'];
export const SUIT_EMOJI = { C: '♣', D: '♦', H: '♥', S: '♠' };

export function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const val = (card) => RANK_VAL[card.r];
export const color = (card) => (card.s === 'H' || card.s === 'D') ? 'RED' : 'BLACK';
export const show = (card) => `${card.r}${SUIT_EMOJI[card.s]}`;

