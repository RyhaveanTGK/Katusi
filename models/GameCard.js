const mongoose = require('mongoose');

const gameCardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  roundId: { type: Number, default: 1, index: true },
  ticketIndex: { type: Number, default: 1 },
  numbers: [[Number]],
  markedNumbers: { type: [Number], default: [] },
  autoDaub: { type: Boolean, default: false },
  wonRows: { type: [Number], default: [] },
  lineWins: { type: Number, default: 0 },
  fullCard: { type: Boolean, default: false },
  fullAt: { type: Date, default: null },
  isWinner: { type: Boolean, default: false },
  prize: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  claimedAt: { type: Date, default: null },
  playedAt: { type: Date, default: Date.now }
});

gameCardSchema.index({ userId: 1, roomId: 1, roundId: 1 });

module.exports = mongoose.model('GameCard', gameCardSchema);
