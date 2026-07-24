const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Room    = require('../models/Room');
const Transaction = require('../models/Transaction');
const { requireAdmin } = require('../middleware/auth');

// GET /admin/rooms
router.get('/rooms', requireAdmin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const rooms = await Room.find({}).sort({ sortOrder: 1 });
  res.render('admin_rooms', { user, rooms, error: null, success: null });
});

// POST /admin/rooms/create
router.post('/rooms/create', requireAdmin, async (req, res) => {
  try {
    const { name, type, entryFee, maxPlayers, jackpotEnabled, sortOrder } = req.body;
    const room = new Room({
      name, type, entryFee: parseFloat(entryFee) || 1,
      maxPlayers: parseInt(maxPlayers) || 50,
      jackpotEnabled: jackpotEnabled === 'on',
      sortOrder: parseInt(sortOrder) || 0
    });
    await room.save();
    const rooms = await Room.find({}).sort({ sortOrder: 1 });
    const user  = await User.findById(req.session.userId);
    res.render('admin_rooms', { user, rooms, error: null, success: 'Otaq yaradıldı' });
  } catch(e) {
    const rooms = await Room.find({}).sort({ sortOrder: 1 });
    const user  = await User.findById(req.session.userId);
    res.render('admin_rooms', { user, rooms, error: 'Xəta baş verdi', success: null });
  }
});

// POST /admin/rooms/delete/:id
router.post('/rooms/delete/:id', requireAdmin, async (req, res) => {
  await Room.findByIdAndDelete(req.params.id);
  res.redirect('/admin/rooms');
});

// POST /admin/rooms/reset-jackpot/:id
router.post('/rooms/reset-jackpot/:id', requireAdmin, async (req, res) => {
  await Room.findByIdAndUpdate(req.params.id, { jackpot: 0 });
  res.redirect('/admin/rooms');
});

// POST /admin/rooms/toggle-status/:id
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

// GET /admin/transactions
router.get('/transactions', requireAdmin, async (req, res) => {
  const user  = await User.findById(req.session.userId);
  const txns  = await Transaction.find({ type: { $in: ['deposit','withdraw'] }, status: 'pending' })
    .sort({ createdAt: -1 }).populate('userId', 'username');
  res.render('admin_transactions', { user, txns, error: null, success: null });
});

// POST /admin/transactions/approve/:id
router.post('/transactions/approve/:id', requireAdmin, async (req, res) => {
  const txn = await Transaction.findById(req.params.id).populate('userId');
  if (txn && txn.status === 'pending') {
    txn.status = 'completed';
    if (txn.type === 'deposit') {
      txn.userId.balance += txn.amount;
      await txn.userId.save();
    }
    await txn.save();
  }
  res.redirect('/admin/transactions');
});

// POST /admin/transactions/reject/:id
router.post('/transactions/reject/:id', requireAdmin, async (req, res) => {
  const txn = await Transaction.findById(req.params.id);
  if (txn) { txn.status = 'rejected'; await txn.save(); }
  res.redirect('/admin/transactions');
});

module.exports = router;
