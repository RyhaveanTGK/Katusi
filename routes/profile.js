const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const GameCard    = require('../models/GameCard');
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('profile', { user, error: null, success: null });
});

router.get('/setting', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('setting', { user, error: null, success: null });
});

router.post('/setting', requireLogin, async (req, res) => {
  try {
    const { username, email, phone } = req.body;
    const user = await User.findById(req.session.userId);
    const exists = await User.findOne({ username, _id: { $ne: user._id } });
    if (exists) return res.render('setting', { user, error: 'Bu istifadəçi adı mövcuddur', success: null });
    user.username = username;
    user.email    = String(email || '').toLowerCase();
    if (phone) user.phone = String(phone).trim();
    await user.save();
    req.session.username = user.username;
    res.render('setting', { user, error: null, success: 'Məlumatlar yeniləndi' });
  } catch(e) {
    const user = await User.findById(req.session.userId);
    res.render('setting', { user, error: 'Xəta baş verdi', success: null });
  }
});

router.get('/changepass', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('changepass', { user, error: null, success: null });
});

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

router.get('/referral', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const referralCount = await User.countDocuments({ referredBy: user._id });
  const protocol = req.protocol;
  const host = req.get('host');
  const referralLink = `${protocol}://${host}/register?ref=${user.referralCode}`;
  res.render('referral', { user, referralCount, referralLink });
});

router.get('/games-played', requireLogin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const games = await GameCard.find({ userId: user._id }).sort({ playedAt: -1 }).limit(50).populate('roomId', 'name type');
  res.render('games-played', { user, games });
});

// ── Bonus kodları (demo) ──
const BONUS_CODES = {
  'WELCOME10': 10,
  'LOTO500':    0.5
};
router.post('/bonus/redeem', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const code = String(req.body.code || '').trim().toUpperCase();
    const reward = BONUS_CODES[code];
    if (!reward) {
      return res.render('profile', { user, error: 'Yanlış və ya müddəti bitmiş kod', success: null });
    }
    user.balance = Number(user.balance || 0) + Number(reward);
    await user.save();
    await new Transaction({
      userId: user._id, type: 'referral', amount: reward, status: 'completed',
      note: `Bonus kod: ${code}`
    }).save();
    res.render('profile', { user, error: null, success: `+${reward} ₼ balansınıza əlavə edildi` });
  } catch (e) {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user, error: 'Xəta baş verdi', success: null });
  }
});

// ── Aktiv oturumları bitir (yalnız öz session ID xaric) ──
router.post('/sessions/terminate', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const currentSid = req.session.id;
  const keep = (user.activeSessions || []).filter(s => s.sessionId === currentSid);
  user.activeSessions = keep;
  await user.save();
  res.redirect('/profile/setting');
});

// Çıxış (GET və POST) — köhnə `/logout` route-u saxlanılır,
router.get('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
