const express = require('express');
const router  = express.Router();
const { customAlphabet } = require('nanoid');
const User    = require('../models/User');
const BonusCode = require('../models/BonusCode');
const Transaction = require('../models/Transaction');
const { requireLogin, requireGuest } = require('../middleware/auth');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

// ── İstifadəçi girişi ──
router.get('/login', requireGuest, (req, res) => {
  res.render('login', { error: null, success: null });
});

router.post('/login', requireGuest, async (req, res) => {
  try {
    const login = String(req.body.login || req.body.email || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({
      $or: [{ email: login.toLowerCase() }, { username: login }]
    });

    if (!user || !(await user.comparePassword(password))) {
      return res.render('login', { error: 'İstifadəçi adı və ya şifrə yanlışdır', success: null });
    }
    if (user.isBlocked) {
      return res.render('login', { error: 'Hesabınız bloklanmışdır.', success: null });
    }

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    res.redirect('/');
  } catch (e) {
    res.render('login', { error: 'Xəta baş verdi', success: null });
  }
});

// ── Admin girişi (ayrıca ekran) ──
router.get('/admin/login', (req, res) => {
  if (req.session.userId && req.session.isAdmin) return res.redirect('/admin/users');
  res.render('admin_login', { error: null });
});

router.post('/admin/login', async (req, res) => {
  try {
    const login    = String(req.body.login || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({
      $or: [{ email: login.toLowerCase() }, { username: login }]
    });
    if (!user || !(await user.comparePassword(password)) || !user.isAdmin) {
      return res.render('admin_login', { error: 'Yanlış giriş məlumatları' });
    }
    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = true;
    res.redirect('/admin/users');
  } catch (e) {
    res.render('admin_login', { error: 'Xəta baş verdi' });
  }
});

// ── Qeydiyyat ──
router.get('/register', requireGuest, (req, res) => {
  res.render('register', { error: null, success: null, query: req.query });
});

router.post('/register', requireGuest, async (req, res) => {
  try {
    const { username, email, password, password2, ref } = req.body;
    if (!username || !email || !password) return res.render('register', { error: 'Bütün sahələri doldurun', success: null, query: req.body });
    if (password !== password2) return res.render('register', { error: 'Şifrələr uyğun gəlmir', success: null, query: req.body });
    if (password.length < 6) return res.render('register', { error: 'Şifrə ən az 6 simvol olmalıdır', success: null, query: req.body });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (exists) return res.render('register', { error: 'Bu e-poçt və ya istifadəçi adı artıq mövcuddur', success: null, query: req.body });

    const referralCode = nanoid();
    let referredBy = null;

    if (ref) {
      const referrer = await User.findOne({ referralCode: ref });
      if (referrer) {
        referredBy = referrer._id;
        referrer.balance += 0.5;
        await referrer.save();
      }
    }

    const user = new User({ username, email: email.toLowerCase(), password, referralCode, referredBy });
    await user.save();

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.render('register', { error: 'Qeydiyyat zamanı xəta baş verdi', success: null, query: req.body });
  }
});

router.get('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Bonus kod aktivləşdirmə ──
router.post('/bonus/redeem', requireLogin, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.json({ ok: false, error: 'Kod boşdur' });
    const bc = await BonusCode.findOne({ code });
    if (!bc || !bc.active) return res.json({ ok: false, error: 'Kod tapılmadı və ya deaktivdir' });
    if (bc.expiresAt && bc.expiresAt < new Date()) return res.json({ ok: false, error: 'Kodun vaxtı bitib' });
    if (bc.maxUses > 0 && bc.usedCount >= bc.maxUses) return res.json({ ok: false, error: 'Kod istifadə limitinə çatıb' });
    if (bc.usedBy.some((u) => String(u) === String(req.session.userId))) {
      return res.json({ ok: false, error: 'Bu kodu artıq istifadə etmisiniz' });
    }
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ ok: false, error: 'İstifadəçi tapılmadı' });

    user.balance = Number(user.balance || 0) + Number(bc.amount);
    await user.save();
    bc.usedCount += 1;
    bc.usedBy.push(user._id);
    await bc.save();
    await new Transaction({
      userId: user._id,
      type: 'referral',
      amount: Number(bc.amount),
      status: 'completed',
      method: 'bonus_code',
      note: `Bonus kod: ${bc.code}`
    }).save();

    res.json({ ok: true, amount: Number(bc.amount), balance: user.balance });
  } catch (e) {
    res.json({ ok: false, error: 'Xəta baş verdi' });
  }
});

module.exports = router;
