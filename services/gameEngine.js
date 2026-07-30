const Room = require('../models/Room');
const GameCard = require('../models/GameCard');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const WinnerLog = require('../models/WinnerLog');
const bots = require('./botEngine');

const DRAW_INTERVAL_SEC = Number(process.env.GAME_DRAW_INTERVAL_SEC || 5);
const ROUND_DURATION_SEC = Number(process.env.GAME_ROUND_DURATION_SEC || 360);

// Otaq süni oyunçularla dolarkən hər yeni oyunçu arasındakı gözləmə
const BOT_JOIN_STEP_SEC = Number(process.env.GAME_BOT_JOIN_STEP_SEC || 6);

// Raund bitdikdən sonra qalibin göstərilmə (animasiya) müddəti
const REVEAL_SEC = Number(process.env.GAME_REVEAL_SEC || 12);

const MAX_TICKETS = 5;
const MAX_BALL = 90;

// Bütün otaqlar üçün maksimum oyunçu sayı
const START_PLAYERS = 5;
const MAX_PLAYERS = START_PLAYERS;

// Linya (sıra) uduş faizləri — ortadakı ümumi mərcdən götürülür
const LINE_PERCENTS = [0.08, 0.16, 0.24];

// Otaqdan çıxanda tutulan komissiya (70%) — 30% geri qaytarılır
const LEAVE_COMMISSION = 0.70;

// Köhnə API uyğunluğu
const ROW_WIN_MULTIPLIER = 2;

let loopHandle = null;
let ticking = false;

const DEFAULT_ROOMS = [
  { name: 'Classic 0.20 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.2, maxPlayers: MAX_PLAYERS, sortOrder: 1, jackpotEnabled: true, starPrize: 20, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 0.50 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.5, maxPlayers: MAX_PLAYERS, sortOrder: 2, jackpotEnabled: true, starPrize: 50, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 1.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 1.0, maxPlayers: MAX_PLAYERS, sortOrder: 3, jackpotEnabled: true, starPrize: 100, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 5.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 5.0, maxPlayers: MAX_PLAYERS, sortOrder: 4, jackpotEnabled: true, starPrize: 500, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 10.00 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 10.0, maxPlayers: MAX_PLAYERS, sortOrder: 5, jackpotEnabled: true, starPrize: 1000, prizeMultiplier: 'x2', themeColor: '#1f9b3b' }
];

function flatCardNumbers(card) {
  return (card.numbers || []).flat().filter(Boolean);
}

/** Biletin sıraları (hər sırada 5 rəqəm) */
function cardRows(card) {
  return (card.numbers || []).map((row) => (row || []).filter(Boolean).map(Number)).filter((r) => r.length);
}

/** Biletin işarələnmiş, amma hələ ödənilməmiş tam sıraları */
function newCompletedRows(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  const paid = new Set((card.wonRows || []).map(Number));
  const out = [];
  cardRows(card).forEach((row, index) => {
    if (paid.has(index)) return;
    if (row.every((n) => marks.has(n))) out.push({ index, numbers: row });
  });
  return out;
}

/** Bilet tam doldu (bütün 15 rəqəm işarələnib) */
function isCardFull(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  const nums = flatCardNumbers(card).map(Number);
  return nums.length > 0 && nums.every((n) => marks.has(n));
}

/** Köhnə API: biletdə ən azı bir sıra doludur */
function isCardComplete(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).some((row) => row.every((n) => marks.has(n)));
}

function completedRow(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).find((row) => row.every((n) => marks.has(n))) || [];
}

function multiplierOf() {
  return ROW_WIN_MULTIPLIER;
}

/** Bir linya uduşunun faizi (1-ci, 2-ci, 3-cü linya) */
function linePercent(lineNo) {
  return LINE_PERCENTS[Math.min(Math.max(1, lineNo), LINE_PERCENTS.length) - 1];
}

/** Ortadakı mərcdən linya uduşu */
function linePrize(room, lineNo) {
  const pot = Number(room.prize || 0);
  return Number(Math.max(0, pot * linePercent(lineNo)).toFixed(2));
}

/** Göstərilən "bilet uduşu": 1-ci linyanın uduşu */
function ticketPrize(room) {
  return linePrize(room, 1);
}

/** Random 3x9 loto bileti (hər sətirdə 5 rəqəm) */
function generateCardNumbers() {
  const cols = [
    [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
    [50, 59], [60, 69], [70, 79], [80, 90]
  ];
  const card = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
  const used = Array.from({ length: 9 }, () => new Set());

  for (let row = 0; row < 3; row++) {
    const chosen = [];
    while (chosen.length < 5) {
      const c = Math.floor(Math.random() * 9);
      if (!chosen.includes(c)) chosen.push(c);
    }
    chosen.sort((a, b) => a - b);
    for (const c of chosen) {
      const [min, max] = cols[c];
      let value = min;
      do { value = Math.floor(Math.random() * (max - min + 1)) + min; }
      while (used[c].has(value));
      used[c].add(value);
      card[row][c] = value;
    }
  }
  return card;
}

function visiblePlayerCount(room) {
  return (room.players || []).length + ((room.bots || []).length);
}

function realPlayerCount(room) {
  return (room.players || []).length;
}

function getDisplayStatus(room) {
  if (room.status === 'started') return 'started';
  if (room.status === 'ended')   return 'ended';
  if (visiblePlayerCount(room) >= START_PLAYERS - 1) return 'starting';
  return 'waiting';
}

function getSecsLeft(room, now = Date.now()) {
  if (room.status === 'started' && room.roundEndsAt) {
    return Math.max(0, Math.round((new Date(room.roundEndsAt).getTime() - now) / 1000));
  }
  if (room.status === 'ended' && room.revealAt) {
    return Math.max(0, Math.round((new Date(room.revealAt).getTime() - now) / 1000));
  }
  return 0;
}

function slotsLeft(room) {
  return Math.max(0, START_PLAYERS - visiblePlayerCount(room));
}

/** Qalib məlumatı görünə bilərmi? */
function winnerVisible(room) {
  return room.status === 'ended';
}

async function ensureDefaultRooms() {
  const count = await Room.countDocuments({});
  if (count > 0) {
    await Room.updateMany(
      { $or: [ { ticketLabel: { $exists: false } }, { starPrize: { $exists: false } }, { prizeMultiplier: { $exists: false } }, { currentRoundId: { $exists: false } } ] },
      {
        $set: {
          ticketLabel: 'TAM BİLET',
          starPrize: 20,
          prizeMultiplier: 'x2',
          themeColor: '#1f9b3b',
          currentRoundId: 1,
          drawIntervalSec: DRAW_INTERVAL_SEC,
          roundDurationSec: ROUND_DURATION_SEC
        }
      }
    );
    await Room.updateMany({ status: { $ne: 'started' } }, { $set: { nextGameAt: null } });
    // Bütün otaqlarda maksimum oyunçu 5
    await Room.updateMany({}, { $set: { maxPlayers: MAX_PLAYERS } });
    // Şəxsi otaqlarda süni oyunçu olmur, digər bütün otaqlarda olur
    await Room.updateMany({ isCustom: true }, { $set: { botsEnabled: false, bots: [], botStake: 0 } });
    await Room.updateMany({ isCustom: { $ne: true } }, { $set: { botsEnabled: true } });
    return;
  }

  const rooms = DEFAULT_ROOMS.map((room) => ({
    ...room,
    status: 'waiting',
    prize: 0,
    jackpot: 0,
    currentRoundId: 1,
    drawIntervalSec: DRAW_INTERVAL_SEC,
    roundDurationSec: ROUND_DURATION_SEC,
    nextGameAt: null
  }));
  await Room.insertMany(rooms);
}

/** Otaqda toplanmış ümumi mərc (real + süni oyunçular) */
async function computeStakeTotal(room) {
  const fee = Number(room.entryFee || 0);
  const cardCount = await GameCard.countDocuments({ roomId: room._id, roundId: room.currentRoundId });
  const realStake = Number((fee * cardCount).toFixed(2));
  return Number((realStake + Number(room.botStake || 0)).toFixed(2));
}

async function startRoom(room) {
  room.status = 'started';
  room.startTime = new Date();
  room.roundEndsAt = new Date(Date.now() + (room.roundDurationSec || ROUND_DURATION_SEC) * 1000);
  room.lastDrawAt = null;
  room.currentNumber = null;
  room.drawnNumbers = [];
  room.nextGameAt = null;
  room.botFillAt = null;
  room.revealAt = null;
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  room.finalWinnerName = null;
  room.finalWinnerPrize = 0;
  room.finalWinnerNums = [];
  room.finalWinnerMarks = 0;
  room.finalWinnerLines = 0;
  room.finalWinnerFull = false;
  room.roundWinners = [];
  room.lastWinnerName = null;
  room.lastWinnerNums = [];
  bots.finalizeBots(room);
  room.stakeTotal = await computeStakeTotal(room);
  await room.save();
}

async function resetRoomForNextRound(room) {
  room.status = 'waiting';
  room.players = [];
  room.prize = 0;
  room.stakeTotal = 0;
  room.drawnNumbers = [];
  room.currentNumber = null;
  room.startTime = null;
  room.roundEndsAt = null;
  room.lastDrawAt = null;
  room.revealAt = null;
  room.botFillAt = null;
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  room.roundWinners = [];
  room.bots = [];
  room.botStake = 0;
  room.markModified('bots');
  room.botWinIntended = false;
  room.currentRoundId = Number(room.currentRoundId || 1) + 1;
  room.nextGameAt = null;
  await room.save();
}

async function logWinner(room, { name, userId, prize, numbers, synthetic }) {
  await new WinnerLog({
    name,
    userId: userId || null,
    roomId: room._id,
    roomName: room.name,
    prize,
    numbers: (numbers || []).slice(0, 5),
    synthetic: !!synthetic
  }).save();
}

/**
 * Real oyunçunun bileti: yeni tam olan hər linya üçün ortadakı mərcdən
 * 8% / 16% / 24% ödənilir. Bilet tam dolduqda oyun DƏRHAL bitir.
 * @returns {{prize:number, lines:number, full:boolean}}
 */
async function settleCard(room, card) {
  const result = { prize: 0, lines: 0, full: false };
  if (!card) return result;

  const pending = newCompletedRows(card);
  if (!pending.length && !(isCardFull(card) && !card.fullCard)) return result;

  const user = await User.findById(card.userId);
  if (!user) return result;

  let total = 0;
  let lastNums = [];
  for (const row of pending) {
    const lineNo = Number(card.lineWins || 0) + 1;
    const prize = linePrize(room, lineNo);
    card.wonRows = [...(card.wonRows || []), row.index];
    card.lineWins = lineNo;
    card.isWinner = true;
    card.prize = Number((Number(card.prize || 0) + prize).toFixed(2));
    card.completedAt = card.completedAt || new Date();
    card.claimedAt = new Date();
    lastNums = row.numbers;
    total += prize;

    room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
    room.winCount = Number(room.winCount || 0) + 1;
    room.roundWinners = [...(room.roundWinners || []), {
      name: user.username, prize, numbers: row.numbers, line: lineNo, isBot: false
    }];
    await logWinner(room, { name: user.username, userId: user._id, prize, numbers: row.numbers, synthetic: false });
  }

  if (total > 0) {
    if (room.type === 'stars') user.stars = Number(user.stars || 0) + total;
    else user.balance = Number(user.balance || 0) + total;
    user.gamesWon = Number(user.gamesWon || 0) + pending.length;
    user.totalWon = Number(user.totalWon || 0) + total;
    await user.save();

    if (room.type !== 'stars') {
      await new Transaction({
        userId: user._id,
        type: 'win',
        amount: Number(total.toFixed(2)),
        status: 'completed',
        note: `${room.name} otağında linya uduşu`
      }).save();
    }
  }

  if (isCardFull(card) && !card.fullCard) {
    card.fullCard = true;
    card.fullAt = new Date();
    result.full = true;
  }

  await card.save();
  room.markModified('roundWinners');
  await room.save();

  result.prize = Number(total.toFixed(2));
  result.lines = pending.length;
  return result;
}

/** Süni oyunçunun linya uduşu */
async function settleBotLines(room, bot, rows) {
  for (const row of rows) {
    const lineNo = Number(bot.lineWins || 0) + 1;
    const prize = linePrize(room, lineNo);
    bot.wonRows = [...(bot.wonRows || []), row.key];
    bot.lineWins = lineNo;
    bot.isWinner = true;
    bot.prize = Number((Number(bot.prize || 0) + prize).toFixed(2));

    room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
    room.winCount = Number(room.winCount || 0) + 1;
    room.roundWinners = [...(room.roundWinners || []), {
      name: bot.name, prize, numbers: row.numbers, line: lineNo, isBot: true
    }];
    await logWinner(room, { name: bot.name, prize, numbers: row.numbers, synthetic: true });
  }
  room.markModified('roundWinners');
  room.markModified('bots');
  await room.save();
}

async function maybeFinishRound() {
  return false;
}

/** İstifadəçinin biletlərini yoxlayır və linya uduşlarını ödəyir */
async function claimRoomWin(roomId, userId, cardId = null) {
  const room = await Room.findById(roomId);
  if (!room || room.status !== 'started') return { won: false, prize: 0, full: false, lines: 0 };

  const query = { roomId: room._id, userId, roundId: room.currentRoundId };
  if (cardId) query._id = cardId;

  const cards = await GameCard.find(query);
  let total = 0;
  let lines = 0;
  let full = false;
  let fullCard = null;
  for (const card of cards) {
    const res = await settleCard(room, card);
    total += res.prize;
    lines += res.lines;
    if (res.full) { full = true; fullCard = card; }
  }

  if (full && fullCard) {
    const user = await User.findById(userId);
    await finishRound(room, {
      name: user ? user.username : 'Oyunçu',
      userId,
      isBot: false,
      marks: (fullCard.markedNumbers || []).length,
      lines: Number(fullCard.lineWins || 3),
      nums: flatCardNumbers(fullCard).slice(0, 5),
      full: true
    });
  }

  return { won: total > 0 || full, prize: Number(total.toFixed(2)), lines, full };
}

async function drawNextNumber(room) {
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= MAX_BALL; i++) {
    if (!drawn.has(i)) available.push(i);
  }
  if (!available.length) return;

  let next = null;
  if ((room.bots || []).length) {
    const realCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
    next = bots.pickNextNumber(room, realCards, available);
  }
  // Real istifadəçilər üçün tam random
  if (!next) next = available[Math.floor(Math.random() * available.length)];

  room.drawnNumbers.push(next);
  room.currentNumber = next;
  room.lastDrawAt = new Date();

  const events = bots.applyDrawToBots(room, next);
  await room.save();

  for (const ev of events) {
    if (ev.rows && ev.rows.length) await settleBotLines(room, ev.bot, ev.rows);
  }
  const fullEvent = events.find((e) => e.fullCard);
  if (fullEvent) {
    fullEvent.bot.fullCard = true;
    room.markModified('bots');
    await room.save();
    await finishRound(room, {
      name: fullEvent.bot.name,
      userId: null,
      isBot: true,
      marks: (fullEvent.bot.marked || []).length,
      lines: Number(fullEvent.bot.lineWins || 3),
      nums: (fullEvent.bot.marked || []).slice(0, 5),
      full: true
    });
  }
}

/** İştirakçıların doldurduğu linya / daş sayına görə cədvəl */
async function markLeaderboard(room) {
  const rows = [];

  const cards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
  const byUser = new Map();
  for (const c of cards) {
    const key = String(c.userId);
    const prev = byUser.get(key) || { marks: 0, lines: 0, nums: [] };
    prev.marks += (c.markedNumbers || []).length;
    prev.lines += Number(c.lineWins || 0);
    prev.nums = prev.nums.concat((c.markedNumbers || []).map(Number));
    byUser.set(key, prev);
  }
  const users = await User.find({ _id: { $in: [...byUser.keys()] } }).select('username');
  for (const u of users) {
    const info = byUser.get(String(u._id));
    rows.push({ name: u.username, userId: u._id, marks: info.marks, lines: info.lines, nums: info.nums, isBot: false });
  }

  for (const b of (room.bots || [])) {
    rows.push({
      name: b.name, userId: null,
      marks: (b.marked || []).length,
      lines: Number(b.lineWins || 0),
      nums: (b.marked || []).map(Number),
      isBot: true
    });
  }

  rows.sort((a, b) => (b.lines - a.lines) || (b.marks - a.marks));
  return rows;
}

/**
 * Raund bitir:
 *  - biletin hamısını ilk dolduran varsa dərhal (override ilə),
 *  - əks halda vaxt bitdikdə ən çox linya dolduran qalib olur.
 */
async function finishRound(room, override = null) {
  if (room.status === 'ended') return;

  let leader = override;
  if (!leader) {
    const board = await markLeaderboard(room);
    leader = board.find((r) => r.lines > 0 || r.marks > 0) || board[0] || null;
  }

  const pot = Number(Number(room.prize || 0).toFixed(2));
  let prize = 0;

  if (leader && pot > 0) {
    prize = pot;
    if (!leader.isBot && leader.userId) {
      const user = await User.findById(leader.userId);
      if (user) {
        if (room.type === 'stars') user.stars = Number(user.stars || 0) + prize;
        else user.balance = Number(user.balance || 0) + prize;
        user.gamesWon = Number(user.gamesWon || 0) + 1;
        user.totalWon = Number(user.totalWon || 0) + prize;
        await user.save();

        if (room.type !== 'stars') {
          await new Transaction({
            userId: user._id,
            type: 'win',
            amount: prize,
            status: 'completed',
            note: `${room.name} otağının əsas uduşu`
          }).save();
        }
      }
    }
    await logWinner(room, {
      name: leader.name,
      userId: leader.isBot ? null : leader.userId,
      prize,
      numbers: leader.nums || [],
      synthetic: !!leader.isBot
    });
    room.prize = 0;
    if (room.jackpotEnabled) room.jackpot = 0;
  }

  room.status = 'ended';
  room.revealAt = new Date(Date.now() + REVEAL_SEC * 1000);
  room.currentNumber = null;
  room.finalWinnerName = leader ? leader.name : null;
  room.finalWinnerPrize = Number(prize.toFixed(2));
  room.finalWinnerNums = leader ? (leader.nums || []).slice(0, 5) : [];
  room.finalWinnerMarks = leader ? Number(leader.marks || 0) : 0;
  room.finalWinnerLines = leader ? Number(leader.lines || 0) : 0;
  room.finalWinnerFull = !!(leader && leader.full);
  room.winnerUser = leader && !leader.isBot ? leader.userId : null;
  room.winnerNums = room.finalWinnerNums;
  room.winnerPrize = room.finalWinnerPrize;
  room.lastWinnerName = room.finalWinnerName;
  room.lastWinnerNums = room.finalWinnerNums;
  await room.save();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
    const now = Date.now();

    for (const room of rooms) {
      // ── Oyun gedir ──
      if (room.status === 'started') {
        const roundEndsAt = room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0;
        if (roundEndsAt && roundEndsAt <= now) {
          await finishRound(room);
          continue;
        }
        const lastDrawAt = room.lastDrawAt ? new Date(room.lastDrawAt).getTime() : 0;
        const interval = Number(room.drawIntervalSec || DRAW_INTERVAL_SEC) * 1000;
        if (!lastDrawAt || now - lastDrawAt >= interval) {
          await drawNextNumber(room);
        }
        continue;
      }

      // ── Qalib göstərilir ──
      if (room.status === 'ended') {
        const revealAt = room.revealAt ? new Date(room.revealAt).getTime() : 0;
        if (!revealAt || revealAt <= now) {
          await resetRoomForNextRound(room);
        }
        continue;
      }

      // ── Gözləmə ──
      const canBots = bots.allowBots(room, START_PLAYERS);

      if (!canBots) {
        // Şəxsi otaq: yalnız real oyunçular
        if ((room.bots || []).length) { bots.clearBots(room); await room.save(); }
        if (realPlayerCount(room) >= START_PLAYERS) { await startRoom(room); continue; }
        if (realPlayerCount(room) >= 2) {
          if (!room.botFillAt) { room.botFillAt = new Date(now + 30000); await room.save(); continue; }
          if (new Date(room.botFillAt).getTime() <= now) await startRoom(room);
        } else if (room.botFillAt) {
          room.botFillAt = null;
          await room.save();
        }
        continue;
      }

      // Real oyunçular üçün yer aç
      let changed = bots.makeRoomForReal(room, START_PLAYERS);

      // Otaqda hər zaman 2-4 random süni oyunçu olur
      if (!(room.bots || []).length && bots.seedBots(room, generateCardNumbers, START_PLAYERS)) changed = true;

      if (visiblePlayerCount(room) >= START_PLAYERS) {
        if (changed) await room.save();
        await startRoom(room);
        continue;
      }

      // Otaq tədricən süni oyunçularla dolur
      if (!room.botFillAt) {
        room.botFillAt = new Date(now + BOT_JOIN_STEP_SEC * 1000);
        changed = true;
      } else if (new Date(room.botFillAt).getTime() <= now) {
        if (bots.addOneBot(room, generateCardNumbers, START_PLAYERS)) changed = true;
        room.botFillAt = new Date(now + BOT_JOIN_STEP_SEC * 1000);
      }

      if (changed) await room.save();
      if (visiblePlayerCount(room) >= START_PLAYERS) await startRoom(room);
    }
  } finally {
    ticking = false;
  }
}

function startGameLoop() {
  if (loopHandle) return;
  loopHandle = setInterval(() => {
    tick().catch((err) => console.error('Game engine tick error:', err.message));
  }, 1500);
  setTimeout(() => {
    tick().catch((err) => console.error('Game engine boot error:', err.message));
  }, 800);
}

/** Otaqdakı bütün oyunçular və mərcləri */
async function roomRoster(room) {
  const fee = Number(room.entryFee || 0);
  const out = [];

  const users = await User.find({ _id: { $in: room.players || [] } }).select('username');
  for (const u of users) {
    const cards = await GameCard.find({ userId: u._id, roomId: room._id, roundId: room.currentRoundId }).select('markedNumbers lineWins');
    const tickets = cards.length || 1;
    out.push({
      name: u.username,
      tickets,
      stake: Number((fee * tickets).toFixed(2)),
      marked: cards.reduce((s, c) => s + (c.markedNumbers || []).length, 0),
      lines: cards.reduce((s, c) => s + Number(c.lineWins || 0), 0)
    });
  }

  bots.botRoster(room).forEach((b) => out.push({ name: b.name, tickets: b.tickets, stake: b.stake, marked: b.marked, lines: b.lines }));
  out.sort((a, b) => b.stake - a.stake);
  return out;
}

/** Otaqda qoyulan ümumi mərc (görünən) */
function totalStake(room) {
  const stored = Number(room.stakeTotal || 0);
  const pot = Number(room.prize || 0);
  return Number(Math.max(stored, pot).toFixed(2));
}

module.exports = {
  MAX_BALL,
  MAX_TICKETS,
  START_PLAYERS,
  MAX_PLAYERS,
  LINE_PERCENTS,
  LEAVE_COMMISSION,
  ROW_WIN_MULTIPLIER,
  DRAW_INTERVAL_SEC,
  ROUND_DURATION_SEC,
  REVEAL_SEC,
  ensureDefaultRooms,
  startGameLoop,
  tick,
  startRoom,
  drawNextNumber,
  roomRoster,
  totalStake,
  computeStakeTotal,
  winnerVisible,
  slotsLeft,
  getDisplayStatus,
  getSecsLeft,
  flatCardNumbers,
  cardRows,
  completedRow,
  newCompletedRows,
  isCardFull,
  isCardComplete,
  claimRoomWin,
  settleCard,
  maybeFinishRound,
  finishRound,
  markLeaderboard,
  resetRoomForNextRound,
  generateCardNumbers,
  ticketPrize,
  linePrize,
  linePercent,
  multiplierOf,
  visiblePlayerCount,
  realPlayerCount,
  botEngine: bots
};
