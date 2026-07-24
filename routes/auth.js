const express = require('express');
const router  = express.Router();
const { customAlphabet } = require('nanoid');
const User    = require('../models/User');
const { requireLogin, requireGuest } = require('../middleware/auth');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

router.get('/login', requireGuest, (req, res) => {
  res.render('login', { error: null, success: null });
});

router.post('/login', requireGuest, async (req, res) => {
  try {
    const login = String(req.body.login || req.body.email || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({
      $or: [
        { email: login.toLowerCase() },
        { username: login }
      ]
    });

    if (!user || !(await user.comparePassword(password))) {
      return res.render('login', { error: 'İstifadəçi adı və ya şifrə yanlışdır', success: null });
    }

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    res.redirect('/');
  } catch (e) {
    res.render('login', { error: 'Xəta baş verdi', success: null });
  }
});

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

module.exports = router;