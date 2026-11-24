import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse
} from '@simplewebauthn/server';

const challengeLifetime = 2 * 60 * 1000;
const recentLoginWindow = 5 * 60 * 1000;
const maxKeys = 10;

function userHandle(id) {
  return Buffer.from('tabel:' + id);
}

export function passkeyService(db, origin, sessionLifetime, requireThat) {
  const rpID = new URL(origin).hostname;
  const expected = { expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true };
  const find = db.prepare('SELECT * FROM web_passkeys WHERE id=?');
  const list = db.prepare('SELECT id,label,created,last_used FROM web_passkeys WHERE user_id=? ORDER BY created DESC');
  const sessionByDigest = db.prepare('SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND expires>?');

  function requireRecentLogin(user) {
    requireThat(user && sessionByDigest.get(user.digest, user.id, Date.now() + sessionLifetime - recentLoginWindow),
      403, 'Для изменения ключей доступа войдите заново.');
  }

  function issue(options, kind, user) {
    const id = randomBytes(24).toString('hex');
    const now = Date.now();
    db.prepare('DELETE FROM passkey_requests WHERE expires<=?').run(now);
    requireThat(db.prepare('SELECT count(*) AS count FROM passkey_requests').get().count < 1000,
      429, 'Слишком много запросов. Попробуйте позже.');
    // Keep a bounded lifetime and consume the challenge before asynchronous verification.
    db.prepare('INSERT INTO passkey_requests VALUES(?,?,?,?,?)').run(
      id, kind, options.challenge, user?.digest ?? null, now + challengeLifetime
    );
    return { id, options };
  }

  function consume(body, kind, user) {
    requireThat(typeof body.id === 'string' && /^[0-9a-f]{48}$/.test(body.id)
      && body.response && typeof body.response.id === 'string' && body.response.id.length <= 2048,
    400, 'Проверьте данные ключа доступа.');
    const row = db.prepare(`
      DELETE FROM passkey_requests WHERE id=? AND kind=? AND session_digest IS ? AND expires>?
      RETURNING challenge
    `).get(body.id, kind, user?.digest ?? null, Date.now());
    requireThat(row, 400, 'Запрос истёк. Начните заново.');
    return row.challenge;
  }

  async function registrationOptions(user) {
    requireRecentLogin(user);
    const keys = list.all(user.id);
    requireThat(keys.length < maxKeys, 409, 'Достигнут лимит ключей доступа.');
    const options = await generateRegistrationOptions({
      rpName: 'Табель', rpID, userID: userHandle(user.id),
      userName: 'employee-' + user.id, userDisplayName: user.name,
      attestationType: 'none', timeout: challengeLifetime,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: keys.map(key => ({ id: key.id }))
    });
    return issue(options, 'register', user);
  }

  async function register(body, user) {
    requireRecentLogin(user);
    const expectedChallenge = consume(body, 'register', user);
    requireThat(typeof body.label === 'string' && body.label.trim().length <= 60, 400, 'Название ключа должно быть не длиннее 60 символов.');
    const result = await verifyRegistrationResponse({
      response: body.response, expectedChallenge, ...expected
    }).catch(() => null);
    requireThat(result?.verified, 400, 'Устройство не подтвердило создание ключа доступа.');
    requireRecentLogin(user);
    const { credential } = result.registrationInfo;
    requireThat(list.all(user.id).length < maxKeys && !find.get(credential.id), 409, 'Этот ключ уже добавлен или достигнут лимит ключей.');
    db.prepare('INSERT INTO web_passkeys VALUES(?,?,?,?,?,?,NULL)').run(
      credential.id, user.id, credential.publicKey, credential.counter, body.label.trim() || 'Ключ доступа', Date.now()
    );
    return { ok: true };
  }

  async function authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID, allowCredentials: [], userVerification: 'required', timeout: challengeLifetime
    });
    return issue(options, 'login');
  }

  async function authenticate(body) {
    const expectedChallenge = consume(body, 'login');
    const record = find.get(body.response.id);
    const handle = body.response.response?.userHandle;
    requireThat(record && handle === userHandle(record.user_id).toString('base64url'), 401, 'Ключ доступа не найден.');
    const result = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge, ...expected,
      credential: { id: record.id, publicKey: record.public_key, counter: record.counter }
    }).catch(() => null);
    requireThat(result?.verified, 401, 'Не удалось подтвердить ключ доступа.');
    const updated = db.prepare('UPDATE web_passkeys SET counter=?,last_used=? WHERE id=? AND counter=?')
      .run(result.authenticationInfo.newCounter, Date.now(), record.id, record.counter);
    requireThat(updated.changes, 409, 'Ключ доступа изменился. Начните вход заново.');
    return { id: record.user_id };
  }

  function remove(user, id) {
    requireRecentLogin(user);
    requireThat(typeof id === 'string' && id.length <= 2048, 400, 'Проверьте ключ доступа.');
    const result = db.prepare('DELETE FROM web_passkeys WHERE id=? AND user_id=?').run(id, user.id);
    requireThat(result.changes, 404, 'Ключ доступа не найден.');
    return { ok: true };
  }

  return { registrationOptions, register, authenticationOptions, authenticate, remove, list: id => list.all(id) };
}
