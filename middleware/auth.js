const User = require('../models/User');

exports.requireLogin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  if (req.session.isAdmin) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin hesabı ilə oyuna giriş yoxdur' });
    return res.redirect('/admin/users');
  }
  try {
    const u = await User.findById(req.session.userId).select('isBlocked blockReason');
    if (u && u.isBlocked) {
      req.session.destroy(() => {});
      return res.status(403).send('Hesabınız bloklanmışdır. ' + (u.blockReason || ''));
    }
  } catch (e) {}
  next();
};

exports.requireAdmin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/admin/login');
  if (!req.session.isAdmin) return res.status(403).send('Giriş qadağandır');
  next();
};

exports.requireGuest = (req, res, next) => {
  if (req.session.userId) return res.redirect('/');
  next();
};
