// Auth middleware
exports.requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
};

exports.requireAdmin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  if (!req.session.isAdmin) return res.status(403).send('Giriş qadağandır');
  next();
};

exports.requireGuest = (req, res, next) => {
  if (req.session.userId) return res.redirect('/');
  next();
};
