const Room = require('../models/Room');
const GameCard = require('../models/GameCard');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const WinnerLog = require('../models/WinnerLog');
const bots = require('./botEngine');


const WAITING_SEC = Number(process.env.GAME_WAITING_SEC || 5);
const STARTING_SEC = Number(process.env.GAME_STARTING_WINDOW_SEC || 3);
const DRAW_INTERVAL_SEC = Number(process.env.GAME_DRAW_INTERVAL_SEC || 5);
const ROUND_DURATION_SEC = Number(process.env.GAME_ROUND_DURATION_SEC || 360);

const MAX_TICKETS = 5;
const MAX_BALL = 90;    // daşlar 1–90 arasında random çıxır, təkrar olmur

// ── Otaq dolduqda dərhal başlayır: başlama vaxtı (geri sayım) yoxdur ──
// 5 iştirakçı (bot və ya real istifadəçi — qarışıq) toplananda oyun start verir.
const START_PLAYERS = Number(process.env.GAME_START_PLAYERS || 5);

// Bir sıranı (5 daş) tam düzən bilet mərcinin 2 misli qədər uduş alır
const ROW_WIN_MULTIPLIER = 2;

let loopHandle = null;
let ticking = false;

const DEFAULT_ROOMS = [
  { name: 'Classic 0.20 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.2, maxPlayers: START_PLAYERS, sortOrder: 1, jackpotEnabled: true, starPrize: 20, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 0.50 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.5, maxPlayers: START_PLAYERS, sortOrder: 2, jackpotEnabled: true, starPrize: 50, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 1.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 1.0, maxPlayers: START_PLAYERS, sortOrder: 3, jackpotEnabled: true, starPrize: 100, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 5.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 5.0, maxPlayers: START_PLAYERS, sortOrder: 4, jackpotEnabled: true, starPrize: 500, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 10.00 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 10.0, maxPlayers: START_PLAYERS, sortOrder: 5, jackpotEnabled: true, starPrize: 1000, prizeMultiplier: 'x2', themeColor: '#1f9b3b' }
];

function flatCardNumbers(card) {
  return (card.numbers || []).flat().filter(Boolean);
}

/** Biletin sıraları (hər sırada 5 rəqəm) */
function cardRows(card) {
  return (card.numbers || []).map((row) => (row || []).filter(Boolean).map(Number)).filter((r) => r.length);
}

/**
 * Bilet qazanır: BİR SIRA tam düzüldükdə.
 * (Bütün otaqlar üçün eynidir — 1 sıra = mərcin 2 misli uduş)
 */
function isCardComplete(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).some((row) => row.every((n) => marks.has(n)));
}

/** Tam dolan sıranın rəqəmləri */
function completedRow(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).find((row) => row.every((n) => marks.has(n))) || [];
}

/** 'x4' → 4, 'x2' → 2 */
function multiplierOf(room) {
  return ROW_WIN_MULTIPLIER;
}

/** Bir biletin uduş məbləği: qoyulan mərcin 2 misli (1 sıra düzüldükdə) */
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

function getDisplayStatus(room, now = Date.now()) {
  if (room.status === 'started') return 'started';
  if (room.status === 'ended')   return 'ended';
  // Başlama vaxtı yoxdur: otaq dolmağa yaxınlaşdıqda "başlayır" göstərilir
  if (visiblePlayerCount(room) >= START_PLAYERS - 1) return 'starting';
  return 'waiting';
}

function getSecsLeft(room, now = Date.now()) {
  if (room.status === 'started' && room.roundEndsAt) {
    return Math.max(0, Math.round((new Date(room.roundEndsAt).getTime() - now) / 1000));
  }
  return 0;   // gözləmə mərhələsində geri sayım yoxdur — otaq dolan kimi başlayır
}

/** Otağın dolması üçün lazım olan iştirakçı sayı */
function slotsLeft(room) {
  return Math.max(0, START_PLAYERS - visiblePlayerCount(room));
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
    // Başlama vaxtı ləğv edilib — otaqlar yalnız dolduqda başlayır
    await Room.updateMany({ status: { $ne: 'started' } }, { $set: { nextGameAt: null } });
    await Room.updateMany({ maxPlayers: { $gt: START_PLAYERS } }, { $set: { maxPlayers: START_PLAYERS } });
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
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  // ── Botlar: 3-dən az real oyunçu varsa otağa bot əlavə olunur ──
  bots.syncBots(room, generateCardNumbers, START_PLAYERS);
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
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  room.bots = (room.bots || []).map((b) => ({
    name: b.name,
    numbers: b.numbers,
    cards: b.cards,
    tickets: b.tickets,
    stake: b.stake,
    marked: [],
    isWinner: false,
    joinedAt: b.joinedAt
  }));
  room.botStake = 0;
  bots.recalcBotStake(room);
  room.markModified('bots');
  room.botWinIntended = false;
  room.currentRoundId = Number(room.currentRoundId || 1) + 1;
  room.nextGameAt = null;
  await room.save();
}


/**
 * Bir bileti qalib elan edir və uduşu dərhal balansa əlavə edir.
 * Otaq DAYANDIRILMIR — digər biletlərin dolması gözlənilir.
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

  room.winnerUser = user._id;
  room.winnerNums = winnerNums;
  room.winnerPrize = prize;
  room.winCount = Number(room.winCount || 0) + 1;
  room.lastWinnerName = user.username;
  room.lastWinnerNums = winnerNums;
  room.prize = Math.max(0, Number(room.prize || 0) - prize);
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

/** Round-un bütün biletləri dolubsa yeni round-a keç */
async function maybeFinishRound(room) {
  const cards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
  if (!cards.length) return false;
  const allDone = cards.every((c) => c.isWinner);
  if (allDone) {
    await resetRoomForNextRound(room);
    return true;
  }
  return false;
}

/**
 * Manual/avtomatik yoxlama: istifadəçinin (bütün və ya bir) biletləri
 * tam dolubsa avtomatik qazandırır.
 */
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
  if (won) await maybeFinishRound(room);
  return { won, prize: Number(total.toFixed(2)) };
}

async function drawNextNumber(room) {
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= MAX_BALL; i++) {
    if (!drawn.has(i)) available.push(i);
  }

  if (!available.length) {
    await resetRoomForNextRound(room);
    return;
  }

  // Botlar varsa daş çəkilişi 80/20 qaydasına uyğun yönləndirilir
  let next;
  if ((room.bots || []).length) {
    const realCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, isWinner: false });
    next = bots.pickNextNumber(room, realCards, available);
  }
  if (!next) next = available[Math.floor(Math.random() * available.length)];

  room.drawnNumbers.push(next);
  room.currentNumber = next;
  room.lastDrawAt = new Date();

  const botWinner = bots.applyDrawToBots(room, next);
  await room.save();

  if (botWinner) {
    await settleBotWin(room, botWinner);
  }
}

/** Bot bileti tam dolduqda raundu bağlayır (real bilet dolubsa əvvəlcə ödənir) */
async function settleBotWin(room, bot) {
  const pending = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, isWinner: false });
  for (const card of pending) {
    if (isCardComplete(card)) await settleCard(room, card);
  }

  const nums = bots.botWinningRow(bot, room.drawnNumbers || []).slice(0, 5);
  const prize = ticketPrize(room);
  room.winnerUser = null;
  room.winnerNums = nums;
  room.winnerPrize = prize;
  room.winCount = Number(room.winCount || 0) + 1;
  room.lastWinnerName = bot.name;
  room.lastWinnerNums = nums;
  // Uduş ümumi mərcdən çıxılır
  room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
  await room.save();

  // Qalib siyahısına düşsün
  await new WinnerLog({
    name: bot.name,
    userId: null,
    roomId: room._id,
    roomName: room.name,
    prize: room.winnerPrize,
    numbers: nums,
    synthetic: true
  }).save();

  await resetRoomForNextRound(room);
}


async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
    const now = Date.now();

    for (const room of rooms) {
      if (room.status === 'started') {
        const roundEndsAt = room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0;
        if (roundEndsAt && roundEndsAt <= now) {
          // Round bitir: dolu olub hələ ödənilməmiş biletləri ödə, sonra sıfırla
          const pending = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, isWinner: false });
          for (const card of pending) {
            if (isCardComplete(card)) await settleCard(room, card);
          }
          await resetRoomForNextRound(room);
          continue;
        }

        const lastDrawAt = room.lastDrawAt ? new Date(room.lastDrawAt).getTime() : 0;
        const interval = Number(room.drawIntervalSec || DRAW_INTERVAL_SEC) * 1000;
        if (!lastDrawAt || now - lastDrawAt >= interval) {
          await drawNextNumber(room);
        }
        continue;
      }

      // ── Gözləmə: başlama vaxtı yoxdur, otaq dolan kimi oyun başlayır ──
      const changed = bots.driftBots(room, generateCardNumbers, START_PLAYERS);
      if (visiblePlayerCount(room) >= START_PLAYERS) {
        await startRoom(room);
      } else if (changed) {
        room.nextGameAt = null;
        await room.save();
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

/** Otaqda görünən ümumi oyunçu sayı */
function visiblePlayerCount(room) {
  return (room.players || []).length + ((room.bots || []).length);
}

/** Otaqdakı bütün oyunçular və mərcləri (real + digər onlayn oyunçular) */
async function roomRoster(room) {
  const User = require('../models/User');
  const GameCard = require('../models/GameCard');
  const fee = Number(room.entryFee || 0);
  const out = [];

  const users = await User.find({ _id: { $in: room.players || [] } }).select('username');
  for (const u of users) {
    const tickets = await GameCard.countDocuments({
      userId: u._id, roomId: room._id, roundId: room.currentRoundId
    });
    out.push({
      name: u.username,
      tickets: tickets || 1,
      stake: Number((fee * (tickets || 1)).toFixed(2))
    });
  }

  bots.botRoster(room).forEach((b) => out.push({ name: b.name, tickets: b.tickets, stake: b.stake }));
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
  ROW_WIN_MULTIPLIER,
  slotsLeft,
  cardRows,
  completedRow,
  roomRoster,
  totalStake,
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
  resetRoomForNextRound,
  generateCardNumbers,
  ticketPrize,
  multiplierOf,
  visiblePlayerCount,
  botEngine: bots
};
