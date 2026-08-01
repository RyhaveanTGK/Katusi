// services/keepAlive.js
// ─────────────────────────────────────────────────────────────────────────────
// Render "Free" planında web servis 15 dəqiqə sorğu gəlmədikdə yuxuya gedir.
// Bu modul iki şeyi təmin edir:
//   1) /uptime — UptimeRobot (və hər hansı monitor) üçün yüngül ping endpoint-i.
//   2) Daxili self-ping — hər KEEP_ALIVE_INTERVAL_MIN dəqiqədən bir öz
//      /uptime ünvanına sorğu atır (monitor işləməsə belə server oyaq qalır).
//
// ENV:
//   KEEP_ALIVE_URL           — tam ünvan (məs. https://birloto.onrender.com)
//                              yazılmasa SITE_URL / RENDER_EXTERNAL_URL istifadə olunur
//   KEEP_ALIVE_INTERVAL_MIN  — default 10 (15-dən kiçik olmalıdır)
//   KEEP_ALIVE_DISABLED=1    — self-ping-i tamamilə söndürür
// ─────────────────────────────────────────────────────────────────────────────

const startedAt = Date.now();
let timer = null;
let lastPingAt = null;
let lastPingOk = null;
let pingCount = 0;

function baseUrl() {
  const raw =
    process.env.KEEP_ALIVE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.SITE_URL ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
}

function uptimePayload() {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  return {
    ok: true,
    service: 'one-loto',
    uptimeSeconds: sec,
    startedAt: new Date(startedAt).toISOString(),
    selfPing: { count: pingCount, lastAt: lastPingAt, lastOk: lastPingOk },
    time: new Date().toISOString()
  };
}

/** Express-ə /uptime (və HEAD) endpoint-ini bağlayır */
function mount(app) {
  const handler = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json(uptimePayload());
  };
  app.get('/uptime', handler);
  app.head('/uptime', (req, res) => res.status(200).end());
  // UptimeRobot bəzən /ping yolunu istifadə edir
  app.get('/ping', (req, res) => res.status(200).send('pong'));
}

async function pingOnce() {
  const url = baseUrl();
  if (!url) return;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${url}/uptime`, {
      method: 'GET',
      headers: { 'User-Agent': 'one-loto-keepalive' },
      signal: ctrl.signal
    });
    clearTimeout(to);
    lastPingOk = res.ok;
  } catch (e) {
    lastPingOk = false;
  }
  pingCount += 1;
  lastPingAt = new Date().toISOString();
}

/** Self-ping dövrünü başladır */
function start() {
  if (timer) return;
  if (String(process.env.KEEP_ALIVE_DISABLED || '') === '1') {
    console.log('[KEEP-ALIVE] Söndürülüb (KEEP_ALIVE_DISABLED=1)');
    return;
  }
  const url = baseUrl();
  if (!url) {
    console.log('[KEEP-ALIVE] KEEP_ALIVE_URL / SITE_URL yoxdur — yalnız /uptime endpoint-i aktivdir.');
    return;
  }
  const minutes = Math.min(14, Math.max(1, parseInt(process.env.KEEP_ALIVE_INTERVAL_MIN, 10) || 10));
  timer = setInterval(() => { pingOnce().catch(() => {}); }, minutes * 60 * 1000);
  if (timer.unref) timer.unref();
  console.log(`[KEEP-ALIVE] ${url}/uptime hər ${minutes} dəqiqədən bir yoxlanılır`);
  setTimeout(() => { pingOnce().catch(() => {}); }, 20000);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { mount, start, stop, uptimePayload };
