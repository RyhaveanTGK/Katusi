const mongoose = require('mongoose');

/**
 * Depozit üçün "kartdan karta" ödəniş sessiyası.
 * İstifadəçi məbləği seçir → sessiya yaranır → ona köçürmə ediləcək kart göstərilir.
 * Təsdiq YALNIZ admin tərəfindən (Transaction.status) aparılır.
 */
const paymentSessionSchema = new mongoose.Schema({
  token:         { type: String, required: true, unique: true, index: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },

  locale:        { type: String, default: 'en' },
  methodKey:     { type: String, default: '' },
  methodName:    { type: String, default: '' },
  amount:        { type: Number, required: true },   // baza valyuta (AZN)
  amountLocal:   { type: Number, required: true },   // istifadəçinin dilinin valyutasında
  currency:      { type: String, default: 'AZN' },

  // Köçürmə ediləcək rekvizitlər (admin paneldəki PaymentMethod-dan kopyalanır)
  cardPan:       { type: String, default: '' },
  cardHolder:    { type: String, default: '' },
  cardBrand:     { type: String, default: '' },
  bankName:      { type: String, default: '' },
  iban:          { type: String, default: '' },
  phone:         { type: String, default: '' },

  status:        { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'], default: 'PENDING', index: true },
  expiresAt:     { type: Date, required: true },
  createdAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
