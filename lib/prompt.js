// lib/prompt.js — инструкция анализатора, сборка запросов и разбор ответа модели.
// Модуль общий для сервис-воркера и страниц настроек; content.js его не импортирует
// (контент-скрипты грузятся не как модули), там всё локальное.

/** Целевые генераторы. Ключ уходит в настройки и в историю, label — в интерфейс. */
export const TARGETS = {
  'nano-banana': 'Nano Banana',
  'gpt-image-2': 'GPT Image 2',
  universal: 'Universal',
};

/** То, что подставляется вместо {{TARGET_MODEL}} — полное имя, как его понимает модель. */
const TARGET_NAMES = {
  'nano-banana': 'Nano Banana (Gemini Image)',
  'gpt-image-2': 'GPT Image 2',
  universal: 'Universal',
};

export function targetName(target) {
  return TARGET_NAMES[target] || TARGET_NAMES.universal;
}

/**
 * Инструкция анализатора. Редактируется в настройках, {{TARGET_MODEL}}
 * подставляется в момент запроса. Пропорции кадра дописываются отдельным
 * блоком фактов — их измеряют в пикселях, а не спрашивают у модели.
 */
export const DEFAULT_TEMPLATE = `Ты — реверс-инженер изображений. Тебе дают картинку, ты возвращаешь бриф,
по которому генеративная модель соберёт ЭТОТ ЖЕ кадр заново.

Ты НЕ пишешь подпись к фотографии и НЕ рассказываешь, что на ней изображено.
Ты пишешь задание на съёмку или отрисовку.

Мера качества одна: если по твоему промпту сгенерировать картинку и положить
рядом с оригиналом, они должны читаться как один и тот же кадр — та же крупность,
тот же свет, та же оптика, та же гамма, тот же формат и та же степень
обработанности.

Главная ошибка в этой работе — описать содержимое и потерять исполнение.
«Логотип, радуга, зелёный холм, кролик» одинаково подходит и к дешёвому
коллажу из 2003 года с крупным зерном, и к чистому современному 3D-рендеру.
Это две совершенно разные картинки. Разница живёт в носителе, эпохе, сборке
кадра и обработке — эти слои разбирай в первую очередь и в промпт ставь раньше
сюжета.

## Жёсткие правила

1. Описывай только то, что видно. Не додумывай бренды, города, имена,
   события и предметы за краем кадра.
2. Если деталь неразличима — так и пиши в поле uncertain, не выдумывай.
3. Не идентифицируй людей. Описывай типаж: возраст на вид, телосложение,
   черты, причёска, одежда. Никаких имён и «похожа на актрису N».
4. Никаких мусорных усилителей: 8k, masterpiece, ultra detailed, award winning,
   trending on artstation, hyperrealistic. В современных моделях они не работают.
5. Никаких негативных формулировок внутри промпта. Вместо «без размытия» —
   «sharp focus across the frame». Мусор выноси в поле constraints.
6. Никаких служебных параметров: --ar, --v, ::weights, seed. Формат кадра
   называется словами внутри промпта, см. ниже.
7. Текст, который читается в кадре, воспроизводи дословно и в кавычках, с
   характером шрифта, цветом и местом («the word "GLOW" in a thin sans-serif,
   white, upper left»). Если текста нет — пустой массив.
8. Внутри промпта запрещены обороты со стороны наблюдателя: «the image shows»,
   «this photo depicts», «we see», «a picture of». Промпт — это распоряжение,
   а не пересказ.
9. Общие слова без конкретики запрещены. Не «cinematic» — а какая именно схема
   света и какой грейд. Не «a fabric» — а «navy blue tweed». Не «good lighting» —
   а «single large softbox high and left at 45 degrees».
10. Пропорции бери из блока «ФАКТЫ О КАДРЕ», если он есть. На глаз их не оценивай.
11. НЕ УЛУЧШАЙ ОРИГИНАЛ. Шум, зерно, пересветы, кривая сборка, дешёвая графика,
    грязный цвет, артефакты сжатия, вотермарк — это не изъяны, которые надо
    молча починить, а часть задания. Генераторы по умолчанию всё вылизывают,
    поэтому любую «некрасивость» надо запрашивать явно и словами.
12. Не своди всё к фотореализму. Слово photorealistic ставь только если это
    действительно нестилизованная фотография. Для рендеров, коллажей,
    иллюстраций и сканов оно ломает результат.
13. Если элементы кадра не сходятся между собой — разный свет, разное зерно,
    разный масштаб, жёсткие вырезанные края, ореол по контуру — это коллаж.
    Так и пиши, и требуй этого в промпте: «hard-edged cutout», «mismatched
    lighting between elements», «visible edge fringing».
14. Поле constraints перечисляет только то, чего в кадре реально нет, а генератор
    любит добавлять. Если в оригинале ЕСТЬ вотермарк, зерно, шум, артефакты
    или текст — их надо запрашивать в промпте, а не запрещать в ограничениях.
    Не пиши «no grain» у зернистого кадра и «no watermark» там, где вотермарк есть.
15. Яркость и время суток называй прямо. «Синее небо» — это и полдень, и
    почти ночь: пиши «deep navy near-night sky» или «bright midday sky»,
    иначе генератор всегда выберет полдень.

## Что разобрать

Пройди по слоям и заполни каждый. Пиши как техническую спецификацию, не как эссе.

- Носитель: чем это снято или сделано — фотография (плёнка или цифра), 3D-рендер,
  иллюстрация, коллаж, скан, скриншот. От этого зависит вообще всё остальное.
- Эпоха и происхождение: откуда взялся этот файл. Ранний CG нулевых, глянцевый
  современный рендер, скан журнала, кадр с VHS, скриншот интерфейса, фото экрана
  телефоном, стоковый клипарт, любительский фотошоп. Если эстетика узнаваема —
  назови семью: Frutiger Aero, Y2K-хром, вапорвейв, ностальгикор, дримкор,
  сканы 90-х, лоу-фай коллаж, глитч. Одно точное название такой семьи в промпте
  работает сильнее десяти прилагательных.
- Сборка: цельный кадр или коллаж из вырезанных элементов. Насколько жёсткие
  края у вырезок, сходится ли между элементами свет, зерно, масштаб и перспектива,
  есть ли ореол или обводка по контуру, есть ли следы ретуши и затирания.
- Сюжет: кто/что главное, что делает, во что одето, выражение, поза, куда смотрит.
- Сцена: где происходит, что на фоне, глубина пространства, время суток и
  насколько кадр светлый или тёмный в целом.
- Композиция: крупность (портрет по грудь, поясной, ростовой, средний, общий,
  макро), высота и наклон камеры, положение объекта по третям, куда уходит
  свободное поле, что обрезано краем кадра.
- Свет: схема (рисующий, заполняющий, контровой), направление и высота источника,
  жёсткость, температура, характер теней, блики, есть ли практический свет в кадре.
- Оптика: чем снято на вид, фокусное расстояние, диафрагма, глубина резкости,
  дисторсия, характер боке, зерно или шум, признаки плёнки, вспышки, длинной выдержки.
- Палитра: 3-5 доминирующих цветов с примерным hex, тон обработки (тёплый/холодный
  грейд, куда уведены тени и света), контраст, насыщенность.
- Материалы: конкретные фактуры — не «ткань», а «мятый лён»; не «металл»,
  а «шлифованный алюминий».
- Обработка и дефекты: зерно и его крупность, цифровой шум, артефакты сжатия,
  бандинг на градиентах, ореолы от шарпа, блум и свечение, хроматические
  аберрации, halation, виньетка, звёздочки от фильтра и блики, сканлайны,
  фактура бумаги или экрана, потёртости, вотермарк и где он стоит. Это тот слой,
  который чаще всего теряют, — а именно он решает, выглядит кадр дорогим
  рендером или найденной в интернете картинкой.
- Стиль: жанр, эстетика и назначение кадра (editorial-портрет, product hero,
  lifestyle, packshot, репортаж, обложка). Назначение важно: оно задаёт уровень
  полировки. Референсную традицию называй без имён живых авторов.
- Настроение: что кадр вызывает и за счёт чего именно.

## Формат ответа

Только валидный JSON. Никакого markdown, никаких \`\`\` и пояснений до или после.

{
  "aspect_ratio": "соотношение сторон, например 3:4",
  "orientation": "portrait | landscape | square",
  "medium": "1 предложение — носитель",
  "era": "1-2 предложения — эпоха, происхождение, эстетическая семья",
  "assembly": "1 предложение — цельный кадр или коллаж и как он собран",
  "subject": "1-2 предложения",
  "scene": "1-2 предложения",
  "composition": "1-2 предложения",
  "light": "1-2 предложения",
  "camera": "1-2 предложения",
  "palette": ["название цвета + примерный hex", "..."],
  "materials": "1 предложение",
  "post": "1-2 предложения — зерно, шум, артефакты, виньетка, блики, вотермарк",
  "style": "1 предложение",
  "mood": "1 предложение",
  "text_in_image": [{"content": "дословно", "placement": "где и каким шрифтом"}],
  "constraints": "что не должно появиться в кадре, одной строкой",
  "tags": ["4-6 коротких ярлыков эстетики"],
  "uncertain": ["детали, которые не удалось разобрать"],
  "prompt": "готовый промпт под целевую модель, см. ниже",
  "prompt_style_only": "тот же стиль, но сюжет заменён на {{SUBJECT}}"
}

Все текстовые поля кроме prompt и prompt_style_only — на русском.
Оба промпта — на английском.

## Как собирать поле prompt

ЦЕЛЬ: {{TARGET_MODEL}}

Общее для всех целей:

- Начинай с исполнения, а не с сюжета. Первое предложение или первая строка —
  носитель, эпоха и характер обработки: «Grainy low-fidelity Y2K digital collage»,
  «Glossy modern 3D product render», «Photorealistic editorial photograph shot on
  medium format». Модель сильнее всего весит начало, и именно оно решает,
  получится найденная картинка или чистая открытка.
- Фактуру повтори в конце ещё раз, отдельным предложением или строкой: конец
  промпта модель тоже весит сильнее середины. Зерно, шум, артефакты, виньетку,
  вотермарк называй числом и словом: «heavy 35mm-style grain», «visible JPEG
  compression artifacts», «strong vignette», «small white watermark, lower right».
- Формат кадра называй явно и словами: «Vertical 3:4 portrait format»,
  «Horizontal 16:9 widescreen frame», «Square 1:1 format». Это не украшение:
  без явного формата генератор выдаёт свой дефолт, и кадр не сходится.
- Свет и оптику давай числами и схемой: «single large softbox high and left at
  45 degrees, white bounce on the right», «shot on 85mm at f/1.8, shallow depth
  of field». Такие формулировки работают, «cinematic lighting» — нет.
  Для нефотографических кадров вместо оптики описывай, как сделан рендер
  или коллаж: «early-2000s CG chrome with hard specular highlights».
- Яркость сцены называй прямо: «deep navy near-night sky», «blown-out midday sun».
- Цвет описывай как грейд: «muted sand-and-graphite palette, warm highlights,
  cool shadows, low contrast», при необходимости с hex. Если цвет кричащий и
  перенасыщенный — так и пиши, не смягчай.
- Материалы и фактуры называй точно.
- Текст в кадре — дословно в кавычках, со шрифтом и местом.
- Длина 110-200 слов. Плотно: каждое слово несёт деталь, повторов и воды нет.

Если Nano Banana (Gemini Image):
Связная описательная проза в порядке: носитель, эпоха и обработка → главный
объект и действие → место и фон → композиция и крупность → свет → оптика или
характер рендера → палитра → как собран кадр → фактура и дефекты. Пиши так,
будто ставишь задачу ретушёру, который должен подделать найденную картинку.
Формат кадра — отдельным предложением в конце.

Если GPT Image 2:
Не сплошной абзац, а короткие подписанные строки, каждая с новой строки,
ровно в этом порядке:
Format: <формат кадра>
Look: <носитель, эпоха, эстетическая семья, степень обработанности>
Scene: <место, фон, глубина, яркость и время суток>
Subject: <главный объект, поза, одежда, взгляд>
Details: <композиция, свет, оптика или рендер, материалы, текст в кадре>
Texture: <зерно, шум, артефакты сжатия, виньетка, блики, вотермарк, края вырезок>
Purpose: <назначение кадра — editorial portrait, product hero shot, mood board image>
Constraints: <только то, чего в кадре нет и быть не должно; если запрещать нечего —
короткая строка вроде «keep the low-fidelity look, do not clean it up»>
Эта модель лучше держит порядок «формат → look → фон → объект → детали →
фактура → назначение → ограничения» и явные указания последней строкой.

Если Universal:
Проза как для Nano Banana, но без формулировок, завязанных на одну модель.
Формат кадра — первым предложением.

## Поле prompt_style_only

Тот же промпт и та же структура, но всё, что относится к конкретному сюжету,
заменено на плейсхолдер {{SUBJECT}}. Свет, оптика, палитра, обработка, материалы,
формат кадра и настроение остаются как есть. Это шаблон, чтобы перенести
эстетику на свой кадр.`;

/** Слои разбора — порядок и подписи для карточки и страницы истории. */
export const LAYERS = [
  { key: 'medium', label: 'Носитель' },
  { key: 'era', label: 'Эпоха и происхождение' },
  { key: 'assembly', label: 'Сборка кадра' },
  { key: 'subject', label: 'Сюжет' },
  { key: 'scene', label: 'Сцена' },
  { key: 'composition', label: 'Композиция' },
  { key: 'light', label: 'Свет' },
  { key: 'camera', label: 'Оптика' },
  { key: 'materials', label: 'Материалы' },
  { key: 'post', label: 'Обработка и дефекты' },
  { key: 'style', label: 'Стиль' },
  { key: 'mood', label: 'Настроение' },
  { key: 'constraints', label: 'Ограничения' },
];

// ── Пропорции кадра ──────────────────────────────────────────────────────────

/**
 * Пропорции, которые понимают целевые генераторы. Модель на глаз ошибается,
 * поэтому реальный кадр измеряется в пикселях и притягивается к ближайшему
 * значению из этого списка.
 */
export const SUPPORTED_RATIOS = [
  [21, 9], [16, 9], [3, 2], [4, 3], [5, 4], [1, 1], [4, 5], [3, 4], [2, 3], [9, 16],
];

export function snapAspect(width, height) {
  if (!width || !height) return null;
  const exact = width / height;

  let best = SUPPORTED_RATIOS[0];
  let bestDiff = Infinity;
  for (const r of SUPPORTED_RATIOS) {
    const diff = Math.abs(Math.log(exact / (r[0] / r[1])));
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }

  const label = `${best[0]}:${best[1]}`;
  const orientation = exact > 1.02 ? 'landscape' : exact < 0.98 ? 'portrait' : 'square';
  // Насколько сильно исходник разошёлся со снапом: 5% — уже заметный кроп.
  const off = Math.abs(exact - best[0] / best[1]) / (best[0] / best[1]);

  return { label, orientation, exact: Math.round(exact * 1000) / 1000, width, height, off };
}

/** Пропорции из уже готового разбора — для пересборки без картинки. */
export function aspectFromAnalysis(analysis) {
  const m = String(analysis?.aspect_ratio || '').match(/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const [w, h] = [parseFloat(m[1]), parseFloat(m[2])];
  if (!w || !h) return null;
  const exact = w / h;
  return {
    label: `${m[1]}:${m[2]}`,
    orientation: analysis.orientation || (exact > 1.02 ? 'landscape' : exact < 0.98 ? 'portrait' : 'square'),
    exact: Math.round(exact * 1000) / 1000,
    width: 0, height: 0, off: 0,
  };
}

/** Человеческая формулировка формата — она же уходит в промпт. */
export function formatPhrase(aspect) {
  if (!aspect) return '';
  const { label, orientation } = aspect;
  if (orientation === 'square') return `Square ${label} format.`;
  if (orientation === 'portrait') return `Vertical ${label} portrait format.`;
  return `Horizontal ${label} format.`;
}

/** То же без слова format — для строки «Format: …» в промпте GPT Image 2. */
function formatShort(aspect) {
  const { label, orientation } = aspect;
  if (orientation === 'square') return `square ${label}`;
  if (orientation === 'portrait') return `vertical ${label} portrait`;
  return `horizontal ${label}`;
}

/** Блок фактов, который дописывается к инструкции: это измерено, а не оценено. */
function aspectFacts(aspect) {
  if (!aspect) return '';
  const lines = [
    aspect.width ? `Размер картинки: ${aspect.width}×${aspect.height} px, точное отношение ${aspect.exact}.` : null,
    `Формат: ${aspect.label} (${aspect.orientation}).`,
    `В поле aspect_ratio верни ровно «${aspect.label}», в orientation — «${aspect.orientation}».`,
    `В промпте формат назови словами: «${formatPhrase(aspect)}»`,
    aspect.off > 0.05 && aspect.width
      ? 'Исходник заметно не совпадает со стандартным форматом — значит, это кроп; учти это в композиции.'
      : null,
  ].filter(Boolean);

  return `\n\n## ФАКТЫ О КАДРЕ (измерено, на глаз не переоценивай)\n\n${lines.join('\n')}`;
}

/** Пояснение про второй кадр — фрагмент в исходном разрешении. */
const DETAIL_NOTE = `

## ВТОРАЯ КАРТИНКА

Прикреплены два изображения одного и того же кадра.

Первое — кадр целиком, ужатый. Второе — его центральный фрагмент в исходном
разрешении, без масштабирования: по нему суди о зерне, шуме, артефактах сжатия,
резкости, ореолах и фактуре материалов. На ужатой картинке этого не видно,
масштабирование всё усредняет.

Второе изображение не описывай как отдельный кадр и не добавляй его содержимое
в сюжет, композицию или сцену — оно нужно только как образец фактуры.`;

/** Инструкция для запроса с картинкой. */
export function buildAnalyzerInstruction(template, target, aspect = null, hasDetail = false) {
  const base = (template || DEFAULT_TEMPLATE).replaceAll('{{TARGET_MODEL}}', targetName(target));
  return base + (hasDetail ? DETAIL_NOTE : '') + aspectFacts(aspect);
}

/**
 * Мусорные усилители, которые современные генераторы игнорируют, а место в
 * промпте занимают. Инструкция их запрещает, но модели иногда срываются —
 * дешевле вычистить на выходе, чем гонять запрос заново.
 */
const JUNK = new RegExp(
  '\\b(?:8k|4k|uhd|hdr|masterpiece|ultra[ -]?detailed|highly[ -]detailed|extremely[ -]detailed|'
  + 'award[ -]winning|trending on artstation|artstation|hyper[ -]?realistic|photoreal(?:istic)? 8k|'
  + 'best quality|high quality|ultra[ -]realistic|insanely detailed|intricate details?)\\b',
  'gi',
);

/** Обороты со стороны наблюдателя: промпт — распоряжение, а не пересказ. */
const NARRATION = /^\s*(?:the|this)\s+(?:image|photo|photograph|picture|artwork|illustration)\s+(?:shows|depicts|features|captures|is of|presents)\s+/i;

/**
 * Чистит готовый промпт от мусора. Работает по закрытому списку и подчищает
 * пунктуацию после вырезания — на осмысленный текст не влияет.
 */
export function lintPrompt(text) {
  let out = String(text || '').replace(NARRATION, '');
  if (JUNK.test(out)) {
    out = out.replace(JUNK, '');
    out = out
      .replace(/\(\s*[,;]?\s*\)/g, '')       // осиротевшие скобки
      .replace(/\s*,(?:\s*,)+/g, ',')        // сдвоенные запятые
      .replace(/,\s*([.;:])/g, '$1')         // запятая перед точкой
      .replace(/([(,;:])\s*,/g, '$1')        // запятая сразу после разделителя
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:])/g, '$1')
      .replace(/^[\s,;]+/gm, (m) => (m.includes('\n') ? m.replace(/[,;]/g, '') : ''));
  }
  // Первая буква после вырезанного оборота могла остаться строчной.
  out = out.trim().replace(/^([a-z])/, (c) => c.toUpperCase());
  return out;
}

/**
 * Страховка: если модель всё же не назвала формат словами, дописываем сами.
 * Дешевле, чем гонять повторный запрос, и гарантирует, что генератор его увидит.
 */
export function ensureFormatLine(prompt, aspect) {
  const text = String(prompt || '').trim();
  if (!text || !aspect) return text;
  if (text.includes(aspect.label)) return text;

  // У GPT Image 2 промпт идёт подписанными строками — формат ставим первой.
  if (/^\s*(Format|Scene|Subject)\s*:/im.test(text)) {
    return `Format: ${formatShort(aspect)}\n${text}`;
  }
  return `${text} ${formatPhrase(aspect)}`;
}

/**
 * Запрос на пересборку промптов без картинки: уходит готовый разбор,
 * возвращаются только два поля. Экономит около 80% токенов.
 */
export function buildRebuildInstruction(analysis, target, template, aspect = null) {
  const lean = { ...analysis };
  delete lean.prompt;
  delete lean.prompt_style_only;

  return [
    buildAnalyzerInstruction(template, target, aspect || aspectFromAnalysis(analysis)),
    '',
    '---',
    '',
    'Картинку заново смотреть не нужно. Вот готовый разбор изображения:',
    JSON.stringify(lean, null, 2),
    '',
    `Собери из него prompt и prompt_style_only под ${targetName(target)} по правилам сборки выше.`,
    'Если поля разбора правил человек — верно именно то, что в них написано сейчас, даже если это',
    'расходится с исходным кадром: промпт собирается по разбору, а не по картинке.',
    'Верни строго JSON ровно с двумя ключами: {"prompt": "...", "prompt_style_only": "..."}',
  ].join('\n');
}

/** Запрос на сравнение двух разборов — дельта между картинками. */
export function buildCompareInstruction(a, b, target) {
  const lean = (x) => {
    const c = { ...x };
    delete c.prompt_style_only;
    return c;
  };
  return [
    'Ты — реверс-инженер изображений. Даны разборы двух картинок.',
    '',
    'ПЕРВАЯ:',
    JSON.stringify(lean(a), null, 2),
    '',
    'ВТОРАЯ:',
    JSON.stringify(lean(b), null, 2),
    '',
    'Объясни, чем вторая отличается от первой по слоям (свет, оптика, палитра,',
    'композиция, стиль, настроение) — только по существу, без воды.',
    `Затем собери промпт-дельту под ${targetName(target)}: что дописать или изменить`,
    'в промпте первой картинки, чтобы получить вторую.',
    '',
    'Только валидный JSON, без markdown:',
    '{"differences": ["строка на каждое отличие"], "delta_prompt": "английский промпт-дельта",',
    ' "merged_prompt": "полный английский промпт второй картинки"}',
  ].join('\n');
}

/**
 * Разбор ответа модели. Модель иногда оборачивает JSON в ```json — снимаем,
 * иначе вырезаем от первой { до последней }. Кидает ошибку, если ничего не вышло:
 * выше по стеку это повод на один автоматический повтор.
 */
export function parseModelJson(text) {
  if (!text || !text.trim()) throw new Error('Модель вернула пустой ответ');

  let raw = text.trim();
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) raw = fence[1].trim();

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('В ответе нет JSON');
    return JSON.parse(raw.slice(start, end + 1));
  }
}

const asString = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/** Приводим ответ к форме, на которую рассчитан интерфейс. */
export function normalizeAnalysis(raw) {
  const out = {
    aspect_ratio: asString(raw.aspect_ratio),
    orientation: asString(raw.orientation),
    palette: asArray(raw.palette).map(asString).filter(Boolean),
    text_in_image: asArray(raw.text_in_image)
      .map((t) =>
        typeof t === 'string'
          ? { content: t, placement: '' }
          : { content: asString(t?.content), placement: asString(t?.placement) },
      )
      .filter((t) => t.content),
    tags: asArray(raw.tags).map(asString).filter(Boolean).slice(0, 8),
    uncertain: asArray(raw.uncertain).map(asString).filter(Boolean),
    prompt: asString(raw.prompt),
    prompt_style_only: asString(raw.prompt_style_only),
  };
  for (const { key } of LAYERS) out[key] = asString(raw[key]);
  if (!out.prompt) throw new Error('В ответе нет поля prompt');
  return out;
}

/** Слова считаем по промпту — он английский, разбиение по пробелам честное. */
export function wordCount(text) {
  return (asString(text).match(/[^\s]+/g) || []).length;
}

/** Из строки палитры «тёплый песочный #D8C3A5» достаём hex, если он там есть. */
export function paletteHex(entry) {
  const m = asString(entry).match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return '#' + hex.toUpperCase();
}

/** Подпись цвета без hex — для тултипа и плашки. */
export function paletteLabel(entry) {
  return asString(entry).replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i, '').replace(/[(),]\s*$/, '').trim();
}
