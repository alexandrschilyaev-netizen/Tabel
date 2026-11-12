const $ = selector => document.querySelector(selector);
const roles = { worker: 'Монтажник', master: 'Мастер', foreman: 'Прораб', engineer: 'Инженер', hr: 'Кадровик' };
const projectColors = ['#2563eb', '#15803d', '#b45309', '#7c3aed', '#be185d', '#0e7490', '#b91c1c', '#475569'];
const statuses = { approved: 'Учтена', closed: 'Закрыта' };
const kinds = { work: 'Работа', vacation: 'Отпуск', sick: 'Больничный', dayoff: 'Выходной' };
const pages = { tabel: 'Табель', workers: 'Сотрудники', projects: 'Объекты' };
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const paths = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m1-16a3 3 0 0 1 0 6m1 4a4 4 0 0 1 4 4v2"/>',
  building: '<path d="M3 21h18M5 21V6l10-3v18m4 0v-9h-4M8 8h3m-3 4h3m-3 4h3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  logout: '<path d="M10 17l5-5-5-5m5 5H3m11-8h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'
};
const state = { session: null, data: null, month: '', day: '', page: 'tabel' };
const editor = $('#editor');
const grid = $('#schedule-desktop');
let fillWorkers = [];
let dragFill = null;
let ignoreHandleClick = false;
let fillPending = false;
let installPrompt;
let loadId = 0;

function svg(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
}

function icon(name) {
  return '<span data-icon="' + name + '">' + svg(name) + '</span>';
}

function safe(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const number = new Intl.NumberFormat('ru');
const fullDay = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function asDate(iso) { return new Date(iso + 'T00:00:00Z'); }
function dayOfWeek(iso) { return asDate(iso).getUTCDay(); }
function dayLabel(iso) { return fullDay.format(asDate(iso)); }
function offsetDay(iso, offset) {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function weekDays(iso) {
  const monday = offsetDay(iso, -((dayOfWeek(iso) + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => offsetDay(monday, index));
}
function hours(minutes) {
  const h = Math.floor(minutes / 60);
  return number.format(h) + ' ч' + (minutes % 60 ? ' ' + minutes % 60 + ' мин' : '');
}
function overtimeBadge(minutes) {
  return minutes > 0 ? '<small class="overtime" aria-label="Переработка ' + hours(minutes) + '">+' + hours(minutes) + '</small>' : '';
}

function colorAttr(color) {
  return /^#[0-9a-f]{6}$/i.test(color ?? '') ? ' data-project-color="' + color + '"' : '';
}

function paintProjects(container) {
  container.querySelectorAll('[data-project-color]').forEach(node => {
    node.style.setProperty('--project-color', node.dataset.projectColor);
  });
}

function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
function option(value, label, selected = false) {
  return '<option value="' + safe(value) + '"' + (selected ? ' selected' : '') + '>' + safe(label) + '</option>';
}
function statusPill(status) {
  return '<span class="status-pill status-' + status + '"><i class="dot" aria-hidden="true"></i>' + statuses[status] + '</span>';
}
function person(worker, caption) {
  return '<span class="person"><span class="avatar" data-tone="' + worker.id % 4 + '" aria-hidden="true">' +
    safe(initials(worker.name)) + '</span><span><strong>' + safe(worker.name) + '</strong><small>' + safe(caption) + '</small></span></span>';
}
function workerCaption(worker) { return worker.grade ? worker.grade + '-й разряд' : roles.worker; }

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  };
  const response = await fetch('/api/' + path, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = new Error(result.error || 'Запрос не выполнен. Повторите действие.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function alertIn(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function notice(message, error = false) {
  $('#notice').toggleAttribute('data-error', error);
  alertIn($('#notice'), message);
}

function connection() {
  alertIn($('#connection'), navigator.onLine ? '' : 'Нет подключения к серверу. Дождитесь подключения перед изменением табеля.');
}

function fillFilters() {
  const project = $('#project-filter').value;
  $('#project-filter').innerHTML = option('', 'Все объекты') + state.data.projects.map(p => option(p.id, p.name, project === String(p.id))).join('');
  $('#month-filter').value = state.month.slice(5);
  $('#year-filter').value = state.month.slice(0, 4);
}

async function load(month = state.month, day = state.day) {
  const request = ++loadId;
  try {
    const data = await api('tabel?month=' + encodeURIComponent(month));
    if (request !== loadId) return;
    state.month = month;
    state.day = day;
    state.data = data;
    fillFilters();
    render();
  } catch (error) {
    if (request !== loadId) return;
    if (state.data) fillFilters();
    if (error.status === 401) await enter();
    else notice(error.message, true);
  }
}

async function enter() {
  const session = await api('session');
  state.session = session;
  $('#startup').hidden = true;
  $('#login').hidden = Boolean(session.user);
  $('#app').hidden = !session.user;
  $('#app').classList.toggle('worker-view', session.user?.role === 'worker');
  $('#demo-login').hidden = !session.demo;
  if (!session.user) {
    ++loadId;
    if (editor.open) editor.close();
    state.data = null;
    $('#login-form').reset();
    return;
  }
  const user = session.user;
  $('#user-name').textContent = user.name;
  $('#user-role').textContent = roles[user.role];
  $('#user-avatar').textContent = initials(user.name);
  $('#demo-tag').hidden = !session.demo;
  $('#search').value = '';
  $('#project-filter').value = '';
  $('#status-filter').value = '';
  state.page = user.role === 'worker' ? 'tabel' : activePage();
  notice('');
  await load(session.today.slice(0, 7), session.today);
  connection();
}

function render() {
  const { user, lock, canEdit, summary } = state.data;
  $('#tabel-view').hidden = state.page !== 'tabel';
  $('#directory-view').hidden = state.page === 'tabel';
  $('#trail-page').textContent = pages[state.page];
  document.querySelectorAll('[data-page]').forEach(button => {
    if (button.dataset.page === state.page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#add-shift').hidden = !canEdit;
  $('#add-shift').disabled = !state.data.workers.length;
  $('#export').hidden = user.role === 'worker';
  $('#close-month').hidden = user.role !== 'hr' || Boolean(lock);
  $('#close-month').disabled = !summary.records;
  alertIn($('#month-lock'), lock ? 'Месяц закрыт · ' + lock.closed_by + ' · ' + timestamp(lock.closed_at) : '');
  if (state.page !== 'tabel') return renderDirectory(user);
  const month = monthNames[Number(state.month.slice(5)) - 1] + ' ' + state.month.slice(0, 4);
  $('#period-caption').textContent = month + (user.role === 'worker' ? ' · Мои смены' : user.role === 'hr' ? ' · Все сотрудники' : ' · Назначенные сотрудники');
  $('#export').href = '/api/export?month=' + state.month;
  renderStats();
  renderSchedule();
}

function renderStats() {
  const { summary, workers, lock, user } = state.data;
  const metrics = [
    ['Учтено за месяц', hours(summary.minutes), 'Переработка: ' + hours(summary.overtime_minutes), 'clock', ''],
    ['Рабочих смен', number.format(summary.workShifts), 'Сотрудников: ' + number.format(workers.length), 'calendar', ''],
    ['Записей в табеле', number.format(summary.records), 'В том числе отсутствия', 'users', ''],
    ['Статус месяца', lock ? 'Закрыт' : 'Открыт', lock ? 'Просмотр' : 'В работе', 'check', 'approved']
  ];
  const visibleMetrics = user.role === 'worker' ? metrics.slice(0, 2) : metrics;
  $('#stats').innerHTML = visibleMetrics.map(([label, value, detail, symbol, tone]) =>
    '<article class="stat"><div class="stat-head"><span>' + label + '</span><span class="stat-icon ' + tone + '">' + icon(symbol) +
    '</span></div><strong>' + value + '</strong><small>' + detail + '</small></article>'
  ).join('');
}

function renderSchedule() {
  clearDragFill();
  const { workers, shifts, projects, today, canEdit } = state.data;
  const dates = weekDays(state.day);
  const query = $('#search').value.trim().toLowerCase();
  const projectFilter = Number($('#project-filter').value);
  const statusFilter = $('#status-filter').value;
  const projectsById = new Map(projects.map(p => [p.id, p]));
  const byWorkerDate = new Map(shifts.map(shift => [shift.worker_id + ':' + shift.date, shift]));
  const matches = shift => Boolean(shift && (!projectFilter || shift.project_id === projectFilter) && (!statusFilter || shift.status === statusFilter));
  const filtering = Boolean(projectFilter || statusFilter);
  const visible = workers.filter(worker => worker.name.toLowerCase().includes(query));
  const weekWorkers = filtering ? visible.filter(worker => dates.some(date => matches(byWorkerDate.get(worker.id + ':' + date)))) : visible;
  fillWorkers = weekWorkers;
  $('#fill-hint').hidden = !(canEdit && !filtering && shifts.some(shift =>
    shift.status !== 'closed' && dates.includes(shift.date) && weekWorkers.some(worker => worker.id === shift.worker_id)));
  const dayWorkers = filtering ? visible.filter(worker => matches(byWorkerDate.get(worker.id + ':' + state.day))) : visible;
  const monthDays = dates.filter(date => date.startsWith(state.month));
  $('#week-label').textContent = shortDay.format(asDate(monthDays[0])) + ' — ' + shortDay.format(asDate(monthDays.at(-1)));
  $('#week-prev').disabled = offsetDay(monthDays[0], -1) < '2000-01-01';
  $('#week-next').disabled = offsetDay(monthDays.at(-1), 1) > '2099-12-31';
  $('#day-selector').innerHTML = dates.map(date => '<button data-day="' + date + '" aria-label="' + dayLabel(date) +
    '" aria-pressed="' + (state.day === date) + '"' + (date.startsWith(state.month) ? '' : ' disabled') +
    '><small>' + weekdays[dayOfWeek(date)] + '</small><strong>' + Number(date.slice(8)) + '</strong></button>').join('');
  const emptyMessage = !workers.length ? 'В табеле пока нет сотрудников.' : 'По выбранным условиям смены не найдены.';
  const tableHeader = '<thead><tr><th scope="col">Сотрудник</th>' + dates.map(date =>
    '<th scope="col" class="' + (date === today ? 'current-day' : [0, 6].includes(dayOfWeek(date)) ? 'weekend' : '') + '">' +
    '<span>' + weekdays[dayOfWeek(date)] + '</span><strong>' + Number(date.slice(8)) + '</strong></th>'
  ).join('') + '<th scope="col">Итого</th></tr></thead>';
  const rows = weekWorkers.map((worker, row) => {
    let total = 0;
    let overtime = 0;
    const cells = dates.map((date, column) => {
      if (!date.startsWith(state.month)) return '<td>·</td>';
      const shift = byWorkerDate.get(worker.id + ':' + date);
      if (filtering && !matches(shift)) return '<td>·</td>';
      if (!shift && !canEdit) return '<td>—</td>';
      total += shift?.minutes ?? 0;
      overtime += shift?.overtime_minutes ?? 0;
      const project = projectsById.get(shift?.project_id);
      const work = shift?.kind === 'work';
      const label = shift ? (work ? hours(shift.minutes) + ', ' + (project?.name ?? '') : kinds[shift.kind]) +
        (shift.overtime_minutes ? ', переработка ' + hours(shift.overtime_minutes) : '') + ', ' + statuses[shift.status] : 'Добавить смену';
      const fillCell = canEdit && !filtering
        ? ' data-fill-row="' + row + '" data-fill-column="' + column + '" data-fill-date="' + date + '"' : '';
      const hasHandle = fillCell && shift && shift.status !== 'closed';
      const handle = hasHandle ? '<button type="button" class="fill-handle" data-fill-source="' + shift.id +
        '" title="Протянуть вправо или вниз" aria-label="' + safe('Заполнить диапазон: ' + worker.name + ', ' + dayLabel(date)) + '"><span></span></button>' : '';
      return '<td' + fillCell + '><button type="button" class="shift-cell ' + (shift ? 'status-' + shift.status : 'empty') +
        (hasHandle ? ' has-fill' : '') + '" data-worker="' + worker.id + '" data-date="' + date + '"' + colorAttr(project?.color) +
        ' aria-label="' + safe(worker.name + ', ' + dayLabel(date) + ', ' + label) + '" title="' + safe(label) + '">' +
        (work ? '<strong>' + hours(shift.minutes) + '</strong><small>' + safe(project?.name) + '</small>' + overtimeBadge(shift.overtime_minutes)
          : shift ? '<small>' + kinds[shift.kind] + '</small>' : '—') + '</button>' + handle + '</td>';
    }).join('');
    return '<tr><th scope="row">' + person(worker, workerCaption(worker)) + '</th>' + cells +
      '<td class="week-total">' + hours(total) + overtimeBadge(overtime) + '</td></tr>';
  }).join('');
  grid.innerHTML = weekWorkers.length
    ? '<table aria-label="Смены сотрудников за неделю">' + tableHeader + '<tbody>' + rows + '</tbody></table>'
    : '<p class="empty-state">' + emptyMessage + '</p>';
  $('#schedule-mobile').innerHTML = dayWorkers.length ? dayWorkers.map(worker => {
    const shift = byWorkerDate.get(worker.id + ':' + state.day);
    const project = projectsById.get(shift?.project_id);
    const details = shift
      ? '<strong' + colorAttr(project?.color) + '>' + (shift.kind === 'work' ? hours(shift.minutes) + ' · ' + safe(project?.name) : kinds[shift.kind]) +
        '</strong>' + overtimeBadge(shift.overtime_minutes) + statusPill(shift.status)
      : '<span>' + (canEdit ? 'Добавить смену' : 'Нет записи') + '</span>';
    const content = person(worker, workerCaption(worker)) + '<span class="mobile-shift">' + details + '</span>';
    return shift || canEdit ? '<button class="mobile-row" type="button" data-worker="' + worker.id + '" data-date="' + state.day + '">' +
      content + '</button>' : '<div class="mobile-row">' + content + '</div>';
  }).join('') : '<p class="empty-state">' + emptyMessage + '</p>';
  paintProjects(grid);
  paintProjects($('#schedule-mobile'));
}

function renderDirectory(user) {
  const workers = state.page === 'workers';
  $('#directory-title').textContent = pages[state.page];
  $('#directory-caption').textContent = workers
    ? 'Сотрудники и руководители в вашем табеле'
    : 'Площадки, на которых учитывается рабочее время';
  $('#add-directory').hidden = user.role !== 'hr';
  $('#directory-add-label').textContent = workers ? 'Добавить сотрудника' : 'Добавить объект';
  const staff = new Map(state.data.staff.map(person => [person.id, person]));
  const data = workers ? [...state.data.staff, ...state.data.workers] : state.data.projects;
  const rows = data.map(row => {
    if (!workers) {
      const edit = user.role === 'hr' ? '<button type="button" data-project-edit="' + row.id + '" aria-label="' +
        safe('Изменить объект ' + row.name) + '">Изменить</button>' : '';
      return '<div class="directory-row"><div class="project-entry"><span class="project-swatch"' + colorAttr(row.color) +
        ' aria-hidden="true"></span><div><strong>' + safe(row.name) + '</strong>' +
        (row.address ? '<br><small>' + safe(row.address) + '</small>' : '') + '</div></div>' + edit + '</div>';
    }
    const worker = !row.role;
    const assigned = row.supervisor_ids?.map(id => staff.get(id)?.name).filter(Boolean).join(', ');
    const caption = worker ? workerCaption(row) + (assigned ? ' · ' + assigned : '') : roles[row.role];
    const assign = worker && user.role === 'hr' ? '<button type="button" data-assign="' + row.id + '">Руководители</button>' : '';
    return '<div class="directory-row">' + person(row, caption) + assign + '</div>';
  });
  $('#directory').innerHTML = rows.join('') || '<p class="empty-state">Список пока пуст.</p>';
  paintProjects($('#directory'));
}

function openDialog(title, caption, markup) {
  $('#editor-title').textContent = title;
  alertIn($('#editor-caption'), caption);
  $('#editor-body').innerHTML = markup;
  paintProjects($('#editor-body'));
  if (!editor.open) editor.showModal();
}

function field(label, name, attributes = '') {
  return '<label>' + label + '<input name="' + name + '" ' + attributes + '></label>';
}

function selectField(label, name, options, attributes = '') {
  return '<label>' + label + '<select name="' + name + '" ' + attributes + '>' + options + '</select></label>';
}

const errorMarkup = '<p class="error" role="alert" hidden></p>';
const cancel = '<button type="button" class="close-dialog">Отмена</button>';

function bindForm(form, save, success) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    const initial = submit.textContent;
    lockEditor(true);
    submit.textContent = 'Сохраняем…';
    const errorBox = form.querySelector('.error');
    alertIn(errorBox, '');
    try {
      await save(form.elements);
      editor.close();
      notice(success);
      await load();
    } catch (error) {
      alertIn(errorBox, error.message);
    } finally {
      lockEditor(false);
      submit.textContent = initial;
    }
  });
}

function openShift(workerId, date) {
  if (!state.data.workers.length) return;
  const shift = state.data.shifts.find(item => item.worker_id === workerId && item.date === date);
  if (shift && (!state.data.canEdit || shift.status === 'closed')) return openDetails(shift);
  if (!state.data.canEdit) return;
  const fixed = Boolean(workerId && date);
  const worker = state.data.workers.find(item => item.id === workerId);
  const workerOptions = state.data.workers.map(w => option(w.id, w.name, w.id === workerId)).join('');
  const projectOptions = option('', 'Выберите объект') + state.data.projects.map(p => option(p.id, p.name, p.id === shift?.project_id)).join('');
  const activeKind = shift?.kind ?? 'work';
  const kindOptions = Object.entries(kinds).map(([key, label]) => option(key, label, activeKind === key)).join('');
  const monthEnd = offsetDay(offsetDay(state.month + '-01', 32).slice(0, 7) + '-01', -1);
  openDialog(shift ? 'Редактирование смены' : 'Добавление смены', fixed ? worker.name + ' · ' + dayLabel(date) : '', '<form class="editor-form">' +
    (fixed ? '' : '<div class="form-grid">' + selectField('Сотрудник', 'worker', workerOptions, 'required') +
      field('Дата', 'date', 'type="date" required value="' + state.day + '" min="' + state.month + '-01" max="' + monthEnd + '"') + '</div>') +
    selectField('Вид записи', 'kind', kindOptions) +
    '<div id="work-fields">' + selectField('Объект', 'project', projectOptions) +
    '<div class="form-grid">' + field('Начало', 'start', 'type="time" value="' + (shift?.start ?? '08:00') + '"') +
    field('Конец', 'end', 'type="time" value="' + (shift?.end ?? '17:00') + '"') + '</div>' +
    field('Перерыв, мин', 'pause', 'type="number" inputmode="numeric" min="0" max="1439" value="' + (shift?.break_minutes ?? 0) + '"') +
    '<label class="check"><input name="overnight" type="checkbox"' + (shift?.overnight ? ' checked' : '') + '>Смена заканчивается на следующий день</label><p class="overtime" data-overtime hidden></p></div>' +
    '<label>Комментарий<textarea name="note" rows="2" maxlength="500">' + safe(shift?.note) + '</textarea></label>' +
    errorMarkup + '<div class="dialog-actions">' + cancel + '<button class="primary" type="submit">Сохранить запись</button></div></form>' +
    (shift && fillAvailable() ? '<button type="button" data-fill-picker="' + shift.id + '">Заполнить диапазон</button>' : '') +
    (shift ? historyMarkup() : '')
  );
  const form = editor.querySelector('form');
  const toggle = () => {
    const work = form.elements.kind.value === 'work';
    $('#work-fields').hidden = !work;
    for (const name of ['project', 'start', 'end', 'pause']) form.elements[name].required = work;
  };
  const preview = () => {
    const fields = form.elements;
    const minutes = value => value.split(':').map(Number).reduce((h, m) => h * 60 + m);
    const total = minutes(fields.end.value) - minutes(fields.start.value) + (fields.overnight.checked ? 1440 : 0);
    const pause = Number(fields.pause.value);
    const extra = total <= 1440 && pause >= 0 ? total - pause - 480 : 0;
    alertIn(form.querySelector('[data-overtime]'), fields.start.value && fields.end.value && extra > 0
      ? 'Переработка: ' + hours(extra) : '');
  };
  form.elements.kind.addEventListener('change', toggle);
  form.addEventListener('input', preview);
  toggle();
  preview();
  bindForm(form, fields => api('shifts', {
    worker_id: workerId || Number(fields.worker.value), date: date || fields.date.value, kind: fields.kind.value,
    project_id: Number(fields.project.value), start: fields.start.value, end: fields.end.value, overnight: fields.overnight.checked,
    break_minutes: Number(fields.pause.value), note: fields.note.value, version: shift?.version ?? 0
  }), 'Запись сохранена.');
  if (shift) bindHistory(shift);
}

function historyMarkup() {
  return '<details class="history"><summary>История изменений</summary><div class="history-body" aria-live="polite"></div></details>';
}

function timestamp(value) {
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' });
}

function bindHistory(shift) {
  const details = editor.querySelector('.history');
  const body = details.querySelector('.history-body');
  details.addEventListener('toggle', async () => {
    if (!details.open || body.dataset.loaded) return;
    body.textContent = 'Загружаем…';
    try {
      const events = await api('shifts/' + shift.id + '/history');
      const labels = { created: 'Создание', edited: 'Изменение', filled: 'Заполнение из смены', submit: 'Отправка', approve: 'Согласование', return: 'Возврат', close: 'Закрытие', month_closed: 'Закрытие месяца' };
      body.innerHTML = events.length ? '<ul>' + events.map(e => {
        const time = timestamp(e.created_at);
        return '<li>' + safe(time + ' · ' + e.name + ' · ' + labels[e.action] + (e.detail ? ' · ' + e.detail : '')) + '</li>';
      }).join('') + '</ul>' : '<p>Изменений пока нет.</p>';
      body.dataset.loaded = 'true';
    } catch (error) {
      body.textContent = error.message;
    }
  });
}

function openDetails(shift) {
  const { workers, projects } = state.data;
  const worker = workers.find(w => w.id === shift.worker_id);
  const project = projects.find(p => p.id === shift.project_id);
  const work = shift.kind === 'work';
  openDialog('Смена', worker.name + ' · ' + dayLabel(shift.date), '<dl class="details">' +
    '<div><dt>Статус</dt><dd>' + statusPill(shift.status) + '</dd></div><div><dt>Вид записи</dt><dd>' + kinds[shift.kind] + '</dd></div>' +
    (work ? '<div><dt>Объект</dt><dd><span class="project-label"' + colorAttr(project?.color) + '>' + safe(project?.name) +
      '</span></dd></div><div><dt>Учтено</dt><dd>' + hours(shift.minutes) +
      '</dd></div>' + (shift.overtime_minutes ? '<div><dt>Переработка</dt><dd class="overtime">' + hours(shift.overtime_minutes) + '</dd></div>' : '') +
      '<div><dt>Рабочее время</dt><dd>' + shift.start + '–' + shift.end + (shift.overnight ? ' (+1 день)' : '') +
      '</dd></div><div><dt>Перерыв</dt><dd>' + shift.break_minutes + ' мин</dd></div>' : '') +
    (shift.note ? '<div class="wide"><dt>Комментарий</dt><dd>' + safe(shift.note) + '</dd></div>' : '') + '</dl>' +
    historyMarkup());
  bindHistory(shift);
}

function openDirectoryEditor(project = null) {
  const workers = state.page === 'workers';
  const color = project?.color ?? projectColors.find(value => !state.data.projects.some(item => item.color === value)) ?? projectColors[0];
  openDialog(workers ? 'Добавление сотрудника' : project ? 'Изменение объекта' : 'Добавление объекта', '', '<form class="editor-form">' +
    (workers ? field('Фамилия и имя', 'name', 'required maxlength="120" autocomplete="off"') +
      selectField('Роль', 'role', Object.entries(roles).map(([key, label]) => option(key, label)).join('')) +
      '<div id="worker-fields">' + field('Разряд', 'grade', 'type="number" min="1" max="8"') + assignmentChoices([]) + '</div>' +
      field('Логин', 'username', 'required minlength="3" maxlength="40" pattern="[A-Za-z0-9._\\-]+" autocomplete="off"') +
      field('Пароль (от 12 символов)', 'password', 'type="password" required minlength="12" maxlength="128" autocomplete="new-password"')
      : field('Название', 'name', 'required maxlength="80" value="' + safe(project?.name) + '"') +
      field('Адрес или площадка', 'address', 'maxlength="160" value="' + safe(project?.address) + '"') +
      field('Цвет объекта', 'color', 'type="color" value="' + safe(color) + '"')) +
    errorMarkup + '<div class="dialog-actions">' + cancel + '<button class="primary" type="submit">' +
    (project ? 'Сохранить' : 'Добавить') + '</button></div></form>'
  );
  const form = editor.querySelector('form');
  if (workers) form.elements.role.addEventListener('change', () => { $('#worker-fields').hidden = form.elements.role.value !== 'worker'; });
  bindForm(form, fields => workers ? api('users', {
    name: fields.name.value, username: fields.username.value, role: fields.role.value, password: fields.password.value,
    supervisor_ids: selectedSupervisors(fields), grade: Number(fields.grade.value) || null
  }) : api(project ? 'projects/' + project.id : 'projects', {
    name: fields.name.value, address: fields.address.value, color: fields.color.value
  }), workers ? 'Учётная запись добавлена.' : project ? 'Объект изменён.' : 'Объект добавлен.');
}

function lockEditor(locked) {
  editor.toggleAttribute('aria-busy', locked);
  editor.querySelectorAll('button').forEach(button => { button.disabled = locked; });
}

function assignmentChoices(selected) {
  return '<fieldset class="assignment-choices"><legend>Руководители</legend>' +
    (state.data.staff.map(person =>
      '<label class="check"><input type="checkbox" name="supervisor" value="' + person.id + '"' +
      (selected.includes(person.id) ? ' checked' : '') + '>' + safe(person.name + ' · ' + roles[person.role]) + '</label>'
    ).join('') || '<p>Добавьте мастера, прораба или инженера в справочнике сотрудников.</p>') + '</fieldset>';
}

function selectedSupervisors(fields) {
  return [...fields].filter(field => field.name === 'supervisor' && field.checked).map(field => Number(field.value));
}

function openAssignments(workerId) {
  const worker = state.data.workers.find(person => person.id === workerId);
  openDialog('Назначить руководителей', worker.name, '<form class="editor-form">' +
    assignmentChoices(worker.supervisor_ids) + errorMarkup + '<div class="dialog-actions">' + cancel +
    '<button class="primary" type="submit">Сохранить назначения</button></div></form>');
  bindForm(editor.querySelector('form'), fields => api('users/' + workerId + '/assignments', {
    supervisor_ids: selectedSupervisors(fields)
  }), 'Назначения сохранены.');
}

function openMonthClose() {
  const { summary, month, lock } = state.data;
  if (lock || !summary.records) return;
  openDialog('Закрытие месяца', $('#period-caption').textContent.split(' · ')[0], '<form class="editor-form">' +
    '<dl class="details"><div><dt>Записей</dt><dd>' + number.format(summary.records) +
    '</dd></div><div><dt>Учтённое время</dt><dd>' + hours(summary.minutes) +
    '</dd></div><div><dt>Переработка</dt><dd>' + hours(summary.overtime_minutes) +
    '</dd></div><div><dt>Сотрудников без записей</dt><dd>' + number.format(summary.workersWithoutRecords) + '</dd></div></dl>' +
    '<p>После закрытия месяц доступен только для просмотра. Проверьте итог перед подтверждением.</p>' + errorMarkup +
    '<div class="dialog-actions">' + cancel + '<button class="primary" type="submit">Подтвердить закрытие</button></div></form>');
  bindForm(editor.querySelector('form'), () => api('months/close', {
    month, revision: summary.revision
  }), 'Месяц закрыт.');
}

function fillAvailable() {
  return state.data?.canEdit && !$('#project-filter').value && !$('#status-filter').value;
}

function fillTargets(source, direction, end) {
  const cells = [];
  if (direction === 'right') {
    for (let date = offsetDay(source.date, 1); date <= end && date.startsWith(state.month); date = offsetDay(date, 1)) {
      cells.push({ worker_id: source.worker_id, date });
    }
  } else {
    const first = fillWorkers.findIndex(worker => worker.id === source.worker_id);
    const last = fillWorkers.findIndex(worker => worker.id === Number(end));
    if (first >= 0 && last > first) {
      for (const worker of fillWorkers.slice(first + 1, last + 1)) cells.push({ worker_id: worker.id, date: source.date });
    }
  }
  const existing = new Map(state.data.shifts.map(shift => [shift.worker_id + ':' + shift.date, shift]));
  let replace = 0;
  let closed = false;
  const targets = cells.map(cell => {
    const shift = existing.get(cell.worker_id + ':' + cell.date);
    if (shift) replace++;
    if (shift?.status === 'closed') closed = true;
    return { ...cell, version: shift?.version ?? 0 };
  });
  return { targets, replace, closed };
}

function fillRequest(source, direction, targets, replaceExisting) {
  return api('shifts/fill', {
    source_id: source.id, source_version: source.version, direction, targets, replace_existing: replaceExisting
  });
}

function fillDescription(plan) {
  if (plan.closed) return 'В диапазоне есть закрытая смена. Выберите другой диапазон.';
  if (!plan.targets.length) return 'Выберите последнюю ячейку диапазона.';
  return 'Ячеек для заполнения: ' + plan.targets.length + (plan.replace ? '. Записей для замены: ' + plan.replace + '.' : '.');
}

function overwriteField() {
  return '<label class="check" data-overwrite hidden><input name="overwrite" type="checkbox">Заменить существующие записи</label>';
}

function openFillPicker(source) {
  if (!source || !fillAvailable() || fillPending) return;
  const rows = fillWorkers.slice(fillWorkers.findIndex(worker => worker.id === source.worker_id) + 1);
  const dates = [];
  for (let date = offsetDay(source.date, 1); date.startsWith(state.month); date = offsetDay(date, 1)) dates.push(date);
  if (!rows.length && !dates.length) {
    notice('Справа и снизу нет ячеек для заполнения.', true);
    return;
  }
  const directions = (dates.length ? option('right', 'Вправо по датам') : '') + (rows.length ? option('down', 'Вниз по сотрудникам') : '');
  openDialog('Заполнить диапазон', dayLabel(source.date) + ' · Из сохранённой смены', '<form class="editor-form">' +
    selectField('Направление', 'direction', directions) + selectField('До даты включительно', 'date_end',
      option('', 'Выберите дату') + dates.map(date => option(date, dayLabel(date))).join('')) +
    selectField('До сотрудника включительно', 'worker_end',
      option('', 'Выберите сотрудника') + rows.map(worker => option(worker.id, worker.name)).join('')) +
    '<p data-fill-description role="status"></p>' + overwriteField() + errorMarkup +
    '<div class="dialog-actions">' + cancel + '<button class="primary" type="submit">Заполнить</button></div></form>');
  const form = editor.querySelector('form');
  function update() {
    const fields = form.elements;
    const right = fields.direction.value === 'right';
    fields.date_end.parentElement.hidden = !right;
    fields.worker_end.parentElement.hidden = right;
    const plan = fillTargets(source, fields.direction.value, right ? fields.date_end.value : fields.worker_end.value);
    form.querySelector('[data-fill-description]').textContent = fillDescription(plan);
    form.querySelector('[data-overwrite]').hidden = !plan.replace || plan.closed;
    fields.overwrite.required = plan.replace > 0 && !plan.closed;
    fields.overwrite.checked = false;
    form.querySelector('[type=submit]').disabled = plan.closed || !plan.targets.length;
    return plan;
  }
  let plan = update();
  form.addEventListener('change', event => {
    if (event.target !== form.elements.overwrite) plan = update();
  });
  bindForm(form, fields => fillRequest(source, fields.direction.value, plan.targets, fields.overwrite.checked), 'Диапазон заполнен.');
}

async function applyDragFill(source, direction, end) {
  const plan = fillTargets(source, direction, end);
  if (!plan.targets.length || fillPending) return;
  if (plan.closed) {
    notice(fillDescription(plan), true);
    return;
  }
  if (plan.replace) {
    openDialog('Подтвердить заполнение', dayLabel(source.date) + ' · Из сохранённой смены', '<form class="editor-form">' +
      '<p>' + fillDescription(plan) + '</p>' + errorMarkup +
      '<div class="dialog-actions">' + cancel + '<button class="primary" type="submit">Заменить и заполнить</button></div></form>');
    bindForm(editor.querySelector('form'), () => fillRequest(source, direction, plan.targets, true), 'Диапазон заполнен.');
    return;
  }
  fillPending = true;
  grid.setAttribute('aria-busy', 'true');
  try {
    await fillRequest(source, direction, plan.targets, false);
    notice('Заполнено ячеек: ' + plan.targets.length + '.');
    await load();
  } catch (error) {
    notice(error.message, true);
    if (error.status === 409) await load();
  } finally {
    fillPending = false;
    grid.removeAttribute('aria-busy');
  }
}

function updateDragFill(event) {
  if (!dragFill || dragFill.pointer !== event.pointerId) return;
  const drag = dragFill;
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-fill-row]');
  const row = Number(cell?.dataset.fillRow);
  const column = Number(cell?.dataset.fillColumn);
  if (!drag.direction && (row > drag.row || column > drag.column)) {
    const dx = Math.abs(event.clientX - drag.x);
    const dy = Math.abs(event.clientY - drag.y);
    drag.direction = column > drag.column && (row <= drag.row || dx >= dy) ? 'right' : 'down';
  }
  const active = drag.direction === 'right' ? row === drag.row && column > drag.column
    : drag.direction === 'down' && column === drag.column && row > drag.row;
  drag.end = active ? (drag.direction === 'right' ? cell.dataset.fillDate : fillWorkers[row].id) : null;
  for (const preview of grid.querySelectorAll('[data-fill-row]')) {
    const r = Number(preview.dataset.fillRow);
    const c = Number(preview.dataset.fillColumn);
    const selected = active && (drag.direction === 'right' ? r === drag.row && c >= drag.column && c <= column
      : c === drag.column && r >= drag.row && r <= row);
    preview.classList.toggle('fill-preview', selected);
  }
}

function clearDragFill() {
  grid.querySelectorAll('.fill-preview').forEach(cell => cell.classList.remove('fill-preview'));
  dragFill = null;
}

grid.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-fill-source]');
  if (!handle || event.button !== 0 || !fillAvailable() || fillPending) return;
  const source = state.data.shifts.find(shift => shift.id === Number(handle.dataset.fillSource));
  const { fillRow, fillColumn } = handle.closest('td').dataset;
  dragFill = { source, row: Number(fillRow), column: Number(fillColumn), x: event.clientX, y: event.clientY, pointer: event.pointerId };
  handle.setPointerCapture(event.pointerId);
});
grid.addEventListener('pointermove', updateDragFill);
grid.addEventListener('pointerup', event => {
  if (!dragFill || dragFill.pointer !== event.pointerId) return;
  updateDragFill(event);
  const { source, direction, end } = dragFill;
  clearDragFill();
  if (!direction) return;
  ignoreHandleClick = true;
  setTimeout(() => { ignoreHandleClick = false; }, 0);
  if (end) applyDragFill(source, direction, end);
});
grid.addEventListener('pointercancel', clearDragFill);
grid.addEventListener('lostpointercapture', clearDragFill);
grid.addEventListener('click', event => {
  const handle = event.target.closest('[data-fill-source]');
  if (!handle || ignoreHandleClick) return;
  openFillPicker(state.data.shifts.find(shift => shift.id === Number(handle.dataset.fillSource)));
});

function changeWeek(direction) {
  const days = weekDays(state.day).filter(date => date.startsWith(state.month));
  const day = offsetDay(direction < 0 ? days[0] : days.at(-1), direction);
  load(day.slice(0, 7), day);
}

async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    return;
  }
  openDialog('Установка приложения', '', '<p>На iPhone откройте меню «Поделиться» в Safari и выберите «На экран Домой».</p>' +
    '<p>На Android и ПК откройте меню браузера и выберите установку приложения, если она доступна.</p>' +
    '<div class="dialog-actions"><button type="button" class="primary close-dialog">Готово</button></div>');
}

document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = svg(node.dataset.icon); });
$('#status-filter').innerHTML = option('', 'Все статусы') + Object.entries(statuses).map(([key, label]) => option(key, label)).join('');
$('#month-filter').innerHTML = monthNames.map((name, i) => option(String(i + 1).padStart(2, '0'), name)).join('');
$('#year-filter').innerHTML = Array.from({ length: 100 }, (_, i) => option(2000 + i, 2000 + i)).join('');
$('#legend').innerHTML = Object.entries(statuses).map(([key, label]) => '<span><i class="dot status-' + key + '" aria-hidden="true"></i>' + label + '</span>').join('');
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  const errorBox = form.querySelector('.error');
  alertIn(errorBox, '');
  try {
    await api('login', { username: form.elements.username.value, password: form.elements.password.value });
    form.reset();
    await enter();
  } catch (error) {
    alertIn(errorBox, error.message);
  } finally {
    button.disabled = false;
  }
});
$('#demo-login').addEventListener('click', async event => {
  const button = event.target.closest('[data-demo]');
  if (!button) return;
  const buttons = [...$('#demo-login').querySelectorAll('button')];
  buttons.forEach(item => { item.disabled = true; });
  try { await api('demo', { role: button.dataset.demo }); await enter(); }
  catch (error) { alertIn($('#login-form .error'), error.message); }
  finally { buttons.forEach(item => { item.disabled = false; }); }
});
$('#logout').addEventListener('click', async () => {
  try { await api('logout', {}); await enter(); }
  catch (error) { notice(error.message, true); }
});
function activePage() {
  const page = location.hash.slice(1);
  return Object.hasOwn(pages, page) ? page : 'tabel';
}

$('#navigation').addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (!button || !state.data) return;
  location.hash = button.dataset.page;
});
window.addEventListener('hashchange', () => {
  if (!state.data || state.data.user.role === 'worker' || state.page === activePage()) return;
  state.page = activePage();
  notice('');
  render();
  $('#main').focus();
});
$('#editor').addEventListener('click', event => {
  if (event.target.closest('.close-dialog')) editor.close();
  const picker = event.target.closest('[data-fill-picker]');
  if (picker) openFillPicker(state.data.shifts.find(shift => shift.id === Number(picker.dataset.fillPicker)));
});
editor.addEventListener('cancel', event => {
  if (editor.hasAttribute('aria-busy')) event.preventDefault();
});
editor.addEventListener('close', () => {
  $('#editor-body').replaceChildren();
  const focus = document.activeElement;
  if (!focus || focus === document.body || focus === editor) $('#main').focus();
});
$('#add-shift').addEventListener('click', () => openShift());
$('#add-directory').addEventListener('click', () => openDirectoryEditor());
$('#close-month').addEventListener('click', openMonthClose);
$('#directory').addEventListener('click', event => {
  const button = event.target.closest('[data-assign]');
  if (button) openAssignments(Number(button.dataset.assign));
  const edit = event.target.closest('[data-project-edit]');
  if (edit) openDirectoryEditor(state.data.projects.find(item => item.id === Number(edit.dataset.projectEdit)));
});
$('#week-prev').addEventListener('click', () => changeWeek(-1));
$('#week-next').addEventListener('click', () => changeWeek(1));
$('#today').addEventListener('click', () => {
  const today = state.data?.today;
  if (today) load(today.slice(0, 7), today);
});
for (const id of ['#month-filter', '#year-filter']) $(id).addEventListener('change', () => {
  const month = $('#year-filter').value + '-' + $('#month-filter').value;
  load(month, state.data.today.startsWith(month) ? state.data.today : month + '-01');
});
$('#day-selector').addEventListener('click', event => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  state.day = button.dataset.day;
  renderSchedule();
  $('#day-selector [aria-pressed="true"]').focus();
});
for (const id of ['#search', '#project-filter', '#status-filter']) $(id).addEventListener('input', () => state.data && renderSchedule());
for (const id of ['#schedule-desktop', '#schedule-mobile']) $(id).addEventListener('click', event => {
  const button = event.target.closest('[data-worker]');
  if (button) openShift(Number(button.dataset.worker), button.dataset.date);
});
$('#install').addEventListener('click', install);
$('#install-mobile').addEventListener('click', install);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('online', connection);
window.addEventListener('offline', connection);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
enter().catch(() => { $('#startup').textContent = 'Нет связи с сервером. Проверьте подключение и обновите страницу.'; });
