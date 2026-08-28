const Room = require('../models/Room');
const GameCard = require('../models/GameCard');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const WinnerLog = require('../models/WinnerLog');
const bots = require('./botEngine');
const starLeague = require('./starLeague');

const DRAW_INTERVAL_SEC = Number(process.env.GAME_DRAW_INTERVAL_SEC || 5);
const ROUND_DURATION_SEC = Number(process.env.GAME_ROUND_DURATION_SEC || 360);

// Otaq süni oyunçularla dolarkən hər yeni oyunçu arasındakı gözləmə
const BOT_JOIN_STEP_SEC = Number(process.env.GAME_BOT_JOIN_STEP_SEC || 6);

// Botlar real istifadəçini bu qədər saniyə gözləyir; gəlməzsə oyunu özləri başladır
const BOT_WAIT_SEC = Number(process.env.GAME_BOT_WAIT_SEC || 30);

// Raund bitdikdən sonra qalibin göstərilmə (animasiya) müddəti
const REVEAL_SEC = Number(process.env.GAME_REVEAL_SEC || 12);

const MAX_TICKETS = 5;
const MAX_BALL = 90;

// Bütün otaqlar üçün maksimum oyunçu sayı
const START_PLAYERS = 5;
const MAX_PLAYERS = START_PLAYERS;

// Otaqda bu qədər real oyunçu olarsa süni oyunçu ÜMUMİYYƏTLƏ olmur
const REAL_ONLY_THRESHOLD = 3;

// Otaq dolduqdan sonra oyunun başlamasına qədər geri sayım (saniyə)
const START_COUNTDOWN_SEC = Number(process.env.GAME_START_COUNTDOWN_SEC || 5);

// Çıxan daşı biletə qoymaq üçün verilən vaxt (saniyə).
// Bu vaxtdan sonra daş biletdə qırmızı X ilə bloklanır və sayılmır.
const MARK_GRACE_SEC = Number(process.env.GAME_MARK_GRACE_SEC || 12);

// Linya (sıra) uduş faizləri — ortadakı ümumi mərcdən götürülür (2.4% / 4.8% / 7.2%)
const LINE_PERCENTS = [0.08, 0.16, 0.24];

// Otaqdan çıxanda tutulan komissiya (70%) — 30% geri qaytarılır
const LEAVE_COMMISSION = 0.70;

// Köhnə API uyğunluğu
const ROW_WIN_MULTIPLIER = 2;

let loopHandle = null;
let ticking = false;

const DEFAULT_ROOMS = [
  // ✓ ŞƏKILDƏ GÖSTƏRILƏN OYUNLAR
  { name: 'Classic 0.20 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.2, maxPlayers: MAX_PLAYERS, sortOrder: 1, jackpotEnabled: true, starPrize: 20, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 0.40 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.4, maxPlayers: MAX_PLAYERS, sortOrder: 1.5, jackpotEnabled: true, starPrize: 40, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  // ✓ DIGƏR VARIYASYONLAR
  { name: 'Classic 0.50 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 0.5, maxPlayers: MAX_PLAYERS, sortOrder: 2, jackpotEnabled: true, starPrize: 50, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 1.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 1.0, maxPlayers: MAX_PLAYERS, sortOrder: 3, jackpotEnabled: true, starPrize: 100, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 5.00 ₼',  ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 5.0, maxPlayers: MAX_PLAYERS, sortOrder: 4, jackpotEnabled: true, starPrize: 500, prizeMultiplier: 'x2', themeColor: '#1f9b3b' },
  { name: 'Classic 10.00 ₼', ticketLabel: 'TAM BİLET', type: 'classic', entryFee: 10.0, maxPlayers: MAX_PLAYERS, sortOrder: 5, jackpotEnabled: true, starPrize: 1000, prizeMultiplier: 'x2', themeColor: '#1f9b3b' }
];

function flatCardNumbers(card) {
  return (card.numbers || []).flat().filter(Boolean);
}

/** Biletin sıraları (hər sırada 5 rəqəm) */
function cardRows(card) {
  return (card.numbers || []).map((row) => (row || []).filter(Boolean).map(Number)).filter((r) => r.length);
}

/** Biletin işarələnmiş, amma hələ ödənilməmiş tam sıraları */
function newCompletedRows(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  const paid = new Set((card.wonRows || []).map(Number));
  const out = [];
  cardRows(card).forEach((row, index) => {
    if (paid.has(index)) return;
    if (row.every((n) => marks.has(n))) out.push({ index, numbers: row });
  });
  return out;
}

/** Bilet tam doldu (bütün 15 rəqəm işarələnib) */
function isCardFull(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  const nums = flatCardNumbers(card).map(Number);
  return nums.length > 0 && nums.every((n) => marks.has(n));
}

/** Köhnə API: biletdə ən azı bir sıra doludur */
function isCardComplete(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).some((row) => row.every((n) => marks.has(n)));
}

function completedRow(card) {
  const marks = new Set((card.markedNumbers || []).map(Number));
  return cardRows(card).find((row) => row.every((n) => marks.has(n))) || [];
}

function multiplierOf() {
  return ROW_WIN_MULTIPLIER;
}

/** Bir linya uduşunun faizi (1-ci, 2-ci, 3-cü linya) */
function linePercent(lineNo) {
  return LINE_PERCENTS[Math.min(Math.max(1, lineNo), LINE_PERCENTS.length) - 1];
}

/**
 * Linya faizlərinin hesablandığı SABİT bank.
 * Raund boyunca dəyişmir — ödənilən uduşlar bunu azaltmır,
 * yalnız ortadakı canlı bank (room.prize) azalır.
 */
function basePotOf(room) {
  // 2-ci zipdəki mexanizm: linya uduşu ORTADAKI CANLI bankdan hesablanır
  return Number(Math.max(0, Number(room.prize || 0)).toFixed(2));
}

/** Sabit bankdan linya uduşu */
function linePrize(room, lineNo) {
  const pot = basePotOf(room);
  return Number(Math.max(0, pot * linePercent(lineNo)).toFixed(2));
}

/** Göstərilən "bilet uduşu": 1-ci linyanın uduşu */
function ticketPrize(room) {
  return linePrize(room, 1);
}

/** Random 3x9 loto bileti (hər sətirdə 5 rəqəm) */
function generateCardNumbers() {
  const cols = [
    [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
    [50, 59], [60, 69], [70, 79], [80, 90]
  ];
  const card = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
  const used = Array.from({ length: 9 }, () => new Set());

  for (let row = 0; row < 3; row++) {
    const chosen = [];
    while (chosen.length < 5) {
      const c = Math.floor(Math.random() * 9);
      if (!chosen.includes(c)) chosen.push(c);
    }
    chosen.sort((a, b) => a - b);
    for (const c of chosen) {
      const [min, max] = cols[c];
      let value = min;
      do { value = Math.floor(Math.random() * (max - min + 1)) + min; }
      while (used[c].has(value));
      used[c].add(value);
      card[row][c] = value;
    }
  }
  return card;
}

function visiblePlayerCount(room) {
  return (room.players || []).length + ((room.bots || []).length);
}

function realPlayerCount(room) {
  return (room.players || []).length;
}

/** Otağın tutumu: şəxsi otaqlarda seçilən limit, digərlərində 5 */
function capacityOf(room) {
  if (!room) return START_PLAYERS;
  if (room.isCustom) {
    const n = Number(room.maxPlayers || START_PLAYERS);
    return Math.max(2, Math.min(START_PLAYERS, Number.isFinite(n) ? n : START_PLAYERS));
  }
  return START_PLAYERS;
}

/** Otaq dolub — başlamasına neçə saniyə qaldı? (0 = geri sayım yoxdur) */
function startsInSec(room, now = Date.now()) {
  if (!room || room.status !== 'waiting' || !room.nextGameAt) return 0;
  return Math.max(0, Math.ceil((new Date(room.nextGameAt).getTime() - now) / 1000));
}

/** Daşın çıxma vaxtı (yoxdursa null) */
function drawnAtOf(room, number) {
  const list = room.drawnNumbers || [];
  const times = room.drawnAt || [];
  const idx = list.map(Number).lastIndexOf(Number(number));
  if (idx < 0) return null;
  const t = times[idx];
  return t ? new Date(t).getTime() : null;
}

/** Daşı biletə qoymaq olarmı? (çıxıbsa – bəli) */
function canMarkNumber(room, number) {
  // 2-ci zipdəki mexanizm: çıxmış istənilən daş vaxt məhdudiyyəti olmadan qoyula bilər
  const list = (room.drawnNumbers || []).map(Number);
  return list.includes(Number(number));
}

/** Biletdə vaxtında qeyd edilmədiyi üçün bloklanan daşlar */
function missedNumbersFor() {
  // Bloklanan daş yoxdur — heç bir daş vaxta görə itmir
  return [];
}

function getDisplayStatus(room) {
  if (room.status === 'started') return 'started';
  if (room.status === 'ended')   return 'ended';
  if (room.nextGameAt) return 'starting';
  if (visiblePlayerCount(room) >= capacityOf(room)) return 'starting';
  return 'waiting';
}

function getSecsLeft(room, now = Date.now()) {
  if (room.status === 'started' && room.roundEndsAt) {
    return Math.max(0, Math.round((new Date(room.roundEndsAt).getTime() - now) / 1000));
  }
  if (room.status === 'ended' && room.revealAt) {
    return Math.max(0, Math.round((new Date(room.revealAt).getTime() - now) / 1000));
  }
  if (room.status === 'waiting' && room.nextGameAt) return startsInSec(room, now);
  return 0;
}

function slotsLeft(room) {
  return Math.max(0, capacityOf(room) - visiblePlayerCount(room));
}

/** Qalib məlumatı görünə bilərmi? */
function winnerVisible(room) {
  return room.status === 'ended';
}

/** DEFAULT_ROOMS-dan bir otağın "şablon" açarı */
function defaultKeyOf(def) {
  return `${def.type || 'classic'}:${Number(def.entryFee || 0).toFixed(2)}`;
}

/** Şablondan otaq sahələri (DB-dəki otaqla sinxronlaşdırılan hissə) */
function roomShapeOf(def) {
  return {
    name: def.name,
    ticketLabel: def.ticketLabel || 'TAM BİLET',
    type: def.type || 'classic',
    entryFee: Number(def.entryFee || 0),
    starPrize: Number(def.starPrize || 0),
    prizeMultiplier: def.prizeMultiplier || 'x2',
    themeColor: def.themeColor || '#1f9b3b',
    maxPlayers: MAX_PLAYERS,
    jackpotEnabled: def.jackpotEnabled !== false,
    sortOrder: Number(def.sortOrder || 0),
    templateKey: defaultKeyOf(def),
    drawIntervalSec: DRAW_INTERVAL_SEC,
    roundDurationSec: ROUND_DURATION_SEC,
    markGraceSec: MARK_GRACE_SEC
  };
}

/** Otaq boşdur? (silinə bilər) */
async function isRoomRemovable(room) {
  if (!room) return false;
  if (room.status === 'started') return false;
  if ((room.players || []).length) return false;
  const cards = await GameCard.countDocuments({ roomId: room._id, roundId: room.currentRoundId || 1 });
  return cards === 0;
}

/**
 * DEFAULT_ROOMS ilə bazadakı otaqları SİNXRONLAŞDIRIR.
 * Əvvəllər baza boş olmayanda seed tamamilə buraxılırdı — buna görə
 * kodda dəyişdirilən/yeni əlavə edilən otaqlar heç vaxt işə düşmürdü.
 */
async function syncDefaultRooms() {
  const keys = [];

  for (const def of DEFAULT_ROOMS) {
    const key = defaultKeyOf(def);
    keys.push(key);
    const shape = roomShapeOf(def);

    let base = await Room.findOne({ isCustom: { $ne: true }, isClone: { $ne: true }, templateKey: key });
    if (!base) {
      base = await Room.findOne({
        isCustom: { $ne: true },
        isClone: { $ne: true },
        type: shape.type,
        entryFee: shape.entryFee
      });
    }

    if (base) {
      await Room.updateOne({ _id: base._id }, { $set: shape });
    } else {
      await Room.create({
        ...shape,
        status: 'waiting',
        prize: 0,
        jackpot: 0,
        currentRoundId: 1,
        botsEnabled: true,
        isCustom: false,
        isClone: false,
        nextGameAt: null
      });
    }

    // Klon otaqlar da yeni şablona uyğunlaşdırılır (ad istisna olmaqla)
    const cloneShape = { ...shape };
    delete cloneShape.name;
    await Room.updateMany(
      { isCustom: { $ne: true }, isClone: true, templateKey: key },
      { $set: cloneShape }
    );
  }

  // Şablonda olmayan köhnə (şəxsi olmayan) otaqlar — boşdursa silinir
  const stale = await Room.find({ isCustom: { $ne: true }, templateKey: { $nin: keys } });
  for (const r of stale) {
    try {
      if (await isRoomRemovable(r)) await Room.deleteOne({ _id: r._id });
    } catch (e) {
      console.error('syncDefaultRooms cleanup error:', e.message);
    }
  }
}

async function ensureDefaultRooms() {
  // ── Köhnə sənədlər üçün miqrasiyalar ──
  await Room.updateMany(
    { $or: [ { ticketLabel: { $exists: false } }, { starPrize: { $exists: false } }, { prizeMultiplier: { $exists: false } }, { currentRoundId: { $exists: false } } ] },
    {
      $set: {
        ticketLabel: 'TAM BİLET',
        starPrize: 20,
        prizeMultiplier: 'x2',
        themeColor: '#1f9b3b',
        currentRoundId: 1,
        drawIntervalSec: DRAW_INTERVAL_SEC,
        roundDurationSec: ROUND_DURATION_SEC
      }
    }
  );
  await Room.updateMany({ status: { $ne: 'started' } }, { $set: { nextGameAt: null } });
  await Room.updateMany({}, { $set: { maxPlayers: MAX_PLAYERS } });
  await Room.updateMany({ isCustom: true }, { $set: { botsEnabled: false, bots: [], botStake: 0 } });
  await Room.updateMany({ isCustom: { $ne: true } }, { $set: { botsEnabled: true } });
  await Room.updateMany(
    { markGraceSec: { $exists: false } },
    { $set: { markGraceSec: MARK_GRACE_SEC, drawnAt: [], basePot: 0 } }
  );

  // Şəxsi otaqlarda templateKey-i tamamla (save() yox, atomik update)
  const customs = await Room.find({ isCustom: true }).select('_id type entryFee templateKey');
  for (const r of customs) {
    const key = `${r.type || 'classic'}:${Number(r.entryFee || 0).toFixed(2)}`;
    if (r.templateKey !== key) await Room.updateOne({ _id: r._id }, { $set: { templateKey: key } });
  }

  // ── Kodda təyin edilmiş otaqları bazaya tətbiq et ──
  await syncDefaultRooms();
}

/** Otaqda toplanmış ümumi mərc (real + süni oyunçular) */
async function computeStakeTotal(room) {
  const fee = Number(room.entryFee || 0);
  const cardCount = await GameCard.countDocuments({ roomId: room._id, roundId: room.currentRoundId });
  const realStake = Number((fee * cardCount).toFixed(2));
  return Number((realStake + Number(room.botStake || 0)).toFixed(2));
}

async function startRoom(room) {
  room.status = 'started';
  room.startTime = new Date();
  room.roundEndsAt = new Date(Date.now() + (room.roundDurationSec || ROUND_DURATION_SEC) * 1000);
  room.lastDrawAt = null;
  room.currentNumber = null;
  room.drawnNumbers = [];
  room.drawnAt = [];
  room.nextGameAt = null;
  room.botFillAt = null;
  room.botWaitUntil = null;
  room.revealAt = null;
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  room.finalWinnerName = null;
  room.finalWinnerPrize = 0;
  room.finalWinnerNums = [];
  room.finalWinnerMarks = 0;
  room.finalWinnerLines = 0;
  room.finalWinnerFull = false;
  room.roundWinners = [];
  room.lastWinnerName = null;
  room.lastWinnerNums = [];
  bots.finalizeBots(room);
  room.stakeTotal = await computeStakeTotal(room);
  // Linya faizləri raund boyunca dəyişməyən bank üzərindən hesablanır
  room.basePot = Number(Math.max(Number(room.stakeTotal || 0), Number(room.prize || 0)).toFixed(2));
  room.markGraceSec = Number(room.markGraceSec || MARK_GRACE_SEC);
  await safeSave(room);
  // Süni oyunçular da bilet qiymətinə görə ulduz yığır (24 saatlıq liderboard)
  try {
    for (const b of (room.bots || [])) {
      await starLeague.awardBotStars(b.name, room, Number(b.tickets || 1));
    }
  } catch (e) { /* liderboard oyunu dayandırmır */ }
  // Otaq doldu → eyni tipli yeni (boş) otaq açılır
  await ensureSpareRoom(room);
}

async function resetRoomForNextRound(room) {
  room.status = 'waiting';
  room.players = [];
  room.prize = 0;
  room.stakeTotal = 0;
  room.basePot = 0;
  room.drawnNumbers = [];
  room.drawnAt = [];
  room.currentNumber = null;
  room.startTime = null;
  room.roundEndsAt = null;
  room.lastDrawAt = null;
  room.revealAt = null;
  room.botFillAt = null;
  room.botWaitUntil = null;
  room.winnerUser = null;
  room.winnerNums = [];
  room.winnerPrize = 0;
  room.roundWinners = [];
  room.bots = [];
  room.botStake = 0;
  room.markModified('bots');
  room.botWinIntended = false;
  room.currentRoundId = Number(room.currentRoundId || 1) + 1;
  room.nextGameAt = null;
  await safeSave(room);
}

async function logWinner(room, { name, userId, prize, numbers, synthetic }) {
  await new WinnerLog({
    name,
    userId: userId || null,
    roomId: room._id,
    roomName: room.name,
    prize,
    numbers: (numbers || []).slice(0, 5),
    synthetic: !!synthetic
  }).save();
}

/**
 * Real oyunçunun bileti: yeni tam olan hər linya üçün ortadakı mərcdən
 * 8% / 16% / 24% ödənilir. Bilet tam dolduqda oyun DƏRHAL bitir.
 * @returns {{prize:number, lines:number, full:boolean}}
 */
async function settleCard(room, card) {
  const result = { prize: 0, lines: 0, full: false };
  if (!card) return result;

  const pending = newCompletedRows(card);
  if (!pending.length && !(isCardFull(card) && !card.fullCard)) return result;

  const user = await User.findById(card.userId);
  if (!user) return result;

  let total = 0;
  let lastNums = [];
  for (const row of pending) {
    const lineNo = Number(card.lineWins || 0) + 1;
    // Uduş bankda olan məbləğdən çox ola bilməz
    const prize = Number(Math.min(linePrize(room, lineNo), Number(room.prize || 0)).toFixed(2));
    if (prize <= 0) break;
    card.wonRows = [...(card.wonRows || []), row.index];
    card.lineWins = lineNo;
    card.isWinner = true;
    card.prize = Number((Number(card.prize || 0) + prize).toFixed(2));
    card.completedAt = card.completedAt || new Date();
    card.claimedAt = new Date();
    lastNums = row.numbers;
    total += prize;

    room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
    room.winCount = Number(room.winCount || 0) + 1;
    room.roundWinners = [...(room.roundWinners || []), {
      name: user.username, prize, numbers: row.numbers, line: lineNo, isBot: false
    }];
    await logWinner(room, { name: user.username, userId: user._id, prize, numbers: row.numbers, synthetic: false });
  }

  if (total > 0) {
    if (room.type === 'stars') user.stars = Number(user.stars || 0) + total;
    else user.balance = Number(user.balance || 0) + total;
    user.gamesWon = Number(user.gamesWon || 0) + pending.length;
    user.totalWon = Number(user.totalWon || 0) + total;
    await user.save();

    if (room.type !== 'stars') {
      await new Transaction({
        userId: user._id,
        type: 'win',
        amount: Number(total.toFixed(2)),
        status: 'completed',
        note: `${room.name} otağında linya uduşu`
      }).save();
    }
  }

  if (isCardFull(card) && !card.fullCard) {
    card.fullCard = true;
    card.fullAt = new Date();
    result.full = true;
  }

  await card.save();
  room.markModified('roundWinners');
  await safeSave(room);

  result.prize = Number(total.toFixed(2));
  result.lines = pending.length;
  return result;
}

/** Süni oyunçunun linya uduşu */
async function settleBotLines(room, bot, rows) {
  for (const row of rows) {
    const lineNo = Number(bot.lineWins || 0) + 1;
    const prize = Number(Math.min(linePrize(room, lineNo), Number(room.prize || 0)).toFixed(2));
    if (prize <= 0) break;
    bot.wonRows = [...(bot.wonRows || []), row.key];
    bot.lineWins = lineNo;
    bot.isWinner = true;
    bot.prize = Number((Number(bot.prize || 0) + prize).toFixed(2));

    room.prize = Number(Math.max(0, Number(room.prize || 0) - prize).toFixed(2));
    room.winCount = Number(room.winCount || 0) + 1;
    room.roundWinners = [...(room.roundWinners || []), {
      name: bot.name, prize, numbers: row.numbers, line: lineNo, isBot: true
    }];
    await logWinner(room, { name: bot.name, prize, numbers: row.numbers, synthetic: true });
  }
  room.markModified('roundWinners');
  room.markModified('bots');
  await safeSave(room);
}

async function maybeFinishRound() {
  return false;
}

/** İstifadəçinin biletlərini yoxlayır və linya uduşlarını ödəyir */
async function claimRoomWin(roomId, userId, cardId = null) {
  const room = await Room.findById(roomId);
  if (!room || room.status !== 'started') return { won: false, prize: 0, full: false, lines: 0 };

  const query = { roomId: room._id, userId, roundId: room.currentRoundId };
  if (cardId) query._id = cardId;

  const cards = await GameCard.find(query);
  let total = 0;
  let lines = 0;
  let full = false;
  let fullCard = null;
  for (const card of cards) {
    const res = await settleCard(room, card);
    total += res.prize;
    lines += res.lines;
    if (res.full) { full = true; fullCard = card; }
  }

  if (full && fullCard) {
    const user = await User.findById(userId);
    await finishRound(room, {
      name: user ? user.username : 'Oyunçu',
      userId,
      isBot: false,
      marks: (fullCard.markedNumbers || []).length,
      lines: Number(fullCard.lineWins || 3),
      nums: flatCardNumbers(fullCard).slice(0, 5),
      full: true
    });
  }

  return { won: total > 0 || full, prize: Number(total.toFixed(2)), lines, full };
}

async function drawNextNumber(room) {
  const drawn = new Set((room.drawnNumbers || []).map(Number));
  const available = [];
  for (let i = 1; i <= MAX_BALL; i++) {
    if (!drawn.has(i)) available.push(i);
  }
  if (!available.length) return;

  let next = null;
  if ((room.bots || []).length) {
    const realCards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
    next = bots.pickNextNumber(room, realCards, available);
  }
  // Real istifadəçilər üçün tam random
  if (!next) next = available[Math.floor(Math.random() * available.length)];

  room.drawnNumbers.push(next);
  room.drawnAt = [...(room.drawnAt || []), new Date()];
  room.currentNumber = next;
  room.lastDrawAt = new Date();

  const events = bots.applyDrawToBots(room, next);
  await safeSave(room);

  for (const ev of events) {
    if (ev.rows && ev.rows.length) await settleBotLines(room, ev.bot, ev.rows);
  }
  const fullEvent = events.find((e) => e.fullCard);
  if (fullEvent) {
    fullEvent.bot.fullCard = true;
    room.markModified('bots');
    await safeSave(room);
    await finishRound(room, {
      name: fullEvent.bot.name,
      userId: null,
      isBot: true,
      marks: (fullEvent.bot.marked || []).length,
      lines: Number(fullEvent.bot.lineWins || 3),
      nums: (fullEvent.bot.marked || []).slice(0, 5),
      full: true
    });
  }
}

/** İştirakçıların doldurduğu linya / daş sayına görə cədvəl */
async function markLeaderboard(room) {
  const rows = [];

  const cards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
  const byUser = new Map();
  for (const c of cards) {
    const key = String(c.userId);
    const prev = byUser.get(key) || { marks: 0, lines: 0, nums: [] };
    prev.marks += (c.markedNumbers || []).length;
    prev.lines += Number(c.lineWins || 0);
    prev.nums = prev.nums.concat((c.markedNumbers || []).map(Number));
    byUser.set(key, prev);
  }
  const users = await User.find({ _id: { $in: [...byUser.keys()] } }).select('username');
  for (const u of users) {
    const info = byUser.get(String(u._id));
    rows.push({ name: u.username, userId: u._id, marks: info.marks, lines: info.lines, nums: info.nums, isBot: false });
  }

  for (const b of (room.bots || [])) {
    rows.push({
      name: b.name, userId: null,
      marks: (b.marked || []).length,
      lines: Number(b.lineWins || 0),
      nums: (b.marked || []).map(Number),
      isBot: true
    });
  }

  rows.sort((a, b) => (b.lines - a.lines) || (b.marks - a.marks));
  return rows;
}

/**
 * Raund bitir:
 *  - biletin hamısını ilk dolduran varsa dərhal (override ilə),
 *  - əks halda vaxt bitdikdə ən çox linya dolduran qalib olur.
 */
async function finishRound(room, override = null) {
  if (room.status === 'ended') return;

  let leader = override;
  if (!leader) {
    const board = await markLeaderboard(room);
    leader = board.find((r) => r.lines > 0 || r.marks > 0) || board[0] || null;
  }

  const pot = Number(Number(room.prize || 0).toFixed(2));
  let prize = 0;

  if (leader && pot > 0) {
    prize = pot;
    if (!leader.isBot && leader.userId) {
      const user = await User.findById(leader.userId);
      if (user) {
        if (room.type === 'stars') user.stars = Number(user.stars || 0) + prize;
        else user.balance = Number(user.balance || 0) + prize;
        user.gamesWon = Number(user.gamesWon || 0) + 1;
        user.totalWon = Number(user.totalWon || 0) + prize;
        await user.save();

        if (room.type !== 'stars') {
          await new Transaction({
            userId: user._id,
            type: 'win',
            amount: prize,
            status: 'completed',
            note: `${room.name} otağının əsas uduşu`
          }).save();
        }
      }
    }
    await logWinner(room, {
      name: leader.name,
      userId: leader.isBot ? null : leader.userId,
      prize,
      numbers: leader.nums || [],
      synthetic: !!leader.isBot
    });
    room.prize = 0;
    if (room.jackpotEnabled) room.jackpot = 0;
  }

  room.status = 'ended';
  room.revealAt = new Date(Date.now() + REVEAL_SEC * 1000);
  room.currentNumber = null;
  room.finalWinnerName = leader ? leader.name : null;
  room.finalWinnerPrize = Number(prize.toFixed(2));
  room.finalWinnerNums = leader ? (leader.nums || []).slice(0, 5) : [];
  room.finalWinnerMarks = leader ? Number(leader.marks || 0) : 0;
  room.finalWinnerLines = leader ? Number(leader.lines || 0) : 0;
  room.finalWinnerFull = !!(leader && leader.full);
  room.winnerUser = leader && !leader.isBot ? leader.userId : null;
  room.winnerNums = room.finalWinnerNums;
  room.winnerPrize = room.finalWinnerPrize;
  room.lastWinnerName = room.finalWinnerName;
  room.lastWinnerNums = room.finalWinnerNums;
  await safeSave(room);
}

/**
 * Otağı təhlükəsiz yadda saxlayır.
 * Paralel deploy/işçi prosesləri eyni sənədi dəyişəndə mongoose VersionError
 * atır ("No matching document found for id ... version ..."). Bu, bütün tick
 * dövrünü dayandırırdı və növbəti (yeni) otaqlar heç vaxt işlənmirdi.
 */
async function safeSave(doc) {
  if (!doc) return false;
  try {
    await doc.save();
    return true;
  } catch (e) {
    const name = e && e.name;
    if (name === 'VersionError' || name === 'DocumentNotFoundError') {
      // Sənəd silinib və ya başqa proses tərəfindən yenilənib — bu tick buraxılır
      return false;
    }
    throw e;
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const rooms = await Room.find({}).sort({ sortOrder: 1, createdAt: 1 });
    const now = Date.now();

    for (const room of rooms) {
     try {
      // ── Oyun gedir ──
      if (room.status === 'started') {
        const roundEndsAt = room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0;
        if (roundEndsAt && roundEndsAt <= now) {
          await finishRound(room);
          continue;
        }
        const lastDrawAt = room.lastDrawAt ? new Date(room.lastDrawAt).getTime() : 0;
        const interval = Number(room.drawIntervalSec || DRAW_INTERVAL_SEC) * 1000;
        if (!lastDrawAt || now - lastDrawAt >= interval) {
          await drawNextNumber(room);
        }
        continue;
      }

      // ── Qalib göstərilir ──
      if (room.status === 'ended') {
        const revealAt = room.revealAt ? new Date(room.revealAt).getTime() : 0;
        if (!revealAt || revealAt <= now) {
          await resetRoomForNextRound(room);
        }
        continue;
      }

      // ── Gözləmə ──
      const cap = capacityOf(room);
      const reals = realPlayerCount(room);

      // Otaq doldu → 5 saniyəlik geri sayım, sonra oyun avtomatik başlayır
      if (visiblePlayerCount(room) >= cap) {
        if (!room.nextGameAt) {
          room.nextGameAt = new Date(now + START_COUNTDOWN_SEC * 1000);
          await safeSave(room);
          continue;
        }
        if (new Date(room.nextGameAt).getTime() <= now) await startRoom(room);
        continue;
      }
      if (room.nextGameAt) { room.nextGameAt = null; await safeSave(room); }

      // Klon otaqlar real oyunçu gəlməyincə boş qalır
      const canBots = bots.allowBots(room, cap) && (!room.isClone || reals > 0);

      if (!canBots) {
        // Şəxsi otaq / 3+ real oyunçu / boş klon otaq: yalnız real oyunçular
        if ((room.bots || []).length) { bots.clearBots(room); await safeSave(room); }
        if (!room.isCustom && reals >= 2) {
          if (!room.botFillAt) { room.botFillAt = new Date(now + 30000); await safeSave(room); continue; }
          if (new Date(room.botFillAt).getTime() <= now) { await startRoom(room); continue; }
        } else if (room.botFillAt) {
          room.botFillAt = null;
  room.botWaitUntil = null;
          await safeSave(room);
        }
        await cleanupSpareRooms(room);
        continue;
      }

      // Real oyunçular üçün yer aç
      let changed = bots.makeRoomForReal(room, cap);

      // Ana səhifədə otaq 3-4 süni oyunçu ilə gözləyir
      if (!(room.bots || []).length && bots.seedBots(room, generateCardNumbers, cap)) {
        changed = true;
        room.botWaitUntil = new Date(now + BOT_WAIT_SEC * 1000);
      }

      if (reals > 0) {
        // Real istifadəçi gəldi → gözləmə ləğv olunur, otaq tədricən dolur
        if (room.botWaitUntil) { room.botWaitUntil = null; changed = true; }
        if (!room.botFillAt) {
          room.botFillAt = new Date(now + BOT_JOIN_STEP_SEC * 1000);
          changed = true;
        } else if (new Date(room.botFillAt).getTime() <= now) {
          if (bots.addOneBot(room, generateCardNumbers, cap)) changed = true;
          room.botFillAt = new Date(now + BOT_JOIN_STEP_SEC * 1000);
          changed = true;
        }
      } else {
        // Real istifadəçi yoxdur: 30 saniyə gözlənilir
        if (!room.botWaitUntil) {
          room.botWaitUntil = new Date(now + BOT_WAIT_SEC * 1000);
          changed = true;
        } else if (new Date(room.botWaitUntil).getTime() <= now) {
          // 30 saniyə içərisində real istifadəçi gəlmədi →
          // süni oyunçular 5-ə çatır və oyunu öz aralarında başladırlar
          let guard = 0;
          while (visiblePlayerCount(room) < cap && guard++ < 10) {
            if (!bots.addOneBot(room, generateCardNumbers, cap)) break;
          }
          room.botWaitUntil = null;
          room.botFillAt = null;
          await safeSave(room);
          await startRoom(room);
          continue;
        }
      }

      if (changed) await safeSave(room);
      await cleanupSpareRooms(room);
     } catch (err) {
       // Bir otağın xətası digər otaqları dayandırmamalıdır
       console.error(`Room tick error (${room && room.name}):`, err && err.message);
     }
    }
  } finally {
    ticking = false;
  }
}

/** Otağın "şablon" açarı — eyni tipli otaqları qruplaşdırmaq üçün */
function templateKeyOf(room) {
  if (room.templateKey) return room.templateKey;
  return `${room.type || 'classic'}:${Number(room.entryFee || 0).toFixed(2)}`;
}

/** Bu şablon üzrə hazırda qoşula bilən (gözləyən və dolu olmayan) otaqlar */
async function openRoomsFor(room) {
  const key = templateKeyOf(room);
  const list = await Room.find({
    isCustom: { $ne: true },
    status: 'waiting',
    $or: [{ templateKey: key }, { entryFee: Number(room.entryFee || 0), type: room.type || 'classic' }]
  }).sort({ isClone: 1, sortOrder: 1, createdAt: 1 });
  return list.filter((r) => realPlayerCount(r) < START_PLAYERS && visiblePlayerCount(r) < START_PLAYERS);
}

const MAX_ROOMS_PER_TEMPLATE = 6;

/**
 * Otaq dolduqda / oyun başlayanda eyni mərcli YENİ boş otaq açır.
 * Yeni otaq 0 oyunçu ilə başlayır və gedən oyuna heç kim daxil ola bilmir.
 */
async function ensureSpareRoom(room) {
  try {
    if (!room || room.isCustom) return null;
    const key = templateKeyOf(room);
    if (!room.templateKey) { room.templateKey = key; await safeSave(room); }

    const siblings = await Room.find({
      isCustom: { $ne: true },
      $or: [{ templateKey: key }, { entryFee: Number(room.entryFee || 0), type: room.type || 'classic' }]
    });
    const openOnes = siblings.filter((r) => r.status === 'waiting' && visiblePlayerCount(r) < START_PLAYERS);
    if (openOnes.length) return null;
    if (siblings.length >= MAX_ROOMS_PER_TEMPLATE) return null;

    const baseName = String(room.name || 'Otaq').replace(/\s*#\d+$/, '');
    const clone = await new Room({
      name: `${baseName} #${siblings.length + 1}`,
      ticketLabel: room.ticketLabel || 'TAM BİLET',
      type: room.type || 'classic',
      status: 'waiting',
      entryFee: Number(room.entryFee || 0),
      starPrize: Number(room.starPrize || 0),
      prizeMultiplier: room.prizeMultiplier || 'x2',
      themeColor: room.themeColor || '#1f9b3b',
      maxPlayers: MAX_PLAYERS,
      jackpotEnabled: !!room.jackpotEnabled,
      sortOrder: Number(room.sortOrder || 0),
      currentRoundId: 1,
      drawIntervalSec: Number(room.drawIntervalSec || DRAW_INTERVAL_SEC),
      roundDurationSec: Number(room.roundDurationSec || ROUND_DURATION_SEC),
      markGraceSec: Number(room.markGraceSec || MARK_GRACE_SEC),
      botsEnabled: room.botsEnabled !== false,
      isClone: true,
      templateKey: key,
      nextGameAt: null
    }).save();
    return clone;
  } catch (e) {
    console.error('ensureSpareRoom error:', e.message);
    return null;
  }
}

/** Artıq lazım olmayan boş klon otaqları silir (bir dənə ehtiyat otaq saxlanılır) */
async function cleanupSpareRooms(room) {
  try {
    if (!room || room.isCustom) return;
    const key = templateKeyOf(room);
    const clones = await Room.find({ isClone: true, templateKey: key, status: 'waiting' }).sort({ createdAt: 1 });
    const idle = clones.filter((r) => !realPlayerCount(r) && !(r.bots || []).length);
    // ən köhnə boş klonu ehtiyat kimi saxla, qalanlarını sil
    for (const extra of idle.slice(1)) {
      const cards = await GameCard.countDocuments({ roomId: extra._id });
      if (!cards) await Room.deleteOne({ _id: extra._id });
    }
  } catch (e) {
    console.error('cleanupSpareRooms error:', e.message);
  }
}

/**
 * İstifadəçini gedən oyuna yox, uyğun BOŞ otağa yönləndirmək üçün.
 * @returns {Room|null}
 */
async function findJoinableRoom(room) {
  if (!room || room.isCustom) return null;
  const open = await openRoomsFor(room);
  const found = open.find((r) => String(r._id) !== String(room._id)) || open[0] || null;
  if (found) return found;
  return await ensureSpareRoom(room);
}

function startGameLoop() {
  if (loopHandle) return;
  loopHandle = setInterval(() => {
    tick().catch((err) => console.error('Game engine tick error:', err.message));
  }, 1500);
  setTimeout(() => {
    tick().catch((err) => console.error('Game engine boot error:', err.message));
  }, 800);
}

/** Otaqdakı bütün oyunçular və mərcləri */
async function roomRoster(room) {
  const fee = Number(room.entryFee || 0);
  const out = [];

  const users = await User.find({ _id: { $in: room.players || [] } }).select('username');
  for (const u of users) {
    const cards = await GameCard.find({ userId: u._id, roomId: room._id, roundId: room.currentRoundId }).select('markedNumbers lineWins');
    const tickets = cards.length || 1;
    out.push({
      name: u.username,
      tickets,
      stake: Number((fee * tickets).toFixed(2)),
      marked: cards.reduce((s, c) => s + (c.markedNumbers || []).length, 0),
      lines: cards.reduce((s, c) => s + Number(c.lineWins || 0), 0)
    });
  }

  bots.botRoster(room).forEach((b) => out.push({ name: b.name, tickets: b.tickets, stake: b.stake, marked: b.marked, lines: b.lines }));
  out.sort((a, b) => b.stake - a.stake);
  return out;
}

/** Otaqda qoyulan ümumi mərc (görünən) */
function totalStake(room) {
  const stored = Number(room.stakeTotal || 0);
  const pot = Number(room.prize || 0);
  return Number(Math.max(stored, pot).toFixed(2));
}

module.exports = {
  MAX_BALL,
  MAX_TICKETS,
  START_PLAYERS,
  MAX_PLAYERS,
  REAL_ONLY_THRESHOLD,
  MARK_GRACE_SEC,
  START_COUNTDOWN_SEC,
  capacityOf,
  startsInSec,
  LINE_PERCENTS,
  LEAVE_COMMISSION,
  ROW_WIN_MULTIPLIER,
  DRAW_INTERVAL_SEC,
  ROUND_DURATION_SEC,
  REVEAL_SEC,
  ensureDefaultRooms,
  startGameLoop,
  tick,
  startRoom,
  drawNextNumber,
  roomRoster,
  totalStake,
  computeStakeTotal,
  winnerVisible,
  slotsLeft,
  getDisplayStatus,
  getSecsLeft,
  flatCardNumbers,
  cardRows,
  completedRow,
  newCompletedRows,
  isCardFull,
  isCardComplete,
  claimRoomWin,
  settleCard,
  maybeFinishRound,
  finishRound,
  markLeaderboard,
  resetRoomForNextRound,
  generateCardNumbers,
  ticketPrize,
  linePrize,
  linePercent,
  basePotOf,
  canMarkNumber,
  missedNumbersFor,
  drawnAtOf,
  ensureSpareRoom,
  cleanupSpareRooms,
  findJoinableRoom,
  openRoomsFor,
  templateKeyOf,
  multiplierOf,
  visiblePlayerCount,
  realPlayerCount,
  botEngine: bots
};
