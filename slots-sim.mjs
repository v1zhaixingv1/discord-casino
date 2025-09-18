#!/usr/bin/env node
import crypto from 'node:crypto';

// Copy of current slot config from index.mjs (20 lines setup)
const SYMBOLS = {
  W: { id: 'W', type: 'wild', pay: [0, 50, 500], substitutes: ['A','K','Q','J','T','N','H1','H2'] },
  S: { id: 'S', type: 'scatter', scatterPay: { 3: 40, 4: 200, 5: 1000 } },
  H1: { id: 'H1', type: 'regular', pay: [20, 100, 500] },
  H2: { id: 'H2', type: 'regular', pay: [15, 80, 400] },
  A: { id: 'A', type: 'regular', pay: [10, 50, 200] },
  K: { id: 'K', type: 'regular', pay: [8, 40, 150] },
  Q: { id: 'Q', type: 'regular', pay: [6, 30, 120] },
  J: { id: 'J', type: 'regular', pay: [5, 25, 100] },
  T: { id: 'T', type: 'regular', pay: [4, 20, 80] },
  N: { id: 'N', type: 'regular', pay: [3, 15, 60] },
  X: { id: 'X', type: 'blank' }
};

const STRIPS = [
  ['A','X','H1','Q','X','W','K','X','S','J','X','H2','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X'],
  ['Q','X','H2','A','X','K','X','S','X','J','X','W','N','X','T','X','K','X','A','X','Q','X','N','X','T','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X'],
  ['K','X','A','X','Q','X','N','X','W','T','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','S','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X'],
  ['A','X','Q','X','N','X','T','X','K','X','A','X','S','X','Q','X','W','N','X','T','X','H1','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X','S','X'],
  ['N','X','T','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','W','K','X','A','X','Q','X','N','X','T','X']
];

const LINES = [
  [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [0,0,1,0,0], [1,1,2,1,1], [2,2,1,2,2],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,1,1,1,0], [2,1,1,1,2],
  [0,2,0,2,0], [2,0,2,0,2],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,1,0,1,0], [2,1,2,1,2],
  [0,2,2,2,0], [2,0,0,0,2]
];

const FILL = ['A','K','Q','J','T','N'];
const rngInt = (n) => crypto.randomInt(0, n);

function spinGrid() {
  const grid = Array.from({ length: 3 }, () => Array(5).fill('X'));
  for (let r = 0; r < 5; r++) {
    const strip = STRIPS[r];
    const start = rngInt(strip.length);
    for (let row = 0; row < 3; row++) {
      let s = strip[(start + row) % strip.length];
      if (s === 'X') s = FILL[rngInt(FILL.length)];
      grid[row][r] = s;
    }
  }
  return grid;
}

function evalGrid(grid, totalBet) {
  const lines = LINES.length;
  const lineBet = totalBet / lines;
  let total = 0;
  let isWin = false;
  // scatters
  let scatters = 0;
  for (let r=0;r<3;r++) for (let c=0;c<5;c++) if (grid[r][c]==='S') scatters++;
  const sPay = SYMBOLS.S.scatterPay[scatters] || 0;
  const sWin = Math.floor(sPay * lineBet);
  total += sWin;
  if (sWin>0) isWin = true;
  // lines
  for (let li=0; li<lines; li++) {
    const rows = LINES[li];
    const seq = rows.map((row, col) => grid[row][col]);
    let base = null;
    for (const s of seq) { if (s!=='W' && s!=='S' && s!=='X') { base = s; break; } }
    if (!base) continue;
    const sym = SYMBOLS[base];
    let match = 0;
    for (let i=0;i<5;i++) { const s=seq[i]; if (s===base || s==='W') match++; else break; }
    if (match>=3) {
      const tier = match - 3;
      const pay = (sym.pay && sym.pay[tier]) ? sym.pay[tier] : 0;
      const w = Math.floor(pay * lineBet);
      if (w>0) { total += w; isWin = true; }
    }
  }
  return { total, isWin };
}

async function main() {
  const spins = Number(process.argv[2] || 200000); // default 200k
  const bet = Number(process.argv[3] || 100); // total bet per spin
  let betSum = 0, retSum = 0, hit = 0;
  for (let i=0;i<spins;i++) {
    const grid = spinGrid();
    const { total, isWin } = evalGrid(grid, bet);
    betSum += bet;
    retSum += total;
    if (isWin) hit++;
  }
  const rtp = retSum / betSum;
  const houseEdge = 1 - rtp;
  const hitRate = hit / spins;
  console.log(JSON.stringify({ spins, bet, rtp, houseEdge, hitRate }, null, 2));
}

main();

