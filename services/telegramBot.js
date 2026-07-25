// Telegram bot servisi – Render-də tək instance işləyir.
// Bot token və admin chat ID .env-dən oxunur. Token/ID yoxdursa funksiyalar
// no-op olur ki, lokal development-da xətaya düşməsin.
const path = require('path');
const fs   = require('fs');

// Parse mode üçün kiçik helper
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function callTelegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { ok: false, raw: text }; }
  } catch (e) {
    console.error('Telegram call failed:', e.message);
    return null;
  }
}

async function sendAdminMessage(text) {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    console.log('[TELEGRAM-DRY]', text);
    return { dryRun: true };
  }
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

// Yeni deposit sorğusu → admin-ə göndərilir
async function notifyDepositRequest(tx, user) {
  const lines = [
    `🟢 <b>YENİ DEPOZİT SORĞUSU</b>`,
    ``,
    `👤 İstifadəçi: <b>${escapeHtml(user.username)}</b> (#${String(user._id).slice(-6).toUpperCase()})`,
    `💰 Məbləğ: <b>${tx.amount.toFixed(2)} ${tx.currency || 'AZN'}</b>`,
    `🏦 Üsul: ${escapeHtml(tx.method || 'card')}`,
    tx.cryptoToken ? `🪙 Token: ${escapeHtml(tx.cryptoToken)}` : '',
    tx.network       ? `🌐 Şəbəkə: ${escapeHtml(tx.network)}` : '',
    tx.cardLast4     ? `💳 Kart: **** **** **** ${escapeHtml(tx.cardLast4)}` : '',
    tx.walletAddress ? `🏷 Cüzdan: <code>${escapeHtml(tx.walletAddress)}</code>` : '',
    `📎 Qəbz: <i>${tx.receiptUrl ? 'yüklənib' : 'yoxdur'}</i>`,
    ``,
    `🆔 TX: <code>${String(tx._id)}</code>`,
    `✅ Təsdiq:  <code>/approve ${String(tx._id)}</code>`,
    `❌ Rədd:    <code>/reject ${String(tx._id)}</code>`
  ].filter(Boolean);

  const res = await sendAdminMessage(lines.join('\n'));
  if (res && res.result && res.result.message_id) {
    tx.telegramMessageId = res.result.message_id;
    await tx.save().catch(() => {});
  }
  return res;
}

// Yeni withdraw sorğusu → admin-ə göndərilir
async function notifyWithdrawRequest(tx, user) {
  const lines = [
    `🔴 <b>YENİ ÇIXARIŞ SORĞUSU</b>`,
    ``,
    `👤 İstifadəçi: <b>${escapeHtml(user.username)}</b> (#${String(user._id).slice(-6).toUpperCase()})`,
    `💰 Məbləğ: <b>${tx.amount.toFixed(2)} ${tx.currency || 'AZN'}</b>`,
    tx.cardLast4 ? `💳 Kart: **** **** **** ${escapeHtml(tx.cardLast4)}` : '',
    tx.note      ? `📝 Qeyd: ${escapeHtml(tx.note)}` : '',
    ``,
    `🆔 TX: <code>${String(tx._id)}</code>`,
    `✅ Təsdiq:  <code>/approve ${String(tx._id)}</code>`,
    `❌ Rədd:    <code>/reject ${String(tx._id)}</code>`
  ].filter(Boolean);

  const res = await sendAdminMessage(lines.join('\n'));
  if (res && res.result && res.result.message_id) {
    tx.telegramMessageId = res.result.message_id;
    await tx.save().catch(() => {});
  }
  return res;
}

async function notifyDecision(tx, user, decision) {
  const icon = decision === 'approved' ? '✅' : '❌';
  const verb = decision === 'approved' ? 'TƏSDİQLƏNDİ' : 'RƏDD EDİLDİ';
  const lines = [
    `${icon} <b>${verb}</b>`,
    ``,
    `👤 İstifadəçi: <b>${escapeHtml(user.username)}</b>`,
    `💰 Məbləğ: <b>${tx.amount.toFixed(2)} ${tx.currency || 'AZN'}</b>`,
    `🆔 TX: <code>${String(tx._id)}</code>`
  ];

  const userChatId = user.telegramChatId || process.env.TELEGRAM_USER_NOTIFY_CHAT_ID;
  if (userChatId) {
    await callTelegram('sendMessage', {
      chat_id: userChatId,
      text:    lines.join('\n'),
      parse_mode: 'HTML'
    });
  }
  return sendAdminMessage(lines.join('\n'));
}

module.exports = {
  sendAdminMessage,
  notifyDepositRequest,
  notifyWithdrawRequest,
  notifyDecision,
  escapeHtml
};
