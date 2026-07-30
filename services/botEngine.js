// services/botEngine.js
// Otaqlarda süni oyunçular üçün məntiq.
//
// Qaydalar:
//  1) Otaqda 3 və ya daha çox REAL istifadəçi varsa — yalnız real istifadəçilər oynayır.
//  2) 3-dən az real istifadəçi varsa — otağa əlavə oyunçular qoşulur və normal oyun gedir.
//  3) Belə raundlarda qazanma şansı: 80% süni oyunçu, 20% real istifadəçi.
//  4) Oyunçular otaqlara random şəkildə girib-çıxır, mərcləri ümumi banka daxil olur.

const BOT_NAMES = [
  'Elvin_07', 'Nigar__', 'Rashad.M', 'AynurX', 'Tural99', 'Leyla_ist',
  'Kamran7', 'SebineN', 'OrxanZ', 'GunelM', 'Ferid_25', 'Ulviyye',
  'Samir.A', 'Nurlan__', 'Aysel19', 'Emil_Baku', 'Zaur55', 'Lamiye_',
  'Vusal.K', 'Sevinc__', 'Anar_92', 'Xatire.M', 'Ilkin7', 'Turkan_',
  'Ramin__', 'Gunay.S', 'Elnur55', 'Nezrin_', 'Fuad.A', 'Aytac__'
];

const REAL_PLAYER_LIMIT = 3;   // bu qədər (və daha çox) real oyunçu varsa süni oyunçu olmur
const BOT_WIN_CHANCE = 0.8;    // 80% / 20%
const MAX_TICKETS_PER_BOT = 3;

const JOIN_CHANCE = 0.35;      // gözləmə anında yeni oyunçu qoşulma şansı
const LEAVE_CHANCE = 0.22;     // gözləmə anında oyunçunun çıxma şansı

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

/** Bu otaqda süni oyunçu ola bilərmi? */
function shouldHaveBots(room) {
  if (room.botsEnabled === false) return false;
  return realPlayerCount(room) < REAL_PLAYER_LIMIT;
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
    joinedAt: new Date()
  };
}

/** Otağın bank məbləğini real + süni oyunçuların mərcinə görə yenilə */
function recalcBotStake(room) {
  const total = (room.bots || []).reduce((sum, b) => sum + Number(b.stake || 0), 0);
  const prev = Number(room.botStake || 0);
  room.botStake = Number(total.toFixed(2));
  room.prize = Number(Math.max(0, Number(room.prize || 0) - prev + room.botStake).toFixed(2));
  if (room.jackpotEnabled) {
    room.jackpot = Number(Math.max(0, Number(room.jackpot || 0) - prev + room.botStake).toFixed(2));
  }
}

function botCapacity(room) {
  return Math.max(0, Number(room.maxPlayers || 10) - realPlayerCount(room));
}

/**
 * Gözləmə mərhələsində oyunçuların random girib-çıxması.
 * Hər tick-də çağırılır; dəyişiklik olubsa true qaytarır.
 */
function driftBots(room, generateCardNumbers) {
  if (!shouldHaveBots(room)) {
    if ((room.bots || []).length) {
      room.bots = [];
      recalcBotStake(room);
      room.markModified('bots');
      return true;
    }
    return false;
  }

  const capacity = botCapacity(room);
  if (capacity <= 0) return false;

  let changed = false;
  const list = room.bots || [];

  // çıxış
  if (list.length > 0 && Math.random() < LEAVE_CHANCE) {
    list.splice(rnd(list.length), 1);
    changed = true;
  }

  // giriş
  if (list.length < capacity && Math.random() < JOIN_CHANCE) {
    const used = list.map((b) => b.name);
    const name = pickBotNames(1, used)[0];
    if (name) {
      list.push(createBot(room, name, generateCardNumbers));
      changed = true;
    }
  }

  if (changed) {
    room.bots = list;
    recalcBotStake(room);
    room.markModified('bots');
  }
  return changed;
}

/**
 * Raund başlamazdan əvvəl heyəti yekunlaşdırır.
 */
function syncBots(room, generateCardNumbers) {
  if (!shouldHaveBots(room)) {
    room.bots = [];
    room.botWinIntended = false;
    recalcBotStake(room);
    return room;
  }

  const capacity = botCapacity(room);
  if (capacity <= 0) {
    room.bots = [];
    room.botWinIntended = false;
    recalcBotStake(room);
    return room;
  }

  const list = (room.bots || []).filter((b) => b && b.name);

  // ən azı 2 oyunçu olsun
  let target = Math.min(capacity, Math.max(2, list.length, 2 + rnd(4)));
  if (list.length > target) list.length = target;

  const names = pickBotNames(target - list.length, list.map((b) => b.name));
  names.forEach((name) => list.push(createBot(room, name, generateCardNumbers)));

  // hər raundda biletlər yenilənir
  room.bots = list.map((b) => {
    const tickets = Number(b.tickets || 1);
    const cards = Array.from({ length: tickets }, () => generateCardNumbers());
    return {
      name: b.name,
      numbers: cards[0],
      cards,
      tickets,
      stake: Number((Number(room.entryFee || 0) * tickets).toFixed(2)),
      marked: [],
      isWinner: false,
      joinedAt: b.joinedAt || new Date()
    };
  });

  recalcBotStake(room);
  room.markModified('bots');

  // 80% süni oyunçu qazanır, 20% real istifadəçiyə şans verilir
  room.botWinIntended = Math.random() < BOT_WIN_CHANCE;
  return room;
}

/** Bir oyunçunun bütün biletlərinin rəqəmləri */
function botNumbers(bot) {
  if (Array.isArray(bot.cards) && bot.cards.length) return flat(bot.cards);
  return flat(bot.numbers);
}

/** Bir botun hələ çıxmamış rəqəmləri (ən yaxın biletinə görə) */
function botRemaining(bot, drawnSet) {
  const cards = (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
  let best = null;
  for (const card of cards) {
    const rem = flat(card).filter((n) => !drawnSet.has(n));
    if (!best || rem.length < best.length) best = rem;
  }
  return best || [];
}

/**
 * Növbəti daşı seçir. Nəticə 80/20 qaydasına uyğun yönləndirilir.
 * Çıxmış daş təkrar seçilmir (`available` artıq süzülmüş gəlir).
 */
function pickNextNumber(room, realCards, available) {
  if (!available.length) return null;
  const bots = room.bots || [];
  if (!bots.length) return pick(available);

  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

  // Lider oyunçu — ən az rəqəmi qalan
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

  // 20% hal: real istifadəçiyə şans veririk
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
 * Çıxan daşı oyunçuların biletlərinə işarələyir.
 * @returns {object|null} biletini tam dolduran oyunçu
 */
function applyDrawToBots(room, number) {
  const bots = room.bots || [];
  if (!bots.length) return null;
  const drawnSet = new Set((room.drawnNumbers || []).map(Number));

  let winner = null;
  for (const bot of bots) {
    if (bot.isWinner) continue;
    const nums = botNumbers(bot);
    if (nums.includes(Number(number))) {
      const marks = new Set((bot.marked || []).map(Number));
      marks.add(Number(number));
      bot.marked = [...marks].sort((a, b) => a - b);
    }
    const cards = (Array.isArray(bot.cards) && bot.cards.length) ? bot.cards : [bot.numbers];
    const done = cards.some((card) => {
      const cn = flat(card);
      return cn.length && cn.every((n) => drawnSet.has(n));
    });
    if (done) {
      bot.isWinner = true;
      if (!winner) winner = bot;
    }
  }
  room.markModified('bots');
  return winner;
}

/** Otaqda görünən oyunçu siyahısı (real + süni, fərq bildirilmir) */
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
  REAL_PLAYER_LIMIT,
  BOT_WIN_CHANCE,
  realPlayerCount,
  shouldHaveBots,
  syncBots,
  driftBots,
  recalcBotStake,
  botRoster,
  pickNextNumber,
  applyDrawToBots
};
