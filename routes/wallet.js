const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const { requireLogin } = require('../middleware/auth');

// GET /wallet
router.get('/', requireLogin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const transactions = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
  res.render('wallet', { user, transactions, error: null, success: null });
});

// POST /wallet/deposit
router.post('/deposit', requireLogin, async (req, res) => {
  try {
    const { amount, cardNumber } = req.body;
    const user = await User.findById(req.session.userId);
    const amt  = parseFloat(amount);
    if (!amt || amt < 1) {
      const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
      return res.render('wallet', { user, transactions: txns, error: 'Minimum 1 ₼ yükləyə bilərsiniz', success: null });
    }
    const txn = new Transaction({ userId: user._id, type: 'deposit', amount: amt, cardNumber, status: 'pending', note: 'Kart vasitəsilə yükləmə' });
    await txn.save();
    const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
    res.render('wallet', { user, transactions: txns, error: null, success: 'Ödəniş tələbi qəbul edildi, təsdiqləndikdən sonra balansınıza yaxılacaq' });
  } catch(e) {
    const user = await User.findById(req.session.userId);
    const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
    res.render('wallet', { user, transactions: txns, error: 'Xəta baş verdi', success: null });
  }
});

// POST /wallet/withdraw
router.post('/withdraw', requireLogin, async (req, res) => {
  try {
    const { amount, cardNumber } = req.body;
    const user = await User.findById(req.session.userId);
    const amt  = parseFloat(amount);
    if (!amt || amt < 1) {
      const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
      return res.render('wallet', { user, transactions: txns, error: 'Minimum 1 ₼ çıxara bilərsiniz', success: null });
    }
    if (user.balance < amt) {
      const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
      return res.render('wallet', { user, transactions: txns, error: 'Balansınız kifayət etmir', success: null });
    }
    user.balance -= amt;
    await user.save();
    const txn = new Transaction({ userId: user._id, type: 'withdraw', amount: amt, cardNumber, status: 'pending', note: 'Kart vasitəsilə çıxarış' });
    await txn.save();
    const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
    res.render('wallet', { user, transactions: txns, error: null, success: 'Çıxarış tələbi qəbul edildi' });
  } catch(e) {
    const user = await User.findById(req.session.userId);
    const txns = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30);
    res.render('wallet', { user, transactions: txns, error: 'Xəta baş verdi', success: null });
  }
});

module.exports = router;
