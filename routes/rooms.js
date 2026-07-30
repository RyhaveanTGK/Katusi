const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const User    = require('../models/User');
const Room    = require('../models/Room');
const { requireLogin } = require('../middleware/auth');

const MAX_CUSTOM_PLAYERS = 5;

function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** İstifadəçinin bu şəxsi otağa girişi varmı? */
function hasRoomAccess(req, room) {
  if (!room.isCustom) return true;
  if (String(room.ownerId || '') === String(req.session.userId)) return true;
  const unlocked = req.session.unlockedRooms || [];
  return unlocked.includes(String(room._id));
}

function unlockRoom(req, room) {
  const list = req.session.unlockedRooms || [];
  if (!list.includes(String(room._id))) list.push(String(room._id));
  req.session.unlockedRooms = list;
}

// ── Otaq yarat (forma) ──
router.get('/room/create', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('room-create', {
    user,
    error: null,
    maxPlayersLimit: MAX_CUSTOM_PLAYERS,
    values: { name: '', entryFee: '0.50', maxPlayers: MAX_CUSTOM_PLAYERS, accessCode: randomCode() }
  });
});

// ── Otaq yarat (POST) ──
router.post('/room/create', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const name = String(req.body.name || '').trim().slice(0, 40);
  let entryFee = parseFloat(req.body.entryFee);
  let maxPlayers = parseInt(req.body.maxPlayers, 10);
  let accessCode = String(req.body.accessCode || '').trim().toUpperCase().slice(0, 12);

  const values = { name, entryFee: req.body.entryFee, maxPlayers, accessCode };
  const fail = (msg) => res.render('room-create', { user, error: msg, maxPlayersLimit: MAX_CUSTOM_PLAYERS, values });

  if (!name) return fail('Otaq adını yazın');
  if (!Number.isFinite(entryFee) || entryFee < 0.1) return fail('Mərc (bilet qiyməti) ən azı 0.10 ₼ olmalıdır');
  if (entryFee > 100) return fail('Mərc maksimum 100 ₼ ola bilər');
  entryFee = Number(entryFee.toFixed(2));
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2) maxPlayers = 2;
  if (maxPlayers > MAX_CUSTOM_PLAYERS) maxPlayers = MAX_CUSTOM_PLAYERS;
  if (!accessCode) accessCode = randomCode();
  if (!/^[A-Z0-9]{4,12}$/.test(accessCode)) return fail('Giriş kodu 4–12 hərf/rəqəm olmalıdır');

  const inviteToken = crypto.randomBytes(9).toString('base64url');

  const room = await new Room({
    name,
    ticketLabel: 'ŞƏXSİ OTAQ',
    type: 'classic',
    status: 'waiting',
    entryFee,
    starPrize: Math.round(entryFee * 100),
    prizeMultiplier: 'x2',
    themeColor: '#f5c518',
    maxPlayers,
    jackpotEnabled: false,
    sortOrder: 100,
    currentRoundId: 1,
    isCustom: true,
    botsEnabled: false,
    ownerId: user._id,
    accessCode,
    inviteToken,
    nextGameAt: null
  }).save();

  unlockRoom(req, room);
  res.redirect('/room/' + room._id + '/invite');
});

// ── Otaq yaradıldıqdan sonra: kod + dəvət linki ──
router.get('/room/:id/invite', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const room = await Room.findById(req.params.id);
  if (!room || !room.isCustom) return res.redirect('/');
  if (!hasRoomAccess(req, room)) return res.redirect('/room/' + room._id + '/code');

  const base = `${req.protocol}://${req.get('host')}`;
  res.render('room-invite', {
    user,
    room,
    inviteLink: `${base}/r/${room.inviteToken}?ref=${user.referralCode}`,
    joinLink: `${base}/join/${room._id}`
  });
});

// ── Giriş kodu ilə otağa daxil olma ──
router.get('/room/:id/code', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const room = await Room.findById(req.params.id);
  if (!room) return res.redirect('/');
  if (hasRoomAccess(req, room)) return res.redirect('/join/' + room._id);
  res.render('room-code', { user, room, error: null });
});

router.post('/room/:id/code', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const room = await Room.findById(req.params.id);
  if (!room) return res.redirect('/');
  const code = String(req.body.code || '').trim().toUpperCase();
  if (code && code === String(room.accessCode || '').toUpperCase()) {
    unlockRoom(req, room);
    return res.redirect('/join/' + room._id);
  }
  res.render('room-code', { user, room, error: 'Giriş kodu yanlışdır' });
});

// ── Dost dəvəti linki: /r/:token ──
router.get('/r/:token', async (req, res) => {
  const room = await Room.findOne({ inviteToken: req.params.token });
  if (!room) return res.redirect('/');

  if (!req.session.userId) {
    // Qeydiyyatdan sonra otağa qayıtsın
    req.session.pendingInvite = room.inviteToken;
    const ref = req.query.ref ? `?ref=${encodeURIComponent(req.query.ref)}` : '';
    return res.redirect('/register' + ref);
  }
  unlockRoom(req, room);
  res.redirect('/join/' + room._id);
});

module.exports = router;
module.exports.hasRoomAccess = hasRoomAccess;
module.exports.MAX_CUSTOM_PLAYERS = MAX_CUSTOM_PLAYERS;
