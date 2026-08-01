const mongoose = require('mongoose');
const crypto   = require('crypto');

/**
 * E-poçt doğrulama kodu.
 * Kod 3 dəqiqə etibarlıdır — vaxt bitdikdə kod BLOKE olunur (blocked=true)
 * və istifadəçi yeni kod tələb etməlidir.
 */
const emailVerificationSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email:     { type: String, required: true, lowercase: true, trim: true, index: true },
  purpose:   { type: String, enum: ['signup', 'password_change'], default: 'signup', index: true },
  codeHash:  { type: String, required: true },
  expiresAt: { type: Date,   required: true },
  attempts:  { type: Number, default: 0 },
  blocked:   { type: Boolean, default: false },
  usedAt:    { type: Date, default: null },
  sendCount: { type: Number, default: 1 },
  lastSentAt:{ type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// 24 saatdan sonra sənəd avtomatik silinir
emailVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

emailVerificationSchema.statics.hashCode = function (code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
};

emailVerificationSchema.methods.isExpired = function () {
  return !this.expiresAt || this.expiresAt.getTime() <= Date.now();
};

emailVerificationSchema.methods.matches = function (code) {
  return this.codeHash === mongoose.model('EmailVerification').hashCode(code);
};

module.exports = mongoose.model('EmailVerification', emailVerificationSchema);
