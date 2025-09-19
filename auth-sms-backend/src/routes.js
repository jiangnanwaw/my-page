import jwt from 'jsonwebtoken';
import { sendSmsCode } from './smsClient.js';
import { setCode, getCode, delCode, hitResend, getAttempts, incAttempts } from './store.js';

const CODE_TTL_SECONDS = parseInt(process.env.CODE_TTL_SECONDS || '300', 10);
const CODE_RESEND_SECONDS = parseInt(process.env.CODE_RESEND_SECONDS || '60', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

function normalizePhoneToE164(cnPhone) {
  const digits = String(cnPhone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+86${digits}`;
  if (digits.startsWith('86') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('+' )) return digits;
  throw new Error('invalid phone');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function registerRoutes(app) {
  app.post('/api/sms/send', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const e164 = normalizePhoneToE164(phone);
      const canSend = await hitResend(e164, CODE_RESEND_SECONDS);
      if (!canSend) return res.status(429).json({ error: 'Too many requests, try later' });
      const code = generateCode();
      await setCode(e164, code, CODE_TTL_SECONDS);
      await sendSmsCode({ phoneNumberE164: e164, code });
      return res.json({ ok: true });
    } catch (e) {
      console.error('send error', e);
      return res.status(400).json({ error: e.message || 'send failed' });
    }
  });

  app.post('/api/sms/verify', async (req, res) => {
    try {
      const { phone, code } = req.body || {};
      if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });
      const e164 = normalizePhoneToE164(phone);
      const stored = await getCode(e164);
      const attempts = await getAttempts(e164);
      if (!stored) return res.status(400).json({ error: 'code expired' });
      if (attempts >= 5) return res.status(429).json({ error: 'too many attempts' });
      if (stored !== code) {
        await incAttempts(e164, CODE_TTL_SECONDS);
        return res.status(400).json({ error: 'invalid code' });
      }
      await delCode(e164);
      const token = jwt.sign({ sub: e164, auth: 'sms' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ ok: true, token });
    } catch (e) {
      console.error('verify error', e);
      return res.status(400).json({ error: e.message || 'verify failed' });
    }
  });
}


