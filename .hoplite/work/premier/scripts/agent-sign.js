#!/usr/bin/env node
// Подпись desktop/premier-agent.js (Ed25519). Помощник обновляется сам, но ставит только файл с верной подписью.
// Ключ подписи держите ВНЕ сервера (флешка, офлайн-диск): украденный с сервера ключ позволил бы выпустить «обновление» с вредоносным кодом.
//   node scripts/agent-sign.js init   [--key ./premier-agent-signing.key] [--file desktop/premier-agent.js]  — создать ключ, вписать открытую часть в помощника и подписать
//   node scripts/agent-sign.js sign   [--key ...] [--file ...]                                               — переподписать после правок помощника
//   node scripts/agent-sign.js verify [--file ...]                                                           — проверить подпись (код выхода 0/1)
// После init/sign выложите на сервер ОБА файла: desktop/premier-agent.js и desktop/premier-agent.js.sig (сервер отдаёт их как есть, байт в байт).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DESKTOP = path.join(__dirname, '..', 'desktop');
const AGENT = path.join(DESKTOP, 'premier-agent.js');
const KEYS_LINE = /^const UPDATE_KEYS = \[([^\]\r\n]*?)\/\*UPDATE_KEYS\*\/\];?[ \t]*\r?$/m;
const text = (b) => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b));
const spki = (pub) => (typeof pub === 'string' ? pub : pub.export({ type: 'spki', format: 'der' }).toString('base64'));

// открытые ключи, вписанные в помощника (base64 SPKI DER)
function embeddedKeys(source) { const m = KEYS_LINE.exec(text(source)); return m ? [...m[1].matchAll(/'([A-Za-z0-9+\/=]+)'/g)].map((x) => x[1]) : []; }
function verify(jsBuffer, sigBase64, keysBase64) {
  const sig = Buffer.from(String(sigBase64 || '').trim(), 'base64'); if (sig.length !== 64) return false;
  return (keysBase64 || []).some((k) => { try { return crypto.verify(null, Buffer.from(jsBuffer), crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; } });
}
function verifyRelease(dir = DESKTOP) { return verifyFiles(path.join(dir, 'premier-agent.js'), path.join(dir, 'premier-agent.js.sig')); }
function verifyFiles(jsPath, sigPath) {
  let js, sig, keys = [];
  try { js = fs.readFileSync(jsPath); } catch (e) { return { ok: false, error: 'нет файла ' + jsPath + ': ' + e.message, keys: 0 }; }
  keys = embeddedKeys(js);
  if (!keys.length) return { ok: false, error: 'в помощнике нет ключа обновлений (UPDATE_KEYS пуст) — выполните: node scripts/agent-sign.js init', keys: 0 };
  try { sig = fs.readFileSync(sigPath, 'utf8'); } catch { return { ok: false, error: 'нет файла premier-agent.js.sig — выполните: node scripts/agent-sign.js sign', keys: keys.length }; }
  return verify(js, sig, keys) ? { ok: true, keys: keys.length } : { ok: false, error: 'подпись не подходит к текущему premier-agent.js — выполните: node scripts/agent-sign.js sign', keys: keys.length };
}
function keygen() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey: spki(publicKey), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
const publicOf = (privateKey) => spki(crypto.createPublicKey(privateKey));
// вписывает открытый ключ в строку UPDATE_KEYS (повторно тот же ключ не добавляет)
function embedKey(jsPath, pubBase64) {
  const src = fs.readFileSync(jsPath, 'utf8'), m = KEYS_LINE.exec(src);
  if (!m) throw new Error('в ' + jsPath + ' нет строки «const UPDATE_KEYS = [/*UPDATE_KEYS*/];»');
  const keys = embeddedKeys(src); if (keys.includes(pubBase64)) return false;
  const inner = [...keys, pubBase64].map((k) => `'${k}'`).join(', ');
  fs.writeFileSync(jsPath, src.slice(0, m.index) + `const UPDATE_KEYS = [${inner}/*UPDATE_KEYS*/];` + (m[0].endsWith('\r') ? '\r' : '') + src.slice(m.index + m[0].length));
  return true;
}
// подписывает файл закрытым ключом (PEM); подпись пишет рядом: <jsPath>.sig. Ключ должен быть среди UPDATE_KEYS — иначе помощники подпись не примут
function signFile(jsPath, keyPath) {
  const priv = crypto.createPrivateKey(fs.readFileSync(keyPath)), pub = publicOf(priv), js = fs.readFileSync(jsPath);
  if (!embeddedKeys(js).includes(pub)) throw new Error('открытая часть этого ключа не вписана в UPDATE_KEYS помощника — подпись никто не примет. Если ключ новый, начните с init');
  const sig = crypto.sign(null, js, priv).toString('base64'), out = jsPath + '.sig';
  fs.writeFileSync(out, sig + '\n'); return out;
}

function parse(argv) {
  const o = { cmd: argv[0], key: path.resolve('premier-agent-signing.key'), file: AGENT };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--key' && argv[i + 1]) o.key = path.resolve(argv[++i]);
    else if (argv[i] === '--file' && argv[i + 1]) o.file = path.resolve(argv[++i]);
    else throw new Error('неизвестный ключ: ' + argv[i]);
  }
  return o;
}
function cli(argv) {
  const o = parse(argv);
  if (o.cmd === 'init') {
    if (fs.existsSync(o.key)) throw new Error(`файл ключа ${o.key} уже есть — не перезаписываю. Укажите другой путь (--key) или удалите его сами, если уверены`);
    const k = keygen();
    fs.writeFileSync(o.key, k.privatePem, { mode: 0o600, flag: 'wx' });
    embedKey(o.file, k.publicKey); const sig = signFile(o.file, o.key);
    console.log(`Готово.\n  закрытый ключ: ${o.key}\n  открытый ключ вписан в ${o.file}\n  подпись: ${sig}\n`);
    console.log('ВАЖНО: закрытый ключ храните ВНЕ сервера (флешка, офлайн-диск, менеджер паролей) и сделайте копию.');
    console.log('Потеряете ключ — пользователям придётся заново скачать и установить помощника: старые копии примут обновления только с этой подписью.');
    console.log('Выложите на сервер оба файла: premier-agent.js и premier-agent.js.sig (меняя помощника, подписывайте заново: node scripts/agent-sign.js sign).');
    return 0;
  }
  if (o.cmd === 'sign') { console.log('Подписано: ' + signFile(o.file, o.key)); return 0; }
  if (o.cmd === 'verify') {
    const r = verifyFiles(o.file, o.file + '.sig');
    console.log(r.ok ? `Подпись верна (ключей в помощнике: ${r.keys}).` : 'Подпись НЕ проверена: ' + r.error); return r.ok ? 0 : 1;
  }
  console.log('Использование: node scripts/agent-sign.js init|sign|verify [--key <файл ключа>] [--file <путь к premier-agent.js>]'); return o.cmd ? 1 : 0;
}
if (require.main === module) { try { process.exitCode = cli(process.argv.slice(2)); } catch (e) { console.error('Ошибка: ' + e.message); process.exitCode = 1; } }
module.exports = { embeddedKeys, verify, verifyRelease, verifyFiles, keygen, signFile, embedKey, publicOf };
