const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const GameCard    = require('../models/GameCard');
const BonusCode   = require('../models/BonusCode');
const { requireLogin } = require('../middleware/auth');
const EmailVerification = require('../models/EmailVerification');
const { sendPasswordChangeCode, generateCode, CODE_TTL_MS } = require('../services/emailService');

// ─────────────────────────────────────────────────────────────
//  ŞİFRƏ DƏYİŞİKLİYİ — 2FA (e-poçta göndərilən 6 rəqəmli kod)
//  Kod 3 dəqiqə etibarlıdır, 5 yanlış cəhddən sonra bloke olunur.
// ─────────────────────────────────────────────────────────────
const MAX_PWD_CODE_ATTEMPTS = 5;

function secondsLeftOf(rec) {
  if (!rec || rec.blocked || rec.usedAt) return 0;
  return Math.max(0, Math.ceil((rec.expiresAt.getTime() - Date.now()) / 1000));
}

async function issuePasswordCode(user) {
  const code = generateCode();
  await EmailVerification.updateMany(
    { userId: user._id, purpose: 'password_change', usedAt: null, blocked: false },
    { $set: { blocked: true } }
  );
  const rec = await new EmailVerification({
    userId: user._id,
    email: user.email,
    purpose: 'password_change',
    codeHash: EmailVerification.hashCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    lastSentAt: new Date()
  }).save();
  await sendPasswordChangeCode(user.email, code);
  return rec;
}

/** E-poçtu maskalayır: ex****le@gmail.com */
function maskEmail(email) {
  const [n, d] = String(email || '').split('@');
  if (!d) return '';
  const head = n.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(2, n.length - 2))}@${d}`;
}

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
  const pend = req.session.pwdChange;
  let secondsLeft = 0;
  if (pend) {
    const rec = await EmailVerification.findOne({ _id: pend.recId });
    secondsLeft = secondsLeftOf(rec);
    if (!secondsLeft) req.session.pwdChange = null;
  }
  res.render('changepass', {
    user,
    error: req.session.pwdError || null,
    success: req.session.pwdSuccess || null,
    step: req.session.pwdChange ? 'verify' : 'form',
    maskedEmail: maskEmail(user.email),
    secondsLeft
  });
  req.session.pwdError = null;
  req.session.pwdSuccess = null;
});

router.post('/changepass', requireLogin, async (req, res) => {
  const back = (msg, ok) => {
    if (ok) req.session.pwdSuccess = msg; else req.session.pwdError = msg;
    return res.redirect('/profile/changepass');
  };
  try {
    const { oldpass, newpass, newpass2 } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    if (!(await user.comparePassword(String(oldpass || '')))) return back('Köhnə şifrə yanlışdır');
    if (String(newpass) !== String(newpass2)) return back('Yeni şifrələr uyğun gəlmir');
    if (String(newpass || '').length < 6) return back('Şifrə ən az 6 simvol olmalıdır');
    if (String(newpass) === String(oldpass)) return back('Yeni şifrə köhnə şifrə ilə eyni ola bilməz');
    if (!user.email) return back('Hesabınıza e-poçt bağlanmayıb — dəstəklə əlaqə saxlayın');

    // Yeni şifrə YALNIZ hash şəklində sessiyada saxlanılır (açıq mətn saxlanılmır)
    const hash = await bcrypt.hash(String(newpass), 12);

    let rec;
    try {
      rec = await issuePasswordCode(user);
    } catch (e) {
      console.error('Password 2FA mail err:', e.message);
      return back('Təsdiq kodu göndərilmədi. Bir az sonra yenidən cəhd edin.');
    }

    req.session.pwdChange = { hash, recId: String(rec._id), at: Date.now() };
    return back('Təsdiq kodu e-poçtunuza göndərildi', true);
  } catch (e) {
    console.error('changepass err:', e);
    return back('Xəta baş verdi');
  }
});

// ── 2FA kodunun yoxlanılması və şifrənin tətbiqi ──
router.post('/changepass/verify', requireLogin, async (req, res) => {
  const back = (msg, ok) => {
    if (ok) req.session.pwdSuccess = msg; else req.session.pwdError = msg;
    return res.redirect('/profile/changepass');
  };
  try {
    const pend = req.session.pwdChange;
    if (!pend) return back('Təsdiq sessiyası tapılmadı. Yenidən başlayın.');

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    const rec = await EmailVerification.findById(pend.recId);
    if (!rec || rec.blocked || rec.usedAt) {
      req.session.pwdChange = null;
      return back('Kod bloke olunub. Şifrə dəyişikliyini yenidən başladın.');
    }
    if (rec.isExpired()) {
      rec.blocked = true; await rec.save();
      req.session.pwdChange = null;
      return back('Kodun vaxtı bitdi. Şifrə dəyişikliyini yenidən başladın.');
    }

    const code = String(req.body.code || '').replace(/\D/g, '');
    if (code.length !== 6) return back('Kodu 6 rəqəm olaraq daxil edin');

    rec.attempts += 1;
    if (!rec.matches(code)) {
      if (rec.attempts >= MAX_PWD_CODE_ATTEMPTS) {
        rec.blocked = true; await rec.save();
        req.session.pwdChange = null;
        return back('Çox sayda yanlış cəhd — kod bloke olundu.');
      }
      await rec.save();
      return back(`Kod yanlışdır (${MAX_PWD_CODE_ATTEMPTS - rec.attempts} cəhd qaldı)`);
    }

    rec.usedAt = new Date();
    await rec.save();

    // pre('save') hook-u ikiqat hash etməsin deyə birbaşa update
    await User.updateOne({ _id: user._id }, { $set: { password: pend.hash } });
    req.session.pwdChange = null;

    return back('Şifrə uğurla dəyişdirildi', true);
  } catch (e) {
    console.error('changepass verify err:', e);
    return back('Xəta baş verdi');
  }
});

// ── Yeni kod göndər (30 saniyə limit) ──
router.post('/changepass/resend', requireLogin, async (req, res) => {
  const back = (msg, ok) => {
    if (ok) req.session.pwdSuccess = msg; else req.session.pwdError = msg;
    return res.redirect('/profile/changepass');
  };
  try {
    const pend = req.session.pwdChange;
    if (!pend) return back('Əvvəlcə şifrə dəyişikliyini başladın');
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    const last = await EmailVerification.findOne({ userId: user._id, purpose: 'password_change' }).sort({ createdAt: -1 });
    if (last && Date.now() - last.lastSentAt.getTime() < 30 * 1000) {
      return back('Yeni kod 30 saniyədən bir göndərilə bilər');
    }
    const rec = await issuePasswordCode(user);
    req.session.pwdChange = { ...pend, recId: String(rec._id) };
    return back('Yeni kod e-poçtunuza göndərildi', true);
  } catch (e) {
    console.error('changepass resend err:', e);
    return back('Kod göndərilmədi, bir az sonra yenidən cəhd edin');
  }
});

// ── Şifrə dəyişikliyini ləğv et ──
router.post('/changepass/cancel', requireLogin, (req, res) => {
  req.session.pwdChange = null;
  res.redirect('/profile/changepass');
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

// ── Bonus / promo kodu (admin paneldə yaradılan kodlar) ──
router.post('/bonus/redeem', requireLogin, async (req, res) => {
  const render = (data) => res.render('profile', data);
  try {
    const user = await User.findById(req.session.userId);
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return render({ user, error: 'Kod boşdur', success: null });

    const bc = await BonusCode.findOne({ code });
    if (!bc || !bc.active) {
      return render({ user, error: 'Kod tapılmadı və ya deaktivdir', success: null });
    }
    if (bc.expiresAt && bc.expiresAt < new Date()) {
      return render({ user, error: 'Kodun vaxtı bitib', success: null });
    }
    if (bc.maxUses > 0 && bc.usedCount >= bc.maxUses) {
      return render({ user, error: 'Kod istifadə limitinə çatıb', success: null });
    }
    if ((bc.usedBy || []).some((u) => String(u) === String(user._id))) {
      return render({ user, error: 'Bu kodu artıq istifadə etmisiniz', success: null });
    }

    user.balance = Number(user.balance || 0) + Number(bc.amount);
    await user.save();

    bc.usedCount = Number(bc.usedCount || 0) + 1;
    bc.usedBy.push(user._id);
    await bc.save();

    await new Transaction({
      userId: user._id, type: 'referral', amount: Number(bc.amount),
      status: 'completed', method: 'bonus_code', note: `Bonus kod: ${bc.code}`
    }).save();

    return render({ user, error: null, success: `+${Number(bc.amount).toFixed(2)} ₼ balansınıza əlavə edildi` });
  } catch (e) {
    console.error('Bonus redeem err:', e);
    const user = await User.findById(req.session.userId);
    return render({ user, error: 'Xəta baş verdi', success: null });
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
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
