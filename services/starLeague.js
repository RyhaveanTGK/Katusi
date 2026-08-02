// services/starLeague.js
// ── 24 SAATLIQ ULDUZ LİDERBOARDU ──
//
// Qaydalar:
//  1) Bütün otaqlarda oyunçu bilet aldıqda biletin qiymətinə görə ULDUZ yığır
//     (20 qəpik = 2 ulduz, yəni 1 ₼ = 10 ulduz — starPrize hər bilet üçün).
//  2) Liderboard ən çox PUL uduşuna görə deyil, ən çox ULDUZ yığanlara görədir.
//  3) Hər 24 saatdan bir ilk 100 oyunçuya avtomatik ulduz uduşu köçürülür:
//       1-ci  →  20.000.000
//       2-ci  →  15.000.000
//       3-cü  →  10.000.000
//       4–100 →   2.000.000
//  4) Uduşlar həm real istifadəçilərin, həm də süni oyunçuların balansına
//     avtomatik köçürülür, sonra dövr sıfırlanır.

const User      = require('../models/User');
const StarBot   = require('../models/StarBot');
const StarCycle = require('../models/StarCycle');
const { BOT_NAMES } = require('./botEngine');

const STARS_PER_AZN = 10;          // 1 ₼ = 10 ulduz (0.20 ₼ = 2 ulduz)

const CYCLE_MS = 24 * 60 * 60 * 1000;   // 24 saat
const LEADERBOARD_SIZE = 100;

const PRIZE_FIRST  = 20000000;
const PRIZE_SECOND = 15000000;
const PRIZE_THIRD  = 10000000;
const PRIZE_REST   = 2000000;

/** Yer nömrəsinə görə ulduz uduşu */
function prizeForRank(rank) {
  if (rank === 1) return PRIZE_FIRST;
  if (rank === 2) return PRIZE_SECOND;
  if (rank === 3) return PRIZE_THIRD;
  if (rank <= LEADERBOARD_SIZE) return PRIZE_REST;
  return 0;
}

/** Biletin qiymətinə görə bir biletdən yığılan ulduz */
function starsPerTicket(room) {
  // 20 qəpik → 2 ulduz  ⇒  1 ₼ → 10 ulduz
  const fee = Number((room && room.entryFee) || 0);
  if (fee > 0) return Math.max(1, Math.round(fee * STARS_PER_AZN));
  const byRoom = Number(room && room.starPrize ? room.starPrize : 0);
  return byRoom > 0 ? Math.max(1, Math.round(byRoom)) : 1;
}

/**
 * Real istifadəçiyə bilet alışına görə ulduz yazır.
 * @returns {number} verilən ulduz sayı
 */
async function awardStars(user, room, quantity = 1) {
  if (!user || !room) return 0;
  const gained = starsPerTicket(room) * Math.max(1, Number(quantity || 1));
  user.periodStars = Number(user.periodStars || 0) + gained;
  // Ulduz otaqlarında bilet ulduzla alınır — balansa təkrar ulduz yazılmır,
  // yalnız liderboard sayğacı artır.
  if (room.type !== 'stars') user.stars = Number(user.stars || 0) + gained;
  await user.save();
  return gained;
}

/** Süni oyunçuya (adına görə) ulduz yazır */
async function awardBotStars(name, room, quantity = 1) {
  if (!name || !room) return 0;
  const gained = starsPerTicket(room) * Math.max(1, Number(quantity || 1));
  await StarBot.updateOne(
    { name },
    {
      $inc: { periodStars: gained, stars: gained, gamesPlayed: Number(quantity || 1) },
      $setOnInsert: { isBot: true, createdAt: new Date() }
    },
    { upsert: true }
  );
  return gained;
}

/** Aktiv dövr — yoxdursa yaradılır */
async function currentCycle() {
  let cycle = await StarCycle.findOne({ paidAt: null }).sort({ startedAt: -1 });
  if (!cycle) {
    cycle = await new StarCycle({
      startedAt: new Date(),
      endsAt: new Date(Date.now() + CYCLE_MS)
    }).save();
  }
  return cycle;
}

/** Süni oyunçular üçün ilkin liderboard iştirakçıları */
async function ensureBotPool() {
  const count = await StarBot.countDocuments();
  if (count >= BOT_NAMES.length) return;
  for (const name of BOT_NAMES) {
    await StarBot.updateOne(
      { name },
      { $setOnInsert: { name, isBot: true, periodStars: 0, stars: 0, createdAt: new Date() } },
      { upsert: true }
    );
  }
}

/**
 * Cari dövrün liderboardu — ən çox ulduz yığanlar (real + süni), max 100 nəfər.
 */
async function leaderboard(limit = LEADERBOARD_SIZE) {
  const [users, botsList] = await Promise.all([
    User.find({ isAdmin: { $ne: true }, periodStars: { $gt: 0 } })
      .select('username periodStars stars gamesPlayed')
      .sort({ periodStars: -1 })
      .limit(limit),
    StarBot.find({ periodStars: { $gt: 0 } })
      .select('name periodStars stars gamesPlayed')
      .sort({ periodStars: -1 })
      .limit(limit)
  ]);

  const rows = [
    ...users.map((u) => ({
      id: String(u._id),
      name: u.username,
      periodStars: Number(u.periodStars || 0),
      stars: Number(u.stars || 0),
      gamesPlayed: Number(u.gamesPlayed || 0),
      isBot: false
    })),
    ...botsList.map((b) => ({
      id: String(b._id),
      name: b.name,
      periodStars: Number(b.periodStars || 0),
      stars: Number(b.stars || 0),
      gamesPlayed: Number(b.gamesPlayed || 0),
      isBot: true
    }))
  ];

  rows.sort((a, b) => b.periodStars - a.periodStars || a.name.localeCompare(b.name));
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1, prize: prizeForRank(i + 1) }));
}

/** Dövrü bağlayır: uduşları balanslara köçürür və sayğacları sıfırlayır */
async function settleCycle(cycle) {
  const rows = await leaderboard(LEADERBOARD_SIZE);
  let totalPaid = 0;
  const winners = [];

  for (const row of rows) {
    const prize = prizeForRank(row.rank);
    if (prize <= 0) continue;
    totalPaid += prize;

    if (row.isBot) {
      await StarBot.updateOne({ _id: row.id }, { $inc: { stars: prize, starPrizesWon: prize } });
    } else {
      await User.updateOne({ _id: row.id }, { $inc: { stars: prize, starPrizesWon: prize } });
    }

    winners.push({
      rank: row.rank,
      name: row.name,
      stars: row.periodStars,
      prize,
      isBot: row.isBot,
      userId: row.isBot ? null : row.id
    });
  }

  cycle.winners = winners;
  cycle.totalPaid = totalPaid;
  cycle.paidAt = new Date();
  await cycle.save();

  // Yeni dövr üçün sıfırlama
  await User.updateMany({ periodStars: { $gt: 0 } }, { $set: { periodStars: 0 } });
  await StarBot.updateMany({ periodStars: { $gt: 0 } }, { $set: { periodStars: 0 } });

  await new StarCycle({
    startedAt: new Date(),
    endsAt: new Date(Date.now() + CYCLE_MS)
  }).save();

  console.log(`[starLeague] 24 saatlıq dövr bağlandı — ${winners.length} qalibə ${totalPaid} ulduz köçürüldü`);
  return { winners, totalPaid };
}

/** Dövrün vaxtı bitibsə uduşları paylayır */
async function tick() {
  try {
    await ensureBotPool();
    const cycle = await currentCycle();
    if (new Date(cycle.endsAt).getTime() <= Date.now()) {
      await settleCycle(cycle);
    }
  } catch (e) {
    console.error('[starLeague] tick xətası:', e.message);
  }
}

let handle = null;
/** Fon prosesini başladır (hər dəqiqə yoxlanır) */
function start(intervalMs = 60 * 1000) {
  if (handle) return;
  tick();
  handle = setInterval(tick, intervalMs);
}
function stop() {
  if (handle) clearInterval(handle);
  handle = null;
}

/** Son bağlanmış dövrün nəticələri */
async function lastCycle() {
  return StarCycle.findOne({ paidAt: { $ne: null } }).sort({ paidAt: -1 });
}

module.exports = {
  CYCLE_MS,
  LEADERBOARD_SIZE,
  PRIZE_FIRST,
  PRIZE_SECOND,
  PRIZE_THIRD,
  PRIZE_REST,
  prizeForRank,
  starsPerTicket,
  STARS_PER_AZN,
  awardStars,
  awardBotStars,
  leaderboard,
  currentCycle,
  lastCycle,
  settleCycle,
  tick,
  start,
  stop
};
