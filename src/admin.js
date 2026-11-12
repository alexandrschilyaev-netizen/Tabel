import { openStore, hashPassword } from './store.js';

const [username, name] = process.argv.slice(2);
if (!username || !/^[a-z0-9._-]{3,40}$/i.test(username) || !name?.trim() || name.trim().length > 120) {
  console.error('Использование: npm run admin -- логин "Имя Фамилия". Пароль передаётся через stdin.');
  process.exit(1);
}
if (process.stdin.isTTY) {
  console.error('Передайте пароль через stdin. Примеры для Bash и PowerShell приведены в README.');
  process.exit(1);
}
let password = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  password += chunk;
  if (password.length > 200) break;
}
password = password.replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 128) {
  console.error('Пароль должен содержать от 12 до 128 символов.');
  process.exit(1);
}
const db = openStore();
try {
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO users(username,name,role,password) VALUES(?,?,'hr',?)").run(username, name.trim(), hash);
  console.log('Учётная запись кадровика создана.');
} catch (error) {
  if (!String(error.message).includes('UNIQUE constraint failed')) throw error;
  console.error('Этот логин уже используется.');
  process.exitCode = 1;
} finally {
  db.close();
}
