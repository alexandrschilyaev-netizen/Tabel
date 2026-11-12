import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, clearSession, readSession, saveSession, validateAddress } from './api';

const roles = { worker: 'Монтажник', master: 'Мастер', foreman: 'Прораб', engineer: 'Инженер', hr: 'Кадровик' };
const kinds = { work: 'Работа', vacation: 'Отпуск', sick: 'Больничный', dayoff: 'Выходной' };
const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const asDate = day => new Date(day + 'T00:00:00Z');
const hours = minutes => Math.floor(minutes / 60) + ' ч' + (minutes % 60 ? ' ' + minutes % 60 + ' мин' : '');
const defaultAddress = process.env.EXPO_PUBLIC_TABEL_URL ?? '';

function offsetDay(day, offset) {
  const date = asDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function daysInWeek(day) {
  const offset = (asDate(day).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => offsetDay(day, index - offset));
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function Button({ title, onPress, disabled, primary = false, selected, label, compact = false, markColor }) {
  const active = primary || selected;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled), selected }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, active && styles.buttonPrimary,
        pressed && styles.pressed, disabled && styles.disabled]}
    >
      {markColor && <View style={[styles.projectDot, { backgroundColor: markColor }]} />}
      <Text style={[styles.buttonText, active && styles.buttonTextPrimary]}>{title}</Text>
    </Pressable>
  );
}

function Field({ label, style, paired, ...props }) {
  return (
    <View style={[styles.field, paired && styles.pairedField]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label} placeholderTextColor={colors.muted} style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

function ErrorMessage({ message }) {
  if (!message) return null;
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>;
}

function Login({ onLogin, initialAddress }) {
  const [address, setAddress] = useState(initialAddress || defaultAddress);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const server = validateAddress(address);
      const auth = await api({ address: server }, 'login', { username: username.trim(), password });
      if (!auth.token || !auth.expires) throw new Error('Сервер не поддерживает вход из мобильного приложения.');
      await onLogin({ address: server, token: auth.token, expires: auth.expires });
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginContent}>
        <View style={styles.loginCard}>
          <Text style={styles.brandName}>Табель</Text>
          <Text accessibilityRole="header" style={styles.title}>Вход в приложение</Text>
          <Field label="Адрес сервера" value={address} onChangeText={setAddress} autoCapitalize="none"
            autoCorrect={false} keyboardType="url" placeholder="https://tabel.example.org" />
          <Field label="Логин" value={username} onChangeText={setUsername} autoCapitalize="none"
            autoCorrect={false} autoComplete="username" maxLength={40} />
          <Field label="Пароль" value={password} onChangeText={setPassword} autoComplete="current-password"
            secureTextEntry maxLength={128} onSubmitEditing={submit} />
          <ErrorMessage message={error} />
          <Button title={busy ? 'Входим…' : 'Войти'} primary onPress={submit}
            disabled={busy || !address.trim() || !username.trim() || !password} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function MonthHeader({ data, day, setDay, busy, onClose, onShare }) {
  const dates = daysInWeek(day);
  const month = day.slice(0, 7);
  function changeMonth(direction) {
    const first = month + '-01';
    const target = direction < 0 ? offsetDay(first, -1).slice(0, 7) + '-01' : offsetDay(first, 32).slice(0, 7) + '-01';
    setDay(data.today.startsWith(target.slice(0, 7)) ? data.today : target);
  }
  return (
    <View style={styles.stack}>
      <View style={styles.titleBlock}>
        <Text accessibilityRole="header" style={styles.title}>Табель рабочего времени</Text>
        <Text style={styles.muted}>{data.user.role === 'worker' ? 'Мои смены' : data.user.role === 'hr' ? 'Все сотрудники' : 'Назначенные сотрудники'}</Text>
      </View>
      <View style={styles.period}>
        <Button title="‹" label="Предыдущий месяц" compact onPress={() => changeMonth(-1)} disabled={busy || month === '2000-01'} />
        <Text accessibilityRole="header" style={styles.periodLabel}>{monthFormat.format(asDate(day))}</Text>
        <Button title="›" label="Следующий месяц" compact onPress={() => changeMonth(1)} disabled={busy || month === '2099-12'} />
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.muted}>Учтено за месяц</Text><Text style={styles.metricValue}>{hours(data.summary.minutes)}</Text>
          <Text style={styles.muted}>Переработка: {hours(data.summary.overtime_minutes ?? 0)}</Text></View>
        <View style={styles.metric}><Text style={styles.muted}>Рабочих смен</Text><Text style={styles.metricValue}>{data.summary.workShifts}</Text></View>
      </View>
      {data.lock && <Text style={styles.lock}>Месяц закрыт · {data.lock.closed_by}</Text>}
      {data.user.role !== 'worker' && (
        <View style={styles.actions}>
          <Button title="Выгрузить CSV" disabled={busy} onPress={onShare} />
          {data.user.role === 'hr' && !data.lock &&
            <Button title="Закрыть месяц" disabled={busy || !data.summary.records} onPress={onClose} />}
        </View>
      )}
      <View style={styles.sectionHead}>
        <View style={styles.fill}>
          <Text accessibilityRole="header" style={styles.heading}>Смены</Text>
          <Text style={styles.muted}>{dateFormat.format(asDate(day))}</Text>
        </View>
        <View style={styles.actions}>
          <Button title="‹" compact label="Предыдущая неделя" onPress={() => setDay(offsetDay(day, -7))}
            disabled={busy || day < '2000-01-08'} />
          <Button title="Сегодня" onPress={() => setDay(data.today)} disabled={busy} />
          <Button title="›" compact label="Следующая неделя" onPress={() => setDay(offsetDay(day, 7))}
            disabled={busy || day > '2099-12-24'} />
        </View>
      </View>
      <View style={styles.dayList}>
        {dates.map(date => (
          <Button key={date} title={weekdays[asDate(date).getUTCDay()] + ' ' + Number(date.slice(8))}
            label={dateFormat.format(asDate(date))} selected={date === day} disabled={busy || date < '2000-01-01' || date > '2099-12-31'}
            onPress={() => setDay(date)} />
        ))}
      </View>
    </View>
  );
}

function ShiftRow({ worker, shift, project, canEdit, onOpen }) {
  const title = !shift ? (canEdit ? 'Добавить смену' : 'Нет записи') :
    shift.kind === 'work' ? hours(shift.minutes) + ' · ' + (project?.name ?? '') : kinds[shift.kind];
  const extra = shift?.overtime_minutes ?? 0;
  const objectMark = project?.color ? { borderLeftColor: project.color, borderLeftWidth: 5 } : null;
  const info = (
    <>
      <View accessible={false} style={styles.avatar}><Text style={styles.avatarText}>{initials(worker.name)}</Text></View>
      <View style={styles.fill}>
        <Text style={styles.label}>{worker.name}</Text>
        <Text style={styles.muted}>{title}</Text>
        {extra > 0 && <Text style={styles.overtime}>Переработка: +{hours(extra)}</Text>}
      </View>
      {!!shift && <Text style={[styles.pill, shift.status === 'closed' && styles.pillClosed]}>
        {shift.status === 'closed' ? 'Закрыта' : 'Учтена'}
      </Text>}
    </>
  );
  if (!shift && !canEdit) return <View style={styles.shiftRow}>{info}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={worker.name + ', ' + title + (extra > 0 ? ', переработка ' + hours(extra) : '')}
    onPress={onOpen} style={({ pressed }) => [styles.shiftRow, objectMark, pressed && styles.pressed]}>{info}</Pressable>;
}

function timeInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : digits.slice(0, 2) + ':' + digits.slice(2);
}

function FillRange({ data, shift, busy, onFill, onBack }) {
  const dates = [];
  for (let date = offsetDay(shift.date, 1); date.startsWith(data.month); date = offsetDay(date, 1)) dates.push(date);
  const workers = data.workers.slice(data.workers.findIndex(worker => worker.id === shift.worker_id) + 1);
  const [direction, setDirection] = useState(dates.length ? 'right' : 'down');
  const [end, setEnd] = useState(null);
  const choices = direction === 'right'
    ? dates.map(date => ({ value: date, title: dateFormat.format(asDate(date)) }))
    : workers.map(worker => ({ value: worker.id, title: worker.name }));
  const range = end == null ? [] : choices.slice(0, choices.findIndex(choice => choice.value === end) + 1);
  const current = new Map(data.shifts.map(item => [item.worker_id + ':' + item.date, item]));
  let replace = 0;
  let closed = false;
  const targets = range.map(choice => {
    const worker_id = direction === 'right' ? shift.worker_id : choice.value;
    const date = direction === 'right' ? choice.value : shift.date;
    const entry = current.get(worker_id + ':' + date);
    if (entry) replace++;
    if (entry?.status === 'closed') closed = true;
    return { worker_id, date, version: entry?.version ?? 0 };
  });
  const switchDirection = value => { setDirection(value); setEnd(null); };
  function fill() {
    const send = () => onFill({
      source_id: shift.id, source_version: shift.version, direction, targets, replace_existing: replace > 0
    });
    if (replace) Alert.alert('Заменить записи?', 'Записей для замены: ' + replace + '.', [
      { text: 'Отмена', style: 'cancel' }, { text: 'Заменить и заполнить', onPress: send }
    ]);
    else send();
  }
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>Заполнить диапазон</Text>
      <Text style={styles.muted}>Копируются данные сохранённой смены.</Text>
      <View style={styles.actions}>
        {dates.length > 0 && <Button title="По датам" selected={direction === 'right'} disabled={busy} onPress={() => switchDirection('right')} />}
        {workers.length > 0 && <Button title="По сотрудникам" selected={direction === 'down'} disabled={busy} onPress={() => switchDirection('down')} />}
      </View>
      <Text style={styles.label}>{direction === 'right' ? 'До даты включительно' : 'До сотрудника включительно'}</Text>
      <View style={styles.actions}>
        {choices.map(choice => <Button key={choice.value} title={choice.title} disabled={busy}
          selected={choice.value === end} onPress={() => setEnd(choice.value)} />)}
      </View>
      {choices.length === 0 && <Text style={styles.muted}>Справа и снизу нет ячеек для заполнения.</Text>}
      {targets.length > 0 && <Text style={styles.muted}>Ячеек для заполнения: {targets.length}</Text>}
      {closed && <ErrorMessage message="В диапазоне есть закрытая смена. Выберите другой диапазон." />}
      <Button primary title={busy ? 'Сохраняем…' : 'Заполнить'} onPress={fill} disabled={busy || closed || !targets.length} />
      <Button title="Назад к смене" disabled={busy} onPress={onBack} />
    </>
  );
}

function ShiftEditor({ item, data, onDismiss, onSave, onFill, onHistory }) {
  const { worker, shift, day } = item;
  const editable = data.canEdit && shift?.status !== 'closed';
  const [kind, setKind] = useState(shift?.kind ?? 'work');
  const [project, setProject] = useState(shift?.project_id ?? null);
  const [start, setStart] = useState(shift?.start ?? '08:00');
  const [end, setEnd] = useState(shift?.end ?? '17:00');
  const [pause, setPause] = useState(String(shift?.break_minutes ?? 0));
  const [overnight, setOvernight] = useState(Boolean(shift?.overnight));
  const [note, setNote] = useState(shift?.note ?? '');
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState('');
  const work = kind === 'work';
  async function submit() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onSave({
        worker_id: worker.id, date: day, version: shift?.version ?? 0, kind, project_id: project,
        start, end, overnight, break_minutes: Number(pause), note
      });
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory() {
    setLoadingHistory(true);
    try {
      setHistory(await onHistory(shift.id));
    } catch (problem) {
      setError(problem.message);
    } finally {
      setLoadingHistory(false);
    }
  }
  const selectedProject = data.projects.find(p => p.id === project);
  const extra = shift?.overtime_minutes ?? 0;
  const time = value => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const gross = time(end) - time(start) + (overnight ? 1440 : 0);
  const net = gross - Number(pause);
  const previewOvertime = net > 480 && gross <= 1440 ? net - 480 : 0;
  async function copy(values) {
    setError('');
    setBusy(true);
    try {
      await onFill(values);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  const labels = { created: 'Создание', edited: 'Изменение', filled: 'Заполнение из смены', month_closed: 'Закрытие месяца' };
  return (
    <Modal visible animationType="none" onRequestClose={busy ? undefined : onDismiss}>
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editor}>
            <Text accessibilityRole="header" style={styles.title}>{editable ? (shift ? 'Редактирование смены' : 'Новая смена') : 'Смена'}</Text>
            <Text style={styles.muted}>{worker.name} · {dateFormat.format(asDate(day))}</Text>
            {filling ? <FillRange data={data} shift={shift} busy={busy} onFill={copy}
              onBack={() => { setError(''); setFilling(false); }} /> : editable ? (
              <>
                <Text style={styles.label}>Вид записи</Text>
                <View style={styles.actions}>
                  {Object.entries(kinds).map(([id, label]) =>
                    <Button key={id} title={label} selected={kind === id} onPress={() => setKind(id)} disabled={busy} />)}
                </View>
                {work && (
                  <>
                    <Text style={styles.label}>Объект</Text>
                    <View style={styles.actions}>
                      {data.projects.map(p => <Button key={p.id} title={p.name} markColor={p.color} selected={project === p.id}
                        onPress={() => setProject(p.id)} disabled={busy} />)}
                    </View>
                    {!data.projects.length && <Text style={styles.muted}>Кадровик может добавить объект в браузере.</Text>}
                    <View style={styles.metrics}>
                      <Field paired label="Начало" value={start} onChangeText={value => setStart(timeInput(value))} keyboardType="number-pad" maxLength={5} editable={!busy} />
                      <Field paired label="Конец" value={end} onChangeText={value => setEnd(timeInput(value))} keyboardType="number-pad" maxLength={5} editable={!busy} />
                    </View>
                    <Field label="Перерыв, мин" value={pause} onChangeText={value => setPause(value.replace(/\D/g, ''))}
                      keyboardType="number-pad" maxLength={4} editable={!busy} />
                    <Button title="Конец смены на следующий день" selected={overnight}
                      onPress={() => setOvernight(!overnight)} disabled={busy} />
                    {previewOvertime > 0 && <Text style={styles.overtime}>Переработка: {hours(previewOvertime)}</Text>}
                  </>
                )}
                <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500}
                  multiline style={styles.multiline} editable={!busy} />
                <Button title={busy ? 'Сохраняем…' : 'Сохранить запись'} primary onPress={submit}
                  disabled={busy || (work && (!project || !/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)))} />
              </>
            ) : (
              <View style={styles.details}>
                <Text style={styles.label}>{kinds[kind]} · {shift.status === 'closed' ? 'Закрыта' : 'Учтена'}</Text>
                {work && <>
                  <View style={styles.projectLine}>
                    {selectedProject?.color && <View style={[styles.projectDot, { backgroundColor: selectedProject.color }]} />}
                    <Text style={styles.body}>{selectedProject?.name}</Text>
                  </View>
                  <Text style={styles.body}>{start}–{end}{overnight ? ' (+1 день)' : ''}</Text>
                  <Text style={styles.body}>Перерыв {pause} мин · Учтено {hours(shift.minutes)}</Text>
                  {extra > 0 && <Text style={styles.overtime}>Переработка: {hours(extra)}</Text>}
                </>}
                {!!note && <Text style={styles.body}>{note}</Text>}
              </View>
            )}
            <ErrorMessage message={error} />
            {shift && editable && !filling && <Button title="Заполнить диапазон" disabled={busy}
              onPress={() => { setError(''); setFilling(true); }} />}
            {shift && !filling && history === null && <Button title={loadingHistory ? 'Загружаем…' : 'История изменений'}
              disabled={loadingHistory || busy} onPress={showHistory} />}
            {history && !filling && <View style={styles.details}>
              <Text accessibilityRole="header" style={styles.heading}>История изменений</Text>
              {history.length === 0 && <Text style={styles.muted}>Изменений пока нет.</Text>}
              {history.map((event, index) => <Text key={index} style={styles.body}>
                {timeFormat.format(new Date(event.created_at.replace(' ', 'T') + 'Z'))} · {event.name} · {labels[event.action] ?? 'Изменение'}
                {event.action === 'filled' && event.detail ? ' · ' + dateFormat.format(asDate(event.detail)) : ''}
              </Text>)}
            </View>}
            <Button title="Закрыть" disabled={busy} onPress={onDismiss} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Workspace({ session, onLogout }) {
  const [data, setData] = useState(null);
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState(null);

  async function refresh(target = day, updateDay = true) {
    const result = await api(session, 'tabel' + (target ? '?month=' + target.slice(0, 7) : ''));
    setData(result);
    if (updateDay) setDay(target || result.today);
    return result;
  }

  async function run(task) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (problem) {
      if (problem.status === 401) await onLogout(false);
      else setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { run(() => refresh()); }, []);
  function selectDay(date) {
    if (date.slice(0, 7) === data.month) setDay(date);
    else run(() => refresh(date));
  }

  async function save(path, values) {
    try {
      await api(session, path, values);
    } catch (problem) {
      if (problem.status === 401) await onLogout(false);
      throw problem;
    }
    setItem(null);
    await run(() => refresh());
  }

  function confirmClose() {
    const { month, summary } = data;
    Alert.alert('Закрыть месяц?', [
      'Записей: ' + summary.records,
      'Учтено: ' + hours(summary.minutes),
      'Переработка: ' + hours(summary.overtime_minutes ?? 0),
      'Сотрудников без записей: ' + summary.workersWithoutRecords,
      'После закрытия месяц доступен только для просмотра.'
    ].join('\n'), [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Закрыть месяц', onPress: () => run(async () => {
        try {
          await api(session, 'months/close', { month, revision: summary.revision });
        } catch (problem) {
          if (problem.status === 409) await refresh();
          throw problem;
        }
        await refresh();
      }) }
    ]);
  }

  async function share() {
    if (!await Sharing.isAvailableAsync()) throw new Error('Отправка файла на этом устройстве недоступна.');
    const contents = await api(session, 'export?month=' + data.month, undefined, 'text');
    const directory = new Directory(Paths.cache, 'tabel-exports');
    directory.create({ idempotent: true });
    const now = Date.now();
    for (const previous of directory.list()) {
      const stamp = Number(previous.name.match(/-(\d+)\.csv$/)?.[1]);
      if (stamp && now - stamp > 24 * 60 * 60 * 1000) previous.delete();
    }
    // The selected app may read the shared file after the chooser closes.
    const file = new File(directory, 'tabel-' + data.month + '-' + now + '.csv');
    file.create();
    file.write(contents);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Выгрузка табеля', UTI: 'public.comma-separated-values-text' });
  }

  if (!data || !day) return <View style={styles.loading}>
    {busy && <ActivityIndicator size="large" color={colors.primary} />}
    <ErrorMessage message={error} />
    {error && <Button title="Повторить" onPress={() => run(() => refresh())} />}
    {error && <Button title="Выйти" onPress={() => onLogout()} />}
  </View>;

  const shifts = new Map(data.shifts.filter(shift => shift.date === day).map(shift => [shift.worker_id, shift]));
  const projects = new Map(data.projects.map(project => [project.id, project]));
  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View style={styles.fill}>
          <Text style={styles.headerName}>{data.user.name}</Text>
          <Text style={styles.headerRole}>{roles[data.user.role]}</Text>
        </View>
        <Button title="Выйти" disabled={busy} onPress={() => run(() => onLogout())} />
      </View>
      <FlatList
        contentContainerStyle={styles.list}
        data={data.workers}
        keyExtractor={worker => String(worker.id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => run(() => refresh())} />}
        ListHeaderComponent={
          <>
            <ErrorMessage message={error} />
            <MonthHeader data={data} day={day} setDay={selectDay} busy={busy} onClose={confirmClose}
              onShare={() => run(share)} />
          </>
        }
        ListEmptyComponent={<Text style={styles.muted}>Нет назначенных сотрудников.</Text>}
        renderItem={({ item: worker }) => {
          const shift = shifts.get(worker.id);
          return <ShiftRow worker={worker} shift={shift} project={projects.get(shift?.project_id)}
            canEdit={data.canEdit} onOpen={() => { if (!busy) setItem({ worker, shift, day }); }} />;
        }}
      />
      {item && <ShiftEditor item={item} data={data} onDismiss={() => setItem(null)} onSave={values => save('shifts', values)}
        onFill={values => save('shifts/fill', values)}
        onHistory={id => api(session, 'shifts/' + id + '/history')} />}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [address, setAddress] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    readSession().then(previous => {
      if (previous?.address) setAddress(previous.address);
      if (previous?.token) setSession(previous);
    }).catch(() => {}).finally(() => setReady(true));
  }, []);
  async function login(auth) {
    await saveSession(auth);
    setAddress(auth.address);
    setSession(auth);
  }
  async function logout(notifyServer = true) {
    await clearSession(session.address);
    setSession(null);
    if (notifyServer) await api(session, 'logout', {}).catch(() => {});
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        {!ready ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View> :
          session ? <Workspace session={session} onLogout={logout} /> :
            <Login onLogin={login} initialAddress={address} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const colors = {
  bg: '#f3f6fb', surface: '#fff', ink: '#172843', muted: '#54647b', primary: '#254fc5',
  line: '#dbe3ef', border: '#8294af', soft: '#edf2ff', nav: '#14233d', navText: '#c8d6eb',
  green: '#176344', greenBg: '#e1f4ec', closed: '#2c4fa1', closedBg: '#e8efff',
  red: '#a01f2d', redBg: '#fae9ec'
};
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1, minWidth: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loginContent: { flexGrow: 1, justifyContent: 'center', padding: 18, alignItems: 'center' },
  loginCard: { width: '100%', maxWidth: 450, padding: 22, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.line, gap: 14 },
  brandName: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '750' },
  body: { color: colors.ink, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 14 },
  field: { gap: 5, minWidth: 0 },
  pairedField: { flexGrow: 1, flexBasis: 125 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '650' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.ink, fontSize: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { flexDirection: 'row', gap: 6, minHeight: 48, minWidth: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonCompact: { paddingHorizontal: 6 },
  buttonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { color: colors.ink, fontSize: 14, textAlign: 'center', fontWeight: '650' },
  buttonTextPrimary: { color: colors.surface },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  error: { borderRadius: 10, padding: 10, backgroundColor: colors.redBg, color: colors.red, fontSize: 15 },
  header: { backgroundColor: colors.nav, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerName: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  headerRole: { color: colors.navText, fontSize: 13 },
  list: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center', gap: 8 },
  stack: { gap: 12, marginBottom: 8 },
  titleBlock: { gap: 4 },
  period: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  periodLabel: { flex: 1, color: colors.ink, textAlign: 'center', fontSize: 18, fontWeight: '750' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flex: 1, minWidth: 120, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 12, borderRadius: 12, gap: 4 },
  metricValue: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  lock: { borderRadius: 10, padding: 10, color: colors.closed, backgroundColor: colors.closedBg, fontWeight: '650' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionHead: { marginTop: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  dayList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  shiftRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface, padding: 9 },
  avatar: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.soft },
  avatarText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  pill: { color: colors.green, backgroundColor: colors.greenBg, borderRadius: 30, paddingVertical: 5, paddingHorizontal: 7, fontSize: 12, fontWeight: '650' },
  pillClosed: { color: colors.closed, backgroundColor: colors.closedBg },
  editor: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 20, gap: 12 },
  projectLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectDot: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  overtime: { color: '#813509', fontSize: 14, fontWeight: '700' },
  details: { gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 12, borderRadius: 12 }
});
