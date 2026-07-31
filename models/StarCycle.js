const mongoose = require('mongoose');

/** Hər 24 saatlıq ulduz liderboard dövrünün nəticəsi */
const starCycleSchema = new mongoose.Schema({
  startedAt: { type: Date, default: Date.now },
  endsAt:    { type: Date, required: true },
  paidAt:    { type: Date, default: null },
  totalPaid: { type: Number, default: 0 },
  winners: [{
    rank:  { type: Number },
    name:  { type: String },
    stars: { type: Number, default: 0 },   // dövrdə toplanan ulduz
    prize: { type: Number, default: 0 },   // ödənilən ulduz
    isBot: { type: Boolean, default: false },
    userId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }]
});

starCycleSchema.index({ paidAt: 1 });

module.exports = mongoose.model('StarCycle', starCycleSchema);
