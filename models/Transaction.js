const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'win', 'referral', 'game_join', 'stars_purchase', 'refund'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'AZN' },
  status: { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending', index: true },
  method: { type: String, default: '' },
  network: { type: String, default: '' },
  cryptoToken: { type: String, default: '' },
  walletAddress: { type: String, default: '' },
  cardNumber: { type: String, default: null },
  cardLast4: { type: String, default: '' },
  cardHolder: { type: String, default: '' },
  cardExpiry: { type: String, default: '' },
  receiptImage: { type: String, default: '' },
  note: { type: String, default: '' },
  telegramMessageId: { type: Number, default: null },
  adminMessage: { type: String, default: '' },
  decidedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true },
  decidedAt: { type: Date, default: null }
});

transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
