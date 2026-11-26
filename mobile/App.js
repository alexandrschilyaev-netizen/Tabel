import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, clearSession, readSession, saveSession, serverAddress } from './api';
import { BrandLaunch } from './BrandLaunch';
import { brandMark } from './brand-mark';

const roles = { worker: 'Монтажник', master: 'Мастер', foreman: 'Прораб', engineer: 'Инженер', hr: 'Кадровик' };
const kinds = { work: 'Работа', vacation: 'Отпуск', sick: 'Больничный', dayoff: 'Выходной' };
const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const asDate = day => new Date(day + 'T00:00:00Z');
function hours(minutes) {
  if (minutes > 0 && minutes < 60) return minutes + ' мин';
  return Math.floor(minutes / 60) + ' ч' + (minutes % 60 ? ' ' + minutes % 60 + ' мин' : '');
}
const weldingTypes = [
  { key: 'welding', label: 'Сварка', color: '#c65513' },
  { key: 'zinc_welding', label: 'Сварка цинк', color: '#6840b3' }
];

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

function Button({ title, onPress, disabled, primary = false, selected, label, compact = false, markColor, danger = false }) {
  const active = primary || selected;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled), selected }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, active && styles.buttonPrimary,
        pressed && styles.pressed, disabled && styles.disabled]}
    >
      {markColor && <View style={[styles.projectDot, { backgroundColor: markColor }]} />}
      <Text style={[styles.buttonText, danger && styles.buttonTextDanger, active && styles.buttonTextPrimary]}>{title}</Text>
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

function useLoginSplash() {
  const [playing, setPlaying] = useState(false);
  const finish = useRef(null);
  const complete = useCallback(() => {
    finish.current?.();
    finish.current = null;
  }, []);
  async function run(task) {
    const animation = new Promise(resolve => { finish.current = resolve; });
    Keyboard.dismiss();
    setPlaying(true);
    try {
      const result = await task();
      await animation;
      return result;
    } finally {
      complete();
      setPlaying(false);
    }
  }
  const splash = playing ? <View style={styles.fill}>
    <StatusBar barStyle="light-content" />
    <BrandLaunch onComplete={complete} />
  </View> : null;
  return [splash, run];
}

function Login({ onLogin }) {
  const [splash, animateLogin] = useLoginSplash();
  const [sms, setSms] = useState(false);
  const [usePhone, setUsePhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  useEffect(() => {
    api({}, 'session').then(info => setSms(Boolean(info.smsEnabled))).catch(() => {});
  }, []);
  const useSms = sms && usePhone;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const incomplete = useSms ? challenge ? code.length !== 6 : !phone.trim() : !username.trim() || !password;
  async function submit() {
    if (busy || incomplete) return;
    setBusy(true);
    setError('');
    try {
      if (useSms && !challenge) {
        const result = await api({}, 'auth/sms/request', { phone });
        setChallenge(result.challenge);
        return;
      }
      const auth = await animateLogin(async () => {
        const result = useSms ? await api({}, 'auth/sms/verify', { challenge, code })
          : await api({}, 'login', { username: username.trim(), password });
        if (!result.token || !result.expires) throw new Error('Сервер не поддерживает вход из мобильного приложения.');
        return result;
      });
      await onLogin({ address: serverAddress, token: auth.token, expires: auth.expires }, useSms);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  if (splash) return splash;
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginContent}>
        <View style={styles.loginCard}>
          <View style={styles.companySignature}>
            <Image source={brandMark} style={styles.brandMark} resizeMode="contain" />
            <Text style={styles.brandName}>Группа «ПРИВОД»</Text>
          </View>
          <Text accessibilityRole="header" style={styles.title}>Вход в приложение</Text>
          {useSms ? <>
            <Field label="Номер телефона" value={phone} onChangeText={setPhone} keyboardType="phone-pad"
              autoComplete="tel" placeholder="+7" editable={!busy && !challenge} />
            {challenge && <>
              <Text style={styles.muted}>Введите код, если SMS пришло на указанный номер.</Text>
              <Field label="Код из SMS" value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))}
                keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} onSubmitEditing={submit} />
              <Button title="Другой номер или новый код" disabled={busy}
                onPress={() => { setChallenge(null); setCode(''); setError(''); }} />
            </>}
          </> : <>
            <Field label="Логин" value={username} onChangeText={setUsername} autoCapitalize="none"
              autoCorrect={false} autoComplete="username" maxLength={40} />
            <Field label="Пароль" value={password} onChangeText={setPassword} autoComplete="current-password"
              secureTextEntry maxLength={128} onSubmitEditing={submit} />
          </>}
          <ErrorMessage message={error} />
          <Button title={busy ? 'Подождите…' : useSms && !challenge ? 'Получить код' : 'Войти'} primary onPress={submit}
            disabled={busy || incomplete} />
          {sms && <Button title={useSms ? 'Войти по паролю' : 'Войти по SMS'} disabled={busy} onPress={() => { setUsePhone(!usePhone); setError(''); }} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function MonthHeader({ data, day, setDay, busy, onClose, onShare }) {
  const dates = daysInWeek(day);
  const month = day.slice(0, 7);
  const special = data.calendar?.find(entry => entry.date === day);
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
          <Text style={styles.muted}>{rateText(data.summary)}</Text></View>
        <View style={styles.metric}><Text style={styles.muted}>Рабочих смен</Text><Text style={styles.metricValue}>{data.summary.workShifts}</Text>
          {weldingTypes.map(({ key, label, color }) => <View key={key} style={styles.projectLine}>
            <View style={[styles.weldingDot, { backgroundColor: color }]} />
            <Text style={styles.muted}>{label} · {data.summary[key + '_days'] ?? 0}</Text>
          </View>)}
        </View>
      </View>
      {data.lock && <Text style={styles.lock}>Месяц закрыт · {data.lock.closed_by}</Text>}
      {data.user.role !== 'worker' && (
        <View style={styles.actions}>
          <Button title="Выгрузить Excel" disabled={busy} onPress={onShare} />
          {data.user.role === 'hr' && !data.lock &&
            <Button title="Закрыть месяц" disabled={busy || !data.summary.records} onPress={onClose} />}
        </View>
      )}
      <View style={styles.sectionHead}>
        <View style={styles.fill}>
          <Text accessibilityRole="header" style={styles.heading}>Смены</Text>
          <Text style={styles.muted}>{dateFormat.format(asDate(day))}</Text>
          {special && <Text style={styles.muted}>{special.name} · {special.kind === 'holiday' ? '×2' : 'норма 7 ч'}</Text>}
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

function rateParts(work) {
  return [
    ['1', work.regular_minutes],
    ['1,5', work.overtime_15_minutes],
    ['2', work.overtime_20_minutes]
  ].filter(([, minutes]) => minutes > 0);
}

function rateText(work) {
  return rateParts(work).map(([rate, minutes]) => hours(minutes) + ' ×' + rate).join(' · ');
}

function RateBreakdown({ work, compact = false }) {
  return rateParts(work).map(([rate, minutes]) => (
    <Text key={rate} numberOfLines={compact ? 1 : undefined} adjustsFontSizeToFit={compact} minimumFontScale={.78}
      style={[styles.rate, rate === '1,5' && styles.rate15, rate === '2' && styles.rate20]}>
      {hours(minutes)} ×{rate}
    </Text>
  ));
}

function WeldingMarks({ shift, labels = false }) {
  const marks = weldingTypes.filter(({ key }) => shift?.[key]);
  if (!marks.length) return null;
  return <View style={styles.actions}>{marks.map(({ key, label, color }) =>
    <View key={key} style={styles.projectLine} accessible accessibilityLabel={label}>
      <View style={[styles.weldingDot, { backgroundColor: color }]} />
      {labels && <Text style={styles.muted}>{label}</Text>}
    </View>)}</View>;
}

function WeekGrid({ data, day, onOpen, onDelete, busy }) {
  const { width } = useWindowDimensions();
  const dates = daysInWeek(day);
  const cellWidth = Math.max(94, Math.floor((Math.min(width, 1600) - 276) / 7));
  const shifts = new Map(data.shifts.map(shift => [shift.worker_id + ':' + shift.date, shift]));
  const projects = new Map(data.projects.map(project => [project.id, project]));
  return <ScrollView horizontal style={styles.grid} keyboardShouldPersistTaps="handled">
    <View>
      <View style={styles.gridRow}>
        <Text style={styles.gridName}>Сотрудник</Text>
        {dates.map(date => <View key={date} style={[styles.gridHeading, { width: cellWidth }]}>
          <Text style={styles.label}>{weekdays[asDate(date).getUTCDay()]} {Number(date.slice(8))}</Text>
        </View>)}
        <Text style={styles.gridTotal}>Итого</Text>
      </View>
      {data.workers.map(worker => {
        const entries = dates.map(date => shifts.get(worker.id + ':' + date));
        return <View style={styles.gridRow} key={worker.id}>
          <Text style={styles.gridName}>{worker.name}</Text>
          {dates.map((date, index) => {
            const shift = entries[index];
            const project = projects.get(shift?.project_id);
            const label = shift?.kind === 'work' ? hours(shift.minutes) : kinds[shift?.kind] ?? '—';
            const enabled = date.startsWith(data.month) && (shift || data.canEdit);
            const removable = enabled && data.canEdit && shift && shift.status !== 'closed';
            const item = { worker, shift, day: date };
            return <Pressable key={date} accessibilityRole="button"
              accessibilityLabel={worker.name + ', ' + dateFormat.format(asDate(date)) + ', ' + label}
              disabled={busy || !enabled} onPress={() => onOpen(item)} onLongPress={removable ? () => onDelete(item) : undefined}
              style={[styles.gridCell, { width: cellWidth, height: cellWidth }, project && { borderLeftColor: project.color, borderLeftWidth: 4 }]}>
              <Text style={styles.gridValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8}>{label}</Text>
              {project && <Text style={styles.gridProject} numberOfLines={1}>{project.name}</Text>}
              {shift?.kind === 'work' && <View style={styles.gridMeta}>
                <WeldingMarks shift={shift} />
                <View style={styles.gridRates}><RateBreakdown work={shift} compact /></View>
              </View>}
            </Pressable>;
          })}
          <View style={styles.gridTotal}>
            <Text style={styles.label}>{hours(entries.reduce((sum, shift) => sum + (shift?.minutes ?? 0), 0))}</Text>
            {weldingTypes.map(({ key, label }) => <Text style={styles.muted} key={key}>
              {label} {entries.filter(shift => shift?.[key]).length}
            </Text>)}
          </View>
        </View>;
      })}
    </View>
  </ScrollView>;
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

function ShiftEditor({ item, data, onDismiss, onSave, onFill, onHistory, onDelete }) {
  const { worker, shift, day } = item;
  const editable = data.canEdit && shift?.status !== 'closed';
  const [kind, setKind] = useState(shift?.kind ?? 'work');
  const [project, setProject] = useState(shift?.project_id ?? null);
  const [start, setStart] = useState(shift?.start ?? '08:00');
  const [end, setEnd] = useState(shift?.end ?? '17:00');
  const [pause, setPause] = useState(String(shift?.break_minutes ?? 0));
  const [overnight, setOvernight] = useState(Boolean(shift?.overnight));
  const [note, setNote] = useState(shift?.note ?? '');
  const [marks, setMarks] = useState(() => Object.fromEntries(
    weldingTypes.map(({ key }) => [key, Boolean(shift?.[key])])
  ));
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
        start, end, overnight, break_minutes: Number(pause), note, ...marks
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
  const time = value => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const gross = time(end) - time(start) + (overnight ? 1440 : 0);
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const net = validTime(start) && validTime(end) && gross <= 1440 ? Math.max(0, gross - Number(pause)) : 0;
  const rule = data.calendar?.find(entry => entry.date === day)?.kind ??
    ([0, 6].includes(asDate(day).getUTCDay()) ? 'weekend' : 'regular');
  const normal = rule === 'holiday' || rule === 'weekend' ? 0 : rule === 'shortened' ? 420 : 480;
  const overtime = Math.max(0, net - normal);
  const first = normal ? Math.min(overtime, 120) : 0;
  const previewRates = {
    regular_minutes: net - overtime, overtime_15_minutes: first, overtime_20_minutes: overtime - first
  };
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
  const labels = { created: 'Создание', edited: 'Изменение', deleted: 'Удаление', filled: 'Заполнение из смены', month_closed: 'Закрытие месяца' };
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
                    <Text style={styles.label}>Виды сварки</Text>
                    <View style={styles.actions}>{weldingTypes.map(({ key, label, color }) =>
                      <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: marks[key], disabled: busy }}
                        disabled={busy} style={styles.button}
                        onPress={() => setMarks(current => ({ ...current, [key]: !current[key] }))}>
                        <Text style={styles.buttonText}>{marks[key] ? '☑' : '☐'}</Text>
                        <View style={[styles.weldingDot, { backgroundColor: color }]} />
                        <Text style={styles.buttonText}>{label}</Text>
                      </Pressable>)}</View>
                    <RateBreakdown work={previewRates} />
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
                  <RateBreakdown work={shift} />
                  <WeldingMarks shift={shift} labels />
                </>}
                {!!note && <><Text style={styles.label}>Комментарий</Text><Text style={styles.body}>{note}</Text></>}
              </View>
            )}
            <ErrorMessage message={error} />
            {shift && editable && !filling && <Button title="Заполнить диапазон" disabled={busy}
              onPress={() => { setError(''); setFilling(true); }} />}
            {shift && editable && !filling && <Button title="Удалить запись" danger disabled={busy} onPress={() => onDelete(item)} />}
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

function DirectoryEditor({ data, mode, employee, busy, onSave, onDismiss }) {
  const [date, setDate] = useState(data.today);
  const [name, setName] = useState(employee?.name ?? '');
  const [kind, setKind] = useState('holiday');
  const [role, setRole] = useState(employee?.role ?? 'worker');
  const [username, setUsername] = useState(employee?.username ?? '');
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState(String(employee?.grade ?? ''));
  const [assigned, setAssigned] = useState(data.workers.find(worker => worker.id === employee?.id)?.supervisor_ids ?? []);
  const [error, setError] = useState('');
  const calendar = mode === 'calendar';
  async function submit() {
    if (busy) return;
    setError('');
    try {
      if (calendar) await onSave('calendar', { date, name, kind });
      else await onSave(employee ? 'users/' + employee.id : 'users', { name, role, username, password, supervisor_ids: assigned, grade: grade ? Number(grade) : null });
    } catch (problem) {
      setError(problem.message);
    }
  }
  return <Modal visible animationType="none" onRequestClose={busy ? undefined : onDismiss}>
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editor}>
          <Text accessibilityRole="header" style={styles.title}>{calendar ? 'Добавить особую дату' : employee ? 'Изменить сотрудника' : 'Добавить сотрудника'}</Text>
          {calendar ? <>
            <Field label="Дата (ГГГГ-ММ-ДД)" value={date} onChangeText={setDate} maxLength={10} editable={!busy} />
            <View style={styles.actions}>
              <Button title="Праздник" selected={kind === 'holiday'} onPress={() => setKind('holiday')} disabled={busy} />
              <Button title="Предпраздничный" selected={kind === 'shortened'} onPress={() => setKind('shortened')} disabled={busy} />
            </View>
            <Field label="Название" value={name} onChangeText={setName} maxLength={120} editable={!busy} />
          </> : <>
            <Field label="Фамилия и имя" value={name} onChangeText={setName} maxLength={120} editable={!busy} />
            <Field label="Логин" value={username} onChangeText={setUsername} maxLength={40} autoCapitalize="none" editable={!busy} />
            <Field label={employee ? "Новый пароль (необязательно)" : "Пароль (от 12 символов)"} value={password} onChangeText={setPassword} secureTextEntry maxLength={128} editable={!busy} />
            <Text style={styles.label}>Роль</Text>
            {employee ? <Text style={styles.body}>{roles[role]}</Text> : <View style={styles.actions}>{Object.entries(roles).map(([key, label]) =>
              <Button key={key} title={label} selected={role === key} onPress={() => setRole(key)} disabled={busy} />)}</View>}
            {role === 'worker' && <Field label="Разряд (1–8)" value={grade} onChangeText={value => setGrade(value.replace(/\D/g, ''))}
              keyboardType="number-pad" maxLength={1} editable={!busy} />}
            {role === 'worker' && data.staff.length > 0 && <>
              <Text style={styles.label}>Руководители</Text>
              <View style={styles.actions}>{data.staff.map(person =>
                <Button key={person.id} title={person.name} selected={assigned.includes(person.id)} disabled={busy}
                  onPress={() => setAssigned(current => current.includes(person.id)
                    ? current.filter(id => id !== person.id) : [...current, person.id])} />)}</View>
            </>}
          </>}
          <ErrorMessage message={error} />
          <Button title={busy ? 'Сохраняем…' : 'Сохранить'} primary onPress={submit} disabled={busy ||
            (calendar ? !date.trim() || (kind === 'holiday' && !name.trim()) : !name.trim() || !username.trim() || ((!employee || password.length > 0) && password.length < 12))} />
          <Button title="Отмена" onPress={onDismiss} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function Workspace({ session, onLogout }) {
  const [data, setData] = useState(null);
  const [menu, setMenu] = useState(false);
  const [page, setPage] = useState('Табель');
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState(null);
  const [directoryMode, setDirectoryMode] = useState(null);

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

  function confirmDelete({ worker, shift, day }) {
    Alert.alert('Удалить запись?', worker.name + ' · ' + dateFormat.format(asDate(day)), [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => run(async () => {
        setItem(null);
        try {
          await api(session, 'shifts/' + shift.id + '/delete', { version: shift.version });
        } catch (problem) {
          if (problem.status === 409) await refresh();
          throw problem;
        }
        await refresh();
      }) }
    ]);
  }

  function confirmClose() {
    const { month, summary } = data;
    Alert.alert('Закрыть месяц?', [
      'Записей: ' + summary.records,
      'Учтено: ' + hours(summary.minutes),
      'Часы по коэффициентам: ' + rateText(summary),
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
    const contents = await api(session, 'export.xlsx?month=' + data.month, undefined, 'binary');
    const directory = new Directory(Paths.cache, 'tabel-exports');
    directory.create({ idempotent: true });
    const now = Date.now();
    for (const previous of directory.list()) {
      const stamp = Number(previous.name.match(/-(\d+)\.(?:xlsx|csv)$/)?.[1]);
      if (stamp && now - stamp > 24 * 60 * 60 * 1000) previous.delete();
    }
    // The selected app may read the shared file after the chooser closes.
    const file = new File(directory, 'tabel-' + data.month + '-' + now + '.xlsx');
    file.create();
    file.write(contents);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Выгрузка табеля', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
  }

  async function saveDirectory(path, values) {
    setBusy(true);
    setError('');
    try {
      await api(session, path, values);
      setDirectoryMode(null);
      try { await refresh(); } catch (problem) { setError(problem.message); }
    } catch (problem) {
      if (problem.status === 401) await onLogout(false);
      throw problem;
    } finally {
      setBusy(false);
    }
  }

  if (!data || !day) return <View style={styles.loading}>
    {busy && <ActivityIndicator size="large" color={colors.primary} />}
    <ErrorMessage message={error} />
    {error && <Button title="Повторить" onPress={() => run(() => refresh())} />}
    {error && <Button title="Выйти" onPress={() => onLogout()} />}
  </View>;

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Button title="☰" label="Меню" compact onPress={() => setMenu(!menu)} />
        <View style={styles.fill}>
          <Text style={styles.headerName}>{data.user.name}</Text>
          <Text style={styles.headerRole}>{roles[data.user.role]}</Text>
        </View>
        <Button title="Выйти" disabled={busy} onPress={() => run(() => onLogout())} />
      </View>
      {menu && <View style={styles.menu}>
        {['Табель', 'Карточка сотрудника', 'Заявления'].map(name => <Button key={name} title={name}
          selected={page === name} onPress={() => { setPage(name); setMenu(false); }} />)}
      </View>}
      {page === 'Табель' ? <ScrollView contentContainerStyle={styles.list} nestedScrollEnabled
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => run(() => refresh())} />}>
        <ErrorMessage message={error} />
        {data.user.role === 'hr' && <View style={styles.actions}>
          <Button title="Сотрудники" disabled={busy} onPress={() => setDirectoryMode('employees')} />
          <Button title="Добавить особую дату" disabled={busy} onPress={() => setDirectoryMode('calendar')} />
        </View>}
        <MonthHeader data={data} day={day} setDay={selectDay} busy={busy} onClose={confirmClose}
          onShare={() => run(share)} />
        {data.workers.length ? <WeekGrid data={data} day={day} busy={busy} onOpen={setItem} onDelete={confirmDelete} /> :
          <Text style={styles.muted}>Нет назначенных сотрудников.</Text>}
      </ScrollView> : <View style={styles.editor}>
        <Text accessibilityRole="header" style={styles.title}>{page}</Text>
        <Text style={styles.muted}>Раздел в разработке.</Text>
      </View>}
      {directoryMode === 'employees' && <Modal visible onRequestClose={() => setDirectoryMode(null)}>
        <SafeAreaView style={styles.screen}>
          <FlatList data={data.employees ?? []} keyExtractor={employee => String(employee.id)}
            contentContainerStyle={styles.list}
            ListHeaderComponent={<View style={styles.stack}>
              <Text accessibilityRole="header" style={styles.title}>Сотрудники</Text>
              <Button title="Добавить сотрудника" primary onPress={() => setDirectoryMode('worker')} />
              <Button title="Закрыть" onPress={() => setDirectoryMode(null)} />
            </View>}
            renderItem={({ item: employee }) => <Button title={employee.name + ' · ' + roles[employee.role]}
              label={'Изменить сотрудника ' + employee.name} onPress={() => setDirectoryMode(employee)} />} />
        </SafeAreaView>
      </Modal>}
      {directoryMode && directoryMode !== 'employees' && <DirectoryEditor data={data} mode={directoryMode}
        employee={typeof directoryMode === 'object' ? directoryMode : null} busy={busy}
        onSave={saveDirectory} onDismiss={() => setDirectoryMode(directoryMode === 'calendar' ? null : 'employees')} />}
      {item && <ShiftEditor item={item} data={data} onDismiss={() => setItem(null)} onSave={values => save('shifts', values)}
        onDelete={confirmDelete}
        onFill={values => save('shifts/fill', values)}
        onHistory={id => api(session, 'shifts/' + id + '/history')} />}
    </View>
  );
}

function DevicePin({ setup, onSubmit, onUnlock, onReset }) {
  const [splash, animateLogin] = useLoginSplash();
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy || !/^\d{4}$/.test(pin)) return;
    if (setup && pin !== repeat) { setError('PIN-коды не совпадают.'); return; }
    setBusy(true);
    setError('');
    try {
      if (setup) await onSubmit(pin);
      else onUnlock(await animateLogin(() => onSubmit(pin)));
    } catch (problem) {
      setPin('');
      setError(problem.message);
      if (problem.resetPin) await onReset();
    } finally { setBusy(false); }
  }
  if (splash) return splash;
  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginContent}>
      <View style={styles.loginCard}>
        <Text accessibilityRole="header" style={styles.title}>{setup ? 'Придумайте PIN' : 'Введите PIN'}</Text>
        <Field label="Четыре цифры" value={pin} onChangeText={value => setPin(value.replace(/\D/g, ''))}
          secureTextEntry keyboardType="number-pad" maxLength={4} editable={!busy} />
        {setup && <Field label="Повторите PIN" value={repeat} onChangeText={value => setRepeat(value.replace(/\D/g, ''))}
          secureTextEntry keyboardType="number-pad" maxLength={4} editable={!busy} />}
        <ErrorMessage message={error} />
        <Button title={setup ? 'Сохранить PIN' : 'Войти'} primary disabled={busy || pin.length !== 4 || (setup && repeat.length !== 4)} onPress={submit} />
        <Button title="Начать заново" disabled={busy} onPress={onReset} />
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [device, setDevice] = useState(null);
  const [pending, setPending] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    readSession().then(async previous => {
      if (previous?.deviceKey) {
        const config = await api({}, 'session');
        if (config.smsEnabled) setDevice(previous);
        else await clearSession();
      } else if (previous?.token) setSession(previous);
    }).catch(() => {}).finally(() => setReady(true));
  }, []);
  async function login(auth, sms) {
    if (sms) { setPending(auth); return; }
    await saveSession(auth);
    setSession(auth);
  }
  async function setupPin(pin) {
    const { deviceKey } = await api(pending, 'auth/pin/enroll', { pin });
    await saveSession({ address: serverAddress, deviceKey });
    setDevice({ deviceKey });
    setSession(pending);
    setPending(null);
  }
  async function unlock(pin) {
    const result = await api({}, 'auth/pin/unlock', { deviceKey: device.deviceKey, pin });
    return { ...result, address: serverAddress };
  }
  async function logout(notifyServer = true) {
    const active = session || pending;
    await clearSession();
    setSession(null);
    setDevice(null);
    setPending(null);
    if (notifyServer && device?.deviceKey) await api({}, 'auth/pin/forget', { deviceKey: device.deviceKey }).catch(() => {});
    else if (notifyServer && active) await api(active, 'logout', {}).catch(() => {});
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        {!ready ? <View style={styles.loading}><ActivityIndicator color={colors.primary} accessibilityLabel="Проверяем сессию" /></View> :
          session ? <Workspace session={session} onLogout={logout} /> :
          pending || device ? <DevicePin key={pending ? 'setup' : 'unlock'} setup={Boolean(pending)}
            onSubmit={pending ? setupPin : unlock} onUnlock={setSession} onReset={() => logout()} /> :
          <Login onLogin={login} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const colors = {
  bg: '#f2f7f4', surface: '#fff', ink: '#142c24', muted: '#4e6459', primary: '#257045',
  line: '#d5e2d9', border: '#829b90', soft: '#e7f3eb', nav: '#034730', navText: '#cce5d8',
  green: '#176344', greenBg: '#e1f4ec', closed: '#2c4fa1', closedBg: '#e8efff',
  red: '#a01f2d', redBg: '#fae9ec'
};
const styles = StyleSheet.create({
  menu: { alignSelf: 'flex-start', backgroundColor: '#fff', padding: 8, gap: 4, marginLeft: 8 },
  grid: { backgroundColor: '#fff', borderRadius: 10 },
  gridRow: { flexDirection: 'row', alignItems: 'stretch' },
  gridHeading: { padding: 7, alignItems: 'center', borderBottomWidth: 1, borderColor: '#d5e2d9' },
  gridName: { width: 144, padding: 8, alignSelf: 'center', fontWeight: '700', color: '#142c24' },
  gridTotal: { width: 100, padding: 6, justifyContent: 'center' },
  gridCell: { padding: 4, justifyContent: 'center', borderWidth: 0.5, borderColor: '#d5e2d9', gap: 2, overflow: 'hidden' },
  gridValue: { fontSize: 19, lineHeight: 23, fontWeight: '750', color: colors.ink, fontVariant: ['tabular-nums'] },
  gridProject: { fontSize: 15, lineHeight: 18, color: colors.muted },
  gridMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  gridRates: { flex: 1, alignItems: 'stretch', minWidth: 0 },
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1, minWidth: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loginContent: { flexGrow: 1, justifyContent: 'center', padding: 18, alignItems: 'center' },
  loginCard: { width: '100%', maxWidth: 450, padding: 22, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.line, gap: 14 },
  companySignature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 42, height: 44 },
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
  buttonTextDanger: { color: colors.red },
  buttonTextPrimary: { color: colors.surface },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  error: { borderRadius: 10, padding: 10, backgroundColor: colors.redBg, color: colors.red, fontSize: 15 },
  header: { backgroundColor: colors.nav, paddingHorizontal: 16, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerName: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  headerRole: { color: colors.navText, fontSize: 13 },
  list: { padding: 16, width: '100%', maxWidth: 1600, alignSelf: 'center', gap: 8 },
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
  weldingDot: { width: 9, height: 9, borderRadius: 5 },
  shiftRates: { alignItems: 'flex-end', gap: 3 },
  rate: { color: '#243f64', fontSize: 13, fontWeight: '700' },
  rate15: { color: '#813509' },
  rate20: { color: '#8c1e35' },
  details: { gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 12, borderRadius: 12 }
});
