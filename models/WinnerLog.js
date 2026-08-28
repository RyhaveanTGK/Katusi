const mongoose = require('mongoose');

const winnerLogSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  roomName: { type: String, default: '' },
  prize: { type: Number, default: 0 },
  numbers: [Number],
  synthetic: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('WinnerLog', winnerLogSchema);
