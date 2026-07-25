const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Room    = require('../models/Room');
const Transaction = require('../models/Transaction');
const { requireAdmin } = require('../middleware/auth');
const { notifyDecision } = require('../services/telegramBot');

// ── Otaqlar ──
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
      maxPlayers:  parseInt(maxPlayers) || 50,
      jackpotEnabled: jackpotEnabled === 'on',
      starPrize:   parseFloat(starPrize) || 20,
      prizeMultiplier: prizeMultiplier || 'x2',
      sortOrder:   parseInt(sortOrder) || 0
    });
    await room.save();

    const rooms = await Room.find({}).sort({ sortOrder: 1 });
    const curUser = await User.findById(req.session.userId);
    res.render('admin_rooms', { user: curUser, rooms, error: null, success: 'Otaq yaradıldı' });
  } catch(e) {
    const rooms = await Room.find({}).sort({ sortOrder: 1 });
    const curUser = await User.findById(req.session.userId);
    res.render('admin_rooms', { user: curUser, rooms, error: 'Xəta baş verdi', success: null });
  }
});

router.post('/rooms/delete/:id',       requireAdmin, async (req, res) => { await Room.findByIdAndDelete(req.params.id); res.redirect('/admin/rooms'); });
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
    .limit(50)
    .populate('userId', 'username');

  res.render('admin_transactions', { user, txns, error: null, success: null, query: req.query });
});

// Köhnə `/approve`-dən istifadə edən Telegram client-lər üçün saxlanılıb:
router.post('/transactions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('userId');
    if (!txn || txn.status !== 'pending') return res.redirect('/admin/transactions');

    txn.status = 'completed';
    txn.decidedAt = new Date();
    txn.decidedBy = (await User.findById(req.session.userId))?.username || 'admin';
    await txn.save();

    if (txn.type === 'deposit') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    notifyDecision(txn, txn.userId, 'approved').catch(()=>{});
    res.redirect('/admin/transactions');
  } catch (e) {
    res.redirect('/admin/transactions');
  }
});

router.post('/transactions/:id/reject', requireAdmin, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('userId');
    if (!txn || txn.status !== 'pending') return res.redirect('/admin/transactions');
    txn.status = 'rejected';
    txn.decidedAt = new Date();
    txn.decidedBy = (await User.findById(req.session.userId))?.username || 'admin';
    txn.adminMessage = req.body.reason || 'Admin tərəfindən rədd edildi';
    await txn.save();

    if (txn.type === 'withdraw') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    notifyDecision(txn, txn.userId, 'rejected').catch(()=>{});
    res.redirect('/admin/transactions');
  } catch (e) {
    res.redirect('/admin/transactions');
  }
});

// Yeni UI üçün vahid endpoint
router.post('/transactions/:id/decision', requireAdmin, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('userId');
    if (!txn || txn.status !== 'pending') return res.redirect('/admin/transactions');

    // Form button `decide()` tərəfindən POST endpoint-ə yönləndirilir:
    // URL .../approve | .../reject göndərilir
    const isApprove = req.url.includes('/approve');
    txn.status = isApprove ? 'completed' : 'rejected';
    txn.decidedAt = new Date();
    txn.decidedBy = (await User.findById(req.session.userId))?.username || 'admin';
    if (!isApprove) txn.adminMessage = req.body.reason || 'Admin tərəfindən rədd edildi';
    await txn.save();

    if (isApprove && txn.type === 'deposit') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    if (!isApprove && txn.type === 'withdraw') {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }

    notifyDecision(txn, txn.userId, isApprove ? 'approved' : 'rejected').catch(()=>{});
    res.redirect('/admin/transactions');
  } catch (e) {
    res.redirect('/admin/transactions');
  }
});

module.exports = router;
