// Signed tokens (HMAC-SHA256). The game page gets one when someone taps Play,
// so the server knows which Telegram user and group a score belongs to.

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const utf8ToB64url = str => b64url(enc.encode(str));

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

/** Derive separate keys from the one ARCADE_SECRET (tokens, webhook, setup). */
export async function deriveKeys(secret) {
  if (!secret || secret.length < 16) throw new Error('ARCADE_SECRET must be at least 16 characters');
  const base = enc.encode(secret);
  const tokenKey = await hmac(base, 'team-arcade:tokens');
  const webhook = [...(await hmac(base, 'team-arcade:webhook'))].map(b => b.toString(16).padStart(2, '0')).join('');
  return { tokenKey, webhookSecret: webhook };
}

export async function sign(tokenKey, claims) {
  const body = utf8ToB64url(JSON.stringify(claims));
  return `${body}.${b64url(await hmac(tokenKey, body))}`;
}

/** Returns the claims, or null if the token is forged, malformed or expired. */
export async function verify(tokenKey, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey('raw', tokenKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(body)))) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (typeof claims.exp !== 'number' || claims.exp < now) return null;
    return claims;
  } catch { return null; }
}
