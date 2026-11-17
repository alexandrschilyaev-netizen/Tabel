import { openStore, roles } from './store.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const origin = new URL(process.env.TABEL_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Укажите внешний HTTPS-адрес в TABEL_ORIGIN или RENDER_EXTERNAL_URL.');
}
if (process.versions.node.split('.')[0] !== '24') throw new Error('Для Tabel нужен Node.js 24.');
process.env.NODE_ENV = 'production';
process.env.TABEL_ORIGIN = origin.origin;
process.env.TABEL_HOST = process.env.TABEL_HOST || '0.0.0.0';
process.env.TABEL_DB = resolve(process.env.TABEL_DB || 'data/tabel-hosted-test.sqlite');

function readAccounts() {
  let accounts;
  try {
    accounts = JSON.parse(process.env.TABEL_TEST_USERS || 'null');
  } catch {
    throw new Error('В TABEL_TEST_USERS должен быть JSON-массив тестовых пользователей.');
  }
  if (!Array.isArray(accounts) || accounts.length < 5 || accounts.length > 20) {
    throw new Error('Перед первым запуском задайте тестовых пользователей через секрет TABEL_TEST_USERS.');
  }
  const usernames = new Set();
  for (const user of accounts) {
    if (!user || typeof user.username !== 'string' || !/^[a-z0-9._-]{3,40}$/i.test(user.username)
        || typeof user.name !== 'string' || !user.name.trim() || user.name.length > 120
        || !Object.hasOwn(roles, user.role)
        || typeof user.passwordHash !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.passwordHash)
        || usernames.has(user.username.toLowerCase())) {
      throw new Error('Проверьте логины, роли и хеши паролей в секрете TABEL_TEST_USERS.');
    }
    usernames.add(user.username.toLowerCase());
  }
  if (!Object.keys(roles).every(role => accounts.some(user => user.role === role))) {
    throw new Error('В тестовом наборе должны присутствовать все пять ролей.');
  }
  return accounts;
}

const db = openStore();
try {
  db.exec('BEGIN IMMEDIATE;');
  const hasMarker = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='tabel_hosted_test_setup'").get();
  if (hasMarker) {
    if (db.prepare('SELECT marker FROM tabel_hosted_test_setup WHERE id=1').get()?.marker !== 'hosted-test-v1') {
      throw new Error('Неизвестная конфигурация тестовой базы.');
    }
    console.log('Существующая тестовая база подключена.');
  } else {
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) {
      throw new Error('Для временного сервера укажите отдельную пустую базу в TABEL_DB.');
    }
    const accounts = readAccounts();
    const insert = db.prepare('INSERT INTO users(username,name,role,password,grade) VALUES(?,?,?,?,?)');
    const created = accounts.map(user => ({
      id: insert.run(user.username, user.name.trim(), user.role, user.passwordHash, user.role === 'worker' ? 4 : null).lastInsertRowid,
      role: user.role
    }));
    const supervisors = created.filter(user => ['master', 'foreman', 'engineer'].includes(user.role));
    const assign = db.prepare('INSERT INTO assignments(worker_id,supervisor_id) VALUES(?,?)');
    for (const worker of created.filter(user => user.role === 'worker')) {
      for (const supervisor of supervisors) assign.run(worker.id, supervisor.id);
    }
    const project = db.prepare('INSERT INTO projects(name,address,color) VALUES(?,?,?)');
    project.run('Тестовый объект 1', 'Учебная площадка', '#2563eb');
    project.run('Тестовый объект 2', 'Учебная площадка', '#15803d');
    db.exec('CREATE TABLE tabel_hosted_test_setup (id INTEGER PRIMARY KEY CHECK(id=1), marker TEXT NOT NULL) STRICT;');
    db.prepare('INSERT INTO tabel_hosted_test_setup VALUES(1,?)').run('hosted-test-v1');
    console.log('Тестовые пользователи и объекты созданы.');
  }
  db.exec('COMMIT;');
} catch (error) {
  db.exec('ROLLBACK;');
  throw error;
} finally {
  db.close();
}

// Bootstrap credentials are needed only for the first initialization.
delete process.env.TABEL_TEST_USERS;
await import('../server.js');
