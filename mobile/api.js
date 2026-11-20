import * as SecureStore from 'expo-secure-store';

const key = 'tabel-session';
const storage = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const serverAddress = 'https://tabel59p2t7-alexandrschilyaev.msk1.amvera.tech';

export async function readSession() {
  const raw = await SecureStore.getItemAsync(key, storage);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.address === serverAddress && session.token && session.expires > Date.now()) return session;
  await clearSession();
  return null;
}

export async function saveSession(session) {
  await SecureStore.setItemAsync(key, JSON.stringify(session), storage);
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(key, storage);
}

export async function api(session, path, body, format = 'json') {
  const headers = { Accept: format === 'text' ? 'text/csv' : format === 'binary' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let response;
    try {
      response = await fetch(serverAddress + '/api/mobile/' + path, {
        headers, method: body === undefined ? 'GET' : 'POST', body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch {
      throw new Error('Сервер недоступен. Проверьте интернет-соединение.');
    }
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const error = new Error(details.error || 'Запрос не выполнен.');
      error.status = response.status;
      throw error;
    }
    if (format === 'binary') return new Uint8Array(await response.arrayBuffer());
    return format === 'text' ? await response.text() : await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
