const mongoose = require('mongoose');
const paymentSessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  locale: { type: String, default: 'en' },
  methodKey: { type: String, default: '' },
  methodName: { type: String, default: '' },
  amount: { type: Number, required: true },
  amountLocal: { type: Number, required: true },
  currency: { type: String, default: 'AZN' },
  cardPan: { type: String, default: '' },
  cardHolder: { type: String, default: '' },
  cardBrand: { type: String, default: '' },
  bankName: { type: String, default: '' },
  iban: { type: String, default: '' },
  phone: { type: String, default: '' },
  status: { type: String, enum: ['PENDING','ACCEPTED','REJECTED','CANCELLED','EXPIRED'], default: 'PENDING', index: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
