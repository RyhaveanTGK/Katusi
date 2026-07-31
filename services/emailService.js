// services/emailService.js
// One Loto — e-poçt göndərilməsi (Resend).
//
// İki rejim dəstəklənir:
//  1) Lovable connector gateway (RESEND_API_KEY "lovc_" ilə başlayır + LOVABLE_API_KEY var)
//  2) Birbaşa Resend API (RESEND_API_KEY "re_" ilə başlayır)
//
// Doğrulama kodu e-poçtu İNGİLİS dilindədir və 3 dəqiqə etibarlıdır.

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend';
const DIRECT_URL  = 'https://api.resend.com';

const SITE_NAME = 'One Loto';
const SITE_URL  = process.env.SITE_URL || 'https://one-loto.com';
const FROM      = process.env.EMAIL_FROM || 'One Loto <no-reply@one-loto.com>';

// Kodun etibarlılıq müddəti — 3 dəqiqə
const CODE_TTL_MS = 3 * 60 * 1000;

function isGatewayKey(key) {
  return typeof key === 'string' && key.startsWith('lovc_');
}

/** Resend üzərindən e-poçt göndərir. Uğursuz olduqda Error atır. */
async function sendMail({ to, subject, html, text }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error('RESEND_API_KEY konfiqurasiya olunmayıb');

  const payload = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };
  if (text) payload.text = text;

  let url, headers;
  if (isGatewayKey(resendKey)) {
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!lovableKey) throw new Error('LOVABLE_API_KEY konfiqurasiya olunmayıb');
    url = `${GATEWAY_URL}/emails`;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': resendKey
    };
  } else {
    url = `${DIRECT_URL}/emails`;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`
    };
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend error [${res.status}]: ${body}`);
    throw new Error(`E-poçt göndərilmədi [${res.status}]`);
  }
  return res.json().catch(() => ({}));
}

/** Səliqəli, İngilis dilində doğrulama kodu şablonu */
function verificationHtml(code, minutes = 3) {
  const digits = String(code)
    .split('')
    .map(
      (d) => `<td style="padding:0 5px;">
        <div style="width:46px;height:58px;line-height:58px;text-align:center;border-radius:12px;
                    background:#2a0848;border:1px solid #f5c518;color:#f5c518;
                    font-size:28px;font-weight:800;font-family:'Courier New',monospace;">${d}</div>
      </td>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Your ${SITE_NAME} verification code is ${code}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:20px;">
          <div style="font-size:24px;font-weight:800;color:#3d0d62;letter-spacing:.5px;">
            <span style="color:#e8001a;">One</span> Loto
          </div>
          <div style="font-size:11px;letter-spacing:2px;color:#8a8a8a;text-transform:uppercase;margin-top:4px;">one-loto.com</div>
        </td></tr>
        <tr><td style="background:#3d0d62;border-radius:20px;padding:30px 26px;color:#ffffff;">
          <div style="font-size:20px;font-weight:800;margin-bottom:10px;">Confirm your email address</div>
          <div style="font-size:14px;line-height:1.6;color:rgba(255,255,255,.85);">
            Welcome to ${SITE_NAME}! Use the verification code below to finish creating your account.
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 14px;">
            <tr>${digits}</tr>
          </table>
          <div style="text-align:center;font-size:13px;font-weight:700;color:#f5c518;">
            This code expires in ${minutes} minutes
          </div>
          <div style="margin-top:22px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.08);
                      font-size:12.5px;line-height:1.6;color:rgba(255,255,255,.8);">
            If the code is not entered within ${minutes} minutes it is blocked automatically and you will need to
            request a new one. Never share this code with anyone — ${SITE_NAME} staff will never ask for it.
          </div>
          <div style="margin-top:22px;text-align:center;">
            <a href="${SITE_URL}" style="display:inline-block;background:#f5c518;color:#3d0d62;text-decoration:none;
               font-size:14px;font-weight:800;padding:12px 26px;border-radius:14px;">Open ${SITE_NAME}</a>
          </div>
        </td></tr>
        <tr><td align="center" style="padding-top:18px;font-size:11px;line-height:1.7;color:#9a9a9a;">
          You received this email because someone signed up at ${SITE_URL} with this address.<br>
          If this was not you, you can safely ignore this message.<br>
          &copy; ${new Date().getFullYear()} ${SITE_NAME} · 18+ · Play responsibly
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function verificationText(code, minutes = 3) {
  return [
    `${SITE_NAME} — email verification`,
    '',
    `Your verification code is: ${code}`,
    `The code expires in ${minutes} minutes and is blocked automatically afterwards.`,
    '',
    `If you did not request this, please ignore this email.`,
    SITE_URL
  ].join('\n');
}

/** 6 rəqəmli doğrulama kodu */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Doğrulama kodunu göndərir */
async function sendVerificationCode(email, code) {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  return sendMail({
    to: email,
    subject: `${code} is your ${SITE_NAME} verification code`,
    html: verificationHtml(code, minutes),
    text: verificationText(code, minutes)
  });
}

module.exports = {
  CODE_TTL_MS,
  SITE_NAME,
  SITE_URL,
  sendMail,
  sendVerificationCode,
  verificationHtml,
  generateCode
};
