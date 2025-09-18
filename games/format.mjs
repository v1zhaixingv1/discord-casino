export function formatChips(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

export function chipsAmount(n) {
  return `${formatChips(n)} Chips`;
}

export function chipsAmountSigned(n) {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${formatChips(Math.abs(n))} Chips`;
}

