const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Room    = require('../models/Room');
const GameCard = require('../models/GameCard');
const Transaction = require('../models/Transaction');
const { requireLogin } = require('../middleware/auth');
const { getDisplayStatus, getSecsLeft } = require('../services/gameEngine');

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
  const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
  const now = Date.now();

  const roomsData = rooms.map((room) => ({
    ...room.toObject(),
    playerCount: room.players.length,
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
    const hasJoined = room.players.map((p) => p.toString()).includes(req.session.userId);
    if (hasJoined) return res.redirect('/gamestart/' + room._id);

    res.render('join', {
      user,
      room,
      displayStatus: getDisplayStatus(room),
      secsLeft: getSecsLeft(room)
    });
  } catch (err) {
    res.redirect('/');
  }
});

router.post('/join/:roomId', requireLogin, async (req, res) => {
  try {
    const { user, room } = await getRoomAndUser(req);
    if (!room || !user) return res.redirect('/');
    if (room.status === 'ended') return res.redirect('/');

    const joinedIds = room.players.map((p) => p.toString());
    if (joinedIds.includes(req.session.userId)) {
      return res.redirect('/gamestart/' + room._id);
    }
    if (room.players.length >= room.maxPlayers) {
      return res.render('join', { user, room, error: 'Otaq doludur', displayStatus: getDisplayStatus(room), secsLeft: getSecsLeft(room) });
    }

    const existingCard = await GameCard.findOne({ userId: user._id, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
    if (existingCard) {
      if (!joinedIds.includes(req.session.userId)) {
        room.players.push(user._id);
        await room.save();
      }
      return res.redirect('/gamestart/' + room._id);
    }

    const fee = Number(room.entryFee || 0);
    if (room.type === 'classic' && user.balance < fee) {
      return res.render('join', { user, room, error: 'Balansınız kifayət etmir', displayStatus: getDisplayStatus(room), secsLeft: getSecsLeft(room) });
    }
    if (room.type === 'stars' && user.stars < fee) {
      return res.render('join', { user, room, error: 'Ulduzlarınız kifayət etmir', displayStatus: getDisplayStatus(room), secsLeft: getSecsLeft(room) });
    }

    if (room.type === 'classic') user.balance -= fee;
    else user.stars -= fee;
    user.gamesPlayed += 1;
    await user.save();

    room.players.push(user._id);
    room.prize = Number(room.prize || 0) + fee;
    if (room.jackpotEnabled) room.jackpot = Number(room.jackpot || 0) + fee;
    await room.save();

    await new GameCard({
      userId: user._id,
      roomId: room._id,
      roundId: room.currentRoundId,
      numbers: generateCard(),
      markedNumbers: [],
      autoDaub: false
    }).save();

    if (room.type === 'classic') {
      await new Transaction({
        userId: user._id,
        type: 'game_join',
        amount: -fee,
        status: 'completed',
        note: `${room.name} otağına qoşulma`
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

    const hasJoined = room.players.map((p) => p.toString()).includes(req.session.userId);
    if (!hasJoined) return res.redirect('/join/' + room._id);

    const card = await GameCard.findOne({ userId: user._id, roomId: room._id, roundId: room.currentRoundId }).sort({ playedAt: -1 });
    return res.render('gamestart', {
      user,
      room,
      card,
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