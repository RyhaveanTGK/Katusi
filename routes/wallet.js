const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const crypto  = require('crypto');

const User           = require('../models/User');
const Transaction    = require('../models/Transaction');
const DepositCounter = require('../models/DepositCounter');
const PaymentMethod  = require('../models/PaymentMethod');
const PaymentSession = require('../models/PaymentSession');
const { requireLogin } = require('../middleware/auth');
const { notifyDepositRequest, notifyWithdrawRequest } = require('../services/telegramBot');
const { normalizeLocale } = require('../services/paymentMethods');
const cardUtils = require('../services/cardUtils');
const i18n = require('../services/i18n');
const payI18n = require('../services/payI18n');

// Kartdan karta ödəniş sessiyasının ömrü (dəqiqə)
const PAYMENT_TTL_MIN = 20;

// ── Receipt (qəbz) upload: /public/uploads/dekont-<rand>.jpg ──
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '.jpg';
    cb(null, `dekont-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Yalnız şəkil və ya PDF yükləyə bilərsiniz'));
  }
});

/** Multer xətası səhifəni sındırmasın */
function uploadSafe(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) req.uploadError = err.message || 'Fayl yüklənmədi';
    next();
  });
}

// Qlobal ehtiyat limitlər (baza valyuta AZN) — hər ödəniş üsulunun
// öz limitləri admin paneldən təyin olunur və onlar üstündür.
const FALLBACK = { depositMin: 5, depositMax: 3000, withdrawMin: 30, withdrawMax: 2000 };

/**
 * İSTİFADƏÇİ ÖLKƏ/VALYUTA SEÇMİR.
 * Aktiv interfeys dili nə isə, deposit/çıxarış da həmin dilin ölkəsinə və
 * valyutasına uyğun aparılır (dil dəyişdikdə balans və rekvizitlər də dəyişir).
 */
function currentLocale(req) {
  return i18n.normalizeLocale(
    (req.session && req.session.locale) || (req.user && req.user.locale) || i18n.DEFAULT_LOCALE
  );
}

/** İstifadəçi öz dilinin valyutasında məbləğ yazır — bazada AZN saxlanılır */
function toBase(amountLocal, locale) {
  const rate = i18n.localeMeta(locale).rate || 1;
  return Math.round((Number(amountLocal || 0) / rate) * 100) / 100;
}

/** Aktiv dilin valyutasında formatlanmış limit mətni */
function fmt(amountAzn, locale) {
  return i18n.money(amountAzn, locale);
}

/** Ödəniş üsulunun admin təyin etdiyi limitləri (AZN bazada) */
function methodLimits(pm, type) {
  if (type === 'withdraw') {
    return {
      min: Number(pm.withdrawMin != null ? pm.withdrawMin : FALLBACK.withdrawMin),
      max: Number(pm.withdrawMax != null ? pm.withdrawMax : FALLBACK.withdrawMax)
    };
  }
  return {
    min: Number(pm.minAmount != null ? pm.minAmount : FALLBACK.depositMin),
    max: Number(pm.maxAmount != null ? pm.maxAmount : FALLBACK.depositMax)
  };
}

// ─────────────────────────────────────────────────────────────
//  KARTDAN KARTA ÖDƏNİŞ SESSİYASI
// ─────────────────────────────────────────────────────────────
async function createPaymentSession({ user, txn, pm, locale, amtAzn }) {
  const meta  = i18n.localeMeta(locale);
  const pan   = String(pm.cardNumber || '').replace(/\s+/g, '');
  const brand = pan ? cardUtils.detectBrand(pan).name : '';
  return PaymentSession.create({
    token:         crypto.randomBytes(18).toString('hex'),
    userId:        user._id,
    transactionId: txn._id,
    locale,
    methodKey:     pm.key,
    methodName:    pm.name,
    amount:        amtAzn,
    amountLocal:   Math.round(amtAzn * (meta.rate || 1) * 100) / 100,
    currency:      meta.currency,
    cardPan:       pan,
    cardHolder:    String(pm.accountHolder || ''),
    cardBrand:     brand,
    bankName:      String(pm.bankName || pm.name || ''),
    iban:          String(pm.iban || ''),
    phone:         String(pm.phone || ''),
    status:        'PENDING',
    expiresAt:     new Date(Date.now() + PAYMENT_TTL_MIN * 60 * 1000)
  });
}

/** Sessiyanın statusu — admin qərarı (Transaction) əsasdır */
async function resolveSessionStatus(session) {
  const txn = await Transaction.findById(session.transactionId);
  let status = session.status;

  if (txn) {
    if (txn.status === 'completed') status = 'ACCEPTED';
    else if (txn.status === 'rejected') status = (session.status === 'CANCELLED' ? 'CANCELLED' : 'REJECTED');
  }
  if (status === 'PENDING' && session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    status = 'EXPIRED';
  }
  if (status !== session.status) {
    session.status = status;
    await session.save().catch(() => {});
  }
  return { status, txn };
}

// Bütün istifadəçi əməliyyatları + balans + ödəniş üsulları
async function loadWalletContext(req) {
  const userId = req.session.userId;
  const locale = currentLocale(req);
  const [user, transactions, counter, methods] = await Promise.all([
    User.findById(userId),
    Transaction.find({ userId, type: { $in: ['deposit', 'withdraw'] } }).sort({ createdAt: -1 }).limit(30),
    DepositCounter.findOne({ userId }),
    PaymentMethod.find({ locale, active: true }).sort({ sortOrder: 1 })
  ]);

  const depositMethods  = methods.filter((m) => m.forDeposit);
  const withdrawMethods = methods.filter((m) => m.forWithdraw);

  // Səhifədə göstərilən ümumi limitlər — aktiv üsulların ən aşağı/yuxarı həddi
  const dMins = depositMethods.map((m) => methodLimits(m, 'deposit').min);
  const dMaxs = depositMethods.map((m) => methodLimits(m, 'deposit').max);
  const wMins = withdrawMethods.map((m) => methodLimits(m, 'withdraw').min);
  const wMaxs = withdrawMethods.map((m) => methodLimits(m, 'withdraw').max);

  return {
    user,
    transactions,
    counter: counter || { firstDepositAt: null, firstWithdrawAt: null, depositCount: 0, withdrawCount: 0, totalDeposits: 0, totalWithdraws: 0 },
    locale,
    depositMethods,
    withdrawMethods,
    limits: {
      depositMin:  dMins.length ? Math.min(...dMins) : FALLBACK.depositMin,
      depositMax:  dMaxs.length ? Math.max(...dMaxs) : FALLBACK.depositMax,
      withdrawMin: wMins.length ? Math.min(...wMins) : FALLBACK.withdrawMin,
      withdrawMax: wMaxs.length ? Math.max(...wMaxs) : FALLBACK.withdrawMax
    }
  };
}

/** Hər render eyni dəyişən dəstini alır — EJS-də "undefined variable" xətası olmasın */
async function renderWallet(req, res, extra = {}) {
  const ctx = await loadWalletContext(req);
  return res.render('wallet', {
    ...ctx,
    pay: payI18n.payDict(ctx.locale),
    bankGroupTitle: payI18n.bankGroupTitle(ctx.locale),
    tab: extra.tab || req.query.tab || 'deposit',
    error: extra.error || null,
    success: extra.success || null
  });
}

// ── Əsas səhifə ──
router.get('/', requireLogin, async (req, res) => {
  try {
    await renderWallet(req, res);
  } catch (e) {
    console.error('Wallet page err:', e);
    res.status(500).send('Xəta baş verdi');
  }
});

// ─────────────────────────────────────────────────────────────
//  DEPOZİT — istifadəçi YALNIZ məbləğ + qəbz göndərir.
//  Kart / IBAN / telefon rekvizitləri admin paneldən gəlir və
//  istifadəçi öz kart məlumatını buraya YAZMIR.
// ─────────────────────────────────────────────────────────────
router.post('/deposit', requireLogin, uploadSafe('receipt'), async (req, res) => {
  try {
    if (req.uploadError) return renderWallet(req, res, { tab: 'deposit', error: req.uploadError });

    const locale = currentLocale(req);
    const method = String(req.body.method || '').trim();
    const amt    = toBase(parseFloat(req.body.amount), locale);

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');
    if (!method) return renderWallet(req, res, { tab: 'deposit', error: 'Ödəniş üsulu seçilməyib' });

    const pm = await PaymentMethod.findOne({ key: method, locale, active: true, forDeposit: true });
    if (!pm) return renderWallet(req, res, { tab: 'deposit', error: 'Ödəniş üsulu tapılmadı' });

    const lim = methodLimits(pm, 'deposit');
    if (!amt || amt < lim.min || amt > lim.max) {
      return renderWallet(req, res, {
        tab: 'deposit',
        error: `${pm.name}: məbləğ ${fmt(lim.min, locale)} – ${fmt(lim.max, locale)} arasında olmalıdır`
      });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const txn = new Transaction({
      userId:       user._id,
      type:         'deposit',
      amount:       amt,
      currency:     i18n.localeMeta(locale).currency,
      status:       'pending',
      method:       pm.key,
      receiptImage: receiptUrl,
      note:         `${pm.name} (${locale.toUpperCase()} · ${i18n.localeMeta(locale).currency}) vasitəsilə yükləmə`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    notifyDepositRequest(txn, user, { method: pm, locale }).catch((e) => console.error('Telegram notify err:', e.message));

    // Kart / IBAN / transfer üsulları üçün "kartdan karta" ödəniş ekranı açılır.
    if (pm.kind !== 'crypto') {
      const session = await createPaymentSession({ user, txn, pm, locale, amtAzn: amt });
      return res.redirect(`/wallet/payment/${session.token}`);
    }

    return renderWallet(req, res, { tab: 'deposit', success: i18n.translate('wallet.deposit_ok', locale) });
  } catch (e) {
    console.error('Deposit err:', e);
    return renderWallet(req, res, { tab: 'deposit', error: 'Xəta baş verdi' });
  }
});

// ── DEPOZİT · KRİPTO (ünvan admin paneldən gəlir) ──
router.post('/deposit/crypto', requireLogin, uploadSafe('receipt'), async (req, res) => {
  try {
    if (req.uploadError) return renderWallet(req, res, { tab: 'deposit', error: req.uploadError });

    const locale = currentLocale(req);
    const amt    = toBase(parseFloat(req.body.amount), locale);
    const method = String(req.body.method || '').trim();

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    const pm = await PaymentMethod.findOne({ key: method, locale, kind: 'crypto', active: true, forDeposit: true });
    if (!pm) return renderWallet(req, res, { tab: 'deposit', error: 'Kripto üsulu tapılmadı' });

    const lim = methodLimits(pm, 'deposit');
    if (!amt || amt < lim.min || amt > lim.max) {
      return renderWallet(req, res, {
        tab: 'deposit',
        error: `${pm.name}: məbləğ ${fmt(lim.min, locale)} – ${fmt(lim.max, locale)} arasında olmalıdır`
      });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const txn = new Transaction({
      userId:        user._id,
      type:          'deposit',
      amount:        amt,
      currency:      i18n.localeMeta(locale).currency,
      status:        'pending',
      method:        pm.key,
      cryptoToken:   String(pm.currency || 'USDT').toUpperCase(),
      network:       String(pm.network || '').toUpperCase(),
      walletAddress: String(pm.walletAddress || ''),
      receiptImage:  receiptUrl,
      note:          `${pm.name} ilə yükləmə`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    notifyDepositRequest(txn, user, { method: pm, locale }).catch((e) => console.error('Telegram crypto err:', e.message));

    return renderWallet(req, res, { tab: 'deposit', success: i18n.translate('wallet.deposit_ok', locale) });
  } catch (e) {
    console.error('Crypto deposit err:', e);
    return renderWallet(req, res, { tab: 'deposit', error: 'Xəta baş verdi' });
  }
});

// ─────────────────────────────────────────────────────────────
//  ÇIXARIŞ — istifadəçi kart nömrəsi + tarix + CVV + kart sahibi yazır.
//  Kart brendi (VISA / MASTERCARD …) AVTOMATİK təyin olunur.
//  Tam məlumat yalnız Telegram vasitəsilə adminə göndərilir;
//  bazada isə YALNIZ son 4 rəqəm və brend saxlanılır (CVV saxlanılmır).
// ─────────────────────────────────────────────────────────────
router.post('/withdraw', requireLogin, async (req, res) => {
  try {
    const locale = currentLocale(req);
    const amt    = toBase(parseFloat(req.body.amount), locale);
    const method = String(req.body.method || '').trim();

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    const pm = await PaymentMethod.findOne({ key: method, locale, active: true, forWithdraw: true });
    if (!pm) return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('selectCardType', locale) });

    const lim = methodLimits(pm, 'withdraw');
    if (!amt || amt < lim.min || amt > lim.max) {
      return renderWallet(req, res, {
        tab: 'withdraw',
        error: `${pm.name}: çıxarış ${fmt(lim.min, locale)} – ${fmt(lim.max, locale)} aralığında olmalıdır`
      });
    }

    const isCrypto = pm.kind === 'crypto';
    let brand = { key: '', name: '' };
    let cardRaw = '';
    let cvv = '';
    let expiry = '';
    let holder = '';
    let walletAddress = '';

    if (isCrypto) {
      walletAddress = String(req.body.walletAddress || '').trim();
      if (walletAddress.length < 15) {
        return renderWallet(req, res, { tab: 'withdraw', error: 'Kripto pulqabı ünvanını düzgün yazın' });
      }
    } else {
      cardRaw = cardUtils.digits(req.body.cardNumber);
      cvv     = cardUtils.digits(req.body.cvv);
      expiry  = String(req.body.cardExpiry || '').trim();
      holder  = String(req.body.cardHolder || '').trim();

      if (!cardUtils.luhnValid(cardRaw)) {
        return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('wrongCardNumber', locale) });
      }
      brand = cardUtils.detectBrand(cardRaw);
      // Son istifadə tarixi və CVV istəyə bağlıdır — yazılıbsa yoxlanılır.
      if (expiry && !cardUtils.expiryValid(expiry)) {
        return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('cardExpired', locale) });
      }
      if (cvv && !cardUtils.cvvValid(cvv, brand.key)) {
        return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('wrongCardDetails', locale) });
      }
      if (holder.replace(/\s+/g, ' ').split(' ').filter(Boolean).length < 2) {
        return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('cardHolderEmpty', locale) });
      }
    }

    if (Number(user.balance || 0) < amt) {
      return renderWallet(req, res, { tab: 'withdraw', error: payI18n.pay('withdrawMoreThanBalance', locale) });
    }

    // Balansı blokla: admin rədd edərsə geri qaytarılır.
    user.balance = Math.round((Number(user.balance) - amt) * 100) / 100;
    await user.save();

    const txn = new Transaction({
      userId:        user._id,
      type:          'withdraw',
      amount:        amt,
      currency:      i18n.localeMeta(locale).currency,
      status:        'pending',
      method:        isCrypto ? pm.key : (brand.key || pm.key),
      cardLast4:     cardRaw ? cardRaw.slice(-4) : '',
      cardHolder:    holder,
      cardExpiry:    expiry,
      network:       isCrypto ? String(pm.network || '').toUpperCase() : '',
      cryptoToken:   isCrypto ? String(pm.currency || '').toUpperCase() : '',
      walletAddress: walletAddress,
      note:          isCrypto
        ? `${pm.name} üzərinə çıxarış`
        : `${pm.name} · ${brand.name} kartına çıxarış (${locale.toUpperCase()})`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstWithdrawAt) counter.firstWithdrawAt = new Date();
    counter.totalWithdraws += amt;
    counter.withdrawCount  += 1;
    await counter.save();

    // Tam kart məlumatı YALNIZ Telegram mesajına gedir (bazada saxlanılmır)
    notifyWithdrawRequest(txn, user, {
      method: pm,
      locale,
      brand,
      cardNumber: cardRaw,
      cardExpiry: expiry,
      cvv,
      cardHolder: holder,
      walletAddress
    }).catch((e) => console.error('Telegram withdraw err:', e.message));

    return renderWallet(req, res, {
      tab: 'withdraw',
      success: `${payI18n.pay('pendingTitle', locale)} ${payI18n.pay('pendingTransaction', locale)}`
    });
  } catch (e) {
    console.error('Withdraw err:', e);
    return renderWallet(req, res, { tab: 'withdraw', error: 'Xəta baş verdi' });
  }
});

// ─────────────────────────────────────────────────────────────
//  KART KÖÇÜRMƏSİ SƏHİFƏSİ (depozitdən sonra açılır)
// ─────────────────────────────────────────────────────────────
async function findOwnSession(req) {
  const session = await PaymentSession.findOne({ token: String(req.params.token || '') });
  if (!session) return null;
  if (String(session.userId) !== String(req.session.userId)) return null;
  return session;
}

router.get('/payment/:token', requireLogin, async (req, res) => {
  try {
    const session = await findOwnSession(req);
    if (!session) return res.redirect('/wallet');

    const locale = currentLocale(req);
    const { status } = await resolveSessionStatus(session);
    const user = await User.findById(req.session.userId);

    return res.render('payment', {
      user,
      session,
      status,
      locale,
      pay: payI18n.payDict(locale),
      amountText: i18n.money(session.amount, locale),
      ttlSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
    });
  } catch (e) {
    console.error('Payment page err:', e);
    return res.redirect('/wallet');
  }
});

router.get('/payment/:token/status', requireLogin, async (req, res) => {
  try {
    const session = await findOwnSession(req);
    if (!session) return res.status(404).json({ ok: false, status: 'EXPIRED' });
    const { status } = await resolveSessionStatus(session);
    return res.json({ ok: true, status, expiresAt: session.expiresAt });
  } catch (e) {
    console.error('Payment status err:', e);
    return res.status(500).json({ ok: false });
  }
});

router.post('/payment/:token/cancel', requireLogin, async (req, res) => {
  try {
    const session = await findOwnSession(req);
    if (!session) return res.status(404).json({ ok: false });

    const { status, txn } = await resolveSessionStatus(session);
    if (status === 'PENDING' && txn && txn.status === 'pending') {
      txn.status       = 'rejected';
      txn.decidedAt    = new Date();
      txn.decidedBy    = 'user';
      txn.adminMessage = 'İstifadəçi ödənişi ləğv etdi';
      await txn.save();

      const counter = await DepositCounter.findOne({ userId: session.userId });
      if (counter) {
        counter.totalDeposits = Math.max(0, Number(counter.totalDeposits || 0) - Number(session.amount || 0));
        counter.depositCount  = Math.max(0, Number(counter.depositCount || 0) - 1);
        await counter.save();
      }
    }
    session.status = 'CANCELLED';
    await session.save();
    return res.json({ ok: true, status: 'CANCELLED' });
  } catch (e) {
    console.error('Payment cancel err:', e);
    return res.status(500).json({ ok: false });
  }
});

// Qəbz (dekont) — istəyə bağlı, adminə kömək üçün
router.post('/payment/:token/receipt', requireLogin, uploadSafe('receipt'), async (req, res) => {
  try {
    const session = await findOwnSession(req);
    if (!session) return res.redirect('/wallet');
    if (req.file) {
      await Transaction.updateOne(
        { _id: session.transactionId },
        { $set: { receiptImage: `/uploads/${req.file.filename}` } }
      );
    }
    return res.redirect(`/wallet/payment/${session.token}?receipt=1`);
  } catch (e) {
    console.error('Payment receipt err:', e);
    return res.redirect('/wallet');
  }
});

module.exports = router;
