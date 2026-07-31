const PaymentMethod = require('../models/PaymentMethod');
const i18n = require('./i18n');

/**
 * Dil / ölkə üzrə default ödəniş üsulları.
 * Kart və IBAN nömrələri BOŞ saxlanılır — YALNIZ admin paneldən doldurulur.
 * İstifadəçi dili dəyişəndə həmin ölkənin bank kartları avtomatik göstərilir.
 * İngilis (default) dilində yalnız kripto üsulları var.
 */
const DEFAULTS = [
  // ── Azərbaycan ──
  { key: 'kapitalbank',  locale: 'az', name: 'Kapital Bank',   kind: 'bank',     logo: '/assets/banks/kapitalbank.svg', currency: 'AZN', sortOrder: 1 },
  { key: 'birbank',      locale: 'az', name: 'Birbank',        kind: 'bank',     logo: '/assets/banks/birbank.svg',     currency: 'AZN', sortOrder: 2 },
  { key: 'm10',          locale: 'az', name: 'm10',            kind: 'transfer', logo: '/assets/banks/m10.svg',         currency: 'AZN', sortOrder: 3 },
  { key: 'card_transfer',locale: 'az', name: 'Kartdan karta',  kind: 'transfer', logo: '/assets/banks/banktransfer.svg',currency: 'AZN', sortOrder: 4 },

  // ── Türkiyə ──
  { key: 'vakifbank',    locale: 'tr', name: 'Vakıf Bank',     kind: 'bank',     logo: '/assets/banks/vakifbank.svg',   currency: 'TRY', sortOrder: 1 },
  { key: 'ziraatbank',   locale: 'tr', name: 'Ziraat Bankası', kind: 'bank',     logo: '/assets/banks/ziraatbank.svg',  currency: 'TRY', sortOrder: 2 },
  { key: 'garanti',      locale: 'tr', name: 'Garanti BBVA',   kind: 'bank',     logo: '/assets/banks/garanti.svg',     currency: 'TRY', sortOrder: 3 },
  { key: 'iban_to_iban', locale: 'tr', name: 'IBAN to IBAN',   kind: 'iban',     logo: '/assets/banks/iban.svg',        currency: 'TRY', sortOrder: 4 },
  { key: 'papara',       locale: 'tr', name: 'Papara',         kind: 'transfer', logo: '/assets/banks/papara.svg',      currency: 'TRY', sortOrder: 5 },

  // ── Rusiya ──
  { key: 'sberbank',     locale: 'ru', name: 'Сбербанк',       kind: 'bank',     logo: '/assets/banks/sberbank.svg',    currency: 'RUB', sortOrder: 1 },
  { key: 'vtb',          locale: 'ru', name: 'ВТБ',            kind: 'bank',     logo: '/assets/banks/vtb.svg',         currency: 'RUB', sortOrder: 2 },
  { key: 'tinkoff',      locale: 'ru', name: 'Т-Банк',         kind: 'bank',     logo: '/assets/banks/tinkoff.svg',     currency: 'RUB', sortOrder: 3 },
  { key: 'sbp',          locale: 'ru', name: 'СБП',            kind: 'transfer', logo: '/assets/banks/sbp.svg',         currency: 'RUB', sortOrder: 4 },

  // ── Gürcüstan ──
  { key: 'tbcbank',      locale: 'ka', name: 'TBC Bank',       kind: 'bank',     logo: '/assets/banks/tbcbank.svg',     currency: 'GEL', sortOrder: 1 },
  { key: 'bog',          locale: 'ka', name: 'Bank of Georgia',kind: 'bank',     logo: '/assets/banks/bog.svg',         currency: 'GEL', sortOrder: 2 },
  { key: 'libertybank',  locale: 'ka', name: 'Liberty Bank',   kind: 'bank',     logo: '/assets/banks/libertybank.svg', currency: 'GEL', sortOrder: 3 },
  { key: 'ge_iban',      locale: 'ka', name: 'IBAN transfer',  kind: 'iban',     logo: '/assets/banks/iban.svg',        currency: 'GEL', sortOrder: 4 },

  // ── İngilis (default) — yalnız kripto ──
  { key: 'crypto_usdt',  locale: 'en', name: 'Crypto Transfer (USDT)', kind: 'crypto', logo: '/assets/banks/usdt.svg',  currency: 'USDT', network: 'TRC20', sortOrder: 1 },
  { key: 'crypto_btc',   locale: 'en', name: 'Crypto Transfer (BTC)',  kind: 'crypto', logo: '/assets/banks/btc.svg',   currency: 'BTC',  network: 'BTC',   sortOrder: 2 },
  { key: 'crypto_eth',   locale: 'en', name: 'Crypto Transfer (ETH)',  kind: 'crypto', logo: '/assets/banks/eth.svg',   currency: 'ETH',  network: 'ERC20', sortOrder: 3 }
];

// Dil siyahısı i18n-dən gəlir (tək mənbə) — bayraq + valyuta daxil
const LOCALES = i18n.LOCALES.map((l) => ({
  code: l.code,
  label: l.native,
  flag: l.flag,
  currency: l.currency,
  symbol: l.symbol
}));

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
  return i18n.normalizeLocale(v);
}

module.exports = { ensureDefaultPaymentMethods, LOCALES, normalizeLocale, DEFAULTS };
