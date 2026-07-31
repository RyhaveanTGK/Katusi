const mongoose = require('mongoose');

/**
 * 24 saatlıq ulduz liderboardında iştirak edən SÜNİ (bot) oyunçular.
 * Real istifadəçilər User modelindəki periodStars sahəsi ilə iştirak edir.
 */
const starBotSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  periodStars: { type: Number, default: 0 },   // cari 24 saatda toplanan ulduz
  stars:       { type: Number, default: 0 },   // ümumi ulduz balansı
  starPrizesWon: { type: Number, default: 0 }, // liderboarddan qazanılmış ulduz
  gamesPlayed: { type: Number, default: 0 },
  isBot:       { type: Boolean, default: true },
  createdAt:   { type: Date, default: Date.now }
});

starBotSchema.index({ periodStars: -1 });

module.exports = mongoose.model('StarBot', starBotSchema);
