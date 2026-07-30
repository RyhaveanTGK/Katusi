// services/botEngine.js
// Otaqlarda süni oyunçular üçün məntiq.
//
// Qaydalar:
//  1) Şəxsi (istifadəçi tərəfindən yaradılan) otaqlardan başqa BÜTÜN otaqlarda
//     (admin tərəfindən sonradan yaradılanlar daxil) 2-4 random süni oyunçu olur.
//  2) Otaq real istifadəçilərin sayına görə hesablanaraq süni oyunçularla dolur.
//  3) Real istifadəçi olmasa belə süni oyunçular öz aralarında oynayır.
//  4) Daşların 65%-i süni oyunçuların xeyrinə, qalanı tam random çıxır.
//  5) Sıra (linya) uduşları: 1-ci 8%, 2-ci 16%, 3-cü 24% — ortadakı mərcdən.

const BOT_NAMES = [
  'Elvin_07', 'Nigar__', 'Rashad.M', 'AynurX', 'Tural99', 'Leyla_ist',
  'Kamran7', 'SebineN', 'OrxanZ', 'GunelM', 'Ferid_25', 'Ulviyye',
  'Samir.A', 'Nurlan__', 'Aysel19', 'Emil_Baku', 'Zaur55', 'Lamiye_',
  'Vusal.K', 'Sevinc__', 'Anar_92', 'Xatire.M', 'Ilkin7', 'Turkan_',
  'Ramin__', 'Gunay.S', 'Elnur55', 'Nezrin_', 'Fuad.A', 'Aytac__'
];

const DEFAULT_ROOM_SIZE = 5;      // bütün otaqlar 5 iştirakçı ilə dolur
const BOT_FAVOR_CHANCE = 0.65;    // daşların 65%-i botların xeyrinə
const MIN_SEED_BOTS = 2;          // hər otaqda ən azı 2 süni oyunçu
const MAX_SEED_BOTS = 4;          // ilkin maksimum 4 süni oyunçu
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

function realPlayerCount(room) {
  return (room.players || []).length;
}

/** Bu otaqda süni oyunçu ola bilərmi? Yalnız şəxsi otaqlarda olmur. */
function allowBots(room, roomSize = DEFAULT_ROOM_SIZE) {
  if (room.isCustom) return false;
  if (room.botsEnabled === false) return false;
  return realPlayerCount(room) < roomSize;
}

function shouldHaveBots(room, roomSize = DEFAULT_ROOM_SIZE) {
  return allowBots(room, roomSize);
}

/** Bir kartın sıraları */
function rowsOf(card) {
  return (card || []).map((row) => (row || []).filter(Boolean).map(Number)).filter((r) => r.length);
}

function botCards(bot) {
  return (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
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
    wonRows: [],
    lineWins: 0,
    isWinner: false,
    fullCard: false,
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

/** Otaqdakı bütün süni oyunçuları silir */
function clearBots(room) {
  if (!(room.bots || []).length) return false;
  room.bots = [];
  recalcBotStake(room);
  room.markModified('bots');
  return true;
}

/** Otağa TƏK bir süni oyunçu qoşur. @returns {boolean} dəyişiklik olubsa true */
function addOneBot(room, generateCardNumbers, roomSize = DEFAULT_ROOM_SIZE) {
  if (!allowBots(room, roomSize)) return false;
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

/**
 * Otağa ilkin 2-4 random süni oyunçu əlavə edir (otaq boş olduqda).
 * @returns {boolean} dəyişiklik olubsa true
 */
function seedBots(room, generateCardNumbers, roomSize = DEFAULT_ROOM_SIZE) {
  if (!allowBots(room, roomSize)) return false;
  if ((room.bots || []).length) return false;
  const want = Math.min(
    MIN_SEED_BOTS + rnd(MAX_SEED_BOTS - MIN_SEED_BOTS + 1),
    Math.max(0, roomSize - realPlayerCount(room))
  );
  let changed = false;
  for (let i = 0; i < want; i++) {
    if (addOneBot(room, generateCardNumbers, roomSize)) changed = true;
  }
  return changed;
}

/** Real oyunçuya yer açmaq üçün lazımi qədər süni oyunçu çıxarır */
function makeRoomForReal(room, roomSize = DEFAULT_ROOM_SIZE) {
  let changed = false;
  while (realPlayerCount(room) + (room.bots || []).length > roomSize && (room.bots || []).length) {
    room.bots.pop();
    changed = true;
  }
  if (changed) {
    recalcBotStake(room);
    room.markModified('bots');
  }
  return changed;
}

/** Köhnə adla uyğunluq */
function driftBots(room, generateCardNumbers, roomSize = DEFAULT_ROOM_SIZE) {
  return addOneBot(room, generateCardNumbers, roomSize);
}

/** Raund başlamazdan əvvəl heyəti yekunlaşdırır (yeni bot əlavə etmir). */
function finalizeBots(room) {
  const list = (room.bots || []).filter((b) => b && b.name);
  room.bots = list.map((b) => ({
    name: b.name,
    numbers: b.numbers,
    cards: botCards(b),
    tickets: Number(b.tickets || 1),
    stake: Number(b.stake || 0),
    marked: [],
    wonRows: [],
    lineWins: 0,
    isWinner: false,
    fullCard: false,
    prize: 0,
    joinedAt: b.joinedAt || new Date()
  }));
  recalcBotStake(room);
  room.markModified('bots');
  return room;
}

function syncBots(room) {
  return finalizeBots(room);
}

function botNumbers(bot) {
  return flat(botCards(bot));
}

/** Botun hələ çıxmamış ən yaxın sırasının rəqəmləri */
function botRemaining(bot, drawnSet) {
  let best = null;
  for (const card of botCards(bot)) {
    for (const row of rowsOf(card)) {
      const rem = row.filter((n) => !drawnSet.has(n));
      if (!rem.length) continue;
      if (!best || rem.length < best.length) best = rem;
    }
  }
  return best || [];
}

/** Botun tam düzülmüş (hələ ödənilməmiş) sıraları */
function botCompletedRows(bot, drawnNumbers) {
  const drawnSet = new Set((drawnNumbers || []).map(Number));
  const done = new Set(bot.wonRows || []);
  const out = [];
  const cards = botCards(bot);
  for (let ci = 0; ci < cards.length; ci++) {
    const rows = rowsOf(cards[ci]);
    for (let ri = 0; ri < rows.length; ri++) {
      const key = ci + ':' + ri;
      if (done.has(key)) continue;
      if (rows[ri].every((n) => drawnSet.has(n))) out.push({ key, cardIndex: ci, numbers: rows[ri] });
    }
  }
  return out;
}

/** Bot hansısa bileti tam doldurubmu? */
function botFullCardIndex(bot, drawnNumbers) {
  const drawnSet = new Set((drawnNumbers || []).map(Number));
  const cards = botCards(bot);
  for (let ci = 0; ci < cards.length; ci++) {
    const nums = flat(cards[ci]);
    if (nums.length && nums.every((n) => drawnSet.has(n))) return ci;
  }
  return -1;
}

/** Köhnə API — botun sonuncu tam sırası */
function botWinningRow(bot, drawnNumbers) {
  const drawnSet = new Set((drawnNumbers || []).map(Number));
  for (const card of botCards(bot)) {
    for (const row of rowsOf(card)) {
      if (row.every((n) => drawnSet.has(n))) return row;
    }
  }
  return (bot.marked || []).slice(-5);
}

/**
 * Növbəti daşı seçir.
 *  - 65% ehtimalla süni oyunçuların ehtiyacı olan daş çıxır
 *  - 35% (və bot olmayanda 100%) tam random
 * Real istifadəçilərə qarşı heç bir blok tətbiq olunmur.
 */
function pickNextNumber(room, realCards, available) {
  if (!available || !available.length) return null;
  const bots = room.bots || [];
  if (!bots.length) return pick(available);
  if (Math.random() > BOT_FAVOR_CHANCE) return pick(available);

  const drawnSet = new Set((room.drawnNumbers || []).map(Number));
  const availSet = new Set(available);

  // ən yaxın bot sırası
  let bestRem = null;
  for (const bot of bots) {
    const rem = botRemaining(bot, drawnSet).filter((n) => availSet.has(n));
    if (!rem.length) continue;
    if (!bestRem || rem.length < bestRem.length) bestRem = rem;
  }
  if (bestRem && bestRem.length) return pick(bestRem);
  return pick(available);
}

/**
 * Çıxan daşı süni oyunçuların biletlərinə işarələyir.
 * @returns {Array} {bot, rows, fullCard} — yeni tam sıra/bilet dolduran oyunçular
 */
function applyDrawToBots(room, number) {
  const bots = room.bots || [];
  if (!bots.length) return [];
  const drawn = room.drawnNumbers || [];

  const events = [];
  for (const bot of bots) {
    const nums = botNumbers(bot);
    if (nums.includes(Number(number))) {
      const marks = new Set((bot.marked || []).map(Number));
      marks.add(Number(number));
      bot.marked = [...marks].sort((a, b) => a - b);
    }
    const rows = botCompletedRows(bot, drawn);
    const fullIndex = botFullCardIndex(bot, drawn);
    if (rows.length || (fullIndex >= 0 && !bot.fullCard)) {
      events.push({ bot, rows, fullCard: fullIndex >= 0 && !bot.fullCard });
    }
  }
  room.markModified('bots');
  return events;
}

/** Otaqda görünən süni oyunçu siyahısı */
function botRoster(room) {
  return (room.bots || []).map((b) => ({
    name: b.name,
    stake: Number(b.stake || 0),
    tickets: Number(b.tickets || 1),
    marked: (b.marked || []).length,
    lines: Number(b.lineWins || 0)
  }));
}

module.exports = {
  BOT_NAMES,
  DEFAULT_ROOM_SIZE,
  BOT_FAVOR_CHANCE,
  MIN_SEED_BOTS,
  MAX_SEED_BOTS,
  botWinningRow,
  botCompletedRows,
  botFullCardIndex,
  botCards,
  botNumbers,
  realPlayerCount,
  allowBots,
  shouldHaveBots,
  clearBots,
  addOneBot,
  seedBots,
  makeRoomForReal,
  finalizeBots,
  syncBots,
  driftBots,
  recalcBotStake,
  botRoster,
  pickNextNumber,
  applyDrawToBots
};
