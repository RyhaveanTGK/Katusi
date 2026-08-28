const mongoose = require('mongoose');
const paymentMethodSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  locale: { type: String, required: true, enum: ['az','tr','ru','ka','en'], index: true },
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['bank','iban','transfer','crypto'], default: 'bank' },
  logo: { type: String, default: '' },
  currency: { type: String, default: 'AZN' },
  cardNumber: { type: String, default: '' },
  iban: { type: String, default: '' },
  accountHolder: { type: String, default: '' },
  bankName: { type: String, default: '' },
  phone: { type: String, default: '' },
  network: { type: String, default: '' },
  walletAddress: { type: String, default: '' },
  minAmount: { type: Number, default: 5 },
  maxAmount: { type: Number, default: 3000 },
  withdrawMin: { type: Number, default: 30 },
  withdrawMax: { type: Number, default: 2000 },
  forDeposit: { type: Boolean, default: true },
  forWithdraw: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
paymentMethodSchema.index({ locale: 1, sortOrder: 1 });
paymentMethodSchema.index({ key: 1, locale: 1 }, { unique: true });
module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
