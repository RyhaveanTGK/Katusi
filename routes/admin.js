const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Room    = require('../models/Room');
const Transaction = require('../models/Transaction');
const BonusCode   = require('../models/BonusCode');
const PaymentMethod = require('../models/PaymentMethod');
const { LOCALES, normalizeLocale } = require('../services/paymentMethods');
const { requireAdmin } = require('../middleware/auth');
const { notifyDecision } = require('../services/telegramBot');

// ── Admin paneldən çıxış ──
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── Otaqlar ──
router.get('/', requireAdmin, (req, res) => res.redirect('/admin/users'));

router.get('/rooms', requireAdmin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const rooms = await Room.find({}).sort({ sortOrder: 1 });
  res.render('admin_rooms', { user, rooms, error: null, success: null });
});

router.post('/rooms/create', requireAdmin, async (req, res) => {
  try {
    const { name, type, entryFee, maxPlayers, jackpotEnabled, sortOrder, ticketLabel, starPrize, prizeMultiplier } = req.body;
    const room = new Room({
      name,
      type,
      ticketLabel: ticketLabel || 'TAM BİLET',
      entryFee:    parseFloat(entryFee) || 1,
      maxPlayers:  Math.min(5, parseInt(maxPlayers) || 5),
      jackpotEnabled: jackpotEnabled === 'on',
      // Admin tərəfindən yaradılan bütün otaqlarda süni oyunçular aktivdir
      botsEnabled: true,
      isCustom:    false,
      starPrize:   parseFloat(starPrize) || Math.max(1, Math.round((parseFloat(entryFee) || 1) * 10)),
      prizeMultiplier: prizeMultiplier || 'x2',
      sortOrder:   parseInt(sortOrder) || 0
    });
    await room.save();
    res.redirect('/admin/rooms');
  } catch(e) {
    res.redirect('/admin/rooms');
  }
});

router.post('/rooms/delete/:id',        requireAdmin, async (req, res) => { await Room.findByIdAndDelete(req.params.id); res.redirect('/admin/rooms'); });
router.post('/rooms/reset-jackpot/:id', requireAdmin, async (req, res) => { await Room.findByIdAndUpdate(req.params.id, { jackpot: 0 }); res.redirect('/admin/rooms'); });
router.post('/rooms/toggle-status/:id', requireAdmin, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (room) {
    if (room.status === 'waiting') room.status = 'started';
    else if (room.status === 'started') room.status = 'ended';
    else room.status = 'waiting';
    await room.save();
  }
  res.redirect('/admin/rooms');
});

// ── Əməliyyatlar ──
router.get('/transactions', requireAdmin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const status = (req.query.status || 'pending').toString();
  const filter = { type: { $in: ['deposit', 'withdraw'] } };
  if (status !== 'all') filter.status = status;

  const txns = await Transaction.find(filter)
    .sort({ createdAt: -1 })
    .limit(80)
    .populate('userId', 'username');

  res.render('admin_transactions', { user, txns, error: null, success: null, query: req.query });
});

async function decideTx(id, action, adminName) {
  const txn = await Transaction.findById(id).populate('userId');
  if (!txn || txn.status !== 'pending') return null;

  txn.status = action === 'approve' ? 'completed' : 'rejected';
  txn.decidedAt = new Date();
  txn.decidedBy = adminName;
  if (action === 'reject') txn.adminMessage = 'Rədd edildi';
  await txn.save();

  if (action === 'approve' && txn.type === 'deposit' && txn.userId) {
    txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
    await txn.userId.save();
  }
  if (action === 'reject' && txn.type === 'withdraw' && txn.userId) {
    txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
    await txn.userId.save();
  }
  notifyDecision(txn, txn.userId, action === 'approve' ? 'approved' : 'rejected').catch(()=>{});
  return txn;
}

router.post('/transactions/:id/approve', requireAdmin, async (req, res) => {
  const admin = await User.findById(req.session.userId);
  await decideTx(req.params.id, 'approve', admin?.username || 'admin');
  res.redirect('back');
});
router.post('/transactions/:id/reject', requireAdmin, async (req, res) => {
  const admin = await User.findById(req.session.userId);
  await decideTx(req.params.id, 'reject', admin?.username || 'admin');
  res.redirect('back');
});
router.post('/transactions/:id/decision', requireAdmin, async (req, res) => {
  // əvvəlki UI ilə uyğunluq
  const isApprove = req.originalUrl.includes('/approve') || req.body.action === 'approve';
  const admin = await User.findById(req.session.userId);
  await decideTx(req.params.id, isApprove ? 'approve' : 'reject', admin?.username || 'admin');
  res.redirect('/admin/transactions');
});

// ── İstifadəçilər ──
router.get('/users', requireAdmin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const q = (req.query.q || '').toString().trim();
  const filter = {};
  if (q) {
    filter.$or = [
      { username: { $regex: q, $options: 'i' } },
      { email:    { $regex: q, $options: 'i' } },
      { phone:    { $regex: q, $options: 'i' } }
    ];
  }
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);

  // hər user üçün son deposit / withdraw
  const ids = users.map((u) => u._id);
  const [lastDeps, lastWds] = await Promise.all([
    Transaction.aggregate([
      { $match: { userId: { $in: ids }, type: 'deposit', status: 'completed' } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$userId', amount: { $first: '$amount' }, at: { $first: '$createdAt' } } }
    ]),
    Transaction.aggregate([
      { $match: { userId: { $in: ids }, type: 'withdraw', status: 'completed' } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$userId', amount: { $first: '$amount' }, at: { $first: '$createdAt' } } }
    ])
  ]);
  const depMap = new Map(lastDeps.map((d) => [String(d._id), d]));
  const wdMap  = new Map(lastWds.map((d) => [String(d._id), d]));

  res.render('admin_users', {
    user, users, q,
    depMap: Object.fromEntries(depMap),
    wdMap:  Object.fromEntries(wdMap),
    error: null, success: null
  });
});

router.post('/users/:id/balance', requireAdmin, async (req, res) => {
  const delta = parseFloat(req.body.delta);
  const note  = (req.body.note || '').toString().slice(0, 200);
  if (!isFinite(delta) || delta === 0) return res.redirect('/admin/users');
  const u = await User.findById(req.params.id);
  if (!u) return res.redirect('/admin/users');
  u.balance = Math.max(0, Number(u.balance || 0) + delta);
  await u.save();
  await new Transaction({
    userId: u._id,
    type: delta > 0 ? 'deposit' : 'withdraw',
    amount: Math.abs(delta),
    status: 'completed',
    method: 'manual_admin',
    note: note || 'Balans düzəlişi'
  }).save();
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle-block', requireAdmin, async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) return res.redirect('/admin/users');
  u.isBlocked = !u.isBlocked;
  u.blockReason = u.isBlocked ? (req.body.reason || 'Qaydaların pozulması') : '';
  await u.save();
  res.redirect('/admin/users');
});

// İstifadəçinin son deposit/çıxarışları
router.get('/users/:id', requireAdmin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const target = await User.findById(req.params.id);
  if (!target) return res.redirect('/admin/users');
  const txns = await Transaction.find({ userId: target._id }).sort({ createdAt: -1 }).limit(50);
  res.render('admin_user_detail', { user, target, txns });
});

// ── Bonus kodları ──
router.get('/bonus', requireAdmin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const codes = await BonusCode.find({}).sort({ createdAt: -1 }).limit(100);
  res.render('admin_bonus', { user, codes, error: null, success: null });
});

router.post('/bonus/create', requireAdmin, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const amount = parseFloat(req.body.amount);
    const maxUses = parseInt(req.body.maxUses, 10) || 1;
    if (!code || !isFinite(amount) || amount <= 0) return res.redirect('/admin/bonus');
    await BonusCode.create({ code, amount, maxUses, note: req.body.note || '' });
  } catch (e) { /* dup key etc */ }
  res.redirect('/admin/bonus');
});

router.post('/bonus/:id/toggle', requireAdmin, async (req, res) => {
  const b = await BonusCode.findById(req.params.id);
  if (b) { b.active = !b.active; await b.save(); }
  res.redirect('/admin/bonus');
});

router.post('/bonus/:id/delete', requireAdmin, async (req, res) => {
  await BonusCode.findByIdAndDelete(req.params.id);
  res.redirect('/admin/bonus');
});

// ── Hazırda gedən oyunlar ──
router.get('/live-games', requireAdmin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const rooms = await Room.find({}).sort({ sortOrder: 1 }).populate('players', 'username balance');
  res.render('admin_live', { user, rooms });
});

// ── Ödəniş kartları (kart / IBAN nömrələri yalnız buradan idarə olunur) ──
router.get('/payments', requireAdmin, async (req, res) => {
  const user   = await User.findById(req.session.userId);
  const locale = normalizeLocale(req.query.locale);
  const methods = await PaymentMethod.find({ locale }).sort({ sortOrder: 1 });
  res.render('admin_payments', { user, methods, locale, locales: LOCALES });
});

router.post('/payments/create', requireAdmin, async (req, res) => {
  const locale = normalizeLocale(req.body.locale);
  try {
    await PaymentMethod.create({
      key:      String(req.body.key || '').trim(),
      locale,
      name:     String(req.body.name || '').trim(),
      kind:     req.body.kind || 'bank',
      logo:     req.body.logo || '',
      currency: req.body.currency || 'AZN',
      sortOrder: parseInt(req.body.sortOrder, 10) || 0
    });
  } catch (e) { console.error('PaymentMethod create:', e.message); }
  res.redirect('/admin/payments?locale=' + locale);
});

router.post('/payments/:id/update', requireAdmin, async (req, res) => {
  const m = await PaymentMethod.findById(req.params.id);
  if (!m) return res.redirect('/admin/payments');

  // Mətn sahələri (bank rekvizitləri — yalnız admin təyin edir)
  ['name','bankName','cardNumber','iban','phone','accountHolder','walletAddress','network','currency','logo','note']
    .forEach((f) => { if (req.body[f] !== undefined) m[f] = String(req.body[f]).trim(); });

  // Limitlər (baza valyuta: AZN)
  const numFields = { minAmount: 'minAmount', maxAmount: 'maxAmount', withdrawMin: 'withdrawMin', withdrawMax: 'withdrawMax' };
  Object.keys(numFields).forEach((f) => {
    if (req.body[f] !== undefined && String(req.body[f]).trim() !== '') {
      const v = parseFloat(req.body[f]);
      if (!isNaN(v) && v >= 0) m[f] = Math.round(v * 100) / 100;
    }
  });
  if (Number(m.maxAmount) > 0 && Number(m.minAmount) > Number(m.maxAmount)) m.maxAmount = m.minAmount;
  if (Number(m.withdrawMax) > 0 && Number(m.withdrawMin) > Number(m.withdrawMax)) m.withdrawMax = m.withdrawMin;

  if (req.body.sortOrder !== undefined) m.sortOrder = parseInt(req.body.sortOrder, 10) || 0;
  if (req.body.forDeposit  !== undefined) m.forDeposit  = req.body.forDeposit === '1';
  if (req.body.forWithdraw !== undefined) m.forWithdraw = req.body.forWithdraw === '1';
  await m.save();
  res.redirect('/admin/payments?locale=' + m.locale);
});


router.post('/payments/:id/toggle', requireAdmin, async (req, res) => {
  const m = await PaymentMethod.findById(req.params.id);
  if (m) { m.active = !m.active; await m.save(); }
  res.redirect('/admin/payments?locale=' + (m ? m.locale : 'az'));
});

router.post('/payments/:id/delete', requireAdmin, async (req, res) => {
  const m = await PaymentMethod.findByIdAndDelete(req.params.id);
  res.redirect('/admin/payments?locale=' + (m ? m.locale : 'az'));
});

module.exports = router;
