// Telegram bot: inline buttons + long-polling callback handler.
// Admin təsdiqləmə/rədd etməni birbaşa Telegram düymələri ilə edir.
// /approve və ya /reject yazmağa ehtiyac yoxdur.

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

async function sendAdminMessage(text, extra = {}) {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    console.log('[TELEGRAM-DRY]', text);
    return { dryRun: true };
  }
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}

function decisionKeyboard(txId) {
  return {
    inline_keyboard: [[
      { text: '✅ Qəbul et', callback_data: `approve:${txId}` },
      { text: '❌ Rədd et',  callback_data: `reject:${txId}`  }
    ]]
  };
}

// Yeni deposit sorğusu → admin-ə göndərilir + inline düymələr
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
    `📎 Qəbz: <i>${tx.receiptUrl || tx.receiptImage ? 'yüklənib' : 'yoxdur'}</i>`,
    ``,
    `🆔 TX: <code>${String(tx._id)}</code>`
  ].filter(Boolean);

  const res = await sendAdminMessage(lines.join('\n'), { reply_markup: decisionKeyboard(String(tx._id)) });
  if (res && res.result && res.result.message_id) {
    tx.telegramMessageId = res.result.message_id;
    await tx.save().catch(() => {});
  }
  return res;
}

async function notifyWithdrawRequest(tx, user) {
  const lines = [
    `🔴 <b>YENİ ÇIXARIŞ SORĞUSU</b>`,
    ``,
    `👤 İstifadəçi: <b>${escapeHtml(user.username)}</b> (#${String(user._id).slice(-6).toUpperCase()})`,
    `💰 Məbləğ: <b>${tx.amount.toFixed(2)} ${tx.currency || 'AZN'}</b>`,
    tx.cardLast4 ? `💳 Kart: **** **** **** ${escapeHtml(tx.cardLast4)}` : '',
    tx.cardHolder ? `👤 Kart sahibi: ${escapeHtml(tx.cardHolder)}` : '',
    tx.note      ? `📝 Qeyd: ${escapeHtml(tx.note)}` : '',
    ``,
    `🆔 TX: <code>${String(tx._id)}</code>`
  ].filter(Boolean);

  const res = await sendAdminMessage(lines.join('\n'), { reply_markup: decisionKeyboard(String(tx._id)) });
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
    await callTelegram('sendMessage', { chat_id: userChatId, text: lines.join('\n'), parse_mode: 'HTML' });
  }
  return sendAdminMessage(lines.join('\n'));
}

// ───────────────────────────── Callback-query handler ─────────────────────────────
// Admin Telegram-da düyməni basanda burada təsdiq/rədd baş verir.
async function processDecision(txId, action, adminName = 'admin') {
  // require burada — dairəvi asılılıqdan qaçmaq üçün
  const Transaction = require('../models/Transaction');
  const User        = require('../models/User');

  const txn = await Transaction.findById(txId).populate('userId');
  if (!txn) return { ok: false, reason: 'not_found' };
  if (txn.status !== 'pending') return { ok: false, reason: 'already_processed', status: txn.status };

  if (action === 'approve') {
    txn.status = 'completed';
    txn.decidedAt = new Date();
    txn.decidedBy = adminName;
    await txn.save();
    if (txn.type === 'deposit' && txn.userId) {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    return { ok: true, action: 'approve', txn };
  }

  if (action === 'reject') {
    txn.status = 'rejected';
    txn.decidedAt = new Date();
    txn.decidedBy = adminName;
    txn.adminMessage = 'Rədd edildi';
    await txn.save();
    // withdraw idisə balansı geri qaytar (blok olunmuşdu)
    if (txn.type === 'withdraw' && txn.userId) {
      txn.userId.balance = Number(txn.userId.balance || 0) + Number(txn.amount || 0);
      await txn.userId.save();
    }
    return { ok: true, action: 'reject', txn };
  }

  return { ok: false, reason: 'bad_action' };
}

async function handleCallbackQuery(cq) {
  const chatId = String(cq.message?.chat?.id || '');
  const adminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '');
  const data = String(cq.data || '');

  // Yalnız admin chat-dən icazə verilir
  if (adminChatId && chatId !== adminChatId) {
    await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'İcazəniz yoxdur', show_alert: true });
    return;
  }

  const [action, txId] = data.split(':');
  if (!txId || !['approve', 'reject'].includes(action)) {
    await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Naməlum əməliyyat' });
    return;
  }

  try {
    const adminName = cq.from?.username || cq.from?.first_name || 'telegram-admin';
    const result = await processDecision(txId, action, adminName);

    if (!result.ok && result.reason === 'not_found') {
      await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Sorğu tapılmadı', show_alert: true });
      return;
    }
    if (!result.ok && result.reason === 'already_processed') {
      await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: `Artıq emal olunub (${result.status})`, show_alert: true });
      // düymələri sil
      await callTelegram('editMessageReplyMarkup', {
        chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] }
      });
      return;
    }
    if (!result.ok) {
      await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Xəta baş verdi', show_alert: true });
      return;
    }

    const tag = action === 'approve' ? '✅ TƏSDİQLƏNDİ' : '❌ RƏDD EDİLDİ';
    const originalText = cq.message.text || '';
    const newText = `${tag}\n\n${originalText}\n\n<i>Admin: ${escapeHtml(adminName)} · ${new Date().toLocaleString('az-AZ')}</i>`;

    await callTelegram('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: newText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });

    await callTelegram('answerCallbackQuery', {
      callback_query_id: cq.id,
      text: action === 'approve' ? 'Balans yeniləndi ✅' : 'Sorğu rədd edildi ❌'
    });

    // istifadəçiyə də bildir
    if (result.txn && result.txn.userId) {
      await notifyDecision(result.txn, result.txn.userId, action === 'approve' ? 'approved' : 'rejected').catch(() => {});
    }
  } catch (e) {
    console.error('callback err', e);
    await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Server xətası', show_alert: true }).catch(()=>{});
  }
}

// ───────────────────────────── Long-polling loop ─────────────────────────────
let pollingStarted = false;
let lastUpdateId = 0;

async function pollLoop() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['callback_query','message']))}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.result)) {
      for (const upd of data.result) {
        if (upd.update_id > lastUpdateId) lastUpdateId = upd.update_id;
        if (upd.callback_query) {
          await handleCallbackQuery(upd.callback_query).catch((e) => console.error('cb handle', e.message));
        }
      }
    }
  } catch (e) {
    // sakit; wait bir az və yenidən
    await new Promise((r) => setTimeout(r, 3000));
  }
  setImmediate(pollLoop);
}

function startBotPolling() {
  if (pollingStarted) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[TELEGRAM] Token yoxdur, polling başlamadı (dev rejimi).');
    return;
  }
  pollingStarted = true;
  // Köhnə webhook varsa siləcəyik ki, getUpdates işləsin
  callTelegram('deleteWebhook', { drop_pending_updates: false }).finally(() => {
    console.log('[TELEGRAM] Long-polling başlayır…');
    pollLoop();
  });
}

module.exports = {
  sendAdminMessage,
  notifyDepositRequest,
  notifyWithdrawRequest,
  notifyDecision,
  escapeHtml,
  startBotPolling,
  processDecision
};
