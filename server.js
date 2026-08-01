// server.js (modified) — Express entry, Render uyğun.
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { ensureDefaultRooms, startGameLoop } = require('./services/gameEngine');
const { startBotPolling } = require('./services/telegramBot');
const starLeague = require('./services/starLeague');
const { ensureDefaultPaymentMethods } = require('./services/paymentMethods');
const keepAlive = require('./services/keepAlive');

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://r77513973_db_user:ZnVE8V5URKL2VG9i@venomkzn.utujwym.mongodb.net/?appName=Venomkzn';
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Uploads qovluğunu yarat (Render diskdə qalır, deploy zamanı silinə bilər) ──
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '7d' : 0,
  etag: true
}));

// HTML səhifələrdə köhnə sessiyanın qara ekrana səbəb olmasının qarşısı
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ── Health check (Render port yoxlaması üçün) ──
app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'connecting'
  });
});

// ── UptimeRobot / monitor endpoint-ləri (/uptime, /ping) ──
// Render Free planı 15 dəqiqə sorğusuz qaldıqda yuxuya gedir.
keepAlive.mount(app);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  name: 'birloto.sid',
  secret: process.env.SESSION_SECRET || 'birloto_super_secret_' + Date.now(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    ttl: 60 * 60 * 24 * 7,
    collectionName: 'birloto_sessions',
    touchAfter: 60,
    autoRemove: 'native'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ── Çoxdilli dəstək (en default | az | tr | ru | ka) ──
const i18n = require('./services/i18n');
app.use(i18n.middleware);

// Dil dəyişmə: /lang/tr?next=/wallet
app.get('/lang/:code', async (req, res) => {
  const code = i18n.normalizeLocale(req.params.code);
  req.session.locale = code;
  if (req.session.userId) {
    try {
      const User = require('./models/User');
      await User.updateOne({ _id: req.session.userId }, { $set: { locale: code } });
    } catch (e) { /* sessiya dili yenə işləyir */ }
  }
  const next = String(req.query.next || req.get('referer') || '/');
  return res.redirect(next.startsWith('/') ? next : '/');
});

// Routes
const authRoutes    = require('./routes/auth');
const gameRoutes    = require('./routes/game');
const profileRoutes = require('./routes/profile');
const walletRoutes  = require('./routes/wallet');
const adminRoutes   = require('./routes/admin');
const apiRoutes     = require('./routes/api');
const roomRoutes    = require('./routes/rooms');

app.use('/', authRoutes);
app.use('/', roomRoutes);
app.use('/', gameRoutes);
app.use('/profile', profileRoutes);
app.use('/wallet', walletRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// Legacy redirects
const legacyRedirects = {
  '/index.php':'/','/home.php':'/','/login.php':'/login','/register.php':'/register',
  '/logout.php':'/logout','/profile.php':'/profile','/wallet_index.php':'/wallet',
  '/referral.php':'/profile/referral','/winners.php':'/winners',
  '/setting.php':'/profile/setting','/changepass.php':'/profile/changepass',
  '/games-played.php':'/profile/games-played','/admin_rooms.php':'/admin/rooms'
};
Object.entries(legacyRedirects).forEach(([from,to])=>{
  app.get(from, (req,res)=>res.redirect(301,to));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.redirect('/login');
});

// ── ÖNƏMLİ: portu DƏRHAL dinləyirik ──
// Render deploy-un uğurlu sayılması üçün proses qısa müddətdə 0.0.0.0:PORT
// üzərində dinləməlidir. Əvvəl `app.listen` yalnız Mongo qoşulduqdan sonra
// çağırılırdı; DB gec cavab verəndə Render "Cause of failure could not be
// determined" xətası ilə deploy-u dayandırırdı.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`One Loto running on port ${PORT}`);
});
server.on('error', (e) => console.error('HTTP server error:', e.message));

// Serveri oyaq saxla (self-ping) — UptimeRobot ilə birlikdə işləyir
try { keepAlive.start(); } catch (e) { console.error('Keep-alive start failed:', e.message); }

async function connectDB(attempt = 1) {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('MongoDB connected');
    await ensureDefaultRooms();
    await ensureDefaultPaymentMethods();
    startGameLoop();
    try { startBotPolling(); } catch (e) { console.error('Telegram polling start failed:', e.message); }
    // 24 saatlıq ulduz liderboardı — uduşlar avtomatik köçürülür
    try { starLeague.start(); } catch (e) { console.error('Star league start failed:', e.message); }
  } catch (e) {
    const wait = Math.min(30000, attempt * 5000);
    console.error(`MongoDB error (cəhd ${attempt}):`, e.message, `— ${wait / 1000}s sonra yenidən`);
    setTimeout(() => connectDB(attempt + 1), wait);
  }
}
connectDB();

process.on('unhandledRejection', (e)=>{console.error('UNHANDLED:', e && e.message);});
process.on('SIGTERM', ()=>{ console.log('SIGTERM received, shutting down'); process.exit(0); });
