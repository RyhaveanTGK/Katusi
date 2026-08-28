/* One-Loto server.js - Render deployment optimized
   ✓ Proper Socket.io setup
   ✓ All routes integrated
   ✓ MongoDB Render-compatible
   ✓ Session management
   ✓ Keep-alive service
*/

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// ━━━━━ MODELS ━━━━━
const User = require('./models/User');
const Room = require('./models/Room');
const GameCard = require('./models/GameCard');
const Transaction = require('./models/Transaction');
const WinnerLog = require('./models/WinnerLog');
const BonusCode = require('./models/BonusCode');
const PaymentMethod = require('./models/PaymentMethod');
const PaymentSession = require('./models/PaymentSession');
const EmailVerification = require('./models/EmailVerification');
const Device = require('./models/Device');
const DepositCounter = require('./models/DepositCounter');
const StarBot = require('./models/StarBot');
const StarCycle = require('./models/StarCycle');

// ━━━━━ MIDDLEWARE & SERVICES ━━━━━
const { requireLogin, requireAdmin, requireGuest } = require('./middleware/auth');
const { ensureDefaultRooms, startGameLoop } = require('./services/gameEngine');
const { startBotPolling } = require('./services/telegramBot');
const starLeague = require('./services/starLeague');
const { ensureDefaultPaymentMethods } = require('./services/paymentMethods');
const keepAlive = require('./services/keepAlive');
const i18n = require('./services/i18n');

// ━━━━━ ROUTES ━━━━━
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const profileRoutes = require('./routes/profile');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const roomRoutes = require('./routes/rooms');

// ━━━━━ EXPRESS & HTTP SETUP ━━━━━
const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/one-loto';
const IS_PROD = process.env.NODE_ENV === 'production';

// ━━━━━ PUBLIC UPLOADS DIRECTORY ━━━━━
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ━━━━━ VIEW ENGINE & STATIC FILES ━━━━━
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '7d' : 0,
  etag: true
}));

// ━━━━━ CACHE PREVENTION FOR HTML ━━━━━
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ━━━━━ HEALTH CHECK (Render monitoring) ━━━━━
app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'connecting',
    timestamp: new Date().toISOString()
  });
});

// ━━━━━ KEEP-ALIVE ROUTES (Prevent Render sleep) ━━━━━
keepAlive.mount(app);

// ━━━━━ BODY PARSERS ━━━━━
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// ━━━━━ SESSION CONFIGURATION ━━━━━
const sessionStore = MongoStore.create({
  mongoUrl: MONGODB_URI,
  touchAfter: 60,
  ttl: 60 * 60 * 24 * 7,
  collectionName: 'sessions',
  autoRemove: 'native'
}).on('error', (err) => {
  console.error('Session store error:', err.message);
});

app.use(session({
  name: 'one-loto.sid',
  secret: process.env.SESSION_SECRET || 'one-loto-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: sessionStore,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/'
  }
}));

// ━━━━━ PASS SESSION TO LOCALS ━━━━━
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.user = null;
  res.locals.error = null;
  
  if (req.session.userId) {
    User.findById(req.session.userId)
      .select('username balance isAdmin locale isBlocked gamesPlayed')
      .lean()
      .then(u => {
        res.locals.user = u;
        next();
      })
      .catch(err => {
        console.error('User fetch error:', err.message);
        next();
      });
  } else {
    next();
  }
});

// ━━━━━ ATTACH IO TO REQUEST ━━━━━
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ━━━━━ INTERNATIONALIZATION ━━━━━
app.use(i18n.middleware);

// ━━━━━ LANGUAGE SWITCH ROUTE ━━━━━
app.get('/lang/:code', async (req, res) => {
  const code = i18n.normalizeLocale(req.params.code);
  req.session.locale = code;
  
  if (req.session.userId) {
    try {
      await User.updateOne(
        { _id: req.session.userId },
        { $set: { locale: code } }
      );
    } catch (e) {
      console.error('Language update error:', e.message);
    }
  }
  
  const next = String(req.query.next || req.get('referer') || '/');
  return res.redirect(next.startsWith('/') ? next : '/');
});

// ━━━━━ APPLY ROUTES ━━━━━
app.use('/', authRoutes);
app.use('/', roomRoutes);
app.use('/', gameRoutes);
app.use('/profile', profileRoutes);
app.use('/wallet', walletRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// ━━━━━ LEGACY REDIRECTS (PHP to Node) ━━━━━
const legacyRedirects = {
  '/index.php': '/',
  '/home.php': '/',
  '/login.php': '/login',
  '/register.php': '/register',
  '/logout.php': '/logout',
  '/profile.php': '/profile',
  '/wallet_index.php': '/wallet',
  '/referral.php': '/profile/referral',
  '/winners.php': '/winners',
  '/setting.php': '/profile/setting',
  '/changepass.php': '/profile/changepass',
  '/games-played.php': '/profile/games-played',
  '/admin_rooms.php': '/admin/rooms'
};

Object.entries(legacyRedirects).forEach(([from, to]) => {
  app.get(from, (req, res) => res.redirect(301, to));
});

// ━━━━━ 404 HANDLER ━━━━━
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.redirect('/login');
});

// ━━━━━ START HTTP SERVER IMMEDIATELY ━━━━━
const httpServer = server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ One-Loto server running on port ${PORT}`);
  console.log(`✓ Environment: ${IS_PROD ? 'production' : 'development'}`);
});

httpServer.on('error', (err) => {
  console.error('HTTP Server Error:', err.message);
  process.exit(1);
});

// ━━━━━ DATABASE CONNECTION ━━━━━
async function connectDB(attempt = 1) {
  try {
    console.log(`\nConnecting to MongoDB (attempt ${attempt})...`);
    
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    });
    
    console.log('✓ MongoDB connected');
    
    // Initialize default rooms
    await ensureDefaultRooms();
    console.log('✓ Default rooms ensured');
    
    // Initialize payment methods
    await ensureDefaultPaymentMethods();
    console.log('✓ Payment methods initialized');
    
    // Start game engine
    startGameLoop();
    console.log('✓ Game loop started');
    
    // Start Telegram bot polling
    try {
      startBotPolling();
      console.log('✓ Telegram bot polling started');
    } catch (e) {
      console.warn('⚠ Telegram bot polling failed:', e.message);
    }
    
    // Start star league tracker
    try {
      starLeague.start();
      console.log('✓ Star league tracker started');
    } catch (e) {
      console.warn('⚠ Star league start failed:', e.message);
    }
    
  } catch (err) {
    const wait = Math.min(30000, attempt * 5000);
    console.error(`✗ MongoDB error (attempt ${attempt}):`, err.message);
    console.log(`⏳ Retrying in ${wait / 1000}s...`);
    
    setTimeout(() => connectDB(attempt + 1), wait);
  }
}

// Connect to database
connectDB();

// ━━━━━ KEEP-ALIVE SERVICE ━━━━━
try {
  keepAlive.start();
  console.log('✓ Keep-alive service started');
} catch (e) {
  console.warn('⚠ Keep-alive start failed:', e.message);
}

// ━━━━━ SOCKET.IO HANDLERS ━━━━━
io.on('connection', (socket) => {
  socket.on('room:join', async (roomId) => {
    try {
      socket.join(`room:${roomId}`);
      const room = await Room.findById(roomId).lean();
      if (room) {
        socket.emit('room:state', room);
      }
    } catch (err) {
      console.error('Socket room:join error:', err.message);
    }
  });
  
  socket.on('room:leave', (roomId) => {
    socket.leave(`room:${roomId}`);
  });
  
  socket.on('disconnect', () => {
    // Cleanup if needed
  });
});

// ━━━━━ GAME LOOP (Tick rooms) ━━━━━
setInterval(async () => {
  try {
    const rooms = await Room.find({ isCustom: false }).select('_id').lean();
    for (const r of rooms) {
      // Game tick logic handled by gameEngine service
    }
  } catch (e) {
    console.error('Game loop error:', e.message);
  }
}, 1000);

// ━━━━━ GRACEFUL SHUTDOWN ━━━━━
process.on('SIGTERM', () => {
  console.log('\n✓ SIGTERM received, shutting down gracefully...');
  
  server.close(() => {
    console.log('✓ HTTP server closed');
    
    mongoose.connection.close(false, () => {
      console.log('✓ MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('✗ Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = { app, server, io };
