// services/botEngine.js
// Otaqlarda süni oyunçular üçün məntiq.
//
// Qaydalar:
//  1) Şəxsi (istifadəçi tərəfindən yaradılan) otaqlardan başqa BÜTÜN otaqlarda
//     (admin tərəfindən sonradan yaradılanlar daxil) 2-4 random süni oyunçu olur.
//  2) Otaq real istifadəçilərin sayına görə hesablanaraq süni oyunçularla dolur.
//  3) Real istifadəçi olmasa belə süni oyunçular öz aralarında oynayır.
//  4) Daşlar random çıxır: botlu otaqlarda 55% süni oyunçuların, 45% real
//     istifadəçilərin xeyrinə seçilir. Bot olmayan otaqlarda TAM random.
//  5) Sıra (linya) uduşları: 1-ci 2.4%, 2-ci 4.8%, 3-cü 7.2% — ortadakı mərcdən.

// ── Süni oyunçu adları: 5 dilli (AZ / TR / RU / EN / KA) ──
// 70% qız adı, 30% oğlan adı seçilir.
const FEMALE_BOT_NAMES = [
  // AZ
  'Nigar__', 'AynurX', 'Leyla_ist', 'SebineN', 'GunelM', 'Ulviyye', 'Aysel19',
  'Lamiye_', 'Sevinc__', 'Xatire.M', 'Turkan_', 'Gunay.S', 'Nezrin_', 'Aytac__',
  // TR
  'Elif_34', 'ZeynepK', 'MeryemT', 'Ayse_06', 'Buse__', 'Selin.Y', 'Ecrin_35',
  'DeryaTR', 'Hilal_16', 'Ceren__',
  // RU
  'Anastasia_', 'Sveta77', 'Olga.M', 'Kseniya_', 'MarinaR', 'Yulia__', 'Daria.K',
  'Alina_99', 'Polina__', 'Katyusha',
  // EN
  'Emily_x', 'Sophie__', 'Olivia.J', 'Chloe_21', 'MiaW', 'Hannah__', 'Grace.L',
  'Lily_07', 'Ava__', 'Ruby.S',
  // KA
  'Nino_ge', 'Tamuna__', 'Mariam.G', 'Salome_', 'Ketevan_', 'Anano__', 'Lika.ge',
  'Elene_32', 'Tako__', 'Natia.K'
];

const MALE_BOT_NAMES = [
  // AZ
  'Elvin_07', 'Rashad.M', 'Tural99', 'Kamran7', 'OrxanZ', 'Ferid_25', 'Samir.A',
  // TR
  'Mert_34', 'BurakTR', 'Emre.K', 'Kaan_06',
  // RU
  'Dmitry__', 'Sergey.V', 'Nikita_7', 'Ivan__',
  // EN
  'Jake_11', 'Ryan.M', 'Oliver__', 'Ethan_9',
  // KA
  'Giorgi_ge', 'Levan__', 'Davit.G', 'Nika_ge'
];

const FEMALE_RATIO = 0.7;   // adların 70%-i qız adı olur

const BOT_NAMES = FEMALE_BOT_NAMES.concat(MALE_BOT_NAMES);

const DEFAULT_ROOM_SIZE = 5;      // bütün otaqlar 5 iştirakçı ilə dolur
const BOT_FAVOR_CHANCE  = 0.55;   // daşların 55%-i botların xeyrinə
const REAL_FAVOR_CHANCE = 0.45;   // 45%-i real istifadəçilərin xeyrinə
const MIN_SEED_BOTS = 3;          // ana səhifədə otaqda 3-4 süni oyunçu gözləyir
const MAX_SEED_BOTS = 4;          // ilkin maksimum 4 süni oyunçu
const MAX_TICKETS_PER_BOT = 3;

// Otaqda bu qədər (və daha çox) real oyunçu varsa süni oyunçu OLMUR —
// oyun bitənədək otaqda yalnız real istifadəçilər oynayır.
const REAL_ONLY_THRESHOLD = 3;

function rnd(max) { return Math.floor(Math.random() * max); }
function pick(arr) { return arr[rnd(arr.length)]; }

/** 70% qız / 30% oğlan nisbətində unikal ad seçir */
function pickBotNames(count, exclude = []) {
  const female = FEMALE_BOT_NAMES.filter((n) => !exclude.includes(n));
  const male   = MALE_BOT_NAMES.filter((n) => !exclude.includes(n));
  const out = [];
  while (out.length < count && (female.length || male.length)) {
    const wantFemale = Math.random() < FEMALE_RATIO;
    let pool = wantFemale ? female : male;
    if (!pool.length) pool = wantFemale ? male : female;
    if (!pool.length) break;
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
  // 3+ real oyunçu → botsuz oyun
  if (realPlayerCount(room) >= REAL_ONLY_THRESHOLD) return false;
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

/** Bir real biletin sıraları (GameCard.numbers) */
function realRowsOf(card) {
  return rowsOf((card && card.numbers) || []);
}

/** Real oyunçuların tamamlanmağa ən yaxın sırasının qalan daşları */
function realRemaining(realCards, drawnSet, availSet) {
  let best = null;
  for (const card of (realCards || [])) {
    for (const row of realRowsOf(card)) {
      const rem = row.filter((n) => !drawnSet.has(n));
      if (!rem.length) continue;
      const usable = rem.filter((n) => availSet.has(n));
      if (!usable.length) continue;
      if (!best || rem.length < best.length) best = usable;
    }
  }
  return best || [];
}

/** Botların tamamlanmağa ən yaxın sırasının qalan daşları */
function botsRemaining(bots, drawnSet, availSet) {
  let best = null;
  for (const bot of (bots || [])) {
    const rem = botRemaining(bot, drawnSet).filter((n) => availSet.has(n));
    if (!rem.length) continue;
    if (!best || rem.length < best.length) best = rem;
  }
  return best || [];
}

/**
 * Növbəti daşı seçir — daşlar RANDOM çıxır:
 *  - Süni oyunçusu OLMAYAN otaqlarda: 100% tam random.
 *  - Süni oyunçulu otaqlarda: 55% ehtimalla botların, 45% ehtimalla real
 *    istifadəçilərin ehtiyacı olan daş seçilir (hər iki halda uyğun daşlar
 *    arasından random). Uyğun daş yoxdursa tam random.
 */
function pickNextNumber(room, realCards, available) {
  if (!available || !available.length) return null;

  const bots = (room.bots || []).filter((b) => b && b.name);
  // Bot olmayan otaqlar — tam random
  if (!bots.length) return pick(available);

  const drawnSet = new Set((room.drawnNumbers || []).map(Number));
  const availSet = new Set(available.map(Number));

  const favorBots = Math.random() < BOT_FAVOR_CHANCE;

  const botPool  = botsRemaining(bots, drawnSet, availSet);
  const realPool = realRemaining(realCards, drawnSet, availSet);

  const first  = favorBots ? botPool : realPool;
  const second = favorBots ? realPool : botPool;

  if (first.length)  return pick(first);
  if (second.length) return pick(second);
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
  REAL_FAVOR_CHANCE,
  MIN_SEED_BOTS,
  MAX_SEED_BOTS,
  REAL_ONLY_THRESHOLD,
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
