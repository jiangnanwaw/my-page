import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
let redis;
let useMemory = false;

try {
  redis = new Redis(redisUrl);
  redis.on('error', (e) => {
    console.warn('Redis error, falling back to memory store:', e?.message);
    useMemory = true;
  });
} catch (e) {
  console.warn('Redis init failed, using memory store:', e?.message);
  useMemory = true;
}

// In-memory fallback
const mem = {
  code: new Map(),
  resend: new Map(),
  attempts: new Map(),
};

function setWithTtl(map, key, value, ttlSeconds) {
  map.set(key, value);
  setTimeout(() => map.delete(key), ttlSeconds * 1000).unref?.();
}

export async function setCode(phoneE164, code, ttlSeconds) {
  const key = `sms:code:${phoneE164}`;
  if (useMemory) return setWithTtl(mem.code, key, code, ttlSeconds);
  await redis.set(key, code, 'EX', ttlSeconds);
}

export async function getCode(phoneE164) {
  const key = `sms:code:${phoneE164}`;
  if (useMemory) return mem.code.get(key) || null;
  return redis.get(key);
}

export async function delCode(phoneE164) {
  const key = `sms:code:${phoneE164}`;
  if (useMemory) return void mem.code.delete(key);
  await redis.del(key);
}

export async function hitResend(phoneE164, cooldownSeconds) {
  const key = `sms:resend:${phoneE164}`;
  if (useMemory) {
    if (mem.resend.has(key)) return false;
    setWithTtl(mem.resend, key, '1', cooldownSeconds);
    return true;
  }
  const ok = await redis.set(key, '1', 'NX', 'EX', cooldownSeconds);
  return ok === 'OK';
}

export async function getAttempts(phoneE164) {
  const key = `sms:attempts:${phoneE164}`;
  if (useMemory) return parseInt(mem.attempts.get(key) || '0', 10);
  const v = await redis.get(key);
  return parseInt(v || '0', 10);
}

export async function incAttempts(phoneE164, ttlSeconds) {
  const key = `sms:attempts:${phoneE164}`;
  if (useMemory) {
    const cnt = (parseInt(mem.attempts.get(key) || '0', 10) + 1);
    mem.attempts.set(key, String(cnt));
    if (cnt === 1) setWithTtl(mem.attempts, key, String(cnt), ttlSeconds);
    return cnt;
  }
  const cnt = await redis.incr(key);
  if (cnt === 1) await redis.expire(key, ttlSeconds);
  return cnt;
}


