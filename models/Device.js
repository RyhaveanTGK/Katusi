const mongoose = require('mongoose');
const deviceSchema = new mongoose.Schema({
  deviceHash: { type: String, required: true, unique: true, index: true },
  fingerprint: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  referralUsed: { type: Boolean, default: false },
  referralCode: { type: String, default: null },
  accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Device', deviceSchema);
