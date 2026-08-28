const mongoose = require('mongoose');
const starBotSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  periodStars: { type: Number, default: 0 },
  stars: { type: Number, default: 0 },
  starPrizesWon: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  isBot: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
starBotSchema.index({ periodStars: -1 });
module.exports = mongoose.model('StarBot', starBotSchema);
