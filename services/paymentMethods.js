const PaymentMethod = require('../models/PaymentMethod');

/**
 * Dil / ölkə üzrə default ödəniş üsulları.
 * Kart və IBAN nömrələri BOŞ saxlanılır — admin paneldən doldurulur.
 * Dil dəstəyi əlavə olunanda sadəcə locale dəyişir, kartlar avtomatik dəyişir.
 */
const DEFAULTS = [
  // ── Azərbaycan (mövcud sistem) ──
  { key: 'kapitalbank',  locale: 'az', name: 'Kapital Bank',   kind: 'bank',     logo: '/assets/banks/kapitalbank.svg', currency: 'AZN', sortOrder: 1 },
  { key: 'birbank',      locale: 'az', name: 'Birbank',        kind: 'bank',     logo: '/assets/banks/birbank.svg',     currency: 'AZN', sortOrder: 2 },
  { key: 'm10',          locale: 'az', name: 'm10',            kind: 'transfer', logo: '/assets/banks/m10.svg',         currency: 'AZN', sortOrder: 3 },
  { key: 'card_transfer',locale: 'az', name: 'Kartdan karta',  kind: 'transfer', logo: '/assets/banks/banktransfer.svg',currency: 'AZN', sortOrder: 4 },
  { key: 'crypto_usdt',  locale: 'az', name: 'Kripto (USDT)',  kind: 'crypto',   logo: '/assets/banks/usdt.svg',        currency: 'USDT', network: 'TRC20', sortOrder: 9 },

  // ── Türkiyə ──
  { key: 'vakifbank',    locale: 'tr', name: 'Vakıf Bank',     kind: 'bank',     logo: '/assets/banks/vakifbank.svg',   currency: 'TRY', sortOrder: 1 },
  { key: 'iban_to_iban', locale: 'tr', name: 'IBAN to IBAN',   kind: 'iban',     logo: '/assets/banks/iban.svg',        currency: 'TRY', sortOrder: 2 },
  { key: 'bank_transfer',locale: 'tr', name: 'Bank Transfer',  kind: 'transfer', logo: '/assets/banks/banktransfer.svg',currency: 'TRY', sortOrder: 3 },
  { key: 'ziraatbank',   locale: 'tr', name: 'Ziraat Bank',    kind: 'bank',     logo: '/assets/banks/ziraatbank.svg',  currency: 'TRY', sortOrder: 4 },

  // ── Rusiya ──
  { key: 'sberbank',     locale: 'ru', name: 'Sber Bank',      kind: 'bank',     logo: '/assets/banks/sberbank.svg',    currency: 'RUB', sortOrder: 1 },
  { key: 'vtb',          locale: 'ru', name: 'VTB Bank',       kind: 'bank',     logo: '/assets/banks/vtb.svg',         currency: 'RUB', sortOrder: 2 },

  // ── Amerika: yalnız kripto ──
  { key: 'crypto_usdt',  locale: 'en', name: 'Crypto Transfer (USDT)', kind: 'crypto', logo: '/assets/banks/usdt.svg',  currency: 'USDT', network: 'TRC20', sortOrder: 1 },
  { key: 'crypto_btc',   locale: 'en', name: 'Crypto Transfer (BTC)',  kind: 'crypto', logo: '/assets/banks/crypto.svg',currency: 'BTC',  network: 'BTC',   sortOrder: 2 }
];

const LOCALES = [
  { code: 'az', label: 'Azərbaycan', flag: '🇦🇿' },
  { code: 'tr', label: 'Türkiyə',    flag: '🇹🇷' },
  { code: 'ru', label: 'Rusiya',     flag: '🇷🇺' },
  { code: 'en', label: 'Amerika',    flag: '🇺🇸' }
];

async function ensureDefaultPaymentMethods() {
  for (const d of DEFAULTS) {
    await PaymentMethod.updateOne(
      { key: d.key, locale: d.locale },
      { $setOnInsert: d },
      { upsert: true }
    );
  }
}

function normalizeLocale(v) {
  const l = String(v || '').toLowerCase();
  return LOCALES.some((x) => x.code === l) ? l : 'az';
}

module.exports = { ensureDefaultPaymentMethods, LOCALES, normalizeLocale, DEFAULTS };
