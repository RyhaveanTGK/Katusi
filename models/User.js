const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone:    { type: String, default: '', index: true, sparse: true },

  // ── Şəxsiyyət məlumatları (qeydiyyat zamanı tələb olunur) ──
  fullName:       { type: String, default: '', trim: true },   // Real ad soyad
  birthDate:      { type: Date,   default: null },             // Doğum tarixi
  passportNumber: { type: String, default: '', trim: true },   // Passport nömrəsi
  passportPhoto:  { type: String, default: '' },               // Passport şəkili (URL)
  facePhoto:      { type: String, default: '' },               // Üz şəkili (URL)
  isVerified:     { type: Boolean, default: false },

  // ── E-poçt doğrulaması (Resend ilə göndərilən 6 rəqəmli kod) ──
  emailVerified:   { type: Boolean, default: false },
  emailVerifiedAt: { type: Date,    default: null },

  // ── İnterfeys dili (default: en) ──
  locale:   { type: String, enum: ['en','az','tr','ru','ka'], default: 'en' },

  balance:  { type: Number, default: 0 },
  stars:    { type: Number, default: 0 },      // ümumi ulduz balansı
  periodStars:   { type: Number, default: 0 }, // 24 saatlıq liderboard ulduzları
  starPrizesWon: { type: Number, default: 0 }, // liderboarddan qazanılmış ulduzlar
  referralCode: { type: String, unique: true },
  referredBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isAdmin:  { type: Boolean, default: false },
  isBlocked:{ type: Boolean, default: false },
  blockReason: { type: String, default: '' },
  telegramChatId: { type: String, default: '' },
  gamesPlayed: { type: Number, default: 0 },
  gamesWon:    { type: Number, default: 0 },
  totalWon:    { type: Number, default: 0 },
  activeSessions: [
    {
      sessionId:  { type: String },
      ip:         { type: String, default: '' },
      userAgent:  { type: String, default: '' },
      lastSeenAt: { type: Date, default: Date.now },
      createdAt:  { type: Date, default: Date.now }
    }
  ],
  lastDailyBonusAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);
