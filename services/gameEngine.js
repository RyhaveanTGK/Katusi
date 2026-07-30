const Room = require('../models/Room');
const GameCard = require('../models/GameCard');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const WinnerLog = require('../models/WinnerLog');
const bots = require('./botEngine');

const DRAW_INTERVAL_SEC = Number(process.env.GAME_DRAW_INTERVAL_SEC || 5);
const ROUND_DURATION_SEC = Number(process.env.GAME_ROUND_DURATION_SEC || 360);

// Real istifadəçi otağa daxil olduqdan sonra bu qədər saniyə gizli gözlənilir;
// bu müddətdə başqa real oyunçu gəlməzsə otağa tək-tək süni oyunçu qoşulur.
const BOT_FILL_DELAY_SEC = Number(process.env.GAME_BOT_FILL_DELAY_SEC || 30);

// Raund bitdikdən sonra qalibin göstərilmə (animasiya) müddəti
const REVEAL_SEC = Number(process.env.GAME_REVEAL_SEC || 12);

const WAITING_SEC = BOT_FILL_DELAY_SEC;
const STARTING_SEC = 0;

const MAX_TICKETS = 5;
const MAX_BALL = 90;

// Bütün otaqlar üçün maksimum oyunçu sayı
const START_PLAYERS = 5;
const MAX_PLAYERS = START_PLAYERS;

// Bir sıranı (5 daş) tam düzən bilet mərcinin 2 misli qədər uduş alır
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

/** Bilet qazanır: BİR SIRA tam düzüldükdə (bütün otaqlar üçün eynidir) */
function isCardComplete(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).some((row) => row.every((n) => marks.has(n)));
}

/** Tam dolan sıranın rəqəmləri */
function completedRow(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).find((row) => row.every((n) => marks.has(n))) || [];
}

function multiplierOf() {
  return ROW_WIN_MULTIPLIER;
}

/** Bir biletin uduş məbləği: qoyulan mərcin 2 misli */
function ticketPrize(room) {
  return Number((Number(room.entryFee || 0) * ROW_WIN_MULTIPLIER).toFixed(2));
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

/** Otaqda görünən ümumi oyunçu sayı */
function visiblePlayerCount(room) {
  return (room.players || []).length + ((room.bots || []).length);
}

function realPlayerCount(room) {
  return (room.players || []).length;
}

function getDisplayStatus(room, now = Date.now()) {
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

/** Otağın dolması üçün lazım olan iştirakçı sayı */
function slotsLeft(room) {
  return Math.max(0, START_PLAYERS - visiblePlayerCount(room));
}

/** Qalib məlumatı görünə bilərmi? (yalnız vaxt bitdikdən sonra) */
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
    // Şəxsi otaqlarda süni oyunçu olmur
    await Room.updateMany({ isCustom: true }, { $set: { botsEnabled: false, bots: [], botStake: 0 } });
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
  room.roundWinners = [];
  room.lastWinnerName = null;
  room.lastWinnerNums = [];
  // Oyun başladıqdan sonra otağa yeni oyunçu (bot daxil) qoşulmur
  bots.finalizeBots(room);
  await room.save();
}

async function resetRoomForNextRound(room) {
  room.status = 'waiting';
  room.players = [];
  room.prize = 0;
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
  // Yeni raundda otaq tamamilə boş qalır: süni oyunçular yalnız real
  // istifadəçi gəldikdən 30 saniyə sonra yenidən qoşulacaq.
  room.bots = [];
  room.botStake = 0;
  room.markModified('bots');
  room.botWinIntended = false;
  room.currentRoundId = Number(room.currentRoundId || 1) + 1;
  room.nextGameAt = null;
  await room.save();
}

/**
 * Bir sıra dolduran bileti qazandırır: mərcin 2 misli dərhal balansa əlavə olunur,
 * məbləğ ortadaki ümumi mərcdən çıxılır. Qalib ADI raund bitənə qədər GİZLİ qalır.
 * Oyun dayanmır — vaxt sona qədər gedir.
 */
async function settleCard(room, card) {
  if (!card || card.isWinner || !isCardComplete(card)) return null;

  const user = await User.findById(card.userId);
  if (!user) return null;

  const prize = ticketPrize(room);
  const winnerNums = completedRow(card).slice(0, 5);

  if (room.type === 'stars') {
    user.stars = Number(user.stars || 0) + prize;
  } else {
    user.balance = Number(user.balance || 0) + prize;
  }
  user.gamesWon = Number(user.gamesWon || 0) + 1;
  user.totalWon = Number(user.totalWon || 0) + prize;
  await user.save();

  card.isWinner = true;
  card.prize = prize;
  card.completedAt = card.completedAt || new Date();
  card.claimedAt = new Date();
  await card.save();

  room.winCount = Number(room.winCount || 0) + 1;
  room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
  room.roundWinners = [...(room.roundWinners || []), {
    name: user.username,
    prize,
    numbers: winnerNums,
    isBot: false
  }];
  room.markModified('roundWinners');
  await room.save();

  await new WinnerLog({
    name: user.username,
    userId: user._id,
    roomId: room._id,
    roomName: room.name,
    prize,
    numbers: winnerNums,
    synthetic: false
  }).save();

  if (room.type !== 'stars') {
    await new Transaction({
      userId: user._id,
      type: 'win',
      amount: prize,
      status: 'completed',
      note: `${room.name} otağında qalib bilet`
    }).save();
  }

  return prize;
}

/** Süni oyunçu bir sıra doldurdu: uduşu ortadan çıxılır, oyun davam edir */
async function settleBotLineWin(room, bot) {
  const nums = bots.botWinningRow(bot, room.drawnNumbers || []).slice(0, 5);
  const prize = ticketPrize(room);

  bot.prize = Number(prize);
  room.winCount = Number(room.winCount || 0) + 1;
  room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
  room.roundWinners = [...(room.roundWinners || []), {
    name: bot.name,
    prize,
    numbers: nums,
    isBot: true
  }];
  room.markModified('roundWinners');
  room.markModified('bots');
  await room.save();

  await new WinnerLog({
    name: bot.name,
    userId: null,
    roomId: room._id,
    roomName: room.name,
    prize,
    numbers: nums,
    synthetic: true
  }).save();
}

/**
 * Raund bitmir — bu funksiya yalnız uyğunluq üçün saxlanılır.
 * Oyun həmişə vaxtın sonuna qədər gedir.
 */
async function maybeFinishRound() {
  return false;
}

/** İstifadəçinin dolan biletlərini avtomatik qazandırır */
async function claimRoomWin(roomId, userId, cardId = null) {
  const room = await Room.findById(roomId);
  if (!room || room.status !== 'started') return { won: false, prize: 0 };

  const query = { roomId: room._id, userId, roundId: room.currentRoundId, isWinner: false };
  if (cardId) query._id = cardId;

  const cards = await GameCard.find(query);
  let total = 0;
  let won = false;
  for (const card of cards) {
    if (!isCardComplete(card)) continue;
    const prize = await settleCard(room, card);
    if (prize !== null && prize !== undefined) { won = true; total += prize; }
  }
  return { won, prize: Number(total.toFixed(2)) };
}

async function drawNextNumber(room) {
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= MAX_BALL; i++) {
    if (!drawn.has(i)) available.push(i);
  }

  // Bütün daşlar çıxıbsa yeni daş çəkilmir, vaxtın sonu gözlənilir
  if (!available.length) return;

  let next;
  if ((room.bots || []).length) {
    const realCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, isWinner: false });
    next = bots.pickNextNumber(room, realCards, available);
  }
  if (!next) next = available[Math.floor(Math.random() * available.length)];

  room.drawnNumbers.push(next);
  room.currentNumber = next;
  room.lastDrawAt = new Date();

  const botWinners = bots.applyDrawToBots(room, next);
  await room.save();

  for (const bot of botWinners) {
    await settleBotLineWin(room, bot);
  }
}

/** İştirakçıların doldurduğu daş sayına görə cədvəl */
async function markLeaderboard(room) {
  const rows = [];

  const cards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
  const byUser = new Map();
  for (const c of cards) {
    const key = String(c.userId);
    const prev = byUser.get(key) || { marks: 0, nums: [] };
    prev.marks += (c.markedNumbers || []).length;
    prev.nums = prev.nums.concat((c.markedNumbers || []).map(Number));
    byUser.set(key, prev);
  }
  const users = await User.find({ _id: { $in: [...byUser.keys()] } }).select('username');
  for (const u of users) {
    const info = byUser.get(String(u._id));
    rows.push({ name: u.username, userId: u._id, marks: info.marks, nums: info.nums, isBot: false });
  }

  for (const b of (room.bots || [])) {
    rows.push({ name: b.name, userId: null, marks: (b.marked || []).length, nums: (b.marked || []).map(Number), isBot: true });
  }

  rows.sort((a, b) => b.marks - a.marks);
  return rows;
}

/**
 * Vaxt bitdi: ortada qalan mərc ən çox daş dolduran iştirakçıya verilir,
 * sonra qalib animasiyalı şəkildə göstərilir.
 */
async function finishRound(room) {
  // hələ ödənilməmiş dolu biletlər varsa ödə
  const pending = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, isWinner: false });
  for (const card of pending) {
    if (isCardComplete(card)) await settleCard(room, card);
  }

  const board = await markLeaderboard(room);
  const leader = board.find((r) => r.marks > 0) || board[0] || null;
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
    await new WinnerLog({
      name: leader.name,
      userId: leader.isBot ? null : leader.userId,
      roomId: room._id,
      roomName: room.name,
      prize,
      numbers: (leader.nums || []).slice(0, 5),
      synthetic: !!leader.isBot
    }).save();
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

      // ── Qalib göstərilir (animasiya) ──
      if (room.status === 'ended') {
        const revealAt = room.revealAt ? new Date(room.revealAt).getTime() : 0;
        if (!revealAt || revealAt <= now) {
          await resetRoomForNextRound(room);
        }
        continue;
      }

      // ── Gözləmə ──
      const real = realPlayerCount(room);

      // Otaqda real oyunçu yoxdursa heç bir bot dayanmır və sayğac sıfırlanır
      if (real < 1) {
        let changed = bots.clearBots(room);
        if (room.botFillAt) { room.botFillAt = null; changed = true; }
        if (changed) await room.save();
        continue;
      }

      // İlk real oyunçu daxil olub: 30 saniyəlik gizli gözləmə başlayır
      if (!room.botFillAt) {
        room.botFillAt = new Date(now + BOT_FILL_DELAY_SEC * 1000);
        await room.save();
        continue;
      }

      // Otaq real oyunçularla doldu — dərhal başlayır
      if (visiblePlayerCount(room) >= START_PLAYERS) {
        await startRoom(room);
        continue;
      }

      const fillReady = new Date(room.botFillAt).getTime() <= now;
      if (!fillReady) continue;

      if (bots.allowBots(room, START_PLAYERS)) {
        // 30 saniyə keçdi: otağa tək-tək süni oyunçu qoşulur
        const changed = bots.addOneBot(room, generateCardNumbers, START_PLAYERS);
        if (changed) await room.save();
        if (visiblePlayerCount(room) >= START_PLAYERS) await startRoom(room);
      } else if (real >= 2) {
        // Şəxsi otaq: bot yoxdur — 30 saniyədən sonra mövcud oyunçularla başlayır
        await startRoom(room);
      }
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
    const cards = await GameCard.find({ userId: u._id, roomId: room._id, roundId: room.currentRoundId }).select('markedNumbers');
    const tickets = cards.length || 1;
    out.push({
      name: u.username,
      tickets,
      stake: Number((fee * tickets).toFixed(2)),
      marked: cards.reduce((s, c) => s + (c.markedNumbers || []).length, 0)
    });
  }

  bots.botRoster(room).forEach((b) => out.push({ name: b.name, tickets: b.tickets, stake: b.stake, marked: b.marked }));
  out.sort((a, b) => b.stake - a.stake);
  return out;
}

/** Otaqda qoyulan ümumi mərc */
function totalStake(room) {
  return Number(Number(room.prize || 0).toFixed(2));
}

module.exports = {
  MAX_BALL,
  START_PLAYERS,
  MAX_PLAYERS,
  ROW_WIN_MULTIPLIER,
  BOT_FILL_DELAY_SEC,
  REVEAL_SEC,
  slotsLeft,
  cardRows,
  completedRow,
  roomRoster,
  totalStake,
  winnerVisible,
  WAITING_SEC,
  STARTING_SEC,
  DRAW_INTERVAL_SEC,
  ROUND_DURATION_SEC,
  MAX_TICKETS,
  ensureDefaultRooms,
  startGameLoop,
  getDisplayStatus,
  getSecsLeft,
  flatCardNumbers,
  isCardComplete,
  claimRoomWin,
  settleCard,
  maybeFinishRound,
  finishRound,
  resetRoomForNextRound,
  generateCardNumbers,
  ticketPrize,
  multiplierOf,
  visiblePlayerCount,
  realPlayerCount,
  botEngine: bots
};
