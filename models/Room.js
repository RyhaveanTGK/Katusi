const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  ticketLabel:{ type: String, default: 'TAM BİLET' },
  type:       { type: String, enum: ['classic', 'stars'], default: 'classic' },
  status:     { type: String, enum: ['waiting', 'started', 'ended'], default: 'waiting' },
  entryFee:   { type: Number, default: 1 },
  starPrize:  { type: Number, default: 20 },
  prizeMultiplier: { type: String, default: 'x2' },
  themeColor: { type: String, default: '#1f9b3b' },
  prize:      { type: Number, default: 0 },
  maxPlayers: { type: Number, default: 50 },
  players:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  jackpotEnabled: { type: Boolean, default: true },
  jackpot:     { type: Number, default: 0 },
  jackpotRatio:{ type: Number, default: 1.0 },
  drawnNumbers: [Number],
  currentNumber: { type: Number, default: null },
  winnerUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winnerNums:  [Number],
  winnerPrize: { type: Number, default: 0 },
  winCount:    { type: Number, default: 0 },
  lastWinnerName: { type: String, default: null },
  lastWinnerNums: [Number],
  currentRoundId: { type: Number, default: 1 },
  drawIntervalSec: { type: Number, default: 5 },
  roundDurationSec: { type: Number, default: 360 },
  startTime:   { type: Date, default: null },
  roundEndsAt: { type: Date, default: null },
  lastDrawAt:  { type: Date, default: null },
  nextGameAt:  { type: Date, default: null },
  sortOrder:   { type: Number, default: 0 },

  // ── Botlar ──
  botsEnabled: { type: Boolean, default: true },
  bots: [{
    name:    { type: String },
    numbers: [[Number]],
    cards:   { type: [[[Number]]], default: [] },
    tickets: { type: Number, default: 1 },
    stake:   { type: Number, default: 0 },
    marked:  { type: [Number], default: [] },
    isWinner:{ type: Boolean, default: false },
    joinedAt:{ type: Date, default: Date.now }
  }],
  botStake: { type: Number, default: 0 },
  botWinIntended: { type: Boolean, default: false },

  // ── Şəxsi (istifadəçi tərəfindən yaradılan) otaqlar ──
  isCustom:    { type: Boolean, default: false },
  ownerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  accessCode:  { type: String, default: null, index: true },
  inviteToken: { type: String, default: null, index: true },
  createdAt:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('Room', roomSchema);
