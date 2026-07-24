const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:     { type: String, enum: ['deposit', 'withdraw', 'win', 'referral', 'game_join', 'stars_purchase'], required: true },
  amount:   { type: Number, required: true },
  status:   { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  note:     { type: String, default: '' },
  cardNumber: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
