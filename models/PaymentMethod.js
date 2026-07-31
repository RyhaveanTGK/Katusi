const mongoose = require('mongoose');

/**
 * Ödəniş üsulu — deposit/çıxarış üçün.
 * Kart / IBAN nömrələri BURADA saxlanılır və yalnız admin paneldən doldurulur.
 * `locale` sahəsi dil dəstəyi üçün hazırdır: dil dəyişəndə həmin ölkənin
 * bankları göstərilir (az | tr | ru | en).
 */
const paymentMethodSchema = new mongoose.Schema({
  key:        { type: String, required: true, trim: true },              // vakifbank, sberbank, crypto_usdt ...
  locale:     { type: String, required: true, enum: ['az', 'tr', 'ru', 'ka', 'en'], index: true },
  name:       { type: String, required: true, trim: true },              // Vakıf Bank
  kind:       { type: String, enum: ['bank', 'iban', 'transfer', 'crypto'], default: 'bank' },
  logo:       { type: String, default: '' },                             // /assets/banks/xxx.svg
  currency:   { type: String, default: 'AZN' },

  // Admin paneldən doldurulur — kodda heç bir nömrə yazılmır
  cardNumber:    { type: String, default: '' },
  iban:          { type: String, default: '' },
  accountHolder: { type: String, default: '' },
  bankName:      { type: String, default: '' },

  // Kripto üçün
  network:       { type: String, default: '' },
  walletAddress: { type: String, default: '' },

  minAmount:  { type: Number, default: 5 },
  maxAmount:  { type: Number, default: 3000 },
  forDeposit: { type: Boolean, default: true },
  forWithdraw:{ type: Boolean, default: true },
  active:     { type: Boolean, default: true },
  sortOrder:  { type: Number, default: 0 },
  note:       { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now }
});

paymentMethodSchema.index({ locale: 1, sortOrder: 1 });
paymentMethodSchema.index({ key: 1, locale: 1 }, { unique: true });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
