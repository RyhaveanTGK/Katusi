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
  maxPlayers: { type: Number, default: 5, max: 5 },
  players:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  jackpotEnabled: { type: Boolean, default: true },
  jackpot:     { type: Number, default: 0 },
  jackpotRatio:{ type: Number, default: 1.0 },
  drawnNumbers: [Number],
  // Hər çıxan daşın çıxma vaxtı (drawnNumbers ilə eyni sırada)
  drawnAt: { type: [Date], default: [] },
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
  // Real istifadəçi daxil olduqdan sonra süni oyunçuların qoşulma vaxtı (30 san.)
  botFillAt:   { type: Date, default: null },
  // Vaxt bitdikdən sonra qalibin göstərilmə müddəti
  revealAt:    { type: Date, default: null },
  finalWinnerName:  { type: String, default: null },
  finalWinnerPrize: { type: Number, default: 0 },
  finalWinnerNums:  [Number],
  finalWinnerMarks: { type: Number, default: 0 },
  finalWinnerLines: { type: Number, default: 0 },
  finalWinnerFull:  { type: Boolean, default: false },
  // Otaqda toplanan ümumi mərc (uduşlar çıxılmadan)
  stakeTotal:  { type: Number, default: 0 },
  // Raund başlayanda sabitlənən bank — linya faizləri bunun üzərindən hesablanır
  basePot:     { type: Number, default: 0 },
  // Daşı biletə qoymaq üçün verilən vaxt (saniyə)
  markGraceSec:{ type: Number, default: 12 },
  roundWinners: [{
    name:    { type: String },
    prize:   { type: Number, default: 0 },
    numbers: { type: [Number], default: [] },
    line:    { type: Number, default: 1 },
    isBot:   { type: Boolean, default: false }
  }],
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
    wonRows: { type: [String], default: [] },
    lineWins:{ type: Number, default: 0 },
    fullCard:{ type: Boolean, default: false },
    isWinner:{ type: Boolean, default: false },
    prize:   { type: Number, default: 0 },
    joinedAt:{ type: Date, default: Date.now }
  }],
  botStake: { type: Number, default: 0 },
  botWinIntended: { type: Boolean, default: false },

  // ── Şəxsi (istifadəçi tərəfindən yaradılan) otaqlar ──
  isCustom:    { type: Boolean, default: false },
  // Otaq dolduqda avtomatik açılan eyni tipli yeni otaq
  isClone:     { type: Boolean, default: false },
  templateKey: { type: String, default: null, index: true },
  ownerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  accessCode:  { type: String, default: null, index: true },
  inviteToken: { type: String, default: null, index: true },
  createdAt:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('Room', roomSchema);
