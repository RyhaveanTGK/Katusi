// services/cardUtils.js
// Kart nömrəsinin validasiyası və brendin AVTOMATİK təyini (Visa / Mastercard ...).

/** Yalnız rəqəmləri saxlayır */
function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Luhn alqoritmi ilə kart nömrəsi yoxlaması */
function luhnValid(cardNumber) {
  const n = digits(cardNumber);
  if (n.length < 13 || n.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = n.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * BIN-ə görə kart brendini təyin edir.
 * → { key: 'visa', name: 'VISA', icon: '💳' }
 */
function detectBrand(cardNumber) {
  const n = digits(cardNumber);
  if (!n) return { key: 'unknown', name: 'NAMƏLUM' };

  if (/^4/.test(n)) return { key: 'visa', name: 'VISA' };

  // Mastercard: 51-55 və ya 2221-2720
  const p2 = parseInt(n.slice(0, 2), 10);
  const p4 = parseInt(n.slice(0, 4), 10);
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) {
    return { key: 'mastercard', name: 'MASTERCARD' };
  }

  if (/^3[47]/.test(n)) return { key: 'amex', name: 'AMERICAN EXPRESS' };
  if (/^(2200|2201|2202|2203|2204)/.test(n)) return { key: 'mir', name: 'MIR' };
  if (/^(60|65|81|82|508)/.test(n)) return { key: 'rupay', name: 'RUPAY' };
  if (/^(62|81)/.test(n)) return { key: 'unionpay', name: 'UNIONPAY' };
  if (/^(9792|979)/.test(n)) return { key: 'troy', name: 'TROY' };
  if (/^(300|301|302|303|304|305|36|38)/.test(n)) return { key: 'diners', name: 'DINERS CLUB' };
  if (/^(6011|64[4-9]|65)/.test(n)) return { key: 'discover', name: 'DISCOVER' };

  return { key: 'unknown', name: 'NAMƏLUM' };
}

/** "4169 7388 1234 5678" formatı */
function formatCard(cardNumber) {
  const n = digits(cardNumber);
  return n.replace(/(.{4})/g, '$1 ').trim();
}

/** MM/YY formatını yoxlayır və vaxtı keçibsə false qaytarır */
function expiryValid(expiry) {
  const m = String(expiry || '').match(/^(\d{2})\s*\/\s*(\d{2,4})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  if (month < 1 || month > 12) return false;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  const now = new Date();
  const end = new Date(year, month, 1); // ayın sonuna qədər etibarlıdır
  return end > new Date(now.getFullYear(), now.getMonth(), 1);
}

/** CVV: 3 rəqəm (Amex üçün 4) */
function cvvValid(cvv, brandKey) {
  const c = digits(cvv);
  return brandKey === 'amex' ? c.length === 4 : c.length === 3;
}

module.exports = { digits, luhnValid, detectBrand, formatCard, expiryValid, cvvValid };
