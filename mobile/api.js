import * as SecureStore from 'expo-secure-store';

const key = 'tabel-session';
const storage = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function validateAddress(input) {
  const value = input.trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(value)) {
    throw new Error('Введите HTTPS-адрес сервера, например https://tabel.example.org.');
  }
  return value;
}

export async function readSession() {
  const raw = await SecureStore.getItemAsync(key, storage);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (!session.token || session.expires > Date.now()) return session;
  await clearSession(session.address);
  return { address: session.address };
}

export async function saveSession(session) {
  await SecureStore.setItemAsync(key, JSON.stringify(session), storage);
}

export async function clearSession(address) {
  await SecureStore.setItemAsync(key, JSON.stringify({ address }), storage);
}

export async function api(session, path, body, format = 'json') {
  const headers = { Accept: format === 'text' ? 'text/csv' : 'application/json' };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let response;
    try {
      response = await fetch(validateAddress(session.address) + '/api/mobile/' + path, {
        headers, method: body === undefined ? 'GET' : 'POST', body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch {
      throw new Error('Сервер недоступен. Проверьте адрес и интернет-соединение.');
    }
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const error = new Error(details.error || 'Запрос не выполнен.');
      error.status = response.status;
      throw error;
    }
    return format === 'text' ? await response.text() : await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
