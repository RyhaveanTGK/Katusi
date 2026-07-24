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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'birloto_super_secret_2026',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI, ttl: 60 * 60 * 24 * 7 }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax' }
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

app.get('/index.php',        (req, res) => res.redirect('/'));
app.get('/home.php',         (req, res) => res.redirect('/'));
app.get('/login.php',        (req, res) => res.redirect('/login'));
app.get('/register.php',     (req, res) => res.redirect('/register'));
app.get('/logout.php',       (req, res) => res.redirect('/logout'));
app.get('/profile.php',      (req, res) => res.redirect('/profile'));
app.get('/wallet_index.php', (req, res) => res.redirect('/wallet'));
app.get('/referral.php',     (req, res) => res.redirect('/profile/referral'));
app.get('/winners.php',      (req, res) => res.redirect('/winners'));
app.get('/setting.php',      (req, res) => res.redirect('/profile/setting'));
app.get('/changepass.php',   (req, res) => res.redirect('/profile/changepass'));
app.get('/games-played.php', (req, res) => res.redirect('/profile/games-played'));
app.get('/admin_rooms.php',  (req, res) => res.redirect('/admin/rooms'));

app.use((req, res) => res.status(404).redirect('/'));

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await ensureDefaultRooms();
    startGameLoop();
    app.listen(PORT, () => console.log(`Birloto running on port ${PORT}`));
  })
  .catch((e) => {
    console.error('MongoDB error:', e.message);
    process.exit(1);
  });