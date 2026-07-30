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
const { requireLogin } = require('../middleware/auth');
const { notifyDepositRequest, notifyWithdrawRequest } = require('../services/telegramBot');
const { LOCALES, normalizeLocale } = require('../services/paymentMethods');

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

const DEPOSIT_MIN = 5,  DEPOSIT_MAX = 3000;
const WITHDRAW_MIN = 30, WITHDRAW_MAX = 2000;

/** İstifadəçinin aktiv dili — dil dəstəyi əlavə olunanda burada oxunacaq */
function currentLocale(req) {
  return normalizeLocale(req.query.lang || req.body.lang || req.session.locale || 'az');
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
  return {
    user,
    transactions,
    counter: counter || { firstDepositAt: null, firstWithdrawAt: null, depositCount: 0, withdrawCount: 0, totalDeposits: 0, totalWithdraws: 0 },
    locale,
    locales: LOCALES,
    depositMethods:  methods.filter((m) => m.forDeposit),
    withdrawMethods: methods.filter((m) => m.forWithdraw),
    limits: { depositMin: DEPOSIT_MIN, depositMax: DEPOSIT_MAX, withdrawMin: WITHDRAW_MIN, withdrawMax: WITHDRAW_MAX },
    firstDepositAmount: 30,
    firstWithdrawAmount: 100
  };
}

/** Hər render eyni dəyişən dəstini alır — EJS-də "undefined variable" xətası olmasın */
async function renderWallet(req, res, extra = {}) {
  const ctx = await loadWalletContext(req);
  return res.render('wallet', {
    ...ctx,
    tab: extra.tab || req.query.tab || 'deposit',
    error: extra.error || null,
    success: extra.success || null
  });
}

// ── Əsas səhifə ──
router.get('/', requireLogin, async (req, res) => {
  try {
    if (req.query.lang) req.session.locale = normalizeLocale(req.query.lang);
    await renderWallet(req, res);
  } catch (e) {
    console.error('Wallet page err:', e);
    res.status(500).send('Xəta baş verdi');
  }
});

// ── DEPOSIT (bank kartı / IBAN / transfer) ──
router.post('/deposit', requireLogin, upload.single('receipt'), async (req, res) => {
  try {
    const { method, amount, cardNumber, cardHolder, cardExpiry } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    if (!method) return renderWallet(req, res, { tab: 'deposit', error: 'Ödəniş üsulu seçilməyib' });
    if (!amt || amt < DEPOSIT_MIN || amt > DEPOSIT_MAX) {
      return renderWallet(req, res, { tab: 'deposit', error: `Məbləğ ${DEPOSIT_MIN} – ${DEPOSIT_MAX} arasında olmalıdır` });
    }

    const locale = currentLocale(req);
    const pm = await PaymentMethod.findOne({ key: method, locale, active: true });
    if (!pm) return renderWallet(req, res, { tab: 'deposit', error: 'Ödəniş üsulu tapılmadı' });

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const cardRaw = String(cardNumber || '').replace(/\s+/g, '');

    const txn = new Transaction({
      userId:       user._id,
      type:         'deposit',
      amount:       amt,
      currency:     pm.currency || 'AZN',
      status:       'pending',
      method:       pm.key,
      cardLast4:    cardRaw ? cardRaw.slice(-4) : '',
      cardHolder:   cardHolder || '',
      cardExpiry:   cardExpiry || '',
      receiptImage: receiptUrl,
      note:         `${pm.name} (${locale.toUpperCase()}) vasitəsilə yükləmə`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    notifyDepositRequest(txn, user).catch((e) => console.error('Telegram notify err:', e.message));

    return renderWallet(req, res, {
      tab: 'deposit',
      success: 'Ödəniş sorğunuz qəbul edildi. Yoxlama başa çatdıqdan sonra balansınıza yüklənəcək.'
    });
  } catch (e) {
    console.error('Deposit err:', e);
    return renderWallet(req, res, { tab: 'deposit', error: e.message || 'Xəta baş verdi' });
  }
});

// ── DEPOSIT KRİPTO ──
router.post('/deposit/crypto', requireLogin, upload.single('receipt'), async (req, res) => {
  try {
    const { amount, method, walletAddress, note } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    const locale = currentLocale(req);
    const pm = await PaymentMethod.findOne({ key: method, locale, kind: 'crypto', active: true });
    if (!pm) return renderWallet(req, res, { tab: 'deposit', error: 'Kripto üsulu tapılmadı' });

    if (!amt || amt < DEPOSIT_MIN || amt > 50000) {
      return renderWallet(req, res, { tab: 'deposit', error: `Kripto məbləğ ${DEPOSIT_MIN} – 50000 aralığında olmalıdır` });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const txn = new Transaction({
      userId:        user._id,
      type:          'deposit',
      amount:        amt,
      currency:      pm.currency || 'USDT',
      status:        'pending',
      method:        pm.key,
      cryptoToken:   String(pm.currency || 'USDT').toUpperCase(),
      network:       String(pm.network || '').toUpperCase(),
      walletAddress: walletAddress || '',
      receiptImage:  receiptUrl,
      note:          note || `${pm.name} ilə yükləmə`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    notifyDepositRequest(txn, user).catch((e) => console.error('Telegram crypto err:', e.message));

    return renderWallet(req, res, { tab: 'deposit', success: 'Kripto depozit sorğunuz göndərildi. Yoxlama gözlənilir.' });
  } catch (e) {
    console.error('Crypto deposit err:', e);
    return renderWallet(req, res, { tab: 'deposit', error: e.message || 'Xəta baş verdi' });
  }
});

// ── ÇIXARIŞ ──
router.post('/withdraw', requireLogin, async (req, res) => {
  try {
    const { amount, method, cardHolder, cardExpiry, cardNumber, iban, walletAddress } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/login');

    if (!amt || amt < WITHDRAW_MIN || amt > WITHDRAW_MAX) {
      return renderWallet(req, res, { tab: 'withdraw', error: `Çıxarış ${WITHDRAW_MIN} – ${WITHDRAW_MAX} aralığında olmalıdır` });
    }

    const locale = currentLocale(req);
    const pm = await PaymentMethod.findOne({ key: method, locale, active: true });
    if (!pm) return renderWallet(req, res, { tab: 'withdraw', error: 'Çıxarış üsulu seçilməyib' });

    const isCrypto = pm.kind === 'crypto';
    if (isCrypto) {
      if (!walletAddress) return renderWallet(req, res, { tab: 'withdraw', error: 'Kripto pulqabı ünvanını yazın' });
    } else {
      const dest = String(cardNumber || iban || '').trim();
      if (!cardHolder || !dest) {
        return renderWallet(req, res, { tab: 'withdraw', error: 'Hesab sahibi və kart/IBAN nömrəsi tələb olunur' });
      }
    }

    if (Number(user.balance || 0) < amt) {
      return renderWallet(req, res, { tab: 'withdraw', error: 'Balansınız kifayət etmir' });
    }

    // Balansı blokla: admin rədd edərsə geri qaytarılır.
    user.balance = Number(user.balance) - amt;
    await user.save();

    const cardRaw = String(cardNumber || iban || '').replace(/\s+/g, '');
    const txn = new Transaction({
      userId:        user._id,
      type:          'withdraw',
      amount:        amt,
      currency:      pm.currency || 'AZN',
      status:        'pending',
      method:        pm.key,
      cardLast4:     cardRaw ? cardRaw.slice(-4) : '',
      cardHolder:    cardHolder || '',
      cardExpiry:    cardExpiry || '',
      network:       isCrypto ? String(pm.network || '').toUpperCase() : '',
      cryptoToken:   isCrypto ? String(pm.currency || '').toUpperCase() : '',
      walletAddress: isCrypto ? (walletAddress || '') : '',
      note:          `${pm.name} (${locale.toUpperCase()}) üzərinə çıxarış`
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstWithdrawAt) counter.firstWithdrawAt = new Date();
    counter.totalWithdraws += amt;
    counter.withdrawCount  += 1;
    await counter.save();

    notifyWithdrawRequest(txn, user).catch((e) => console.error('Telegram withdraw err:', e.message));

    return renderWallet(req, res, { tab: 'withdraw', success: 'Çıxarış sorğunuz göndərildi. Yoxlama gözlənilir.' });
  } catch (e) {
    console.error('Withdraw err:', e);
    return renderWallet(req, res, { tab: 'withdraw', error: e.message || 'Xəta baş verdi' });
  }
});

module.exports = router;
