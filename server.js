import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openStore, seedDemo, hashPassword, checkPassword, localDate, roles, statuses, kinds, projectColors } from './src/store.js';

const demo = process.argv.includes('--demo');
const externalOrigin = process.env.TABEL_ORIGIN ? new URL(process.env.TABEL_ORIGIN).origin : null;
if (process.env.NODE_ENV === 'production' && (demo || !externalOrigin?.startsWith('https://'))) {
  throw new Error('Для рабочего сервера укажите TABEL_ORIGIN с https:// и запустите без --demo.');
}
const secure = externalOrigin?.startsWith('https://');
const cookie = secure ? '__Host-tabel' : 'tabel';
const db = openStore(demo);
if (demo) seedDemo(db);
const duration = 12 * 60 * 60;
const fallbackPassword = await hashPassword(randomBytes(32).toString('hex'));
const limits = new Map();

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/offline.html': ['offline.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png']
};
for (const asset of Object.values(assets)) asset.push(readFileSync(new URL('./public/' + asset[0], import.meta.url)));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 16384) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Ожидаются данные JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  requireThat(size <= limit, 413, 'Размер данных превышает допустимый.');
  let data;
  try { data = JSON.parse(Buffer.concat(chunks)); }
  catch { throw new HttpError(400, 'Проверьте формат данных.'); }
  requireThat(data && typeof data === 'object' && !Array.isArray(data), 400, 'Проверьте формат данных.');
  return data;
}

function digest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function session(req, mobile) {
  const token = mobile ? (req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/)?.[1] : null;
  const value = mobile ? token : (req.headers.cookie || '').match(new RegExp('(?:^|; *)' + cookie + '=([a-f0-9]{64})(?=;|$)'))?.[1];
  if (!value) return null;
  const table = mobile ? 'mobile_sessions' : 'sessions';
  return db.prepare(`SELECT u.id,u.name,u.role,s.digest FROM ${table} s JOIN users u ON u.id=s.user_id
    WHERE s.digest=? AND s.expires>?`).get(digest(value), Date.now());
}

function setSession(res, user, previous, mobile = false) {
  const token = randomBytes(32).toString('hex');
  const table = mobile ? 'mobile_sessions' : 'sessions';
  const expires = Date.now() + duration * 1000;
  transaction(() => {
    db.prepare('DELETE FROM ' + table + ' WHERE expires<=? OR digest=?').run(Date.now(), previous?.digest ?? '');
    db.prepare('INSERT INTO ' + table + ' VALUES(?,?,?)').run(digest(token), user.id, expires);
  });
  if (!mobile) setCookie(res, token, duration);
  return mobile ? { token, expires } : { ok: true };
}

function setCookie(res, value, age) {
  res.setHeader('Set-Cookie', cookie + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : ''));
}

function visible(user, workerId) {
  const worker = db.prepare("SELECT id FROM users WHERE id=? AND role='worker'").get(workerId);
  if (!worker) return false;
  if (user.role === 'hr' || user.id === worker.id) return true;
  return Boolean(db.prepare('SELECT 1 FROM assignments WHERE worker_id=? AND supervisor_id=?').get(workerId, user.id));
}

function scope(user) {
  if (user.role === 'hr') return ["u.role='worker' AND 1=?", 1];
  if (user.role === 'worker') return ["u.role='worker' AND u.id=?", user.id];
  return ["u.role='worker' AND EXISTS (SELECT 1 FROM assignments a WHERE a.worker_id=u.id AND a.supervisor_id=?)", user.id];
}

function monthLock(month) {
  return db.prepare(`SELECT m.closed_at,u.name AS closed_by
    FROM month_locks m JOIN users u ON u.id=m.closed_by WHERE m.month=?`).get(month) || null;
}

function withOvertime(shift) {
  const worked = shift.kind === 'work' ? shift.minutes : 0;
  const overtime = Math.max(0, worked - 8 * 60);
  const overtime15 = Math.min(overtime, 2 * 60);
  return {
    ...shift,
    regular_minutes: worked - overtime,
    overtime_minutes: overtime,
    overtime_15_minutes: overtime15,
    overtime_20_minutes: overtime - overtime15
  };
}

function monthSummary(shifts, workers) {
  const recorded = new Set(shifts.map(shift => shift.worker_id));
  const signature = shifts.map(shift => shift.id + ':' + shift.version).join(',') + '|' + workers.map(worker => worker.id).join(',');
  return {
    records: shifts.length,
    workShifts: shifts.filter(shift => shift.kind === 'work').length,
    minutes: shifts.reduce((sum, shift) => sum + shift.minutes, 0),
    regular_minutes: shifts.reduce((sum, shift) => sum + shift.regular_minutes, 0),
    overtime_15_minutes: shifts.reduce((sum, shift) => sum + shift.overtime_15_minutes, 0),
    overtime_20_minutes: shifts.reduce((sum, shift) => sum + shift.overtime_20_minutes, 0),
    overtime_minutes: shifts.reduce((sum, shift) => sum + shift.overtime_minutes, 0),
    workersWithoutRecords: workers.length - recorded.size,
    revision: digest(signature)
  };
}

function validMonth(month) {
  return typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
}

function data(user, month) {
  requireThat(validMonth(month), 400, 'Выберите корректный месяц.');
  const [where, id] = scope(user);
  const workers = db.prepare('SELECT u.id,u.name,u.grade FROM users u WHERE ' + where).all(id)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id - b.id);
  const shifts = db.prepare(`SELECT s.* FROM shifts s JOIN users u ON u.id=s.worker_id
    WHERE ${where} AND s.date BETWEEN ? AND ? ORDER BY s.date,s.worker_id`).all(id, month + '-01', month + '-31').map(withOvertime);
  const allProjects = db.prepare('SELECT * FROM projects ORDER BY id').all();
  const projectIds = new Set(shifts.map(shift => shift.project_id));
  const projects = user.role === 'worker' ? allProjects.filter(project => projectIds.has(project.id)) : allProjects;
  const hr = user.role === 'hr';
  const staff = hr ? db.prepare("SELECT id,name,role FROM users WHERE role IN ('master','foreman','engineer') ORDER BY name").all() : [];
  if (hr) {
    const workerById = new Map(workers.map(worker => [worker.id, worker]));
    workers.forEach(worker => { worker.supervisor_ids = []; });
    for (const a of db.prepare('SELECT worker_id,supervisor_id FROM assignments ORDER BY supervisor_id').all()) {
      workerById.get(a.worker_id)?.supervisor_ids.push(a.supervisor_id);
    }
  }
  const lock = monthLock(month);
  return {
    user: { id: user.id, name: user.name, role: user.role }, today: localDate(), workers, shifts, projects, staff,
    month, lock, summary: monthSummary(shifts, workers), canEdit: !lock && user.role !== 'worker', demo
  };
}

function validDate(date) {
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
}

function timeMinutes(value) {
  requireThat(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 400, 'Укажите начало и конец смены.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function parseShift(body) {
  requireThat(Number.isSafeInteger(body.worker_id) && validDate(body.date) && Object.hasOwn(kinds, body.kind), 400, 'Проверьте сотрудника, дату и вид записи.');
  requireThat(typeof body.note === 'string' && body.note.length <= 500, 400, 'Комментарий должен быть короче 501 символа.');
  if (body.kind !== 'work') return [null, body.kind, null, null, 0, 0, 0];
  const project = Number.isSafeInteger(body.project_id) && db.prepare('SELECT 1 FROM projects WHERE id=?').get(body.project_id);
  requireThat(project, 400, 'Выберите объект.');
  const start = timeMinutes(body.start);
  const end = timeMinutes(body.end);
  const overnight = body.overnight === true;
  const total = end - start + (overnight ? 1440 : 0);
  requireThat(total > 0 && total <= 1440, 400, 'Проверьте время смены и отметку о переходе через полночь.');
  requireThat(Number.isInteger(body.break_minutes) && body.break_minutes >= 0 && body.break_minutes < total, 400, 'Перерыв должен быть короче смены.');
  return [body.project_id, body.kind, body.start, body.end, Number(overnight), body.break_minutes, total - body.break_minutes];
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function logShift(id, actor, action, detail = null) {
  db.prepare('INSERT INTO events(shift_id,actor_id,action,detail) VALUES(?,?,?,?)').run(id, actor, action, detail);
}

function requireEditor(user) {
  requireThat(user.role !== 'worker', 403, 'Монтажник может только просматривать свои смены.');
}

function writeShift(user, cell, values, { replace = true, source = null } = {}) {
  requireThat(visible(user, cell.worker_id), 403, 'У вас нет доступа к этому сотруднику.');
  const current = db.prepare('SELECT * FROM shifts WHERE worker_id=? AND date=?').get(cell.worker_id, cell.date);
  requireThat((current?.version ?? 0) === cell.version, 409, 'Табель изменился. Обновите его и повторите действие.');
  requireThat(!current || replace, 409, 'В диапазоне уже есть записи. Подтвердите их замену.');
  requireThat(current?.status !== 'closed', 409, 'В диапазоне есть закрытая смена.');
  const note = source ? (current?.note ?? '') : cell.note.trim();
  let saved;
  if (current) {
    saved = db.prepare(`UPDATE shifts SET project_id=?,kind=?,start=?,end=?,overnight=?,break_minutes=?,minutes=?,note=?,
      version=version+1 WHERE id=? RETURNING *`).get(...values, note, current.id);
  } else {
    saved = db.prepare(`INSERT INTO shifts(worker_id,date,project_id,kind,start,end,overnight,break_minutes,minutes,note,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,'approved') RETURNING *`).get(cell.worker_id, cell.date, ...values, note);
  }
  logShift(saved.id, user.id, source ? 'filled' : current ? 'edited' : 'created', source?.date ?? null);
  return withOvertime(saved);
}

function saveShift(user, body) {
  requireEditor(user);
  return transaction(() => {
    const values = parseShift(body);
    requireThat(!monthLock(body.date.slice(0, 7)), 409, 'Месяц закрыт кадровиком. Изменения заблокированы.');
    return writeShift(user, body, values);
  });
}

function fillShifts(user, body) {
  requireEditor(user);
  const { source_id: sourceId, source_version: sourceVersion, direction, targets } = body;
  requireThat(Number.isSafeInteger(sourceId) && Number.isSafeInteger(sourceVersion) && ['right', 'down'].includes(direction)
    && Array.isArray(targets) && targets.length > 0 && targets.length <= 1000, 400, 'Выберите диапазон для заполнения.');
  return transaction(() => {
    const source = db.prepare('SELECT * FROM shifts WHERE id=?').get(sourceId);
    requireThat(source && visible(user, source.worker_id), 404, 'Исходная смена не найдена.');
    requireThat(source.version === sourceVersion, 409, 'Исходная смена изменилась. Обновите табель.');
    const month = source.date.slice(0, 7);
    requireThat(!monthLock(month) && source.status !== 'closed', 409, 'Выберите запись открытого месяца.');
    const seen = new Set();
    const values = [source.project_id, source.kind, source.start, source.end, source.overnight, source.break_minutes, source.minutes];
    for (const cell of targets) {
      requireThat(cell && Number.isSafeInteger(cell.worker_id) && Number.isSafeInteger(cell.version) && validDate(cell.date)
        && cell.date.startsWith(month), 400, 'Заполняйте ячейки в пределах одного месяца.');
      const right = cell.worker_id === source.worker_id && cell.date > source.date;
      const down = cell.worker_id !== source.worker_id && cell.date === source.date;
      requireThat(direction === 'right' ? right : down, 400, 'Выберите ячейки справа или в том же столбце.');
      const key = cell.worker_id + ':' + cell.date;
      requireThat(!seen.has(key), 400, 'В диапазоне есть повторяющиеся ячейки.');
      seen.add(key);
      writeShift(user, cell, values, { source, replace: body.replace_existing === true });
    }
    return { count: seen.size };
  });
}

function closeMonth(user, body) {
  requireThat(user.role === 'hr', 403, 'Закрыть месяц может только кадровик.');
  const { month, revision } = body;
  requireThat(validMonth(month), 400, 'Выберите корректный месяц.');
  return transaction(() => {
    const snapshot = data(user, month);
    requireThat(!snapshot.lock, 409, 'Этот месяц уже закрыт.');
    requireThat(snapshot.summary.records, 409, 'В выбранном месяце пока нет записей.');
    requireThat(snapshot.summary.revision === revision, 409, 'Табель изменился. Обновите месяц и проверьте итоги.');
    const period = [month + '-01', month + '-31'];
    db.prepare('INSERT INTO month_locks(month,closed_by) VALUES(?,?)').run(month, user.id);
    db.prepare(`UPDATE shifts SET status='closed',version=version+1
      WHERE date BETWEEN ? AND ? AND status<>'closed'`).run(...period);
    db.prepare(`INSERT INTO events(shift_id,actor_id,action,detail)
      SELECT id,?,'month_closed',? FROM shifts WHERE date BETWEEN ? AND ?`).run(user.id, month, ...period);
    return monthLock(month);
  });
}

function csvCell(value) {
  if (value == null) return '""';
  const string = String(value);
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@\t\r\n]/.test(string) ? "'" + string : string;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function exportCsv(res, user, month) {
  const { shifts, workers, projects } = data(user, month);
  const names = new Map(workers.map(worker => [worker.id, worker.name]));
  const objects = new Map(projects.map(project => [project.id, project.name]));
  const rows = [['Дата', 'Сотрудник', 'Вид записи', 'Объект', 'Начало', 'Конец', 'Через полночь', 'Перерыв (мин)', 'Учтено (мин)', 'Статус', 'Комментарий', 'Переработка (мин)', 'Обычные ×1 (мин)', 'Переработка ×1,5 (мин)', 'Переработка ×2 (мин)']];
  shifts.forEach(s => rows.push([s.date, names.get(s.worker_id), kinds[s.kind], objects.get(s.project_id), s.start, s.end, s.overnight ? 'Да' : '', s.break_minutes, s.minutes, statuses[s.status], s.note, s.overtime_minutes, s.regular_minutes, s.overtime_15_minutes, s.overtime_20_minutes]));
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tabel-' + month + '.csv"' });
  res.end('\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n');
}

function limitLogin(req, name) {
  const address = req.socket.remoteAddress;
  const now = Date.now();
  for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
  requireThat(limits.size < 10000, 429, 'Попробуйте войти позже.');
  const buckets = [['ip:' + address, 100], ['user:' + name.toLowerCase(), 10]];
  for (const [key, threshold] of buckets) requireThat((limits.get(key)?.count ?? 0) < threshold, 429, 'Слишком много попыток. Повторите через 10 минут.');
  for (const [key] of buckets) {
    const entry = limits.get(key) ?? { count: 0, until: now + 600000 };
    entry.count++;
    limits.set(key, entry);
  }
}

async function login(req, res, body, previous, mobile) {
  requireThat(typeof body.username === 'string' && typeof body.password === 'string'
    && body.username.length <= 40 && body.password.length <= 128, 400, 'Проверьте логин и пароль.');
  const name = body.username.trim();
  limitLogin(req, name);
  const user = db.prepare('SELECT id,password FROM users WHERE username=?').get(name);
  const valid = await checkPassword(body.password, user?.password ?? fallbackPassword);
  requireThat(valid && user?.password, 401, 'Неверный логин или пароль.');
  limits.delete('user:' + name.toLowerCase());
  return json(res, setSession(res, user, previous, mobile));
}

function validateAssignments(ids) {
  requireThat(Array.isArray(ids) && ids.length <= 100 && ids.every(Number.isSafeInteger), 400, 'Проверьте список руководителей.');
  const valid = db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('master','foreman','engineer')");
  requireThat(ids.every(id => valid.get(id)), 400, 'Выберите мастеров, прорабов и инженеров из списка.');
  return [...new Set(ids)];
}

function writeAssignments(worker, ids) {
  db.prepare('DELETE FROM assignments WHERE worker_id=?').run(worker);
  const add = db.prepare('INSERT INTO assignments VALUES(?,?)');
  ids.forEach(id => add.run(worker, id));
}

async function createUser(res, body) {
  const { username, name, role, password, grade } = body;
  requireThat(typeof username === 'string' && /^[a-z0-9._-]{3,40}$/i.test(username) && Object.hasOwn(roles, role), 400, 'Укажите роль и логин из 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний.');
  requireThat(typeof name === 'string' && name.trim().length > 1 && name.trim().length <= 120, 400, 'Укажите имя сотрудника.');
  requireThat(typeof password === 'string' && password.length >= 12 && password.length <= 128, 400, 'Пароль должен содержать от 12 до 128 символов.');
  const worker = role === 'worker';
  requireThat(!worker || grade === null || (Number.isInteger(grade) && grade >= 1 && grade <= 8), 400, 'Укажите разряд от 1 до 8.');
  const hash = await hashPassword(password);
  try {
    transaction(() => {
      const ids = worker ? validateAssignments(body.supervisor_ids ?? []) : [];
      const result = db.prepare('INSERT INTO users(username,name,role,password,grade) VALUES(?,?,?,?,?)')
        .run(username, name.trim(), role, hash, worker ? grade : null);
      if (worker) writeAssignments(result.lastInsertRowid, ids);
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) throw new HttpError(409, 'Этот логин уже используется.');
    throw error;
  }
  return json(res, { ok: true }, 201);
}

function updateAssignments(user, worker, ids) {
  requireThat(user.role === 'hr', 403, 'Руководителей назначает кадровик.');
  transaction(() => {
    requireThat(db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker'").get(worker), 404, 'Сотрудник не найден.');
    writeAssignments(worker, validateAssignments(ids));
  });
  return { ok: true };
}

function saveProject(res, body, id = null) {
  requireThat(typeof body.name === 'string' && body.name.trim() && body.name.trim().length <= 80
    && typeof body.address === 'string' && body.address.length <= 160, 400, 'Проверьте название и адрес объекта.');
  requireThat(body.color === undefined || (typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)),
    400, 'Выберите корректный цвет объекта.');
  transaction(() => {
    const name = body.name.trim();
    const projects = db.prepare('SELECT id,name,color FROM projects').all();
    const existing = projects.find(project => project.id === id);
    requireThat(id === null || existing, 404, 'Объект не найден.');
    requireThat(!projects.some(project => project.id !== id && project.name.toLowerCase() === name.toLowerCase()),
      409, 'Такой объект уже существует.');
    const color = body.color?.toLowerCase() ?? existing?.color ??
      projectColors.find(value => !projects.some(project => project.color === value)) ?? projectColors[0];
    if (existing) db.prepare('UPDATE projects SET name=?,address=?,color=? WHERE id=?').run(name, body.address.trim(), color, id);
    else db.prepare('INSERT INTO projects(name,address,color) VALUES(?,?,?)').run(name, body.address.trim(), color);
  });
  return json(res, { ok: true }, id === null ? 201 : 200);
}

async function handle(req, res) {
  const origin = externalOrigin || 'http://' + req.headers.host;
  const url = new URL(req.url, origin);
  const mobile = url.pathname.startsWith('/api/mobile/');
  const path = mobile ? '/api/' + url.pathname.slice('/api/mobile/'.length) : url.pathname;
  const method = req.method;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  if (method === 'GET' && path === '/healthz') return json(res, { ok: true });
  if (method === 'GET' && Object.hasOwn(assets, path)) {
    const [, type, content] = assets[path];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': path === '/' || path === '/sw.js' ? 'no-store' : 'no-cache' });
    return res.end(content);
  }
  if (mobile) {
    requireThat(!req.headers.origin && !req.headers['sec-fetch-site'], 403, 'Используйте мобильное приложение.');
  } else if (method === 'POST') {
    requireThat(req.headers.origin === origin || (!req.headers.origin && req.headers['x-tabel-client'] === 'cli'), 403, 'Источник запроса не совпадает с адресом приложения.');
    requireThat(req.headers['sec-fetch-site'] !== 'cross-site', 403, 'Источник запроса не совпадает с адресом приложения.');
  }
  const user = session(req, mobile);
  if (method === 'GET' && path === '/api/session') {
    return json(res, { user: user ? { id: user.id, name: user.name, role: user.role } : null, today: localDate(), demo });
  }
  if (method === 'POST' && path === '/api/login') return login(req, res, await readJson(req), user, mobile);
  if (method === 'POST' && path === '/api/demo' && demo && !mobile) {
    const { role } = await readJson(req);
    requireThat(Object.hasOwn(roles, role), 400, 'Выберите роль.');
    const account = db.prepare('SELECT id FROM users WHERE role=? ORDER BY id LIMIT 1').get(role);
    setSession(res, account, user);
    return json(res, { ok: true });
  }
  if (method === 'POST' && path === '/api/logout') {
    if (user) db.prepare(mobile ? 'DELETE FROM mobile_sessions WHERE digest=?' : 'DELETE FROM sessions WHERE digest=?').run(user.digest);
    if (!mobile) setCookie(res, '', 0);
    return json(res, { ok: true });
  }
  requireThat(path.startsWith('/api/'), 404, 'Страница не найдена.');
  requireThat(user, 401, 'Войдите в приложение.');
  const month = url.searchParams.get('month') || localDate().slice(0, 7);
  if (method === 'GET' && path === '/api/tabel') return json(res, data(user, month));
  if (method === 'GET' && path === '/api/export') {
    requireThat(user.role !== 'worker', 403, 'Выгрузка доступна руководителям и кадровику.');
    return exportCsv(res, user, month);
  }
  if (method === 'POST' && path === '/api/shifts/fill') return json(res, fillShifts(user, await readJson(req, 131072)));
  if (method === 'POST' && path === '/api/shifts') return json(res, saveShift(user, await readJson(req)));
  if (method === 'POST' && path === '/api/months/close') return json(res, closeMonth(user, await readJson(req)));
  const assignmentPath = path.match(/^\/api\/users\/(\d+)\/assignments$/);
  if (method === 'POST' && assignmentPath) {
    const body = await readJson(req);
    return json(res, updateAssignments(user, Number(assignmentPath[1]), body.supervisor_ids));
  }
  const shiftPath = path.match(/^\/api\/shifts\/(\d+)\/history$/);
  if (method === 'GET' && shiftPath) {
    const id = Number(shiftPath[1]);
    const shift = db.prepare('SELECT worker_id FROM shifts WHERE id=?').get(id);
    requireThat(shift && visible(user, shift.worker_id), 404, 'Запись не найдена.');
    return json(res, db.prepare(`SELECT e.action,e.created_at,e.detail,u.name FROM events e
      JOIN users u ON u.id=e.actor_id WHERE e.shift_id=? ORDER BY e.id DESC LIMIT 50`).all(id));
  }
  const projectPath = path.match(/^\/api\/projects(?:\/(\d+))?$/);
  if (method === 'POST' && (path === '/api/users' || projectPath)) {
    requireThat(user.role === 'hr', 403, 'Действие доступно кадровику.');
    const body = await readJson(req);
    return projectPath ? saveProject(res, body, projectPath[1] ? Number(projectPath[1]) : null) : createUser(res, body);
  }
  throw new HttpError(404, 'Действие не найдено.');
}

const server = createServer({ requestTimeout: 15000 }, (req, res) => {
  handle(req, res).catch(error => {
    if (!error.status) console.error(error);
    if (res.headersSent) return res.destroy();
    json(res, { error: error.status ? error.message : 'Ошибка сервера. Повторите действие.' }, error.status || 500);
  });
});
const host = process.env.TABEL_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => console.log('Tabel: http://' + host + ':' + server.address().port + (demo ? ' (демо)' : '')));
