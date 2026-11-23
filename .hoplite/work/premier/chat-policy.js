'use strict';
const { plain, detect } = require('./media');

const stripJournal = (text) => String(text || '')
  .replace(/^\(Журнал Premier[\s\S]*?Ассистент такие заметки не пишет\.\)\s*/, '').trim();
// Текст вложения — это данные, а не просьба: во вложенном коде и документах сколько угодно
// фраз «создай изображение», «нарисуй картинку», generate_image. Для намерения оставляем
// только строку с именем файла (клиент пакует файлы блоками [Файл: …] … [Конец файла]).
const ATT_OPEN = /\[(?:Файл|File):[^\]\n]*\]/;
const ATT_CLOSE = (s) => Math.max(s.lastIndexOf('[Конец файла]'), s.lastIndexOf('[End of file]'));
// Срезаем от первого заголовка вложения до ПОСЛЕДНЕго закрывающего маркера: тело файла само
// может содержать «[Конец файла]» (например, код клиента), поэтому матчинг по первому негодится.
const stripFiles = (text) => {
  const s = String(text || '').trim(), open = s.search(ATT_OPEN);
  if (open < 0) return s;
  const close = ATT_CLOSE(s);
  if (close <= open) return s;
  const tail = s.slice(close).replace(/^\[(?:Конец файла|End of file)\]/, '');
  return (s.slice(0, open) + s.slice(open).match(ATT_OPEN)[0] + tail).trim();
};
const userText = (m) => stripFiles(stripJournal(plain(m.content)));
// тот же порог, что внутри media.detect(): слишком длинный текст — не просьба
const MEDIA_MAX = 2000;

const CREATE = /(?:созда|сдела|напиши|напиш|разработ|собери|запили|реализ|передела|добав|исправ|почини|хочу|нужн|нарису|create|make|build|implement|fix|write)/i;
const WEB_ARTIFACT = /(?:игр[ауые]|игрушк|сайт|лендинг|веб[ -]?прилож|интерактив|three\.?js|webgl|первого лица|first[ -]person|\bgame\b|\bwebsite\b|\blanding\b)/i;
const FOLLOW_UP = /^(?:ну\s+(?:ч[её]|что)\s+там|где\s+(?:код|игра|сайт|результат)|продолж(?:и|ай)|давай|жду|доделай|не\s+работает|(?:а\s+)?теперь\s+|(?:ещ[её]|добавь|исправь|поменяй|убери|сделай|доработай|доработать|улучши|улучшить|измени|изменить|обнови|почини)(?:\s|$))/i;
const EDIT_REQUEST = /(?:доработ(?:ай|ать)|улучш(?:и|ить)|измен(?:и|ить)|обнов(?:и|ить)|исправ(?:ь|ить)|почини|поменяй|убери|добав(?:ь|ить)|отредактир|enhance\b|improve\b|modify\b|update\b|change\b|fix\b)/i;
const RECREATE = /(?:с\s+нуля|заново|нов(?:ая|ую|ый|ое)\s+(?:игр|сайт|сцен|поле|лендинг)|друг(?:ую|ой|ое)\s+(?:игр|сайт|сцен|поле)|from\s+scratch|start\s+over|new\s+(?:game|website|scene))/i;
const NEW_REQUEST = /^(?:пожалуйста[,\s]+)?(?:создай|создать|сделай|сделать|напиши|собери|create\b|build\b|make\b)/i;
const QUESTION = /^(?:почему|зачем|как\s+(?:работает|устроен|сделать)|что\s+такое|объясни|расскажи|why\b|explain\b)/i;
const NEGATED_IMAGE = /(?:не\s+(?:картинк|изображен|фото)|(?:а\s+)?не\s+(?:картинк|изображен)|вместо\s+картинк)/i;
const EXPLICIT_IMAGE = /(?:нарису|изобрази|созда|сдела|сгенерир|generate|draw|create|make)[\s\S]{0,100}(?:картинк|изображен|иллюстрац|скриншот|логотип|обложк|постер|\bimage\b|\bpicture\b|\billustration\b|\blogo\b)/i;
// «Видео кодом»: просьба сделать видео/ролик/анимацию идёт тем же путём, что сайт или игра: модель пишет HTML/CSS/SVG/Canvas-анимацию,
// пользователь смотрит её вживую и скачивает MP4 (запись кадров — animation.js). Отдельного генератора видео нет.
const ANIM_VERB = /(?:созда|сдела|сгенерир|сним|собери|запили|разработ|хочу|нужн|нужен|нужна|нужно|generate|create|make|build|render|\bproduce\b)/iu;
// сильные слова: видео, ролик, клип, анимация. «с анимацией» — свойство чего-то другого, не заказ анимации.
// «видеоплеер», «video chat» и т. п. — не ролик.
const ANIM_STRONG = '(?:видео(?!-?(?:плеер|хостинг|чат|звонк|связ|редактор|игр|конференц|урок|наблюден|камер))|ролик|клип|(?<![\\p{L}\\p{N}])(?<!(?:^|[^\\p{L}\\p{N}])с[оа]?\\s+)анимаци(?:я|ю|и|ей|ями)(?![\\p{L}])|\\bvideo\\b(?![ -](?:player|chat|call|editor|game|conferenc|hosting|stream))|\\bclip\\b|\\bmotion[ -]graphics\\b|(?<!\\bwith\\s)(?<!\\band\\s)\\banimation\\b)';
// мультик/мультфильм/заставка — только прямое дополнение («сделай мультик»), не «героя мультика», «в стиле мультфильма», «из мультфильма»
const ANIM_DIRECT = '(?:мультик|мультфильм|заставк|\\bcartoon\\b)';
const ANIM_WEAK = '(?:анимированн|анимацион|гиф(?![\\p{L}])|гифк|\\bgif\\b|\\banimated\\b)';
// слова, которые превращают «анимацию/заставку» в правку страницы: «анимация на кнопку», «заставка при загрузке сайта»
const ANIM_WEB_PART = /^[^.!?\n]{0,40}?(?:кнопк|меню|сайт|страниц|лендинг|блок|карточк|форм[ауые](?![\p{L}])|элемент|навигац|шапк|подвал|заголов|иконк|переход|\bbutton\b|\bsite\b|\bpage\b|\bmenu\b|\bblocks?\b|\bcard\b)/iu;
const ANIM_VERB_ALONE = /(?:оживи|анимируй|\banimate\b)/iu;
const NO_ANIM = /(?:не\s+(?:видео|ролик|анимаци)|вместо\s+(?:видео|ролик|анимаци)|not\s+(?:a\s+)?(?:video|animation))/i;
// код/команды/просмотр: «напиши скрипт для скачивания видео», «хочу посмотреть видео» — не заказ ролика
const NON_ANIM = new RegExp('(?:\\bpython\\b|питон|pygame|unity|unreal|\\bgodot\\b|роблокс|\\broblox\\b|скрипт|функци|(?<![\\p{L}\\p{N}])код(?![\\p{L}])|ffmpeg|\\bbash\\b|терминал|команд(?:а|у|ы|ой)?\\s+(?:для|ffmpeg|bash|в\\s+терминал)|посмотр|смотреть|youtube|ютуб|\\bscript\\b|\\bfunction\\b|\\bsource code\\b|\\bwatch\\b)', 'iu');
const ANIM_META = /<meta\b[^>]*\bname\s*=\s*["']?premier-animation\b/i;
const isAnimHtml = (source) => ANIM_META.test(String(source || ''));
const NEAR_GAP = '(?:(?:мне|нам|me|us)\\s+)?(?:[\\p{L}\\p{N}-]+\\s+){0,4}?';
const NEAR_STRONG = new RegExp(`(?:${ANIM_VERB.source})[\\p{L}\\p{N}]*\\s+${NEAR_GAP}(${ANIM_STRONG})`, 'iu');
const NEAR_WEAK = new RegExp(`(?:${ANIM_VERB.source})[\\p{L}\\p{N}]*\\s+${NEAR_GAP}(${ANIM_WEAK})`, 'iu');
const NEAR_DIRECT = new RegExp(`(?:${ANIM_VERB.source})[\\p{L}\\p{N}]*\\s+(?:(?:мне|нам|me|us)\\s+)?(?:(?!(?:из|в|для|на|с|со|про|по|от|как|героя|героев|персонаж\\p{L}*|стил\\p{L}*)\\s)[\\p{L}\\p{N}-]+\\s+){0,2}?(${ANIM_DIRECT})`, 'iu');
// Индекс слова «видео/анимация» в просьбе (рядом с глаголом, не дальше четырёх слов) или -1. Если сайт/игра названы раньше слова — это не ролик.
function animAt(text) {
  if (!text || QUESTION.test(text) || NO_ANIM.test(text) || NON_ANIM.test(text)) return -1;
  const found = [];
  for (const re of [NEAR_STRONG, NEAR_WEAK, NEAR_DIRECT]) {
    const m = re.exec(text); if (!m) continue;
    const at = m.index + m[0].length - m[1].length, word = m[1];
    if (/^(?:анимаци|animation|заставк|анимированн|анимацион|animated)/iu.test(word) && ANIM_WEB_PART.test(text.slice(at + word.length))) continue;
    const webAt = text.slice(m.index).search(WEB_ARTIFACT);
    if (webAt >= 0 && m.index + webAt < at) continue;
    found.push(at);
  }
  const alone = text.search(ANIM_VERB_ALONE);
  if (alone >= 0 && text.slice(alone).search(WEB_ARTIFACT) < 0) found.push(alone);
  return found.length ? Math.min(...found) : -1;
}
const animRequest = (text) => animAt(text) >= 0;
const FN_REQUEST = /(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i;
const NON_HTML = /(?:\bpython\b|питон|pygame|unity|unreal|\bgodot\b|роблокс|\broblox\b|презентац|excel|\.pptx\b|\.xlsx\b)/i;

function directIntent(text) {
  if (!text || QUESTION.test(text)) return 'general';
  const commandAt = text.search(CREATE);
  const requested = commandAt >= 0 ? text.slice(commandAt) : text;
  const webAt = requested.search(WEB_ARTIFACT);
  const imageAt = requested.search(/картинк|изображен|иллюстрац|скриншот|логотип|обложк|постер|\bimage\b|\bpicture\b|\billustration\b|\blogo\b/i);
  const anim = FN_REQUEST.test(text) ? -1 : animAt(text);
  // «сделай видео из этой картинки» — анимация; «нарисуй картинку для видео» — картинка
  if (anim >= 0 && (imageAt < 0 || anim - (commandAt > 0 ? commandAt : 0) <= imageAt)) return 'artifact';
  if (!NEGATED_IMAGE.test(text) && EXPLICIT_IMAGE.test(text) && (webAt < 0 || imageAt < webAt)) return 'image';
  if (/(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(text)) return 'general';
  if (WEB_ARTIFACT.test(text) && !NON_HTML.test(text) &&
      (CREATE.test(text) || /(?:я\s+просил|именно|а\s+не\s+картинк)/i.test(text))) return 'artifact';
  return 'general';
}

// Короткие «ну че там» / правки наследуют задачу, но новый явный запрос заменяет её.
// Это ограниченная эвристика, не универсальный классификатор языка.
function intentOf(messages) {
  const users = messages.filter((m) => m?.role === 'user')
    .map(userText).slice(-12);
  const last = users.pop() || '';
  const direct = directIntent(last);
  if (direct !== 'general') return direct;
  if (NON_HTML.test(last) || /(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(last))
    return 'general';
  if (!QUESTION.test(last) && FOLLOW_UP.test(last)) {
    for (let i = users.length - 1; i >= 0; i--) {
      const prior = directIntent(users[i]);
      if (prior !== 'general') return prior;
      if (!FOLLOW_UP.test(users[i])) break; // Не наследуем старую задачу через смену темы.
    }
  }
  return 'general';
}
function baseTaskOf(messages, base) {
  const users = messages.filter((m) => m?.role === 'user')
    .map(userText);
  const text = users.at(-1) || '';
  const intent = intentOf(messages);
  const mediaOrOther = intent === 'image' || QUESTION.test(text) ||
    NON_HTML.test(text) || /(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(text);
  if (mediaOrOther) return { intent, mode: null, needsBase: false };
  if (RECREATE.test(text) || (NEW_REQUEST.test(text) && WEB_ARTIFACT.test(text) && !EDIT_REQUEST.test(text)))
    return { intent: 'artifact', mode: 'create', needsBase: false };
  const asksEdit = EDIT_REQUEST.test(text) || FOLLOW_UP.test(text);
  // Короткий статус после нового незавершённого запроса не правит старую игру.
  if (base && asksEdit && !EDIT_REQUEST.test(text) && /^(?:ну\s|продолж|жду|давай)/i.test(text)) {
    const prior = users.slice(0, -1).reverse().find((u) => !FOLLOW_UP.test(u) || RECREATE.test(u));
    if (prior && RECREATE.test(prior)) return { intent: 'artifact', mode: 'create', needsBase: false };
  }
  if (asksEdit && (base || (EDIT_REQUEST.test(text) && (intent === 'artifact' || WEB_ARTIFACT.test(text)))))
    return { intent: 'artifact', mode: 'edit', needsBase: !base };
  return { intent, mode: intent === 'artifact' ? 'create' : null, needsBase: false };
}

// Режим анимации: свежая просьба «сделай видео/анимацию …» создаёт новую анимацию (а не правит открытую игру);
// правки и короткие продолжения наследуют режим от открытой версии с <meta name="premier-animation"> или от прошлой просьбы.
function inheritedAnim(users) {
  for (let i = users.length - 1; i >= 0; i--) {
    if (animRequest(users[i])) return true;
    if (directIntent(users[i]) !== 'general') return false;
    if (!FOLLOW_UP.test(users[i])) return false;
  }
  return false;
}
const VIDEO_WORD = /(?:видео|ролик|клип|мульт|гиф|\bvideo\b|\bclip\b|\bgif\b|\bcartoon\b|motion[ -]graphics)/i;
function taskOf(messages, base) {
  const task = baseTaskOf(messages, base);
  if (task.intent !== 'artifact') return task;
  const users = messages.filter((m) => m?.role === 'user').map(userText), text = users.at(-1) || '';
  const baseAnim = !!base && isAnimHtml(base.source);
  if (animRequest(text)) {
    if (baseAnim && task.mode === 'edit' && EDIT_REQUEST.test(text) && !RECREATE.test(text)) return { ...task, anim: true };
    // Открыт обычный сайт/игра: «сделай анимацию загрузки», «заставку при загрузке» — это правка сайта, а не новый ролик.
    // Новая анимация — только по явному «с нуля/заново» или по прямой просьбе про видео/ролик/клип/гифку.
    if (base && !baseAnim && !RECREATE.test(text) && !(NEW_REQUEST.test(text) && VIDEO_WORD.test(text))) return task;
    return { intent: 'artifact', mode: 'create', needsBase: false, anim: true };
  }
  if (directIntent(text) !== 'general' || RECREATE.test(text)) return task;
  const anim = base ? baseAnim : inheritedAnim(users.slice(0, -1));
  return anim ? { ...task, anim: true } : task;
}

function toolAllowed(name, intent) {
  return intent !== 'artifact' ||
    !['generate_image', 'generate_video', 'view_page', 'run_python'].includes(name);
}
function mediaWant(text, options, intent) {
  if (intent === 'artifact') return null;
  const t = stripFiles(text); // тело файла не может заказать картинку или видео
  if (intent === 'image') return t.length > MEDIA_MAX ? null : intent;
  return detect(t, options);
}
function validateTool(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Аргументы инструмента должны быть JSON-объектом');
  if (name === 'fetch_page' || name === 'view_page') {
    if (typeof args.url !== 'string' || !args.url.trim()) throw new Error('Нужен полный URL страницы, например https://example.com/');
    let u; try { u = new URL(args.url); } catch { throw new Error('Некорректный URL страницы: нужен полный адрес http:// или https://'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password)
      throw new Error('Нужен URL http/https без логина и пароля');
    args = { ...args, url: u.href };
  }
  if (name === 'web_search' && (typeof args.query !== 'string' || !args.query.trim()))
    throw new Error('Нужен непустой поисковый запрос');
  return args;
}
function completeHtml(text) {
  const blocks = String(text || '').matchAll(/```([^\n]*)\n([\s\S]*?)```/g);
  for (const [, info, code] of blocks) {
    if ((/^html?(?:\s|:|$)/i.test(info.trim()) || /(?:^|[/:])[^/\s]+\.html?(?:\s|$)/i.test(info.trim()) || !info.trim()) &&
        /<(?:!doctype|html|body)\b/i.test(code) && /<\/html\s*>/i.test(code))
      return true;
  }
  return false;
}
const ARTIFACT_NOTE = `

РЕЖИМ ИНТЕРАКТИВНОГО HTML-РЕЗУЛЬТАТА.
Пользователь ждёт работающую браузерную игру/сайт/сцену, а не иллюстрацию и не описание плана.
Верни полный HTML-документ в закрытом блоке кода html (или полные HTML/CSS/JS-файлы, если просили проект).
Для игры от первого лица реализуй управление и интерактивность кодом. Не подменяй игру изображением или видео.
Не вызывай generate_image, view_page или run_python: они не создают этот результат.
Если нужен поиск документации, используй web_search; fetch_page — только с настоящим полным URL.
Объяснение перед кодом — максимум одно короткое предложение. Не говори «готово/создал» без самого кода.
Если задача неясна или её нельзя выполнить, честно задай уточнение/объясни ограничение вместо обещания.`;
const ANIM_RULES = `1. В <head> обязательно: <meta name="premier-animation" content="duration=8; fps=30; width=1920; height=1080">.
   duration — секунды (по умолчанию 8, максимум 60), fps — 30 или 60, размер: 1920x1080 (по умолчанию), 1080x1920 (вертикальное, сторис) или 1080x1080 (квадрат). Выбери под просьбу.
2. Сцена — один фиксированный контейнер (например <div id="stage"> шириной и высотой из meta, overflow:hidden), который масштабируется под окно предпросмотра
   (transform: scale(min(innerWidth/W, innerHeight/H)) от центра; body без прокрутки, тёмный фон вокруг сцены). Внутри размеры считай в пикселях сцены W×H.
3. Движение зависит только от времени: CSS-анимации и transitions, Web Animations API, таймлайн GSAP (подключай с CDN, например https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js)
   или requestAnimationFrame, где положение считается из временной метки (аргумент колбэка или performance.now()), а не из числа кадров.
   Не используй ввод пользователя, клики, наведение, звук, камеру, WebSocket, fetch к внешним API. Math.random допустим, но лучше свой генератор с фиксированным зерном.
4. Анимация начинается сама, идёт ровно duration секунд и либо замыкается в бесшовный цикл (live-превью повторяется), либо останавливается на красивом финальном кадре.
   Все CSS-анимации начинаются с нуля при загрузке; для последовательности используй animation-delay или timeline, а не setTimeout-цепочки.
5. Картинки — только из самого кода (SVG, canvas, CSS-градиенты, emoji, data: URL). Внешние ссылки при записи MP4 разрешены только для библиотек и шрифтов с этих CDN:
   cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com, esm.sh, ajax.googleapis.com. Картинки с других сайтов не загрузятся — рисуй их сам. Оформи как готовый ролик: заголовки, плавные easing, композиция, цвет.
6. Не вызывай generate_image, view_page или run_python.`;
const ANIMATION_NOTE = `

РЕЖИМ «ВИДЕО КОДОМ» (анимация в HTML/CSS/SVG/Canvas).
Пользователь просит видео, ролик или анимацию. Настоящего генератора видео нет: ты пишешь анимацию кодом, как артефакт.
Пользователь увидит её вживую в окне предпросмотра и сможет скачать как MP4 (сервер сам запишет её покадрово).
Верни ОДИН полный HTML-документ в закрытом блоке html. Правила:
${ANIM_RULES}
Объяснение перед кодом — одно короткое предложение; после кода можно одной строкой сказать, что видео скачивается кнопкой «Скачать MP4».`;
// Правка открытой анимации: формат ответа задаёт протокол точечных правок, здесь только правила самой анимации
const ANIMATION_EDIT_NOTE = `

РЕЖИМ «ВИДЕО КОДОМ»: открыта анимация, которую скачивают как MP4. Формат ответа — как указано выше (точечные правки); правки не должны нарушать правила анимации:
${ANIM_RULES}`;
const REPAIR_NOTE = `В предыдущем ответе нет полного HTML-документа. Один раз заверши исходную задачу сейчас:
пришли готовую интерактивную игру/сайт полным HTML-документом в закрытом блоке html с </html>.
Не присылай картинку, видео, план, обещание или вызовы инструментов. CSS и JS внутри HTML;
если пользователь явно просил проект из файлов — верни полные файлы с путями.
Если выполнить нельзя, прямо скажи об этом; не утверждай, что результат готов.`;

function needsRepair(text) {
  // Не навязываем код после явного отказа или уточнения.
  return !completeHtml(text) && !/(?:не могу|не буду|нельзя выполнить|не удалось|уточни|уточните|какую именно|какой именно|could you clarify|cannot|can't)/i.test(text);
}
module.exports = { stripJournal, stripFiles, intentOf, taskOf, toolAllowed, mediaWant, validateTool, completeHtml, needsRepair, ARTIFACT_NOTE, ANIMATION_NOTE, ANIMATION_EDIT_NOTE, REPAIR_NOTE, animRequest, isAnimHtml };