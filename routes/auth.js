const express = require('express');
const router  = express.Router();
const { customAlphabet } = require('nanoid');
const User    = require('../models/User');
const BonusCode = require('../models/BonusCode');
const Transaction = require('../models/Transaction');
const { requireLogin, requireGuest } = require('../middleware/auth');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const Device = require('../models/Device');
const EmailVerification = require('../models/EmailVerification');
const { sendVerificationCode, generateCode, CODE_TTL_MS } = require('../services/emailService');

// ── Qeydiyyat sənədləri üçün fayl yükləmə (passport + üz şəkili) ──
const kycDir = path.join(__dirname, '..', 'public', 'uploads', 'kyc');
if (!fs.existsSync(kycDir)) fs.mkdirSync(kycDir, { recursive: true });

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, kycDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${file.fieldname}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const kycUpload = multer({
  storage: kycStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Yalnız şəkil yükləyə bilərsiniz'));
  }
}).fields([{ name: 'passportPhoto', maxCount: 1 }, { name: 'facePhoto', maxCount: 1 }]);

/** Multer xətası qeydiyyatı dayandırmasın — səhifə mesajla göstərilsin */
function kycUploadSafe(req, res, next) {
  kycUpload(req, res, (err) => {
    if (err) req.uploadError = err.message || 'Şəkil yüklənmədi';
    next();
  });
}

/** Doğum tarixinə görə yaşı hesablayır */
function ageFrom(birthDate) {
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

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

// ─────────────────────────────────────────────────────────────
//  E-POÇT DOĞRULAMASI (Resend)
//  Qeydiyyatdan sonra istifadəçiyə 6 rəqəmli kod göndərilir.
//  Kod 3 dəqiqə etibarlıdır; vaxt bitdikdə kod BLOKE olunur.
// ─────────────────────────────────────────────────────────────
const MAX_CODE_ATTEMPTS = 5;

/** Yeni doğrulama kodu yaradır və e-poçta göndərir */
async function issueVerificationCode(user) {
  const code = generateCode();
  const now  = Date.now();

  // Köhnə aktiv kodlar bloke olunur — yalnız son kod işləyir
  await EmailVerification.updateMany(
    { userId: user._id, usedAt: null, blocked: false },
    { $set: { blocked: true } }
  );

  const rec = await new EmailVerification({
    userId: user._id,
    email: user.email,
    codeHash: EmailVerification.hashCode(code),
    expiresAt: new Date(now + CODE_TTL_MS),
    lastSentAt: new Date(now)
  }).save();

  await sendVerificationCode(user.email, code);
  return rec;
}

/** Sessiyadaki gözləyən istifadəçini qaytarır */
async function pendingUser(req) {
  const id = req.session.pendingVerifyUserId;
  if (!id) return null;
  return User.findById(id);
}

function secondsLeftOf(rec) {
  if (!rec || rec.blocked || rec.usedAt) return 0;
  return Math.max(0, Math.ceil((rec.expiresAt.getTime() - Date.now()) / 1000));
}

// ── Doğrulama səhifəsi ──
router.get('/verify-email', async (req, res) => {
  const user = await pendingUser(req);
  if (!user) return res.redirect('/login');
  if (user.emailVerified) {
    req.session.pendingVerifyUserId = null;
    return res.redirect('/login');
  }
  const rec = await EmailVerification.findOne({ userId: user._id, usedAt: null })
    .sort({ createdAt: -1 });
  res.render('verify-email', {
    email: user.email,
    error: req.session.verifyError || null,
    success: req.session.verifySuccess || null,
    secondsLeft: secondsLeftOf(rec)
  });
  req.session.verifyError = null;
  req.session.verifySuccess = null;
});

// ── Kodun yoxlanılması ──
router.post('/verify-email', async (req, res) => {
  try {
    const user = await pendingUser(req);
    if (!user) return res.redirect('/login');

    const code = String(req.body.code || '').replace(/\D/g, '');
    const rec = await EmailVerification.findOne({ userId: user._id, usedAt: null })
      .sort({ createdAt: -1 });

    if (!rec || rec.blocked) {
      req.session.verifyError = 'Kod bloke olunmuşdur. Yeni kod göndərin.';
      return res.redirect('/verify-email');
    }
    // 3 dəqiqə keçib — kod bloke olunur
    if (rec.isExpired()) {
      rec.blocked = true;
      await rec.save();
      req.session.verifyError = 'Kodun 3 dəqiqəlik vaxtı bitdi və kod bloke olundu. Yeni kod göndərin.';
      return res.redirect('/verify-email');
    }
    if (code.length !== 6) {
      req.session.verifyError = 'Kodu 6 rəqəm olaraq daxil edin';
      return res.redirect('/verify-email');
    }

    rec.attempts += 1;
    if (!rec.matches(code)) {
      if (rec.attempts >= MAX_CODE_ATTEMPTS) {
        rec.blocked = true;
        await rec.save();
        req.session.verifyError = 'Çox sayda yanlış cəhd — kod bloke olundu. Yeni kod göndərin.';
        return res.redirect('/verify-email');
      }
      await rec.save();
      req.session.verifyError = `Kod yanlışdır (${MAX_CODE_ATTEMPTS - rec.attempts} cəhd qaldı)`;
      return res.redirect('/verify-email');
    }

    rec.usedAt = new Date();
    await rec.save();

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    req.session.pendingVerifyUserId = null;
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
    req.session.verifyError = 'Xəta baş verdi, yenidən yoxlayın';
    res.redirect('/verify-email');
  }
});

// ── Yeni kod göndər ──
router.post('/verify-email/resend', async (req, res) => {
  try {
    const user = await pendingUser(req);
    if (!user) return res.redirect('/login');

    const last = await EmailVerification.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (last && Date.now() - last.lastSentAt.getTime() < 30 * 1000) {
      req.session.verifyError = 'Yeni kod 30 saniyədən bir göndərilə bilər';
      return res.redirect('/verify-email');
    }
    await issueVerificationCode(user);
    req.session.verifySuccess = 'Yeni kod e-poçtunuza göndərildi';
    res.redirect('/verify-email');
  } catch (e) {
    console.error(e);
    req.session.verifyError = 'Kod göndərilmədi, bir az sonra yenidən cəhd edin';
    res.redirect('/verify-email');
  }
});

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

    // E-poçt doğrulanmayıbsa giriş yoxdur — yeni kod göndərilir
    if (!user.isAdmin && !user.emailVerified) {
      req.session.pendingVerifyUserId = user._id.toString();
      try {
        await issueVerificationCode(user);
        req.session.verifySuccess = 'Doğrulama kodu e-poçtunuza göndərildi';
      } catch (e) {
        console.error(e);
        req.session.verifyError = 'Kod göndərilmədi, "Yeni kod göndər" düyməsini sınayın';
      }
      return res.redirect('/verify-email');
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

router.post('/register', requireGuest, kycUploadSafe, async (req, res) => {
  try {
    const { username, email, password, password2, ref } = req.body;
    const fullName       = String(req.body.fullName || '').trim();
    const birthDate      = String(req.body.birthDate || '').trim();
    const passportNumber = String(req.body.passportNumber || '').trim().toUpperCase();

    const files = req.files || {};
    const passportFile = (files.passportPhoto || [])[0] || null;
    const faceFile     = (files.facePhoto || [])[0] || null;
    const cleanup = () => {
      [passportFile, faceFile].forEach((f) => { if (f) { try { fs.unlinkSync(f.path); } catch (e) {} } });
    };
    const fail = (msg) => { cleanup(); return res.render('register', { error: msg, success: null, query: req.body }); };

    if (req.uploadError) return fail(req.uploadError);
    if (!username || !email || !password) return fail('Bütün sahələri doldurun');
    if (password !== password2) return fail('Şifrələr uyğun gəlmir');
    if (password.length < 6) return fail('Şifrə ən az 6 simvol olmalıdır');

    // ── Şəxsiyyət məlumatları ──
    if (!fullName || fullName.split(/\s+/).length < 2) return fail('Real ad və soyadınızı tam yazın');
    if (!birthDate) return fail('Doğum tarixini daxil edin');
    const age = ageFrom(birthDate);
    if (age === null) return fail('Doğum tarixi düzgün deyil');
    if (age < 18) return fail('Qeydiyyat yalnız 18 yaşdan yuxarı şəxslər üçündür');
    if (age > 100) return fail('Doğum tarixi düzgün deyil');
    if (!passportNumber || passportNumber.length < 5) return fail('Passport nömrəsini düzgün daxil edin');
    if (!passportFile) return fail('Passport şəkilini əlavə edin');
    if (!faceFile) return fail('Üz şəkilinizi əlavə edin');

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (exists) return fail('Bu e-poçt və ya istifadəçi adı artıq mövcuddur');

    const passportExists = await User.findOne({ passportNumber });
    if (passportExists) return fail('Bu passport nömrəsi ilə artıq hesab mövcuddur');

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

    const user = new User({
      username, email: email.toLowerCase(), password, referralCode, referredBy,
      fullName,
      birthDate: new Date(birthDate),
      passportNumber,
      passportPhoto: `/uploads/kyc/${passportFile.filename}`,
      facePhoto: `/uploads/kyc/${faceFile.filename}`
    });
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

    // ── E-poçt doğrulaması: hesab kod təsdiqlənənə qədər aktivləşmir ──
    req.session.pendingVerifyUserId = user._id.toString();
    try {
      await issueVerificationCode(user);
      req.session.verifySuccess = 'Doğrulama kodu e-poçtunuza göndərildi';
    } catch (e) {
      console.error(e);
      req.session.verifyError = 'Kod göndərilmədi — "Yeni kod göndər" düyməsini sınayın';
    }
    return res.redirect('/verify-email');
  } catch (e) {
    console.error(e);
    res.render('register', { error: 'Qeydiyyat zamanı xəta baş verdi', success: null, query: req.body });
  }
});

router.get('/logout', (req, res) => {
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
