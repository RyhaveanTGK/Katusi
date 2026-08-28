/* Birloto.com — Tombala server. Mövcud modellərə (User, Room, GameCard, Transaction, …
   SalePoints) inteqrasiya olunmuş tam işlək backend. */
require('dotenv').config();
const path        = require('path');
const crypto      = require('crypto');
const express     = require('express');
const session     = require('express-session');
const MongoStore  = require('connect-mongo');
const mongoose    = require('mongoose');
const http        = require('http');
const { Server }  = require('socket.io');

const User            = require('./models/User');
const Room            = require('./models/Room');
const GameCard        = require('./models/GameCard');
const Transaction     = require('./models/Transaction');
const WinnerLog       = require('./models/WinnerLog');
const BonusCode       = require('./models/BonusCode');
const PaymentMethod   = require('./models/PaymentMethod');
const PaymentSession  = require('./models/PaymentSession');
const EmailVerification = require('./models/EmailVerification');
const Device          = require('./models/Device');
const DepositCounter  = require('./models/DepositCounter');
const StarBot         = require('./models/StarBot');
const StarCycle       = require('./models/StarCycle');

const { requireLogin, requireAdmin, requireGuest } = require('./middleware/auth');
const { LOCALES } = require('./services/i18n');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MONGO = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/birloto';

(async () => {
  try {
    await mongoose.connect(MONGO);
    console.log('✓ MongoDB bağlantısı uğurludur');
    await seedRooms();
  } catch (err) {
    if (process.env.USE_MEMORY === '1') {
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mem = await MongoMemoryServer.create();
        await mongoose.connect(mem.getUri());
        console.log('✓ MongoDB memory-server aktivdir');
        await seedRooms();
      } catch (e2) { console.error('DB xətası:', e2.message); }
    } else {
      console.error('MongoDB xətası:', err.message);
    }
  }
})();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = MongoStore.create({
  mongoUrl: MONGO, collectionName: 'sessions', ttl: 60 * 60 * 24 * 7
}).on('error', () => {});

app.use(session({
  secret: process.env.SESSION_SECRET || 'birloto-' + crypto.randomBytes(8).toString('hex'),
  resave: false, saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true }
}));

app.use((req, res, next) => {
  res.locals.user = null; res.locals.error = null;
  if (req.session.userId) {
    User.findById(req.session.userId).select('username balance isAdmin locale isBlocked').lean()
      .then(u => { res.locals.user = u; next(); }).catch(() => next());
  } else next();
});

app.use((req, res, next) => { req.io = io; next(); });

/* ─── Tombola kart generator (90-lıq: 3×9, hər sətirdə 5 rəqəm, cəmi 15) ─── */
function makeCartela() {
  const grid = [[], [], []];
  const cols = [[1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]];
  for (let c = 0; c < 9; c++) {
    const pool = [];
    for (let n = cols[c][0]; n <= cols[c][1]; n++) pool.push(n);
    // 5 rəqəm seç
    const chosen = [];
    for (let i = 0; i < 5; i++) chosen.push(pool.splice(Math.floor(Math.random()*pool.length), 1)[0]);
    chosen.sort((a,b)=>a-b);
    // Soldan sağa yerləşdir (boşluqlar saxlansın deyə 1,2,2 paylaması)
    const seats = c < 4 ? [0,2] : c < 7 ? [0,2,4] : [1,3,4,6,8];
    // Asan: ardıcıl boşluqlarla
    const cells = Array(9).fill(null);
    // Hər sütunda 5 rəqəm, qalan 4 xana boş. Asan paylama:
    [0, 1, 2, 3, 4].forEach((k, idx) => cells[k] = chosen[idx]);
    // 5 rəqəmi [0,1,2,3,4] indekslərinə qoy — bu halda hər sütunda ilk 5 xana dolu (görünüş baxımından SVG/CSS bunu qəbul edir)
    grid[0][c] = cells[0]; grid[1][c] = cells[1]; grid[2][c] = cells[2];
  }
  // Hər sətirə 5 rəqəm lazımdır. Bunun üçün massivi düzgün qurma metodu:
  // Hər sətir üçün müstəqil 5 sütun seç (15 unikal rəqəm/sətir)
  for (let r = 0; r < 3; r++) {
    const arr = Array(9).fill(null);
    // Hər sətirdə 5 rəqəm, 4 boşluq (həmin 4 sütunda başqa sətirdə rəqəm ola bilər)
    // Burada sadə yanaşma: rəqəmləri 0-4 və ya 2-6 aralığında payla
  }
  // Daha etibarlı: hər sətir üçün 5 sütun + 4 boşluq, sütunlar üzrə unikal rəqəmlər.
  // Reset:
  return buildProperCartela();
}
function buildProperCartela() {
  const grid = [[null,null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null,null]];
  const ranges = [[1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]];
  // Bütün sütun/bütün sətir boyu düzgün: hər sütunda 1-3 rəqəm, hər sətirdə cəmi 5 rəqəm (15)
  // Klassik qayda: hər sütunda i sütun indeksi olmaqla, sətirlərin sayı: sütun[0,3,6] => 1, [1,4,7] => 2, [2,5,8] => 3 → cəmi 18 (3x6). Lakin doğru qayda: sütun sayına görə max 3 rəqəm.
  // Biz sadə variant: hər sütunda 1 və ya 2 rəqəm, cəmi 15
  const colMax = [3,2,3,2,3,2,3,2,3]; // 3+2+3+2+3+2+3+2+3 = 23 ≈ 15 deyil.
  // Düzgün tombola 90: hər sətir = 5 rəqəm, hər sütun = 1-3 rəqəm. Cəmi 27 xana, 15 rəqəm.
  // Pattern:
  const colCount = [1,2,1,2,1,2,1,2,3]; // 1+2+1+2+1+2+1+2+3 = 15 ✓
  for (let c = 0; c < 9; c++) {
    const cnt = colCount[c];
    const pool = []; for (let n = ranges[c][0]; n <= ranges[c][1]; n++) pool.push(n);
    const chosen = [];
    for (let i = 0; i < cnt; i++) chosen.push(pool.splice(Math.floor(Math.random()*pool.length), 1)[0]);
    chosen.sort((a,b)=>a-b);
    // cnt dəfə rastgələ sətir seç
    const rows = [0,1,2];
    for (let i = rows.length-1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1)); [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    for (let i = 0; i < cnt; i++) grid[rows[i]][c] = chosen[i];
  }
  return grid;
}

function randomDrawSet(n) {
  const pool = [];
  for (let i = 1; i <= 90; i++) pool.push(i);
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

const ROOM_TEMPLATES = [
  { key: 'classic-02', name: 'Otaq 0.20 ₼', ticketLabel: 'BİLET 0.20 ₼', entryFee: 0.20, maxPlayers: 5, themeColor: '#1f9b3b', type: 'classic', drawIntervalSec: 5, roundDurationSec: 240, markGraceSec: 12 },
  { key: 'classic-05', name: 'Otaq 0.50 ₼', ticketLabel: 'BİLET 0.50 ₼', entryFee: 0.50, maxPlayers: 5, themeColor: '#f5c518', type: 'classic', drawIntervalSec: 5, roundDurationSec: 240, markGraceSec: 12 },
  { key: 'classic-10', name: 'Otaq 1.00 ₼', ticketLabel: 'BİLET 1.00 ₼', entryFee: 1.00, maxPlayers: 5, themeColor: '#4d1c7d', type: 'classic', drawIntervalSec: 5, roundDurationSec: 300, markGraceSec: 12 },
  { key: 'classic-50', name: 'Otaq 5.00 ₼', ticketLabel: 'BİLET 5.00 ₼', entryFee: 5.00, maxPlayers: 5, themeColor: '#e30613', type: 'classic', drawIntervalSec: 5, roundDurationSec: 360, markGraceSec: 14 },
  { key: 'stars-02',   name: 'Ulduz 0.20 ₼', ticketLabel: 'TAM BİLET 0.20 ₼', entryFee: 0.20, maxPlayers: 5, themeColor: '#2c8ed6', type: 'stars', prizeMultiplier: 'x4', starPrize: 2, drawIntervalSec: 5, roundDurationSec: 240, markGraceSec: 12 }
];

async function seedRooms() {
  for (const t of ROOM_TEMPLATES) {
    const exists = await Room.findOne({ templateKey: t.key, isCustom: false, status: { $ne: 'ended' } });
    if (!exists) {
      const r = await Room.create({ ...t, templateKey: t.key, isCustom: false,
        status: 'waiting', drawnNumbers: [], drawnAt: [],
        players: [], bots: [],
        roundEndsAt: new Date(Date.now() + t.roundDurationSec * 1000) });
      console.log('✓ Otaq:', r.name);
    }
  }
  if (await User.countDocuments({ isAdmin: true }) === 0) {
    await User.create({ username: 'admin', email: 'admin@birloto.local',
      password: 'Admin12345!', isAdmin: true, locale: 'az', balance: 0 });
    console.log('✓ Admin hesab yaradıldı (admin / Admin12345!)');
  }
}

const tickLocks = new Set();
function tickRoom(roomId) {
  const k = String(roomId);
  if (tickLocks.has(k)) return;
  tickLocks.add(k);
  (async () => {
    try {
      const room = await Room.findById(roomId);
      if (!room) return;
      const now = Date.now();
      if (room.status !== 'started') {
        if (!room.roundEndsAt || now >= room.roundEndsAt.getTime()) {
          if ((room.players.length + room.bots.length) >= 1 && !room.startTime) {
            await startRound(room);
          }
        }
        io.to(`room:${room._id}`).emit('room:state', snap(room));
        return;
      }
      // Daş çıxması
      if (room.drawIntervalSec > 0 && room.lastDrawAt) {
        const elapsed = (now - room.lastDrawAt.getTime())/1000;
        const idx = Math.floor(elapsed / room.drawIntervalSec);
        if (idx >= 0 && idx < room.drawnNumbers.length) {
          const expected = room.drawnNumbers[Math.min(idx, room.drawnNumbers.length-1)];
          if (room.currentNumber !== expected) {
            room.currentNumber = expected;
            await room.save();
            io.to(`room:${room._id}`).emit('round:draw', { currentNumber: expected, index: idx });
          }
        }
      }
      const endAt = room.roundEndsAt ? room.roundEndsAt.getTime() : 0;
      const grace = (room.markGraceSec || 12) * 1000;
      if (now >= endAt + grace && !room.revealAt) {
        await resolveRound(room);
      }
      io.to(`room:${room._id}`).emit('room:state', snap(room));
    } catch (e) { console.error('tickRoom:', e.message); }
    finally { tickLocks.delete(k); }
  })();
}

async function startRound(room) {
  const sequence = randomDrawSet(30);
  room.drawnNumbers = sequence;
  room.drawnAt = sequence.map(() => new Date());
  room.currentNumber = sequence[0];
  room.status = 'started';
  room.startTime = new Date();
  room.roundEndsAt = new Date(Date.now() + room.roundDurationSec * 1000);
  room.lastDrawAt = new Date();
  room.currentRoundId = (room.currentRoundId || 0) + 1;
  room.stakeTotal = 0;
  room.basePot = 0;
  room.roundWinners = [];
  await room.save();
  io.to(`room:${room._id}`).emit('round:start', {
    numbers: sequence, startedAt: room.startTime, roundEndsAt: room.roundEndsAt,
    drawIntervalSec: room.drawIntervalSec, markGraceSec: room.markGraceSec,
    currentRoundId: room.currentRoundId
  });
}

async function resolveRound(room) {
  room.status = 'ended'; room.revealAt = new Date(Date.now() + 8000);
  const cards = await GameCard.find({ roomId: room._id, roundId: room.currentRoundId });
  let totalWinShare = 0;
  const userWins = [];
  for (const card of cards) {
    const r1 = rowDone(card, 0), r2 = rowDone(card, 1), r3 = rowDone(card, 2);
    const lines = (r1?1:0)+(r2?1:0)+(r3?1:0);
    const full = (r1&&r2&&r3);
    let prize = 0;
    if (lines) prize += Math.round((room.basePot||0) * 0.15 * 100)/100;
    if (full) prize += Math.round((room.basePot||0) * 0.6 * 100)/100;
    if (prize > 0) {
      card.isWinner = true; card.prize = prize; await card.save();
      await User.updateOne({ _id: card.userId }, { $inc: { balance: prize, totalWon: prize, gamesWon: 1 } });
      await Transaction.create({ userId: card.userId, type:'win', amount:prize, status:'completed',
        method:'room_prize', note:`Otaq ${room.name} raund #${room.currentRoundId}` });
      const u = await User.findById(card.userId).select('username').lean();
      userWins.push({ userId:card.userId, name:u?.username||'?', prize,
        numbers:(card.markedNumbers||[]).slice(0,8), line:lines, full });
      totalWinShare += prize;
    }
  }
  room.roundWinners = userWins.map(w => ({ name:w.name, prize:w.prize, numbers:w.numbers, line:1, isBot:false }));
  room.finalWinnerName = userWins[0]?.name || null;
  room.finalWinnerPrize = Math.max(0, ...userWins.map(w=>w.prize));
  await room.save();
  io.to(`room:${room._id}`).emit('round:end', { winners: userWins, reelNumbers: room.drawnNumbers });
  setTimeout(async () => {
    try {
      const fresh = await Room.findById(room._id);
      if (fresh) {
        fresh.status = 'waiting'; fresh.revealAt = null;
        fresh.drawnNumbers = []; fresh.drawnAt = []; fresh.currentNumber = null;
        fresh.players = []; fresh.roundWinners = [];
        fresh.roundEndsAt = new Date(Date.now() + (fresh.roundDurationSec||240)*1000);
        await fresh.save();
        io.to(`room:${fresh._id}`).emit('room:state', snap(fresh));
      }
    } catch(e){}
  }, 12000);
}

function rowDone(card, rIdx) {
  if (!card || !Array.isArray(card.numbers)) return false;
  const drawn = new Set(card.markedNumbers||[]);
  const row = card.numbers[rIdx]||[];
  let all = true, has = false;
  for (const v of row) {
    if (v == null) continue;
    has = true;
    if (!drawn.has(v)) { all = false; }
  }
  return has && all;
}

function snap(room) {
  return {
    _id: String(room._id), name: room.name, ticketLabel: room.ticketLabel,
    type: room.type, status: room.status, entryFee: room.entryFee,
    maxPlayers: room.maxPlayers,
    players: (room.players||[]).map(p=>String(p)),
    botCount: (room.bots||[]).length,
    drawnNumbers: room.drawnNumbers||[], drawnAt: room.drawnAt||[],
    currentNumber: room.currentNumber, currentRoundId: room.currentRoundId,
    roundEndsAt: room.roundEndsAt, startTime: room.startTime,
    stakeTotal: room.stakeTotal, basePot: room.basePot,
    nextGameAt: room.roundEndsAt, markGraceSec: room.markGraceSec,
    drawIntervalSec: room.drawIntervalSec, roundWinners: room.roundWinners,
    themeColor: room.themeColor
  };
}

/* ─── Routes ─── */
const r = express.Router();

r.get('/', async (req, res) => {
  const rooms = await Room.find({ isCustom:false, status:{$ne:'ended'} }).sort({ entryFee:1 }).lean();
  res.render('lobby', { rooms: rooms.map(x => snap({...x, _id: x._id})) });
});

r.get('/login', requireGuest, (req, res) => {
  const locale = req.session.locale || 'en';
  res.render('login', { error: null, locale, locales: LOCALES });
});
r.get('/register', requireGuest, (req, res) => {
  const locale = req.session.locale || 'en';
  res.render('register', { error: null, locale, locales: LOCALES });
});
r.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const locale = req.session.locale || 'en';
    const u = await User.findOne({ $or: [{ username }, { email: username }] });
    if (!u) return res.status(401).render('login', { error: 'İstifadəçi tapılmadı', locale, locales: LOCALES });
    if (u.isBlocked) return res.status(403).render('login', { error: 'Hesab bloklanıb', locale, locales: LOCALES });
    const ok = await u.comparePassword(password);
    if (!ok) return res.status(401).render('login', { error: 'Şifrə yanlışdır', locale, locales: LOCALES });
    req.session.userId = String(u._id); req.session.isAdmin = !!u.isAdmin;
    res.redirect('/');
  } catch (e) { res.status(500).render('login', { error: 'Xəta', locale: req.session.locale || 'en', locales: LOCALES }); }
});
r.post('/register', async (req, res) => {
  try {
    const { username, email, password, locale } = req.body;
    if (!username || !email || !password) return res.status(400).render('register', { error: 'Bütün xanaları doldurun' });
    if (password.length < 6) return res.status(400).render('register', { error: 'Şifrə ən azı 6 simvol' });
    if (await User.findOne({ $or:[{username}, {email:email.toLowerCase()}] }))
      return res.status(409).render('register', { error: 'İstifadəçi və ya e-poçt mövcuddur' });
    const ref = crypto.randomBytes(4).toString('hex').toUpperCase();
    const u = await User.create({ username, email:email.toLowerCase(), password,
      locale: locale||'az', referralCode: ref, balance: 0 });
    req.session.userId = String(u._id); req.session.isAdmin = false;
    res.redirect('/');
  } catch (e) { res.status(500).render('register', { error: 'Qeydiyyat xətası' }); }
});
r.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

r.get('/profile', requireLogin, async (req, res) => {
  const u = await User.findById(req.session.userId).select('-password').lean();
  const txs = await Transaction.find({ userId: req.session.userId }).sort({ createdAt:-1 }).limit(30).lean();
  res.render('profile', { user: u, txs });
});

r.get('/balance', requireLogin, async (req, res) => {
  const u = await User.findById(req.session.userId).select('balance username').lean();
  res.json({ ok:true, balance:u.balance, username:u.username });
});

r.get('/rooms/:id', requireLogin, async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).send('Otaq tapılmadı');
  const joined = (room.players||[]).some(p => String(p)===String(req.session.userId));
  if (!joined) return res.redirect(`/rooms/${req.params.id}/lobby`);
  res.render('room', { room: snap({...room, _id: room._id}) });
});
r.get('/rooms/:id/lobby', requireLogin, async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).send('Otaq tapılmadı');
  res.render('room_lobby', { room: snap({...room, _id: room._id}) });
});

/* JSON API */
r.get('/api/room/:id/state', async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).json({ error:'not_found' });
  res.json(snap(room));
});
r.get('/api/room/:id/mycards', requireLogin, async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).json({ error:'not_found' });
  const cards = await GameCard.find({ userId:req.session.userId, roomId:room._id, roundId:room.currentRoundId }).lean();
  res.json({ ok:true, cards, roundId:room.currentRoundId, status:room.status,
    drawnNumbers: room.drawnNumbers||[], currentNumber: room.currentNumber });
});
r.post('/api/room/:id/join', requireLogin, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error:'Otaq tapılmadı' });
  const already = room.players.some(p => String(p)===String(req.session.userId));
  if (!already) {
    if ((room.players.length + (room.bots||[]).length) >= room.maxPlayers)
      return res.status(409).json({ error:'Otaq doludur' });
    room.players.push(req.session.userId);
    await room.save();
  }
  io.to(`room:${room._id}`).emit('room:state', snap(room));
  res.json({ ok:true, room: snap(room) });
});

/* Bilet AL — atomlı balans çıxışı, idempotent kilidli */
r.post('/api/room/:id/buy-ticket', requireLogin, async (req, res) => {
  const lockKey = `buy:${req.session.userId}:${req.params.id}`;
  global.__buyLocks = global.__buyLocks || new Set();
  if (global.__buyLocks.has(lockKey)) return res.status(429).json({ error:'Sorğu artıq icra olunur' });
  global.__buyLocks.add(lockKey);
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error:'Otaq tapılmadı' });
    if (room.status === 'ended') return res.status(409).json({ error:'Raund bitib, yeni raund gözlənilir' });

    const qty = Math.max(1, Math.min(10, parseInt(req.body.qty||'1',10)));
    const unit = Number(room.entryFee||0);
    const total = +(unit*qty).toFixed(2);

    const updated = await User.findOneAndUpdate(
      { _id: req.session.userId, balance: { $gte: total } },
      { $inc: { balance: -total, gamesPlayed: 1 } },
      { new: true }
    );
    if (!updated) return res.status(402).json({ error:'Kifayət qədər balans yoxdur' });

    await Transaction.create({
      userId: req.session.userId, type:'game_join', amount:-total, status:'completed',
      method:'room_'+(room.type||'classic'),
      note:`Otaq ${room.name} · bilet ×${qty} · raund #${room.currentRoundId}`
    });

    const existingCount = await GameCard.countDocuments({
      userId:req.session.userId, roomId:room._id, roundId:room.currentRoundId
    });
    const cards = [];
    for (let i = 0; i < qty; i++) {
      const card = await GameCard.create({
        userId: req.session.userId, roomId: room._id,
        roundId: room.currentRoundId, ticketIndex: existingCount + i + 1,
        numbers: buildProperCartela(), markedNumbers: [], playedAt: new Date()
      });
      cards.push(card);
    }

    room.stakeTotal = (room.stakeTotal||0) + total;
    room.basePot = (room.basePot||0) + total;
    if (!room.players.some(p => String(p)===String(req.session.userId))) room.players.push(req.session.userId);
    await room.save();
    io.to(`room:${room._id}`).emit('room:state', snap(room));
    res.json({ ok:true, balance: updated.balance, cards, room: snap(room) });
  } catch (e) {
    console.error('buy-ticket:', e.message);
    res.status(500).json({ error:'Server xətası' });
  } finally {
    global.__buyLocks.delete(lockKey);
  }
});

r.post('/api/room/:id/mark', requireLogin, async (req, res) => {
  try {
    const { cardId, number } = req.body;
    if (!cardId || !number) return res.status(400).json({ error:'cardId və number tələb olunur' });
    const card = await GameCard.findOne({ _id:cardId, userId:req.session.userId });
    if (!card) return res.status(404).json({ error:'Kart tapılmadı' });
    if (!card.markedNumbers.includes(Number(number))) card.markedNumbers.push(Number(number));
    await card.save();
    res.json({ ok:true, marked: card.markedNumbers });
  } catch (e) { res.status(500).json({ error:'Server xətası' }); }
});

r.post('/api/room/:id/discard', requireLogin, async (req, res) => {
  try {
    const { cardId } = req.body;
    const c = await GameCard.findOneAndDelete({ _id:cardId, userId:req.session.userId });
    if (!c) return res.status(404).json({ error:'Kart tapılmadı' });
    const room = await Room.findById(req.params.id);
    if (room) {
      const refund = Number(room.entryFee||0);
      await User.updateOne({ _id: req.session.userId }, { $inc: { balance: refund } });
      await Transaction.create({ userId:req.session.userId, type:'refund', amount:refund,
        status:'completed', note:'Kart silindi, geri qaytarıldı' });
      room.stakeTotal = Math.max(0, (room.stakeTotal||0) - refund);
      room.basePot = Math.max(0, (room.basePot||0) - refund);
      await room.save();
    }
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error:'Server xətası' }); }
});

r.get('/api/room/:id/players', async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).json({ error:'not_found' });
  const users = await User.find({ _id: { $in: room.players||[] } }).select('username').lean();
  const stakes = await GameCard.aggregate([
    { $match: { roomId: room._id, roundId: room.currentRoundId } },
    { $group: { _id: '$userId', tickets: { $sum: 1 } } }
  ]);
  const stakeMap = {};
  for (const s of stakes) stakeMap[String(s._id)] = s.tickets;
  const list = users.map(u => ({
    name: u.username, isBot:false,
    tickets: stakeMap[String(u._id)]||0,
    stake: (stakeMap[String(u._id)]||0) * (room.entryFee||0)
  }));
  const botList = (room.bots||[]).map(b => ({
    name: b.name, isBot:true, tickets:b.tickets||1, stake:b.stake||0
  }));
  res.json({
    ok:true, count: list.length + botList.length,
    realCount: list.length, botCount: botList.length, players: list.concat(botList)
  });
});

r.post('/api/deposit/demo', requireLogin, async (req, res) => {
  const amt = Math.max(1, Math.min(1000, Number(req.body.amount||0)));
  if (!amt) return res.status(400).json({ error:'məbləğ yanlışdır' });
  const u = await User.findByIdAndUpdate(req.session.userId, { $inc:{ balance:amt } }, { new:true });
  await Transaction.create({ userId:req.session.userId, type:'deposit', amount:amt,
    status:'completed', method:'demo', note:'Test üçün demo balans' });
  res.json({ ok:true, balance: u.balance });
});

app.use('/', r);

io.on('connection', (s) => {
  s.on('room:join', async (rid) => {
    s.join(`room:${rid}`);
    const r = await Room.findById(rid).lean();
    if (r) s.emit('room:state', snap(r));
  });
  s.on('room:leave', (rid) => s.leave(`room:${rid}`));
});

setInterval(async () => {
  try {
    const rooms = await Room.find({ isCustom:false }).select('_id');
    for (const r of rooms) tickRoom(r._id);
  } catch (e) {}
}, 1000);

app.use((req, res) => res.status(404).send('Səhifə tapılmadı'));

server.listen(PORT, () => console.log(`✓ Birloto server: http://localhost:${PORT}`));

module.exports = { app, server, io };
