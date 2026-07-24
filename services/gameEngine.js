const Room = require('../models/Room');
const GameCard = require('../models/GameCard');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const WAITING_SEC = Number(process.env.GAME_WAITING_SEC || 75);
const STARTING_SEC = Number(process.env.GAME_STARTING_WINDOW_SEC || 15);
const DRAW_INTERVAL_SEC = Number(process.env.GAME_DRAW_INTERVAL_SEC || 5);
const ROUND_DURATION_SEC = Number(process.env.GAME_ROUND_DURATION_SEC || 360);

let loopHandle = null;
let ticking = false;

const DEFAULT_ROOMS = [
  { name: 'Classic 0.20 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.2, maxPlayers: 50, sortOrder: 1, jackpotEnabled: true, starPrize: 20, prizeMultiplier: 'x4', themeColor: '#1f9b3b' },
  { name: 'Classic 0.50 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.5, maxPlayers: 50, sortOrder: 2, jackpotEnabled: true, starPrize: 50, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 1.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 1.0, maxPlayers: 50, sortOrder: 3, jackpotEnabled: true, starPrize: 100, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 5.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 5.0, maxPlayers: 50, sortOrder: 4, jackpotEnabled: true, starPrize: 500, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 10.00 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 10.0, maxPlayers: 50, sortOrder: 5, jackpotEnabled: true, starPrize: 1000, prizeMultiplier: 'x2', themeColor: '#1f9b3b' }
];

function flatCardNumbers(card) {
  return (card.numbers || []).flat().filter(Boolean);
}

function isCardComplete(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  const numbers = flatCardNumbers(card);
  return numbers.length > 0 && numbers.every((n) => marks.has(Number(n)));
}

function getDisplayStatus(room, now = Date.now()) {
  if (room.status === 'started') return 'started';
  if (room.status === 'ended') return 'ended';
  if (room.nextGameAt) {
    const diff = new Date(room.nextGameAt).getTime() - now;
    if (diff <= STARTING_SEC * 1000) return 'starting';
  }
  return 'waiting';
}

function getSecsLeft(room, now = Date.now()) {
  if (room.status === 'started' && room.roundEndsAt) {
    return Math.max(0, Math.round((new Date(room.roundEndsAt).getTime() - now) / 1000));
  }
  if (room.nextGameAt) {
    return Math.max(0, Math.round((new Date(room.nextGameAt).getTime() - now) / 1000));
  }
  return WAITING_SEC;
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
    await Room.updateMany({ nextGameAt: null, status: { $ne: 'started' } }, { $set: { nextGameAt: new Date(Date.now() + WAITING_SEC * 1000) } });
    return;
  }

  const startAt = Date.now() + WAITING_SEC * 1000;
  const rooms = DEFAULT_ROOMS.map((room, i) => ({
    ...room,
    status: 'waiting',
    prize: 0,
    jackpot: 0,
    currentRoundId: 1,
    drawIntervalSec: DRAW_INTERVAL_SEC,
    roundDurationSec: ROUND_DURATION_SEC,
    nextGameAt: new Date(startAt + i * Math.max(5000, Math.floor((WAITING_SEC * 1000) / 2)))
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
  room.currentRoundId = Number(room.currentRoundId || 1) + 1;
  room.nextGameAt = new Date(Date.now() + WAITING_SEC * 1000);
  await room.save();
}

async function settleWinner(room, card) {
  const prize = Number(room.prize || 0);
  const user = await User.findById(card.userId);
  if (!user) {
    await resetRoomForNextRound(room);
    return false;
  }

  const cardNumbers = flatCardNumbers(card);
  const marked = new Set((card.markedNumbers || []).map(Number));
  const winnerNums = cardNumbers.filter((n) => marked.has(Number(n))).slice(0, 5);

  user.balance += prize;
  user.gamesWon += 1;
  user.totalWon += prize;
  await user.save();

  room.winnerUser = user._id;
  room.winnerNums = winnerNums;
  room.winnerPrize = prize;
  room.winCount = Number(room.winCount || 0) + 1;
  room.lastWinnerName = user.username;
  room.lastWinnerNums = winnerNums;

  card.isWinner = true;
  card.prize = prize;
  card.completedAt = card.completedAt || new Date();
  card.claimedAt = new Date();
  await card.save();

  await new Transaction({
    userId: user._id,
    type: 'win',
    amount: prize,
    status: 'completed',
    note: `${room.name} otağında qalib`
  }).save();

  await resetRoomForNextRound(room);
  return true;
}

async function claimRoomWin(roomId, userId) {
  const room = await Room.findById(roomId);
  if (!room || room.status !== 'started' || room.winnerUser) return false;

  const card = await GameCard.findOne({ roomId: room._id, userId, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  if (!card || !isCardComplete(card)) return false;
  return settleWinner(room, card);
}

async function drawNextNumber(room) {
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= 90; i++) {
    if (!drawn.has(i)) available.push(i);
  }

  if (!available.length) {
    await resetRoomForNextRound(room);
    return;
  }

  const next = available[Math.floor(Math.random() * available.length)];
  room.drawnNumbers.push(next);
  room.currentNumber = next;
  room.lastDrawAt = new Date();
  await room.save();

  const autoCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, autoDaub: true });
  for (const card of autoCards) {
    const numbers = flatCardNumbers(card);
    if (!numbers.includes(next)) continue;
    if (!(card.markedNumbers || []).includes(next)) {
      card.markedNumbers = [...new Set([...(card.markedNumbers || []), next])];
      if (isCardComplete(card)) card.completedAt = card.completedAt || new Date();
      await card.save();
      if (isCardComplete(card)) {
        await claimRoomWin(room._id, card.userId);
        return;
      }
    }
  }
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
          const winnerCard = await GameCard.findOne({ roomId: room._id, roundId: room.currentRoundId }).sort({ completedAt: 1, playedAt: 1 });
          if (winnerCard && isCardComplete(winnerCard)) {
            await settleWinner(room, winnerCard);
          } else {
            await resetRoomForNextRound(room);
          }
          continue;
        }

        const lastDrawAt = room.lastDrawAt ? new Date(room.lastDrawAt).getTime() : 0;
        const interval = Number(room.drawIntervalSec || DRAW_INTERVAL_SEC) * 1000;
        if (!lastDrawAt || now - lastDrawAt >= interval) {
          await drawNextNumber(room);
        }
        continue;
      }

      const nextGameAt = room.nextGameAt ? new Date(room.nextGameAt).getTime() : 0;
      if (!nextGameAt) {
        room.nextGameAt = new Date(now + WAITING_SEC * 1000);
        await room.save();
        continue;
      }
      if (nextGameAt <= now) {
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

module.exports = {
  WAITING_SEC,
  STARTING_SEC,
  DRAW_INTERVAL_SEC,
  ROUND_DURATION_SEC,
  ensureDefaultRooms,
  startGameLoop,
  getDisplayStatus,
  getSecsLeft,
  flatCardNumbers,
  isCardComplete,
  claimRoomWin
};
