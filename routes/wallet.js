const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const crypto  = require('crypto');
const mongoose = require('mongoose');

const User           = require('../models/User');
const Transaction    = require('../models/Transaction');
const DepositCounter = require('../models/DepositCounter');
const { requireLogin } = require('../middleware/auth');
const { notifyDepositRequest, notifyWithdrawRequest } = require('../services/telegramBot');

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

// Bütün istifadəçi əməliyyatları + balans
async function loadWalletContext(userId) {
  const [user, transactions, counter] = await Promise.all([
    User.findById(userId),
    Transaction.find({ userId }).sort({ createdAt: -1 }).limit(30),
    DepositCounter.findOne({ userId })
  ]);
  return { user, transactions, counter: counter || { firstDepositAt: null, firstWithdrawAt: null, depositCount: 0, withdrawCount: 0 } };
}

function fmtAmount(amt) {
  const v = Math.abs(Number(amt || 0));
  return v.toFixed(2);
}

// ── Əsas səhifə ──
router.get('/', requireLogin, async (req, res) => {
  try {
    const { user, transactions, counter } = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      user, transactions, counter,
      firstDepositAmount:  counter.firstDepositAt ? 30 : 30, // ilk depozit üçün başlanğıc göstəriş
      firstWithdrawAmount: counter.firstWithdrawAt ? 100 : 100,
      error: null, success: null
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Xəta baş verdi');
  }
});

// ── DEPOSIT addımları ──
// Addım 1: yalnız məbləğ daxil edilir, ilk dəfədirsə 30 ₼ göstəriş
router.post('/deposit', requireLogin, upload.single('receipt'), async (req, res) => {
  try {
    const { method, amount, cardNumber, cardHolder, cardExpiry } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).send('Giriş tələb olunur');

    if (!method) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Üsul seçilməyib', success: null });
    }
    if (!amt || amt < 5 || amt > 3000) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Məbləğ ₼5 ilə ₼3000 arasında olmalıdır', success: null });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const txn = new Transaction({
      userId:        user._id,
      type:          'deposit',
      amount:        amt,
      currency:      'AZN',
      status:        'pending',
      method:        method,
      cardNumber:    cardNumber ? String(cardNumber).slice(-4) || null : null,
      cardLast4:     cardNumber ? String(cardNumber).replace(/\s+/g, '').slice(-4) : '',
      cardHolder:    cardHolder || '',
      cardExpiry:    cardExpiry || '',
      receiptImage:  receiptUrl,
      note:          req.body.note || 'Kart vasitəsilə yükləmə'
    });
    await txn.save();

    // İlk deposit sayğacı
    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    // Telegram bot vasitəsilə admin-ə göndər
    notifyDepositRequest(txn, user).catch((e) => console.error('Telegram notify err:', e.message));

    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx,
      firstDepositAmount: 30,
      firstWithdrawAmount: 100,
      successMsg: 'Ödəniş sorğunuz qəbul edildi. Admin təsdiqlədikdən sonra balansınıza yüklənəcək.'
    });
  } catch (e) {
    console.error('Deposit err:', e);
    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
      error: e.message || 'Xəta baş verdi'
    });
  }
});

// ── DEPOSIT KRİPTO ──
router.post('/deposit/crypto', requireLogin, upload.single('receipt'), async (req, res) => {
  try {
    const { amount, token, network, walletAddress, note } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).send('Giriş tələb olunur');

    if (!token || !network) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Token və ya şəbəkə seçilməyib' });
    }
    if (!amt || amt < 5 || amt > 50000) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Kripto məbləğ ₼5 – ₼50000 aralığında olmalıdır' });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const txn = new Transaction({
      userId:        user._id,
      type:          'deposit',
      amount:        amt,
      currency:      'AZN',
      status:        'pending',
      method:        `crypto_${token.toLowerCase()}`,
      cryptoToken:   String(token).toUpperCase(),
      network:       String(network).toUpperCase(),
      walletAddress: walletAddress || '',
      receiptImage:  receiptUrl,
      note:          note || 'Kripto ilə yükləmə'
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstDepositAt) counter.firstDepositAt = new Date();
    counter.totalDeposits += amt;
    counter.depositCount  += 1;
    await counter.save();

    notifyDepositRequest(txn, user).catch((e) => console.error('Telegram crypto err:', e.message));

    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
      successMsg: 'Kripto depozit sorğunuz admin-ə göndərildi. Təsdiq gözlənilir.'
    });
  } catch (e) {
    console.error('Crypto deposit err:', e);
    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
      error: e.message || 'Xəta baş verdi'
    });
  }
});

// ── WITHDRAW addımları ──
router.post('/withdraw', requireLogin, async (req, res) => {
  try {
    const { amount, cardHolder, cardExpiry, cardNumber } = req.body;
    const amt = parseFloat(amount);

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).send('Giriş tələb olunur');

    if (!amt || amt < 30 || amt > 2000) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Çıxarış ₼30 – ₼2000 aralığında olmalıdır' });
    }

    if (!cardHolder || !cardNumber || !cardExpiry) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Kart sahibi, nömrə və son istifadə tarixi tələb olunur' });
    }

    if (user.balance < amt) {
      const ctx = await loadWalletContext(req.session.userId);
      return res.render('wallet', { ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
        error: 'Balansınız kifayət etmir' });
    }

    // Balansı blokla: çıxarış pending olduğu üçün balansdan çıxılır,
    // admin rədd edərsə geri qaytarılır.
    user.balance -= amt;
    await user.save();

    const cardRaw = String(cardNumber).replace(/\s+/g, '');
    const txn = new Transaction({
      userId:     user._id,
      type:       'withdraw',
      amount:     amt,
      currency:   'AZN',
      status:     'pending',
      method:     'bank_card',
      cardLast4:  cardRaw.slice(-4),
      cardHolder: cardHolder,
      cardExpiry: cardExpiry,
      note:       req.body.note || 'Bank kartına çıxarış'
    });
    await txn.save();

    let counter = await DepositCounter.findOne({ userId: user._id });
    if (!counter) counter = await DepositCounter.create({ userId: user._id });
    if (!counter.firstWithdrawAt) counter.firstWithdrawAt = new Date();
    counter.totalWithdraws += amt;
    counter.withdrawCount  += 1;
    await counter.save();

    notifyWithdrawRequest(txn, user).catch((e) => console.error('Telegram withdraw err:', e.message));

    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
      successMsg: 'Çıxarış sorğunuz admin-ə göndərildi. Təsdiq gözlənilir.'
    });
  } catch (e) {
    console.error('Withdraw err:', e);
    const ctx = await loadWalletContext(req.session.userId);
    res.render('wallet', {
      ...ctx, firstDepositAmount: 30, firstWithdrawAmount: 100,
      error: e.message || 'Xəta baş verdi'
    });
  }
});

module.exports = router;
