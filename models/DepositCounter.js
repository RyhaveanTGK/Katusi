const mongoose = require('mongoose');
const depositCounterSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  firstDepositAt: { type: Date, default: null },
  firstWithdrawAt: { type: Date, default: null },
  totalDeposits: { type: Number, default: 0 },
  totalWithdraws: { type: Number, default: 0 },
  depositCount: { type: Number, default: 0 },
  withdrawCount: { type: Number, default: 0 }
});
module.exports = mongoose.model('DepositCounter', depositCounterSchema);
