const express = require('express');
const router  = express.Router();
const { customAlphabet } = require('nanoid');
const User    = require('../models/User');
const BonusCode = require('../models/BonusCode');
const Transaction = require('../models/Transaction');
const { requireLogin, requireGuest } = require('../middleware/auth');
const crypto = require('crypto');
const Device = require('../models/Device');

const REFERRAL_BONUS = 0.5; // 0.50 ₼

/** Cihazı tanımaq üçün stabil hash: brauzer barmaq izi + IP + user-agent */
function deviceHashOf(req) {
  const fp = String(req.body.deviceId || req.cookies_deviceId || '').trim();
  const ua = String(req.get('user-agent') || '');
  const ip = String(
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || ''
  );
  const base = fp ? `fp:${fp}` : `ipua:${ip}|${ua}`;
  return { hash: crypto.createHash('sha256').update(base).digest('hex'), fp, ua, ip };
}

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

// ── İstifadəçi girişi ──
router.get('/login', requireGuest, (req, res) => {
  res.render('login', { error: null, success: null });
});

router.post('/login', requireGuest, async (req, res) => {
  try {
    const login = String(req.body.login || req.body.email || '').trim();
    const password = String(req.body.password || '');

    // ── ENV əsaslı admin girişi (adi login formu üzərindən) ──
    // Render env: ADMIN_USERNAME / ADMIN_PASSWORD
    // Uyğun gəlirsə istifadəçi avtomatik yaradılır / admin işarələnir və /admin/users-ə yönləndirilir.
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;
    if (envUser && envPass && login === envUser && password === envPass) {
      let adminU = await User.findOne({ username: envUser });
      if (!adminU) {
        adminU = new User({
          username: envUser,
          email: (envUser + '@admin.local').toLowerCase(),
          password: password,
          isAdmin: true,
          referralCode: 'ADMIN' + Math.floor(Math.random() * 9000 + 1000)
        });
        await adminU.save();
      } else if (!adminU.isAdmin) {
        adminU.isAdmin = true;
        await adminU.save();
      }
      req.session.userId   = adminU._id.toString();
      req.session.username = adminU.username;
      req.session.isAdmin  = true;
      return res.redirect('/admin/users');
    }

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
    // Admin istifadəçi birbaşa admin panelinə düşür.
    if (user.isAdmin) return res.redirect('/admin/users');
    res.redirect('/');
  } catch (e) {
    res.render('login', { error: 'Xəta baş verdi', success: null });
  }
});

// ── Köhnə /admin/login yolları adi girişə yönləndirilir ──
router.get('/admin/login', (req, res) => {
  if (req.session.userId && req.session.isAdmin) return res.redirect('/admin/users');
  res.redirect('/login');
});
router.post('/admin/login', (req, res) => res.redirect('/login'));

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

    // ── Cihaz tanınması: eyni cihazda referal linki yalnız 1 dəfə işləyir ──
    const dev = deviceHashOf(req);
    let device = await Device.findOne({ deviceHash: dev.hash });
    if (!device) {
      device = new Device({
        deviceHash: dev.hash,
        fingerprint: dev.fp,
        ip: dev.ip,
        userAgent: dev.ua
      });
    }

    let referrer = null;
    const refCodeIn = String(ref || '').trim();
    if (refCodeIn && !device.referralUsed) {
      referrer = await User.findOne({ referralCode: refCodeIn });
      if (referrer) referredBy = referrer._id;
    } else if (refCodeIn && device.referralUsed) {
      // Bu cihaz artıq bir dəfə referal bonusu yaradıb — bonus verilmir,
      // amma qeydiyyat davam edir.
      const r = await User.findOne({ referralCode: refCodeIn });
      if (r) referredBy = r._id;
    }

    const user = new User({ username, email: email.toLowerCase(), password, referralCode, referredBy });
    await user.save();

    if (referrer && !device.referralUsed) {
      referrer.balance = Number(referrer.balance || 0) + REFERRAL_BONUS;
      await referrer.save();
      device.referralUsed = true;
      device.referralCode = refCodeIn;
      try {
        await new Transaction({
          userId: referrer._id,
          type: 'referral',
          amount: REFERRAL_BONUS,
          status: 'completed',
          note: `Dost dəvəti bonusu: ${user.username}`
        }).save();
      } catch (e) {}
    }

    device.accounts.push(user._id);
    device.lastSeenAt = new Date();
    device.ip = dev.ip; device.userAgent = dev.ua;
    try { await device.save(); } catch (e) {}

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    if (req.session.pendingInvite) {
      const token = req.session.pendingInvite;
      req.session.pendingInvite = null;
      return res.redirect('/r/' + token);
    }
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
