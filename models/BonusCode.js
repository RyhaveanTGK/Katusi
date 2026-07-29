const mongoose = require('mongoose');

const bonusCodeSchema = new mongoose.Schema({
  code:       { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  amount:     { type: Number, required: true },       // hər istifadə üçün AZN
  maxUses:    { type: Number, default: 1 },           // 0 = limitsiz
  usedCount:  { type: Number, default: 0 },
  active:     { type: Boolean, default: true },
  usedBy:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  note:       { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now },
  expiresAt:  { type: Date, default: null }
});

module.exports = mongoose.model('BonusCode', bonusCodeSchema);
