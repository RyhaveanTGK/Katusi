const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const GameCard    = require('../models/GameCard');
const { requireLogin } = require('../middleware/auth');

// GET /profile
router.get('/', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('profile', { user, error: null, success: null });
});

// GET /setting
router.get('/setting', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('setting', { user, error: null, success: null });
});

// POST /setting
router.post('/setting', requireLogin, async (req, res) => {
  try {
    const { username, email } = req.body;
    const user = await User.findById(req.session.userId);
    const exists = await User.findOne({ username, _id: { $ne: user._id } });
    if (exists) return res.render('setting', { user, error: 'Bu istifadəçi adı mövcuddur', success: null });
    user.username = username;
    user.email    = email.toLowerCase();
    await user.save();
    req.session.username = user.username;
    res.render('setting', { user, error: null, success: 'Məlumatlar yeniləndi' });
  } catch(e) {
    const user = await User.findById(req.session.userId);
    res.render('setting', { user, error: 'Xəta baş verdi', success: null });
  }
});

// GET /changepass
router.get('/changepass', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('changepass', { user, error: null, success: null });
});

// POST /changepass
router.post('/changepass', requireLogin, async (req, res) => {
  try {
    const { oldpass, newpass, newpass2 } = req.body;
    const user = await User.findById(req.session.userId);
    if (!(await user.comparePassword(oldpass))) {
      return res.render('changepass', { user, error: 'Köhnə şifrə yanlışdır', success: null });
    }
    if (newpass !== newpass2) {
      return res.render('changepass', { user, error: 'Yeni şifrələr uyğun gəlmir', success: null });
    }
    if (newpass.length < 6) {
      return res.render('changepass', { user, error: 'Şifrə ən az 6 simvol olmalıdır', success: null });
    }
    user.password = newpass;
    await user.save();
    res.render('changepass', { user, error: null, success: 'Şifrə uğurla dəyişdirildi' });
  } catch(e) {
    const user = await User.findById(req.session.userId);
    res.render('changepass', { user, error: 'Xəta baş verdi', success: null });
  }
});

// GET /referral
router.get('/referral', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const referralCount = await User.countDocuments({ referredBy: user._id });
  const protocol = req.protocol;
  const host = req.get('host');
  const referralLink = `${protocol}://${host}/register?ref=${user.referralCode}`;
  res.render('referral', { user, referralCount, referralLink });
});

// GET /games-played
router.get('/games-played', requireLogin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const games = await GameCard.find({ userId: user._id }).sort({ playedAt: -1 }).limit(50).populate('roomId', 'name type');
  res.render('games-played', { user, games });
});

module.exports = router;
