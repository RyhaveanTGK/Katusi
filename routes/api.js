const express = require('express');
const router  = express.Router();
const Room    = require('../models/Room');
const GameCard = require('../models/GameCard');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const { flatCardNumbers, isCardComplete, getDisplayStatus, getSecsLeft, claimRoomWin } = require('../services/gameEngine');

const apiAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const apiAdmin = (req, res, next) => {
  if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
};

function cardToClient(card, room) {
  if (!card) return null;
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const allNumbers = flatCardNumbers(card);
  const marks = new Set((card.markedNumbers || []).map(Number));
  return {
    id: card._id.toString(),
    round_id: card.roundId,
    numbers: card.numbers,
    marked_numbers: card.markedNumbers || [],
    auto_daub: !!card.autoDaub,
    is_complete: isCardComplete(card),
    matched_numbers: allNumbers.filter((n) => drawn.has(Number(n))),
    unmarked_drawn_numbers: allNumbers.filter((n) => drawn.has(Number(n)) && !marks.has(Number(n)))
  };
}

router.get('/rooms-status', apiAuth, async (req, res) => {
  const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
  const now = Date.now();
  const data = rooms.map((r) => ({
    id: r._id.toString(),
    status: getDisplayStatus(r, now),
    raw_status: r.status,
    player_count: r.players.length,
    prize: Number(r.prize || 0),
    jackpot: r.jackpotEnabled ? Number(r.jackpot || 0) : null,
    jackpot_ratio: Number(r.jackpotRatio || 1),
    secs_left: getSecsLeft(r, now),
    win_count: Number(r.winCount || 0),
    winner_nums: r.winnerNums || [],
    winner_prize: Number(r.winnerPrize || 0),
    current_number: r.currentNumber,
    star_prize: Number(r.starPrize || 0),
    multiplier: r.prizeMultiplier || 'x2'
  }));
  res.json(data);
});

router.get('/room/:id', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });

  const card = await GameCard.findOne({ userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  const now = Date.now();
  res.json({
    id: room._id.toString(),
    room_name: room.name,
    ticket_label: room.ticketLabel || 'TAM BİLET',
    status: getDisplayStatus(room, now),
    raw_status: room.status,
    player_count: room.players.length,
    prize: Number(room.prize || 0),
    jackpot: room.jackpotEnabled ? Number(room.jackpot || 0) : null,
    jackpot_ratio: Number(room.jackpotRatio || 1),
    secs_left: getSecsLeft(room, now),
    win_count: Number(room.winCount || 0),
    winner_nums: room.winnerNums || [],
    winner_prize: Number(room.winnerPrize || 0),
    drawn_numbers: room.drawnNumbers || [],
    current_number: room.currentNumber,
    star_prize: Number(room.starPrize || 0),
    multiplier: room.prizeMultiplier || 'x2',
    current_round_id: Number(room.currentRoundId || 1),
    card: cardToClient(card, room)
  });
});

router.post('/card/:roomId/toggle', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const card = await GameCard.findOne({ userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const number = Number(req.body.number);
  if (!flatCardNumbers(card).includes(number)) return res.status(400).json({ error: 'Number is not on card' });
  if (!(room.drawnNumbers || []).includes(number)) return res.status(400).json({ error: 'Number has not been drawn yet' });

  const marks = new Set((card.markedNumbers || []).map(Number));
  if (marks.has(number)) marks.delete(number);
  else marks.add(number);
  card.markedNumbers = [...marks].sort((a, b) => a - b);
  card.completedAt = isCardComplete(card) ? (card.completedAt || new Date()) : null;
  await card.save();

  const won = await claimRoomWin(room._id, req.session.userId);
  res.json({ ok: true, won, card: cardToClient(card, room) });
});

router.post('/card/:roomId/auto', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const card = await GameCard.findOne({ userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : String(req.body.enabled) === 'true';
  card.autoDaub = enabled;

  if (enabled) {
    const drawn = new Set((room.drawnNumbers || []).map(Number));
    const merged = new Set((card.markedNumbers || []).map(Number));
    flatCardNumbers(card).forEach((n) => { if (drawn.has(Number(n))) merged.add(Number(n)); });
    card.markedNumbers = [...merged].sort((a, b) => a - b);
    card.completedAt = isCardComplete(card) ? (card.completedAt || new Date()) : null;
  }

  await card.save();
  const won = await claimRoomWin(room._id, req.session.userId);
  res.json({ ok: true, won, card: cardToClient(card, room) });
});

router.post('/room/:id/claim-win', apiAuth, async (req, res) => {
  const won = await claimRoomWin(req.params.id, req.session.userId);
  res.json({ ok: true, won });
});

router.post('/admin/rooms/:id/start', apiAdmin, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });
  room.status = 'started';
  room.startTime = new Date();
  room.roundEndsAt = new Date(Date.now() + (room.roundDurationSec || 360) * 1000);
  room.drawnNumbers = [];
  room.currentNumber = null;
  room.lastDrawAt = null;
  room.nextGameAt = null;
  await room.save();
  res.json({ ok: true });
});

router.post('/admin/rooms/:id/draw', apiAdmin, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room || room.status !== 'started') return res.status(400).json({ error: 'Not in started state' });

  const used = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= 90; i++) if (!used.has(i)) available.push(i);
  if (!available.length) return res.json({ done: true });

  const num = available[Math.floor(Math.random() * available.length)];
  room.drawnNumbers.push(num);
  room.currentNumber = num;
  room.lastDrawAt = new Date();
  await room.save();

  const autoCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId, autoDaub: true });
  for (const card of autoCards) {
    if (flatCardNumbers(card).includes(num) && !(card.markedNumbers || []).includes(num)) {
      card.markedNumbers = [...new Set([...(card.markedNumbers || []), num])];
      card.completedAt = isCardComplete(card) ? (card.completedAt || new Date()) : null;
      await card.save();
    }
  }

  res.json({ ok: true, number: num, all: room.drawnNumbers });
});

router.post('/admin/rooms/:id/end', apiAdmin, async (req, res) => {
  try {
    const { winnerUserId } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Not found' });

    if (winnerUserId) {
      const user = await User.findById(winnerUserId);
      if (user) {
        const prize = Number(room.prize || 0);
        user.balance += prize;
        user.gamesWon += 1;
        user.totalWon += prize;
        await user.save();

        await new Transaction({ userId: user._id, type: 'win', amount: prize, status: 'completed', note: `${room.name} otağında qalib` }).save();

        room.lastWinnerName = user.username;
        room.lastWinnerNums = room.drawnNumbers.slice(-5);
        room.winCount = Number(room.winCount || 0) + 1;
      }
    }

    room.status = 'waiting';
    room.players = [];
    room.prize = 0;
    room.drawnNumbers = [];
    room.currentNumber = null;
    room.startTime = null;
    room.lastDrawAt = null;
    room.roundEndsAt = null;
    room.currentRoundId = Number(room.currentRoundId || 1) + 1;
    room.nextGameAt = new Date(Date.now() + 75000);
    await room.save();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;