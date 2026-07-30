// services/botEngine.js
// Otaqlarda süni oyunçular üçün məntiq.
//
// Qaydalar:
//  1) Otağa yalnız REAL istifadəçi daxil olduqdan 30 saniyə sonra süni oyunçu qoşulur.
//  2) Süni oyunçular yalnız gözləmə mərhələsində, tək-tək qoşulur (gedən oyuna qoşulmurlar).
//  3) Şəxsi (istifadəçi tərəfindən yaradılmış) otaqlarda süni oyunçu OLMUR.
//  4) Bir sıranı (5 daş) dolduran hər kəs mərcinin 2 mislini qazanır.

const BOT_NAMES = [
  'Elvin_07', 'Nigar__', 'Rashad.M', 'AynurX', 'Tural99', 'Leyla_ist',
  'Kamran7', 'SebineN', 'OrxanZ', 'GunelM', 'Ferid_25', 'Ulviyye',
  'Samir.A', 'Nurlan__', 'Aysel19', 'Emil_Baku', 'Zaur55', 'Lamiye_',
  'Vusal.K', 'Sevinc__', 'Anar_92', 'Xatire.M', 'Ilkin7', 'Turkan_',
  'Ramin__', 'Gunay.S', 'Elnur55', 'Nezrin_', 'Fuad.A', 'Aytac__'
];

const DEFAULT_ROOM_SIZE = 5;   // bütün otaqlar 5 iştirakçı ilə dolur
const BOT_WIN_CHANCE = 0.65;
const REAL_WIN_CHANCE = 0.45;
const MAX_TICKETS_PER_BOT = 3;

function rnd(max) { return Math.floor(Math.random() * max); }
function pick(arr) { return arr[rnd(arr.length)]; }

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

/**
 * Bu otaqda süni oyunçu ola bilərmi?
 *  - şəxsi otaqlarda heç vaxt olmur
 *  - botsEnabled === false olduqda olmur
 *  - otaqda ən azı 1 real istifadəçi olmalıdır
 *  - otaq dolmamış olmalıdır
 */
function allowBots(room, roomSize = DEFAULT_ROOM_SIZE) {
  if (room.isCustom) return false;
  if (room.botsEnabled === false) return false;
  if (realPlayerCount(room) < 1) return false;
  return realPlayerCount(room) < roomSize;
}

function shouldHaveBots(room, roomSize = DEFAULT_ROOM_SIZE) {
  return allowBots(room, roomSize);
}

/** Bir sıradakı rəqəmlər */
function rowsOf(card) {
  return (card || []).map((row) => (row || []).filter(Boolean).map(Number)).filter((r) => r.length);
}

/** Bir süni oyunçu obyekti yaradır (biletləri + mərci ilə) */
function createBot(room, name, generateCardNumbers) {
  const tickets = 1 + rnd(MAX_TICKETS_PER_BOT);
  const cards = Array.from({ length: tickets }, () => generateCardNumbers());
  return {
    name,
    numbers: cards[0],
    cards,
    tickets,
    stake: Number((Number(room.entryFee || 0) * tickets).toFixed(2)),
    marked: [],
    isWinner: false,
    prize: 0,
    joinedAt: new Date()
  };
}

/** Otağın bank məbləğini süni oyunçuların mərcinə görə yenilə */
function recalcBotStake(room) {
  const total = (room.bots || []).reduce((sum, b) => sum + Number(b.stake || 0), 0);
  const prev = Number(room.botStake || 0);
  room.botStake = Number(total.toFixed(2));
  room.prize = Number(Math.max(0, Number(room.prize || 0) - prev + room.botStake).toFixed(2));
  if (room.jackpotEnabled) {
    room.jackpot = Number(Math.max(0, Number(room.jackpot || 0) - prev + room.botStake).toFixed(2));
  }
}

function botCapacity(room, roomSize = DEFAULT_ROOM_SIZE) {
  const size = Math.min(Number(room.maxPlayers || roomSize), roomSize);
  return Math.max(0, size - realPlayerCount(room) - (room.bots || []).length);
}

/** Otaqdaki bütün süni oyunçuları silir */
function clearBots(room) {
  if (!(room.bots || []).length) return false;
  room.bots = [];
  recalcBotStake(room);
  room.markModified('bots');
  return true;
}

/**
 * Otağa TƏK bir süni oyunçu qoşur (gözləmə mərhələsində, 30 saniyə keçdikdən sonra).
 * @returns {boolean} dəyişiklik olubsa true
 */
function addOneBot(room, generateCardNumbers, roomSize = DEFAULT_ROOM_SIZE) {
  if (!allowBots(room, roomSize)) return clearBots(room);
  if (botCapacity(room, roomSize) <= 0) return false;

  const list = room.bots || [];
  const name = pickBotNames(1, list.map((b) => b.name))[0];
  if (!name) return false;

  list.push(createBot(room, name, generateCardNumbers));
  room.bots = list;
  recalcBotStake(room);
  room.markModified('bots');
  return true;
}

/** Köhnə adla uyğunluq: artıq yalnız tək-tək qoşulma var */
function driftBots(room, generateCardNumbers, roomSize = DEFAULT_ROOM_SIZE) {
  return addOneBot(room, generateCardNumbers, roomSize);
}

/**
 * Raund başlamazdan əvvəl heyəti yekunlaşdırır.
 * Yeni bot ƏLAVƏ ETMİR — yalnız mərcləri və qazanma meylini hesablayır.
 */
function finalizeBots(room) {
  const list = (room.bots || []).filter((b) => b && b.name);
  room.bots = list.map((b) => ({
    name: b.name,
    numbers: b.numbers,
    cards: (Array.isArray(b.cards) && b.cards.length) ? b.cards : [b.numbers],
    tickets: Number(b.tickets || 1),
    stake: Number(b.stake || 0),
    marked: [],
    isWinner: false,
    prize: 0,
    joinedAt: b.joinedAt || new Date()
  }));
  recalcBotStake(room);
  room.markModified('bots');

  const total = BOT_WIN_CHANCE + REAL_WIN_CHANCE;
  room.botWinIntended = Math.random() < (BOT_WIN_CHANCE / total);
  return room;
}

function syncBots(room) {
  return finalizeBots(room);
}

/** Bir oyunçunun bütün biletlərinin rəqəmləri */
function botNumbers(bot) {
  if (Array.isArray(bot.cards) && bot.cards.length) return flat(bot.cards);
  return flat(bot.numbers);
}

/** Bir botun hələ çıxmamış rəqəmləri (ən yaxın sırasına görə) */
function botRemaining(bot, drawnSet) {
  const cards = (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
  let best = null;
  for (const card of cards) {
    for (const row of rowsOf(card)) {
      const rem = row.filter((n) => !drawnSet.has(n));
      if (!best || rem.length < best.length) best = rem;
    }
  }
  return best || [];
}

/** Botun tam düzülmüş sırası */
function botWinningRow(bot, drawnNumbers) {
  const drawnSet = new Set((drawnNumbers || []).map(Number));
  const cards = (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
  for (const card of cards) {
    for (const row of rowsOf(card)) {
      if (row.every((n) => drawnSet.has(n))) return row;
    }
  }
  return (bot.marked || []).slice(-5);
}

/** Növbəti daşı seçir. */
function pickNextNumber(room, realCards, available) {
  if (!available.length) return null;
  const bots = room.bots || [];
  if (!bots.length) return pick(available);

  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

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

  const realNeeds = [];
  for (const card of realCards) {
    if (card.isWinner) continue;
    let best = null;
    for (const row of rowsOf(card.numbers)) {
      const rem = row.filter((n) => !drawnSet.has(n));
      if (!best || rem.length < best.length) best = rem;
    }
    if (best && best.length) realNeeds.push(best);
  }

  const availSet = new Set(available);
  const inAvail = (arr) => arr.filter((n) => availSet.has(n));

  if (room.botWinIntended && leader) {
    const blocked = new Set();
    for (const rem of realNeeds) {
      if (rem.length <= 3) rem.forEach((n) => blocked.add(n));
    }
    const preferred = inAvail(leaderRemaining).filter((n) => !blocked.has(n));
    if (preferred.length) return pick(preferred);

    const neutral = available.filter((n) => !blocked.has(n));
    if (neutral.length) return pick(neutral);
    return pick(available);
  }

  const blockedBot = new Set();
  if (leader && leaderRemaining.length <= 3) leaderRemaining.forEach((n) => blockedBot.add(n));

  const helpReal = [];
  realNeeds.forEach((rem) => rem.forEach((n) => { if (availSet.has(n) && !blockedBot.has(n)) helpReal.push(n); }));
  if (helpReal.length) return pick(helpReal);

  const neutral = available.filter((n) => !blockedBot.has(n));
  if (neutral.length) return pick(neutral);
  return pick(available);
}

/**
 * Çıxan daşı süni oyunçuların biletlərinə işarələyir.
 * @returns {Array} bu daşla sıranı tamamlayan (yeni qalib olan) oyunçular
 */
function applyDrawToBots(room, number) {
  const bots = room.bots || [];
  if (!bots.length) return [];
  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

  const winners = [];
  for (const bot of bots) {
    const nums = botNumbers(bot);
    if (nums.includes(Number(number))) {
      const marks = new Set((bot.marked || []).map(Number));
      marks.add(Number(number));
      bot.marked = [...marks].sort((a, b) => a - b);
    }
    if (bot.isWinner) continue;
    const cards = (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
    const done = cards.some((card) => rowsOf(card).some((row) => row.every((n) => drawnSet.has(n))));
    if (done) {
      bot.isWinner = true;
      winners.push(bot);
    }
  }
  room.markModified('bots');
  return winners;
}

/** Otaqda görünən süni oyunçu siyahısı */
function botRoster(room) {
  return (room.bots || []).map((b) => ({
    name: b.name,
    stake: Number(b.stake || 0),
    tickets: Number(b.tickets || 1),
    marked: (b.marked || []).length
  }));
}

module.exports = {
  BOT_NAMES,
  DEFAULT_ROOM_SIZE,
  BOT_WIN_CHANCE,
  REAL_WIN_CHANCE,
  botWinningRow,
  botNumbers,
  realPlayerCount,
  allowBots,
  shouldHaveBots,
  clearBots,
  addOneBot,
  finalizeBots,
  syncBots,
  driftBots,
  recalcBotStake,
  botRoster,
  pickNextNumber,
  applyDrawToBots
};
