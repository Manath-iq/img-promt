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
 * подставляется в момент запроса.
 */
export const DEFAULT_TEMPLATE = `Ты — реверс-инженер изображений. Твоя работа: посмотреть на картинку и
восстановить бриф, по которому генеративная модель сможет собрать её заново.

Ты НЕ пишешь подпись к фотографии. Ты пишешь техническое задание.

## Жёсткие правила

1. Описывай только то, что видно. Не додумывай бренды, города, имена,
   события и предметы за краем кадра.
2. Если деталь неразличима — так и пиши в поле uncertain, не выдумывай.
3. Не идентифицируй людей. Описывай типаж: возраст на вид, телосложение,
   черты, причёска, одежда. Никаких имён и «похожа на актрису N».
4. Никаких мусорных усилителей: 8k, masterpiece, ultra detailed, award winning,
   trending on artstation. Они ничего не делают в современных моделях.
5. Никаких негативных формулировок внутри промпта. Вместо «без размытия» —
   «резкий фокус по всему кадру». Мусор выноси в поле constraints.
6. Никаких служебных параметров вроде --ar, --v, ::weights. Пропорции отдаёшь
   отдельным полем.
7. Текст, который читается в кадре, воспроизводи дословно и в кавычках,
   с указанием места. Если текста нет — пустой массив.

## Что разобрать

Пройди по слоям и заполни каждый:

- Сюжет: кто/что главное, что делает, во что одето, выражение, поза, ракурс.
- Сцена: где происходит, что на фоне, глубина пространства, время суток.
- Композиция: кадрирование (крупность), положение объекта в кадре, линии,
  негативное пространство, пропорции кадра.
- Свет: источники, направление, жёсткость, температура, характер теней,
  контровой/заполняющий, блики.
- Оптика: тип съёмки, фокусное на вид, глубина резкости, дисторсия,
  зерно/шум, характер боке, признаки плёнки или цифры.
- Палитра: 3-5 доминирующих цветов, тон обработки, контраст, насыщенность.
- Материалы: фактуры тканей, поверхностей, кожи, металла, стекла.
- Стиль: жанр и эстетика (студийный портрет, репортаж, 3D-рендер, коллаж,
  иллюстрация), референсная традиция без имён живых авторов.
- Настроение: что кадр вызывает и чем именно.

## Формат ответа

Только валидный JSON. Никакого markdown, никаких \`\`\` и пояснений до или после.

{
  "aspect_ratio": "соотношение сторон, например 3:4",
  "orientation": "portrait | landscape | square",
  "subject": "1-2 предложения",
  "scene": "1-2 предложения",
  "composition": "1-2 предложения",
  "light": "1-2 предложения",
  "camera": "1-2 предложения",
  "palette": ["название цвета + примерный hex", "..."],
  "materials": "1 предложение",
  "style": "1 предложение",
  "mood": "1 предложение",
  "text_in_image": [{"content": "дословно", "placement": "где"}],
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

Если Nano Banana (Gemini Image):
Связная описательная проза, 3-6 предложений. Начинай с главного объекта и
действия, дальше окружение, свет, оптика, стиль. Пиши так, будто ставишь
задачу фотографу. Камеру и свет называй конкретно: «shot on 85mm at f/1.8»
работает лучше, чем «cinematic». Текст в кадре — в кавычках.

Если GPT Image 2:
Держи порядок: сцена и фон → главный объект → ключевые детали → назначение →
ограничения. Назначение указывай явно («editorial fashion editorial shot»,
«product hero shot»): оно задаёт модели уровень полировки. Материалы называй
точно — «brushed aluminium», а не «shiny metal». Ограничения выноси
в финальную строку: no watermark, no extra objects.

Если Universal:
Проза как для Nano Banana, но без параметров, специфичных для одной модели.

Длина: 60-140 слов. Плотно, без воды, без повторов.

## Поле prompt_style_only

Тот же промпт, но всё, что относится к конкретному сюжету, заменено
на плейсхолдер {{SUBJECT}}. Свет, оптика, палитра, обработка, настроение
остаются. Это шаблон, чтобы перенести эстетику на свой кадр.`;

/** Слои разбора — порядок и подписи для карточки и страницы истории. */
export const LAYERS = [
  { key: 'subject', label: 'Сюжет' },
  { key: 'scene', label: 'Сцена' },
  { key: 'composition', label: 'Композиция' },
  { key: 'light', label: 'Свет' },
  { key: 'camera', label: 'Оптика' },
  { key: 'materials', label: 'Материалы' },
  { key: 'style', label: 'Стиль' },
  { key: 'mood', label: 'Настроение' },
  { key: 'constraints', label: 'Ограничения' },
];

/** Инструкция для запроса с картинкой. */
export function buildAnalyzerInstruction(template, target) {
  return (template || DEFAULT_TEMPLATE).replaceAll('{{TARGET_MODEL}}', targetName(target));
}

/**
 * Запрос на пересборку промптов без картинки: уходит готовый разбор,
 * возвращаются только два поля. Экономит около 80% токенов.
 */
export function buildRebuildInstruction(analysis, target, template) {
  const lean = { ...analysis };
  delete lean.prompt;
  delete lean.prompt_style_only;

  return [
    buildAnalyzerInstruction(template, target),
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
