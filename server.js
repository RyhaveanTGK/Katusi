require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const { ensureDefaultRooms, startGameLoop } = require('./services/gameEngine');

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://r77513973_db_user:ZnVE8V5URKL2VG9i@venomkzn.utujwym.mongodb.net/?appName=Venomkzn';
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 1) Render reverse-proxy arxasında çalışırıq; etibar edirik
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0, etag: true }));

// 2) HTML səhifələrdə köhnə sessiyanın brauzerdə qalıb qara ekrana səbəb
//    olmasının qarşısını alırıq.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 3) Cookie/session: Render-də session routing problemlərini aradan qaldırmaq
//    üçün ad açıq şəkildə qoyulur, sameSite/lax seçilir, secret məcburidir.
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

const authRoutes    = require('./routes/auth');
const gameRoutes    = require('./routes/game');
const profileRoutes = require('./routes/profile');
const walletRoutes  = require('./routes/wallet');
const adminRoutes   = require('./routes/admin');
const apiRoutes     = require('./routes/api');

app.use('/', authRoutes);
app.use('/', gameRoutes);
app.use('/profile', profileRoutes);
app.use('/wallet', walletRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// Legacy ".php" redirects (kept for compatibility)
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

// 404 fallback — axtarılan URL səhv yazılıbsa istifadəçini giriş səhifəsinə
// yönləndir (qara "Not Found" ekranının qarşısı).
app.use((req, res) => {
  // API sorğusu? JSON qaytar
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  // Render-də cold-start zamanı session/store race condition baş verə bilər;
  // ona görə istifadəçini məntiqi səhifəyə yönləndir.
  return res.redirect('/login');
});

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await ensureDefaultRooms();
    startGameLoop();
    app.listen(PORT, () => console.log(`Birloto running on port ${PORT}`));
  })
  .catch((e) => {
    console.error('MongoDB error:', e.message);
    // Production-da (Render) restart strategiyası işləsin
    if (!IS_PROD) process.exit(1);
    setTimeout(() => process.exit(1), 5000);
  });

// Render free-tier spin-down sonrası qəflətən restart üçün sağlam ehtiyat
process.on('unhandledRejection', (e)=>{console.error('UNHANDLED:', e && e.message);});
process.on('SIGTERM', ()=>{ console.log('SIGTERM received, shutting down'); process.exit(0); });
