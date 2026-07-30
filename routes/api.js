const express = require('express');
const router  = express.Router();
const Room    = require('../models/Room');
const GameCard = require('../models/GameCard');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const WinnerLog = require('../models/WinnerLog');
const DepositCounter = require('../models/DepositCounter');
const { flatCardNumbers, isCardComplete, isCardFull, linePrize, computeStakeTotal, LEAVE_COMMISSION, START_PLAYERS, winnerVisible, slotsLeft, getDisplayStatus, getSecsLeft, claimRoomWin, resetRoomForNextRound, generateCardNumbers, ticketPrize, MAX_TICKETS, visiblePlayerCount, roomRoster, totalStake, canMarkNumber, missedNumbersFor, basePotOf, findJoinableRoom, MARK_GRACE_SEC, capacityOf, startsInSec } = require('../services/gameEngine');
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
  const now = Date.now();
  const missed = missedNumbersFor(room, card, now);
  const missedSet = new Set(missed.map(Number));
  return {
    id: card._id.toString(),
    round_id: card.roundId,
    numbers: card.numbers,
    marked_numbers: card.markedNumbers || [],
    auto_daub: !!card.autoDaub,
    is_complete: isCardComplete(card),
    is_full: isCardFull(card),
    line_wins: Number(card.lineWins || 0),
    is_winner: !!card.isWinner,
    prize: Number(card.prize || 0),
    ticket_index: Number(card.ticketIndex || 1),
    matched_numbers: allNumbers.filter((n) => drawn.has(Number(n))),
    missed_numbers: missed,
    unmarked_drawn_numbers: allNumbers.filter((n) => drawn.has(Number(n)) && !marks.has(Number(n)) && !missedSet.has(Number(n)))
  };
}

function generateCard() { // legacy wrapper
  return generateCardNumbers();
}
function _unusedGenerateCard() {
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
  // ÖNƏMLİ: ana səhifə (routes/game.js "/") yalnız istifadəçinin görə bildiyi
  // otaqları render edir. Əvvəl burada BÜTÜN otaqlar qaytarılırdı; başqa
  // istifadəçinin özəl otağı üçün səhifədə kart tapılmadığından client
  // "yeni otaq var" sanaraq hər 3 saniyədən bir səhifəni yeniləyirdi
  // (sonsuz reload döngüsü). İndi eyni görünürlük filtri tətbiq olunur.
  const unlocked = (req.session.unlockedRooms || []);
  const rooms = await Room.find({
    $or: [
      { isCustom: { $ne: true } },
      { ownerId: req.session.userId },
      { _id: { $in: unlocked } }
    ]
  }).sort({ sortOrder: 1, createdAt: 1 });
  const now = Date.now();
  const data = rooms.map((r) => {
    // Başlamış / bitmiş otaqlar ana səhifədən silinir
    if (r.status !== 'waiting') return { id: r._id.toString(), removed: true };
    return {
      id:         r._id.toString(),
      status:     getDisplayStatus(r, now),
      raw_status: r.status,
      player_count: visiblePlayerCount(r),
      room_size:    capacityOf(r),
      slots_left:   slotsLeft(r),
      starts_in:    startsInSec(r, now),
      bot_count:    (r.bots || []).length,
      prize:      Number(r.prize || 0),
      jackpot:    r.jackpotEnabled ? Number(r.jackpot || 0) : null,
      jackpot_ratio: Number(r.jackpotRatio || 1),
      secs_left:  getSecsLeft(r, now),
      win_count:  Number(r.winCount || 0),
      winner_nums: winnerVisible(r) ? (r.winnerNums || []) : [],
      winner_prize: winnerVisible(r) ? Number(r.winnerPrize || 0) : 0,
      current_number: r.currentNumber,
      star_prize:  Number(r.starPrize || 0),
      multiplier:  r.prizeMultiplier || 'x2',
      last_winner_name: winnerVisible(r) ? (r.lastWinnerName || null) : null,
      last_winner_nums: winnerVisible(r) ? (r.lastWinnerNums || []) : []
    };
  });
  res.json(data);
});

// ── Son qazananlar (real-time ticker üçün) ──
// Bütün otaqlardan ən son qazanan oyunçuların adı və məbləği.
router.get('/latest-winners', async (req, res) => {
  try {
    const games = await WinnerLog.find({}).sort({ createdAt: -1 }).limit(15);
    const out = games.map((g) => ({
      name: g.name || 'Oyunçu',
      room: g.roomName || 'Otaq',
      prize: Number(g.prize || 0),
      at: g.createdAt
    }));
    res.json(out);
  } catch (e) {
    res.json([]);
  }
});

router.get('/room/:id', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });

  const now = Date.now();
  const cards = await GameCard.find({
    userId: req.session.userId,
    roomId: room._id,
    roundId: room.currentRoundId
  }).sort({ ticketIndex: 1, playedAt: 1 });

  const roster = await roomRoster(room);
  const me = await User.findById(req.session.userId).select('balance stars');

  res.json({
    id:              room._id.toString(),
    room_name:       room.name,
    ticket_label:    room.ticketLabel || 'TAM BİLET',
    status:          getDisplayStatus(room, now),
    raw_status:      room.status,
    player_count:    visiblePlayerCount(room),
    room_size:       capacityOf(room),
    slots_left:      slotsLeft(room),
    starts_in:       startsInSec(room, now),
    players:         roster,
    // Ortadakı ƏSAS mərc: linya uduşları ödəndikcə azalır
    total_stake:     Number(Number(room.prize || 0).toFixed(2)),
    base_pot:        basePotOf(room),
    mark_grace_sec:  Number(room.markGraceSec || MARK_GRACE_SEC),
    balance:         Number((me && me.balance) || 0),
    stars:           Number((me && me.stars) || 0),
    prize:           Number(room.prize || 0),
    ticket_prize:    ticketPrize(room),
    entry_fee:       Number(room.entryFee || 0),
    jackpot:         room.jackpotEnabled ? Number(room.jackpot || 0) : null,
    jackpot_ratio:   Number(room.jackpotRatio || 1),
    secs_left:       getSecsLeft(room, now),
    win_count:       Number(room.winCount || 0),
    // Qalib yalnız vaxt bitdikdən sonra açıqlanır
    winner_nums:     winnerVisible(room) ? (room.winnerNums || []) : [],
    winner_prize:    winnerVisible(room) ? Number(room.winnerPrize || 0) : 0,
    final_winner:    winnerVisible(room) && room.finalWinnerName ? {
      name:  room.finalWinnerName,
      prize: Number(room.finalWinnerPrize || 0),
      marks: Number(room.finalWinnerMarks || 0),
      lines: Number(room.finalWinnerLines || 0),
      full:  !!room.finalWinnerFull,
      numbers: room.finalWinnerNums || []
    } : null,
    drawn_numbers:   room.drawnNumbers || [],
    current_number:  room.currentNumber,
    star_prize:      Number(room.starPrize || 0),
    multiplier:      room.prizeMultiplier || 'x2',
    current_round_id: Number(room.currentRoundId || 1),
    max_tickets:     MAX_TICKETS,
    cards:           cards.map((c) => cardToClient(c, room)),
    card:            cards.length ? cardToClient(cards[0], room) : null
  });
});

// Daşı bilete qoy / götür. Bilet tam dolduqda avtomatik qazanılır.
router.post('/card/:roomId/toggle', apiAuth, async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const query = { userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId };
  if (req.body.cardId) query._id = req.body.cardId;
  const card = await GameCard.findOne(query).sort({ ticketIndex: 1, playedAt: 1 });
  if (!card) return res.status(404).json({ error: 'Bilet tapılmadı' });

  const number = Number(req.body.number);
  if (!flatCardNumbers(card).includes(number)) return res.status(400).json({ error: 'Bu rəqəm biletdə yoxdur' });
  if (!(room.drawnNumbers || []).includes(number)) return res.status(400).json({ error: 'Bu daş hələ çıxmayıb' });
  const alreadyMarked = (card.markedNumbers || []).map(Number).includes(number);
  // Vaxtında qoyulmayan daş bloklanır və sayılmır
  if (!alreadyMarked && !canMarkNumber(room, number)) {
    return res.status(400).json({ error: 'Vaxt bitdi — bu daş bloklandı', missed: true, card: cardToClient(card, room) });
  }

  // Çıxmış istənilən daş istənilən vaxt qoyula bilər (1-ci linyadan sonra da).
  const marks = new Set((card.markedNumbers || []).map(Number));
  const paidRows = new Set((card.wonRows || []).map(Number));
  const rows = (card.numbers || []).map((r) => (r || []).filter(Boolean).map(Number));
  const rowIndex = rows.findIndex((r) => r.includes(number));
  if (marks.has(number)) {
    // Ödənilmiş linyanın daşı geri götürülə bilməz
    if (!paidRows.has(rowIndex)) marks.delete(number);
  } else {
    marks.add(number);
  }
  card.markedNumbers = [...marks].sort((a, b) => a - b);
  card.completedAt = isCardComplete(card) ? (card.completedAt || new Date()) : null;
  await card.save();

  const result = await claimRoomWin(room._id, req.session.userId, card._id);
  const fresh = await GameCard.findById(card._id);
  const me = await User.findById(req.session.userId).select('balance stars');
  res.json({
    ok: true,
    won: result.won,
    prize: result.prize,
    lines: result.lines,
    full: result.full,
    balance: Number((me && me.balance) || 0),
    stars: Number((me && me.stars) || 0),
    card: cardToClient(fresh || card, room)
  });
});

// Auto rejim tamamilə söndürülüb.
router.post('/card/:roomId/auto', apiAuth, async (req, res) => {
  res.status(410).json({ error: 'Avto rejim aktiv deyil' });
});


// Biletin rəqəmlərini yenilə (yalnız oyun başlamazdan əvvəl mümkündür deyil — istənilən vaxt round-un öz bileti üçün)
router.post('/card/:roomId/regenerate', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const query = { userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId };
    if (req.body.cardId) query._id = req.body.cardId;
    const existing = await GameCard.findOne(query).sort({ ticketIndex: 1, playedAt: 1 });
    if (!existing) return res.status(404).json({ error: 'Bilet tapılmadı' });
    if (existing.isWinner) return res.status(400).json({ error: 'Qazanan bileti dəyişmək olmaz' });

    existing.numbers = generateCardNumbers();
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

    const query = { userId: req.session.userId, roomId: room._id, roundId: room.currentRoundId };
    if (req.body.cardId) query._id = req.body.cardId;
    const card = await GameCard.findOne(query).sort({ ticketIndex: 1, playedAt: 1 });
    if (!card) return res.status(404).json({ error: 'Bilet tapılmadı' });

    card.markedNumbers = [];
    card.completedAt = null;
    await card.save();

    res.json({ ok: true, card: cardToClient(card, room) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Bilet al — maksimum 5 ədəd.
 * body: { quantity: 1..5, tickets?: [[[..9],[..9],[..9]], ...] }
 * Lobbidə "yenilə / dəyiş" ilə seçilmiş bilet rəqəmləri göndərilə bilər.
 */
router.post('/card/:roomId/buy', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Otaq tapılmadı' });

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (room.status !== 'waiting') {
      const open = await findJoinableRoom(room);
      return res.status(400).json({ error: 'Oyun başlayıb — yeni otağa keçin', redirect: open ? '/join/' + open._id : '/' });
    }

    const incoming = Array.isArray(req.body.tickets) ? req.body.tickets : null;
    let quantity = incoming ? incoming.length : (parseInt(req.body.quantity, 10) || 1);
    quantity = Math.max(1, Math.min(MAX_TICKETS, quantity));

    const owned = await GameCard.countDocuments({
      userId: user._id, roomId: room._id, roundId: room.currentRoundId
    });
    if (owned >= MAX_TICKETS) {
      return res.status(400).json({ error: `Maksimum ${MAX_TICKETS} bilet ala bilərsiniz` });
    }
    quantity = Math.min(quantity, MAX_TICKETS - owned);

    const feePerCard = Number(room.entryFee || 0);
    const totalFee = Number((feePerCard * quantity).toFixed(2));
    const isStars = room.type === 'stars';

    if (isStars && Number(user.stars || 0) < totalFee) {
      return res.status(400).json({ error: 'Ulduzlarınız kifayət etmir' });
    }
    if (!isStars && Number(user.balance || 0) < totalFee) {
      return res.status(400).json({ error: 'Balans kifayət deyil' });
    }

    if (isStars) user.stars = Number(user.stars || 0) - totalFee;
    else user.balance = Number(user.balance || 0) - totalFee;
    user.gamesPlayed = Number(user.gamesPlayed || 0) + quantity;
    await user.save();

    if (!room.players.map(String).includes(String(user._id))) {
      room.players.push(user._id);
    }
    room.prize = Number((Number(room.prize || 0) + totalFee).toFixed(2));
    room.stakeTotal = Number((Number(room.stakeTotal || 0) + totalFee).toFixed(2));
    if (room.jackpotEnabled) room.jackpot = Number(room.jackpot || 0) + totalFee;
    await room.save();

    const created = [];
    for (let i = 0; i < quantity; i++) {
      const numbers = incoming && Array.isArray(incoming[i]) && incoming[i].length === 3
        ? incoming[i].map((row) => row.map((n) => Number(n) || 0))
        : generateCardNumbers();
      const card = new GameCard({
        userId: user._id,
        roomId: room._id,
        roundId: room.currentRoundId,
        ticketIndex: owned + i + 1,
        numbers,
        markedNumbers: [],
        autoDaub: false
      });
      await card.save();
      created.push(cardToClient(card, room));
    }

    if (!isStars) {
      await new Transaction({
        userId: user._id,
        type: 'game_join',
        amount: -totalFee,
        status: 'completed',
        note: `${room.name} otağına ${quantity} bilet`
      }).save();
    }

    res.json({ ok: true, quantity, total: totalFee, cards: created, card: created[0] || null, balance: Number(user.balance || 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/**
 * Otaqdan çıxış: mərcin 70%-i komissiya kimi tutulur, 30%-i balansa qaytarılır.
 */
router.post('/room/:id/leave', apiAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Otaq tapılmadı' });
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const cards = await GameCard.find({ userId: user._id, roomId: room._id, roundId: room.currentRoundId });
    const fee = Number(room.entryFee || 0);
    const stake = Number((fee * cards.length).toFixed(2));
    const refund = Number((stake * (1 - LEAVE_COMMISSION)).toFixed(2));
    const isStars = room.type === 'stars';

    await GameCard.deleteMany({ _id: { $in: cards.map((c) => c._id) } });
    room.players = (room.players || []).filter((p) => String(p) !== String(user._id));
    room.prize = Number(Math.max(0, Number(room.prize || 0) - stake + refund).toFixed(2));
    room.stakeTotal = Number(Math.max(0, Number(room.stakeTotal || 0) - stake).toFixed(2));
    if (room.jackpotEnabled) room.jackpot = Number(Math.max(0, Number(room.jackpot || 0) - stake).toFixed(2));
    await room.save();

    if (refund > 0) {
      if (isStars) user.stars = Number(user.stars || 0) + refund;
      else user.balance = Number(user.balance || 0) + refund;
      await user.save();
      if (!isStars) {
        await new Transaction({
          userId: user._id,
          type: 'refund',
          amount: refund,
          status: 'completed',
          note: `${room.name} otağından çıxış (70% komissiya)`
        }).save();
      }
    }

    res.json({ ok: true, refund, commission: Number((stake - refund).toFixed(2)), balance: Number(user.balance || 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/room/:id/claim-win', apiAuth, async (req, res) => {
  const result = await claimRoomWin(req.params.id, req.session.userId, req.body && req.body.cardId);
  res.json({ ok: true, won: result.won, prize: result.prize });
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
