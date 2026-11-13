import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
export const roles = { worker: 'Монтажник', master: 'Мастер', foreman: 'Прораб', engineer: 'Инженер', hr: 'Кадровик' };
export const statuses = { approved: 'Учтена', closed: 'Закрыта' };
export const projectColors = ['#2563eb', '#15803d', '#b45309', '#7c3aed', '#be185d', '#0e7490', '#b91c1c', '#475569'];
const legacyHolidays = [
  ['2026-01-01', 'Новый год'], ['2026-01-07', 'Рождество'],
  ['2026-02-23', 'День защитника Отечества'], ['2026-03-08', '8 Марта'],
  ['2026-05-01', 'Праздник Весны и Труда'], ['2026-05-09', 'День Победы'],
  ['2026-06-12', 'День России'], ['2026-11-04', 'День народного единства']
];

export const kinds = { work: 'Работа', vacation: 'Отпуск', sick: 'Больничный', dayoff: 'Выходной' };
export const timeZone = process.env.TABEL_TIME_ZONE || 'Europe/Moscow';
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' });

export function localDate() {
  return dateFormat.format(new Date());
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return salt + ':' + key.toString('hex');
}

export async function checkPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const actual = await deriveKey(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}

export function openStore(demo = false) {
  const path = demo ? ':memory:' : resolve(process.env.TABEL_DB || 'data/tabel.sqlite');
  if (!demo) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
  `);
  const userColumns = `(
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('hr','master','foreman','engineer','worker')),
    password TEXT, master_id INTEGER REFERENCES users(id), grade INTEGER
  ) STRICT`;
  db.exec('CREATE TABLE IF NOT EXISTS users ' + userColumns);
  if (!db.prepare("SELECT sql FROM sqlite_schema WHERE name='users'").get().sql.includes("'foreman'")) {
    // Preserve IDs referenced by shifts, sessions, and audit events.
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      if (!db.prepare("SELECT sql FROM sqlite_schema WHERE name='users'").get().sql.includes("'foreman'")) {
        db.exec(`
          CREATE TABLE users_new ${userColumns};
          INSERT INTO users_new SELECT * FROM users;
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
        `);
      }
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Некорректные ссылки при обновлении SQLite.');
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys=ON;');
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, address TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2563eb'
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY, worker_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id), kind TEXT NOT NULL CHECK(kind IN ('work','vacation','sick','dayoff')),
      start TEXT, end TEXT, overnight INTEGER NOT NULL, break_minutes INTEGER NOT NULL, minutes INTEGER NOT NULL,
      note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','closed')),
      version INTEGER NOT NULL DEFAULT 1, UNIQUE(worker_id, date)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS shifts_date ON shifts(date);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES shifts(id), actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), detail TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS events_shift ON events(shift_id, id);
    CREATE TABLE IF NOT EXISTS assignments (
      worker_id INTEGER NOT NULL REFERENCES users(id), supervisor_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY(worker_id,supervisor_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS assignments_supervisor ON assignments(supervisor_id,worker_id);
    INSERT OR IGNORE INTO assignments SELECT id,master_id FROM users WHERE role='worker' AND master_id IS NOT NULL;
    UPDATE users SET master_id=NULL WHERE master_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS month_locks (
      month TEXT PRIMARY KEY, closed_by INTEGER NOT NULL REFERENCES users(id),
      closed_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS calendar_days (
      date TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('holiday','shortened')), name TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS mobile_sessions (
      digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    ) STRICT;
    UPDATE shifts SET status='approved' WHERE status IN ('draft','submitted');
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    ) STRICT;
  `);
  if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'color')) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'color')) {
        db.exec("ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '#2563eb';");
        const update = db.prepare('UPDATE projects SET color=? WHERE id=?');
        db.prepare('SELECT id FROM projects ORDER BY id').all().forEach(({ id }, index) => {
          update.run(projectColors[index % projectColors.length], id);
        });
      }
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  db.exec('BEGIN IMMEDIATE;');
  try {
    if (!db.prepare('PRAGMA table_info(month_locks)').all().some(column => column.name === 'calendar_policy')) {
      db.exec('ALTER TABLE month_locks ADD COLUMN calendar_policy INTEGER NOT NULL DEFAULT 0;');
    }
    const marker = db.prepare("INSERT OR IGNORE INTO app_migrations VALUES('legacy_holidays_2026')").run();
    if (marker.changes) {
      const insert = db.prepare("INSERT OR IGNORE INTO calendar_days(date,kind,name) VALUES(?,'holiday',?)");
      legacyHolidays.forEach(day => insert.run(...day));
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  return db;
}

export function seedDemo(db) {
  const user = db.prepare('INSERT INTO users(username,name,role,master_id,grade) VALUES(?,?,?,?,?)');
  user.run('hr', 'Анна Соколова', 'hr', null, null);
  user.run('master', 'Алексей Морозов', 'master', null, null);
  user.run('foreman', 'Олег Лавров', 'foreman', null, null);
  user.run('engineer', 'Ирина Котова', 'engineer', null, null);
  const crew = [
    ['Артём Волков', 5], ['Дмитрий Орлов', 4], ['Иван Кузнецов', 6], ['Кирилл Лебедев', 5],
    ['Максим Сидоров', 4], ['Михаил Фёдоров', 6], ['Павел Новиков', 5], ['Сергей Егоров', 4]
  ];
  const assignment = db.prepare('INSERT INTO assignments VALUES(?,?)');
  const workerIds = crew.map(([name, grade], index) => {
    const id = user.run('worker' + (index + 1), name, 'worker', null, grade).lastInsertRowid;
    assignment.run(id, 2);
    if (index < 5) assignment.run(id, 3);
    if (index >= 3) assignment.run(id, 4);
    return id;
  });
  const project = db.prepare('INSERT INTO projects(name,address,color) VALUES(?,?,?)');
  project.run('РНК', 'Монтажный участок', projectColors[0]);
  project.run('ТПЦ-3', 'Производственный корпус', projectColors[1]);
  project.run('Склад № 2', 'Складская площадка', projectColors[2]);

  const date = localDate();
  const month = date.slice(0, 7);
  const shift = db.prepare(`INSERT INTO shifts(worker_id,date,project_id,kind,start,end,overnight,break_minutes,minutes,note,status)
    VALUES(?,?,?,?,?,?,0,?,?,?,?)`);
  for (let i = 1; i <= 31; i++) {
    const day = month + '-' + String(i).padStart(2, '0');
    const parsed = new Date(day + 'T00:00:00Z');
    if (Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== day || [0, 6].includes(parsed.getUTCDay())) continue;
    crew.forEach((_, index) => {
      if ((i + index * 3) % 13 === 0) return;
      const leave = (i + index * 7) % 17 === 0;
      shift.run(workerIds[index], day, leave ? null : index % 3 + 1, leave ? 'vacation' : 'work',
        leave ? null : '08:00', leave ? null : '17:00', leave ? 0 : 60, leave ? 0 : 480, '', 'approved');
    });
  }
}
