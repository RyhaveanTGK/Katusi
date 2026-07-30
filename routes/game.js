const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Room    = require('../models/Room');
const GameCard = require('../models/GameCard');
const Transaction = require('../models/Transaction');
const { requireLogin } = require('../middleware/auth');
const { getDisplayStatus, getSecsLeft, generateCardNumbers, ticketPrize, MAX_TICKETS, visiblePlayerCount } = require('../services/gameEngine');
const { hasRoomAccess } = require('./rooms');

function generateCard() {
  const cols = [
    [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
    [50, 59], [60, 69], [70, 79], [80, 90]
  ];
  const card = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
  const used = Array.from({ length: 9 }, () => new Set());

  for (let row = 0; row < 3; row++) {
    const chosenCols = [];
    while (chosenCols.length < 5) {
      const col = Math.floor(Math.random() * 9);
      if (!chosenCols.includes(col)) chosenCols.push(col);
    }
    chosenCols.sort((a, b) => a - b);

    for (const col of chosenCols) {
      const [min, max] = cols[col];
      let value = min;
      do {
        value = Math.floor(Math.random() * (max - min + 1)) + min;
      } while (used[col].has(value));
      used[col].add(value);
      card[row][col] = value;
    }
  }

  return card;
}

async function getRoomAndUser(req) {
  const [user, room] = await Promise.all([
    User.findById(req.session.userId),
    Room.findById(req.params.roomId)
  ]);
  return { user, room };
}

router.get('/', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const unlocked = (req.session.unlockedRooms || []);
  const rooms = await Room.find({
    $or: [
      { isCustom: { $ne: true } },
      { ownerId: user._id },
      { _id: { $in: unlocked } }
    ]
  }).sort({ sortOrder: 1, createdAt: 1 });
  const now = Date.now();

  const roomsData = rooms.map((room) => ({
    ...room.toObject(),
    playerCount: visiblePlayerCount(room),
    botCount: (room.bots || []).length,
    hasJoined: room.players.map((p) => p.toString()).includes(req.session.userId),
    displayStatus: getDisplayStatus(room, now),
    secsLeft: getSecsLeft(room, now)
  }));

  res.render('index', { user, rooms: roomsData });
});

router.get('/join/:roomId', requireLogin, async (req, res) => {
  try {
    const { user, room } = await getRoomAndUser(req);
    if (!room || !user) return res.redirect('/');
    if (!hasRoomAccess(req, room)) return res.redirect('/room/' + room._id + '/code');

    const cards = await GameCard.find({ userId: user._id, roomId: room._id, roundId: room.currentRoundId });
    if (cards.length) return res.redirect('/gamestart/' + room._id);

    res.render('join', {
      user,
      room,
      maxTickets: MAX_TICKETS,
      ticketPrize: ticketPrize(room),
      previewCards: Array.from({ length: MAX_TICKETS }, () => generateCardNumbers()),
      displayStatus: getDisplayStatus(room),
      secsLeft: getSecsLeft(room)
    });
  } catch (err) {
    res.redirect('/');
  }
});

router.post('/join/:roomId', requireLogin, async (req, res) => {
  const renderErr = async (message) => {
    const { user, room } = await getRoomAndUser(req);
    return res.render('join', {
      user, room,
      error: message,
      maxTickets: MAX_TICKETS,
      ticketPrize: ticketPrize(room),
      previewCards: Array.from({ length: MAX_TICKETS }, () => generateCardNumbers()),
      displayStatus: getDisplayStatus(room),
      secsLeft: getSecsLeft(room)
    });
  };

  try {
    const { user, room } = await getRoomAndUser(req);
    if (!room || !user) return res.redirect('/');
    if (room.status === 'ended') return res.redirect('/');

    const existing = await GameCard.find({ userId: user._id, roomId: room._id, roundId: room.currentRoundId });
    if (existing.length) return res.redirect('/gamestart/' + room._id);

    if (!hasRoomAccess(req, room)) return res.redirect('/room/' + room._id + '/code');
    if (room.players.length >= room.maxPlayers) return renderErr('Otaq doludur');

    let tickets = null;
    if (req.body.tickets) {
      try { tickets = JSON.parse(req.body.tickets); } catch (e) { tickets = null; }
    }
    let quantity = Array.isArray(tickets) ? tickets.length : (parseInt(req.body.quantity, 10) || 1);
    quantity = Math.max(1, Math.min(MAX_TICKETS, quantity));

    const fee = Number(room.entryFee || 0);
    const total = Number((fee * quantity).toFixed(2));
    const isStars = room.type === 'stars';

    if (isStars && Number(user.stars || 0) < total) return renderErr('Ulduzlarınız kifayət etmir');
    if (!isStars && Number(user.balance || 0) < total) return renderErr('Balansınız kifayət etmir');

    if (isStars) user.stars = Number(user.stars || 0) - total;
    else user.balance = Number(user.balance || 0) - total;
    user.gamesPlayed = Number(user.gamesPlayed || 0) + quantity;
    await user.save();

    if (!room.players.map(String).includes(String(user._id))) room.players.push(user._id);
    room.prize = Number(room.prize || 0) + total;
    if (room.jackpotEnabled) room.jackpot = Number(room.jackpot || 0) + total;
    await room.save();

    for (let i = 0; i < quantity; i++) {
      const numbers = Array.isArray(tickets) && Array.isArray(tickets[i]) && tickets[i].length === 3
        ? tickets[i].map((row) => row.map((n) => Number(n) || 0))
        : generateCardNumbers();
      await new GameCard({
        userId: user._id,
        roomId: room._id,
        roundId: room.currentRoundId,
        ticketIndex: i + 1,
        numbers,
        markedNumbers: [],
        autoDaub: false
      }).save();
    }

    if (!isStars) {
      await new Transaction({
        userId: user._id,
        type: 'game_join',
        amount: -total,
        status: 'completed',
        note: `${room.name} otağına ${quantity} bilet`
      }).save();
    }

    res.redirect('/gamestart/' + room._id);
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

router.get('/gamestart/:roomId', requireLogin, async (req, res) => {
  try {
    const { user, room } = await getRoomAndUser(req);
    if (!room || !user) return res.redirect('/');

    const cards = await GameCard.find({ userId: user._id, roomId: room._id, roundId: room.currentRoundId })
      .sort({ ticketIndex: 1, playedAt: 1 });
    if (!cards.length) return res.redirect('/join/' + room._id);

    return res.render('gamestart', {
      user,
      room,
      cards,
      card: cards[0],
      maxTickets: MAX_TICKETS,
      ticketPrize: ticketPrize(room),
      displayStatus: getDisplayStatus(room),
      secsLeft: getSecsLeft(room)
    });
  } catch (err) {
    res.redirect('/');
  }
});


router.get('/card-add/:roomId', requireLogin, async (req, res) => {
  try {
    const { user, room } = await getRoomAndUser(req);
    if (!room || !user) return res.redirect('/');
    const card = await GameCard.findOne({ userId: user._id, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
    res.render('card-add', { user, room, card, displayStatus: getDisplayStatus(room), secsLeft: getSecsLeft(room) });
  } catch (err) {
    res.redirect('/');
  }
});

router.get('/winners', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const topWinners = await User.find({ gamesWon: { $gt: 0 } }).sort({ totalWon: -1 }).limit(20);
  const recentGames = await GameCard.find({ isWinner: true })
    .sort({ playedAt: -1 })
    .limit(10)
    .populate('userId', 'username')
    .populate('roomId', 'name type');
  res.render('winners', { user, topWinners, recentGames });
});

module.exports = router;
