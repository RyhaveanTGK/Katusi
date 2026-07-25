const express = require('express');
const router  = express.Router();
const Room    = require('../models/Room');
const GameCard = require('../models/GameCard');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const DepositCounter = require('../models/DepositCounter');
const { flatCardNumbers, isCardComplete, getDisplayStatus, getSecsLeft, claimRoomWin, resetRoomForNextRound } = require('../services/gameEngine');
const { notifyDecision } = require('../services/telegramBot');

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

function generateCard() {
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

router.get('/rooms-status', apiAuth, async (req, res) => {
  const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
  const now = Date.now();
  const data = rooms.map((r) => {
    // Artıq status="waiting" olsa da, server tərəfində vaxt gəldikdə
    // avtomatik "starting" / "started" status-a keçir. Client tərəfində
    // yalnız vizual — heç bir lobby gözləməsi yoxdur.
    return {
      id:         r._id.toString(),
      status:     getDisplayStatus(r, now),
      raw_status: r.status,
      player_count: r.players.length,
      prize:      Number(r.prize || 0),
      jackpot:    r.jackpotEnabled ? Number(r.jackpot || 0) : null,
      jackpot_ratio: Number(r.jackpotRatio || 1),
      secs_left:  getSecsLeft(r, now),
      win_count:  Number(r.winCount || 0),
      winner_nums: r.winnerNums || [],
      winner_prize: Number(r.winnerPrize || 0),
      current_number: r.currentNumber,
      star_prize:  Number(r.starPrize || 0),
      multiplier:  r.prizeMultiplier || 'x2'
    };
  });
  res.json(data);
});

router.get('/room/:id', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });

  const card = await GameCard.findOne({ userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  const now = Date.now();

  // İstifadəçi qoşulmayıbsa və round başlayıbsa, avtomatik kart ver
  let autoJoin = false;
  if (!card && (room.status === 'started' || getDisplayStatus(room, now) === 'starting')) {
    const user = await User.findById(req.session.userId);
    if (user && user.balance >= Number(room.entryFee || 0) && user.balance > 0) {
      user.balance -= Number(room.entryFee || 0);
      user.gamesPlayed += 1;
      await user.save();
      room.players.push(user._id);
      room.prize = Number(room.prize || 0) + Number(room.entryFee || 0);
      if (room.jackpotEnabled) room.jackpot = Number(room.jackpot || 0) + Number(room.entryFee || 0);
      await room.save();
      const newCard = new GameCard({
        userId: user._id,
        roomId: room._id,
        roundId: room.currentRoundId,
        numbers: generateCard(),
        markedNumbers: [],
        autoDaub: false
      });
      await newCard.save();
      autoJoin = true;
    }
  }

  const finalCard = card || await GameCard.findOne({ userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
  res.json({
    id:              room._id.toString(),
    room_name:       room.name,
    ticket_label:    room.ticketLabel || 'TAM BİLET',
    status:          getDisplayStatus(room, now),
    raw_status:      room.status,
    player_count:    room.players.length,
    prize:           Number(room.prize || 0),
    jackpot:         room.jackpotEnabled ? Number(room.jackpot || 0) : null,
    jackpot_ratio:   Number(room.jackpotRatio || 1),
    secs_left:       getSecsLeft(room, now),
    win_count:       Number(room.winCount || 0),
    winner_nums:     room.winnerNums || [],
    winner_prize:    Number(room.winnerPrize || 0),
    drawn_numbers:   room.drawnNumbers || [],
    current_number:  room.currentNumber,
    star_prize:      Number(room.starPrize || 0),
    multiplier:      room.prizeMultiplier || 'x2',
    current_round_id: Number(room.currentRoundId || 1),
    auto_joined:     autoJoin,
    card:            cardToClient(finalCard, room)
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

// Yeni round başladıqda köhnə kartı bazadan götürür, yeni kart yaradır.
router.post('/card/:roomId/regenerate', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Round hələ başlamayıbsa → yeni kart; başlayıbsa server özü yeni round-da verəcək.
    const existing = await GameCard.findOne({
      userId: req.session.userId,
      roomId: room._id,
      roundId: room.currentRoundId
    }).sort({ playedAt: -1 });

    if (!existing) return res.status(404).json({ error: 'Card not found' });

    existing.numbers = generateCard();
    existing.markedNumbers = [];
    existing.completedAt = null;
    await existing.save();

    res.json({ ok: true, card: cardToClient(existing, room) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/card/:roomId/reset-marks', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const card = await GameCard.findOne({
      userId: req.session.userId,
      roomId: room._id,
      roundId: room.currentRoundId
    }).sort({ playedAt: -1 });

    if (!card) return res.status(404).json({ error: 'Card not found' });

    card.markedNumbers = [];
    card.completedAt = null;
    await card.save();

    res.json({ ok: true, card: cardToClient(card, room) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/card/:roomId/buy', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const quantity = Math.max(1, Math.min(10, parseInt(req.body.quantity, 10) || 1));
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const feePerCard = Number(room.entryFee || 0);
    const totalFee = feePerCard * quantity;

    if (user.balance < totalFee) {
      return res.status(400).json({ error: 'Balans kifayət deyil' });
    }

    user.balance -= totalFee;
    user.gamesPlayed += quantity;
    await user.save();

    if (!room.players.map(String).includes(String(user._id))) {
      room.players.push(user._id);
    }
    room.prize = Number(room.prize || 0) + totalFee;
    if (room.jackpotEnabled) room.jackpot = Number(room.jackpot || 0) + totalFee;
    await room.save();

    let baseCard = await GameCard.findOne({
      userId: user._id, roomId: room._id, roundId: room.currentRoundId
    }).sort({ playedAt: -1 });

    if (!baseCard) {
      baseCard = new GameCard({
        userId: user._id, roomId: room._id, roundId: room.currentRoundId,
        numbers: generateCard(), markedNumbers: [], autoDaub: false
      });
    } else {
      baseCard.numbers = generateCard();
      baseCard.markedNumbers = [];
      baseCard.completedAt = null;
    }
    await baseCard.save();

    await new Transaction({
      userId: user._id,
      type: 'game_join',
      amount: -totalFee,
      status: 'completed',
      note: `${room.name} otağına ${quantity} bilet`
    }).save();

    res.json({ ok: true, quantity, total: totalFee, card: cardToClient(baseCard, room) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/room/:id/claim-win', apiAuth, async (req, res) => {
  const won = await claimRoomWin(req.params.id, req.session.userId);
  res.json({ ok: true, won });
});

// Oyunçu hazırkı round-da oynamır, amma növbəti round avtomatik
// başlasın və o da qoşula bilsin — bunu təmin etmək üçün əl ilə "force-start"
router.post('/room/:id/force-restart', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Not found' });
    if (room.status !== 'waiting') return res.json({ ok: true, note: 'Oyun artıq aktivdir' });

    // Lobby gözləməsini 0-a endir.
    room.nextGameAt = new Date(Date.now() + 1500);
    await room.save();
    res.json({ ok: true, secs_left: 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// ── Admin tərəfində TX təsdiq/rədd (Telegram bot üçün) ──
router.post('/admin/transactions/:id/approve', apiAdmin, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('userId');
    if (!txn) return res.status(404).json({ error: 'Not found' });
    if (txn.status !== 'pending') return res.json({ ok: false, note: 'Artıq emal olunub' });

    txn.status = 'completed';
    txn.decidedAt = new Date();
    txn.decidedBy = (await User.findById(req.session.userId))?.username || 'admin';
    await txn.save();

    if (txn.type === 'deposit') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    // Withdraw tipli əməliyyatda balans artıq çıxılıb, status=completed isə uğur.
    notifyDecision(txn, txn.userId, 'approved').catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/transactions/:id/reject', apiAdmin, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('userId');
    if (!txn) return res.status(404).json({ error: 'Not found' });
    if (txn.status !== 'pending') return res.json({ ok: false, note: 'Artıq emal olunub' });

    txn.status = 'rejected';
    txn.decidedAt = new Date();
    txn.decidedBy = (await User.findById(req.session.userId))?.username || 'admin';
    txn.adminMessage = req.body.reason || 'Admin tərəfindən rədd edildi';
    await txn.save();

    // Withdraw rədd olunubsa, balansı geri qaytar.
    if (txn.type === 'withdraw') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    notifyDecision(txn, txn.userId, 'rejected').catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bot üçün sadə polling bridge (opsional) — webhook istifadə olunmasa bura zəng edə bilər
const { sendAdminMessage, escapeHtml } = require('../services/telegramBot');
router.post('/admin/telegram/preview', apiAdmin, async (req, res) => {
  const r = await sendAdminMessage(req.body.text || '(boş test mesajı)');
  res.json({ ok: !!r, result: r });
});

module.exports = router;
