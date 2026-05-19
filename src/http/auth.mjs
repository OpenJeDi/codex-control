import { createHash, timingSafeEqual } from 'node:crypto';

function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function normalizeAuthSettings(env = process.env) {
  const mode = String(env.CODEX_CONTROL_AUTH || 'none').trim().toLowerCase();
  const normalizedMode = mode === 'basic' ? 'basic' : 'none';
  return {
    mode: normalizedMode,
    user: String(env.CODEX_CONTROL_AUTH_USER || 'admin'),
    password: String(env.CODEX_CONTROL_AUTH_PASSWORD || ''),
    passwordSha256: String(env.CODEX_CONTROL_AUTH_PASSWORD_SHA256 || '').trim().toLowerCase(),
    allowUnauthenticatedNetwork: envFlag(env.CODEX_CONTROL_ALLOW_UNAUTHENTICATED_NETWORK),
  };
}

export function isLoopbackHost(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text === 'localhost' || text === '127.0.0.1' || text === '::1';
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function rejectAuth(res) {
  res.writeHead(401, {
    'www-authenticate': 'Basic realm="Codex Control"',
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end('Authentication required');
  return false;
}

function verifyAuthPassword(authSettings, password) {
  if (authSettings.password && safeEqualText(password, authSettings.password)) return true;
  if (!authSettings.passwordSha256) return false;
  const hash = createHash('sha256').update(String(password ?? ''), 'utf8').digest('hex');
  return safeEqualText(hash, authSettings.passwordSha256);
}

export function createRequireAuth(authSettings = normalizeAuthSettings()) {
  return function requireAuth(req, res) {
    if (authSettings.mode !== 'basic') return true;
    if (!authSettings.password && !authSettings.passwordSha256) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Basic auth is enabled but no password or password hash is configured.');
      return false;
    }
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Basic\s+(.+)$/i);
    if (!match) return rejectAuth(res);
    let decoded = '';
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return rejectAuth(res);
    }
    const separator = decoded.indexOf(':');
    if (separator === -1) return rejectAuth(res);
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeEqualText(user, authSettings.user) && verifyAuthPassword(authSettings, password) ? true : rejectAuth(res);
  };
}

export function createRequireWriteAccess(readOnlyMode = false) {
  return function requireWriteAccess() {
    if (readOnlyMode) throw Object.assign(new Error('Codex Control is running in read-only mode.'), { statusCode: 403 });
  };
}
