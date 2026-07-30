// services/botEngine.js
// Otaqlarda süni ("bot") oyunçular üçün məntiq.
//
// Qaydalar:
//  1) Otaqda 3 və ya daha çox REAL istifadəçi varsa — bot olmur.
//  2) 3-dən az real istifadəçi varsa — otağa botlar əlavə olunur və oynayır.
//  3) Botlarla oynanılan raundlarda qazanma şansı: bot 80%, real istifadəçi 20%.

const BOT_NAMES = [
  'Elvin_07', 'Nigar__', 'Rashad.M', 'AynurX', 'Tural99', 'Leyla_ist',
  'Kamran7', 'SebineN', 'OrxanZ', 'GunelM', 'Ferid_25', 'Ulviyye',
  'Samir.A', 'Nurlan__', 'Aysel19', 'Emil_Baku', 'Zaur55', 'Lamiye_'
];

const REAL_PLAYER_LIMIT = 3;          // bu qədər (və daha çox) real oyunçu varsa bot yoxdur
const BOT_WIN_CHANCE = 0.8;           // botların qazanma şansı (80%)

function rnd(max) { return Math.floor(Math.random() * max); }

function pickBotNames(count, exclude = []) {
  const pool = BOT_NAMES.filter((n) => !exclude.includes(n));
  const out = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice(rnd(pool.length), 1)[0]);
  }
  return out;
}

function flat(numbers) {
  return (numbers || []).flat().filter(Boolean).map(Number);
}

/** Otaqda neçə real oyunçu var */
function realPlayerCount(room) {
  return (room.players || []).length;
}

/** Bu otaqda bot olmalıdırmı? */
function shouldHaveBots(room) {
  if (room.botsEnabled === false) return false;
  return realPlayerCount(room) < REAL_PLAYER_LIMIT;
}

/**
 * Raund başlamazdan əvvəl botları hazırlayır.
 * @param {*} room mongoose Room sənədi
 * @param {Function} generateCardNumbers bilet generatoru
 */
function syncBots(room, generateCardNumbers) {
  const real = realPlayerCount(room);

  if (!shouldHaveBots(room)) {
    room.bots = [];
    room.botWinIntended = false;
    return room;
  }

  const capacity = Math.max(0, Number(room.maxPlayers || 10) - real);
  if (capacity <= 0) {
    room.bots = [];
    room.botWinIntended = false;
    return room;
  }

  // 2–5 bot, otaq tutumunu aşmadan
  let target = Math.min(capacity, 2 + rnd(4));
  if (target < 1) target = 1;

  const names = pickBotNames(target);
  room.bots = names.map((name) => ({
    name,
    numbers: generateCardNumbers(),
    marked: [],
    isWinner: false
  }));

  // 80% bot qazanır, 20% real istifadəçiyə şans verilir
  room.botWinIntended = Math.random() < BOT_WIN_CHANCE;
  return room;
}

/** Bir botun hələ çıxmamış rəqəmləri */
function botRemaining(bot, drawnSet) {
  return flat(bot.numbers).filter((n) => !drawnSet.has(n));
}

/**
 * Növbəti daşı seçir. Nəticə 80/20 qaydasına uyğun yönləndirilir.
 * @returns {number} seçilmiş rəqəm
 */
function pickNextNumber(room, realCards, available) {
  if (!available.length) return null;
  const bots = room.bots || [];
  if (!bots.length) return available[rnd(available.length)];

  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

  // Əsas (lider) bot — ən az rəqəmi qalan
  let leader = null;
  let leaderRemaining = [];
  for (const bot of bots) {
    if (bot.isWinner) continue;
    const rem = botRemaining(bot, drawnSet);
    if (!leader || rem.length < leaderRemaining.length) {
      leader = bot;
      leaderRemaining = rem;
    }
  }

  // Real biletlərin qalan ehtiyacları
  const realNeeds = [];
  for (const card of realCards) {
    if (card.isWinner) continue;
    const rem = flat(card.numbers).filter((n) => !drawnSet.has(n));
    if (rem.length) realNeeds.push(rem);
  }

  const availSet = new Set(available);
  const inAvail = (arr) => arr.filter((n) => availSet.has(n));

  if (room.botWinIntended && leader) {
    // Real biletin son 3 daşını gecikdiririk ki, bot öndə qalsın
    const blocked = new Set();
    for (const rem of realNeeds) {
      if (rem.length <= 3) rem.forEach((n) => blocked.add(n));
    }
    const preferred = inAvail(leaderRemaining).filter((n) => !blocked.has(n));
    if (preferred.length) return preferred[rnd(preferred.length)];

    const neutral = available.filter((n) => !blocked.has(n));
    if (neutral.length) return neutral[rnd(neutral.length)];
    return available[rnd(available.length)];
  }

  // 20% hal: real istifadəçiyə şans veririk, botu ləngidirik
  const blockedBot = new Set();
  if (leader && leaderRemaining.length <= 3) leaderRemaining.forEach((n) => blockedBot.add(n));

  const helpReal = [];
  realNeeds.forEach((rem) => rem.forEach((n) => { if (availSet.has(n) && !blockedBot.has(n)) helpReal.push(n); }));
  if (helpReal.length) return helpReal[rnd(helpReal.length)];

  const neutral = available.filter((n) => !blockedBot.has(n));
  if (neutral.length) return neutral[rnd(neutral.length)];
  return available[rnd(available.length)];
}

/**
 * Çıxan daşı botların biletlərinə işarələyir.
 * @returns {object|null} biletini tam dolduran bot
 */
function applyDrawToBots(room, number) {
  const bots = room.bots || [];
  if (!bots.length) return null;
  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

  let winner = null;
  for (const bot of bots) {
    if (bot.isWinner) continue;
    const nums = flat(bot.numbers);
    if (nums.includes(Number(number))) {
      const marks = new Set((bot.marked || []).map(Number));
      marks.add(Number(number));
      bot.marked = [...marks].sort((a, b) => a - b);
    }
    if (nums.length && nums.every((n) => drawnSet.has(n))) {
      bot.isWinner = true;
      if (!winner) winner = bot;
    }
  }
  if (winner) room.markModified('bots');
  else room.markModified('bots');
  return winner;
}

module.exports = {
  BOT_NAMES,
  REAL_PLAYER_LIMIT,
  BOT_WIN_CHANCE,
  realPlayerCount,
  shouldHaveBots,
  syncBots,
  pickNextNumber,
  applyDrawToBots
};
