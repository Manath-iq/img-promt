// background.js — сервис-воркер: сеть, Gemini, кэш, запись истории.
// Всё, что требует ключа или кросс-доменного запроса, живёт здесь: контент-скрипт
// не должен ни знать ключ, ни упираться в CORS чужого сайта.

import {
  getSettings, getEntry, addEntry, updateEntry,
  cacheGet, cacheSet, cacheDrop, hashKey, bumpUsage,
} from './lib/store.js';
import {
  buildAnalyzerInstruction, buildRebuildInstruction, buildCompareInstruction,
  parseModelJson, normalizeAnalysis, TARGETS,
} from './lib/prompt.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_SIDE = 1024;   // длинная сторона картинки, которая уходит в модель
const THUMB_SIDE = 256;  // превью для истории

/** Ошибка с кодом — контент-скрипт по коду выбирает, что показать и что предложить. */
class LensError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ── Роутинг сообщений ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({
      ok: false,
      error: {
        code: err.code || 'UNKNOWN',
        message: err.message || String(err),
        raw: err.raw || '',
      },
    }));
  return true; // ответ уйдёт асинхронно
});

chrome.action.onClicked.addListener(() => openHistory());

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'ANALYZE': return analyze(msg, sender);
    case 'REBUILD': return rebuild(msg);
    case 'COMPARE': return compare(msg);
    case 'SETTINGS': return { settings: await getSettings() };
    case 'OPEN_HISTORY': return openHistory();
    case 'OPEN_OPTIONS': return chrome.runtime.openOptionsPage().then(() => ({}));
    case 'PING': return { pong: true };
    default: throw new LensError('BAD_REQUEST', 'Неизвестный запрос: ' + msg?.type);
  }
}

/**
 * Открывает историю. Id вкладки помним в storage, а не через tabs.query({url}) —
 * тот фильтр требует разрешения "tabs", а ради одной вкладки просить доступ
 * ко всем адресам браузера незачем.
 */
async function openHistory() {
  const url = chrome.runtime.getURL('history.html');
  const { historyTabId } = await chrome.storage.local.get('historyTabId');

  if (historyTabId != null) {
    try {
      const tab = await chrome.tabs.get(historyTabId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return {};
    } catch {
      // вкладку закрыли — откроем новую
    }
  }

  const tab = await chrome.tabs.create({ url });
  await chrome.storage.local.set({ historyTabId: tab.id });
  return {};
}

// ── Разбор картинки ──────────────────────────────────────────────────────────

/**
 * msg: { urls:[…по убыванию качества], pageUrl, target, crop?, rect?, dpr?, force? }
 * crop — доля от картинки {x,y,w,h} в 0..1, если выделяли фрагмент.
 * rect — прямоугольник картинки во вьюпорте, запасной путь через скриншот вкладки.
 */
async function analyze(msg, sender) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new LensError('NO_KEY', 'Нужен ключ Gemini из AI Studio — открой настройки и вставь его.');
  }

  const target = TARGETS[msg.target] ? msg.target : settings.target;
  const sourceUrl = msg.urls?.[0] || '';
  const cropKey = msg.crop ? `#${round4(msg.crop.x)},${round4(msg.crop.y)},${round4(msg.crop.w)},${round4(msg.crop.h)}` : '';
  const key = await hashKey(sourceUrl + cropKey);

  if (!msg.force) {
    const hit = await cacheGet(key);
    if (hit) {
      const entry = await getEntry(hit.id);
      if (entry) {
        // Промпт под этот генератор мог быть ещё не собран — дособерём без картинки.
        const filled = entry.prompts[target] ? entry : await rebuildEntry(entry, target, settings);
        return { entry: filled, target, fromCache: true, cacheKey: key };
      }
      await cacheDrop(key);
    }
  }

  const image = await loadImage(msg, sender);
  const [payload, thumb] = await Promise.all([
    encode(image.bitmap, MAX_SIDE, 'image/jpeg', 0.9, msg.crop),
    encode(image.bitmap, THUMB_SIDE, 'image/webp', 0.75, msg.crop),
  ]);
  image.bitmap.close();

  const instruction = buildAnalyzerInstruction(settings.template, target);
  const parts = [
    { text: instruction },
    { inline_data: { mime_type: 'image/jpeg', data: payload.base64 } },
  ];

  let analysis;
  try {
    analysis = normalizeAnalysis(parseModelJson(await ask(settings, parts)));
  } catch (first) {
    // Один автоматический повтор с припиской — модели иногда добавляют пояснение.
    try {
      const retryParts = [
        { text: instruction + '\n\nВАЖНО: верни строго JSON по схеме выше. Без markdown, без пояснений, без ```.' },
        { inline_data: { mime_type: 'image/jpeg', data: payload.base64 } },
      ];
      const raw = await ask(settings, retryParts);
      analysis = normalizeAnalysis(parseModelJson(raw));
    } catch (second) {
      throw new LensError(
        second.code || 'BAD_JSON',
        second.code ? second.message : 'Модель вернула не JSON. Повтор не помог.',
        { raw: second.raw || first.raw || '' },
      );
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceUrl,
    pageUrl: msg.pageUrl || '',
    target,
    crop: msg.crop || null,
    analysis,
    prompts: {
      [target]: { replicate: analysis.prompt, styleOnly: analysis.prompt_style_only },
    },
    tags: analysis.tags,
    starred: false,
    note: '',
  };

  await addEntry(entry, thumb.dataUrl);
  await cacheSet(key, entry.id);
  return { entry, target, fromCache: false, cacheKey: key };
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Достаёт картинку: сначала пробует ссылки по очереди (первая — самый крупный
 * кандидат), при полном провале — скриншот вкладки с вырезкой по прямоугольнику.
 */
async function loadImage(msg, sender) {
  const urls = (msg.urls || []).filter(Boolean);
  const errors = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.size) throw new Error('пустой ответ');
      return { bitmap: await createImageBitmap(blob), url };
    } catch (e) {
      errors.push(`${short(url)}: ${e.message}`);
    }
  }

  // Запасной путь: снимок видимой области и вырезка по месту картинки.
  if (msg.rect && sender?.tab?.windowId != null) {
    try {
      const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      const full = await createImageBitmap(await (await fetch(shot)).blob());
      const dpr = msg.dpr || 1;
      const x = Math.max(0, Math.round(msg.rect.x * dpr));
      const y = Math.max(0, Math.round(msg.rect.y * dpr));
      const w = Math.min(full.width - x, Math.round(msg.rect.width * dpr));
      const h = Math.min(full.height - y, Math.round(msg.rect.height * dpr));
      if (w > 8 && h > 8) {
        const bitmap = await createImageBitmap(full, x, y, w, h);
        full.close();
        return { bitmap, url: urls[0] || '', fromScreenshot: true };
      }
      full.close();
    } catch (e) {
      errors.push('скриншот: ' + e.message);
    }
  }

  throw new LensError(
    'FETCH_FAILED',
    'Картинку не удалось скачать — сайт её не отдаёт. Попробуй Alt+рамку по картинке: уйдёт снимок области.',
    { raw: errors.join('\n') },
  );
}

const short = (u) => (u.length > 80 ? u.slice(0, 77) + '…' : u);

/** Масштабирование, кроп и кодирование через OffscreenCanvas. */
async function encode(bitmap, maxSide, type, quality, crop) {
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  if (crop) {
    sx = Math.round(crop.x * bitmap.width);
    sy = Math.round(crop.y * bitmap.height);
    sw = Math.max(16, Math.round(crop.w * bitmap.width));
    sh = Math.max(16, Math.round(crop.h * bitmap.height));
    sw = Math.min(sw, bitmap.width - sx);
    sh = Math.min(sh, bitmap.height - sy);
  }

  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);

  const blob = await canvas.convertToBlob({ type, quality });
  const base64 = toBase64(await blob.arrayBuffer());
  return { base64, dataUrl: `data:${blob.type};base64,${base64}`, width: dw, height: dh };
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// ── Пересборка промптов без картинки ─────────────────────────────────────────

/**
 * msg: { id?, analysis?, target }
 * Пересобирает promt и promt_style_only из готового разбора: смена генератора
 * и правка полей разбора идут этим дешёвым текстовым запросом.
 */
async function rebuild(msg) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new LensError('NO_KEY', 'Нужен ключ Gemini — открой настройки.');

  const target = TARGETS[msg.target] ? msg.target : settings.target;
  const entry = msg.id ? await getEntry(msg.id) : null;
  const analysis = msg.analysis || entry?.analysis;
  if (!analysis) throw new LensError('NO_ENTRY', 'Разбор не найден — картинку придётся отправить заново.');

  // Правки полей меняют смысл разбора, значит готовый промпт под этот генератор
  // больше не подходит: кэш прошлых сборок игнорируем, если пришёл свежий analysis.
  if (entry && !msg.analysis && entry.prompts[target]) {
    return { entry, target, fromCache: true };
  }

  const built = await buildPrompts(analysis, target, settings);
  if (!entry) return { prompts: built, analysis, target };

  const next = await updateEntry(entry.id, {
    analysis: { ...analysis, prompt: built.replicate, prompt_style_only: built.styleOnly },
    prompts: { ...entry.prompts, [target]: built },
    target,
    tags: analysis.tags?.length ? analysis.tags : entry.tags,
  });
  return { entry: next, target, fromCache: false };
}

/** То же, но для случая «запись есть, промпта под этот генератор нет». */
async function rebuildEntry(entry, target, settings) {
  const built = await buildPrompts(entry.analysis, target, settings);
  return await updateEntry(entry.id, {
    prompts: { ...entry.prompts, [target]: built },
  });
}

async function buildPrompts(analysis, target, settings) {
  const instruction = buildRebuildInstruction(analysis, target, settings.template);
  let parsed;
  try {
    parsed = parseModelJson(await ask(settings, [{ text: instruction }]));
  } catch (first) {
    const raw = await ask(settings, [{ text: instruction + '\n\nВАЖНО: только JSON с двумя ключами.' }]);
    try {
      parsed = parseModelJson(raw);
    } catch (second) {
      throw new LensError('BAD_JSON', 'Модель вернула не JSON при пересборке.', { raw: second.raw || first.raw || raw });
    }
  }
  const replicate = String(parsed.prompt || '').trim();
  if (!replicate) throw new LensError('BAD_JSON', 'В ответе нет поля prompt.');
  return { replicate, styleOnly: String(parsed.prompt_style_only || '').trim() };
}

// ── Сравнение двух записей ───────────────────────────────────────────────────

async function compare(msg) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new LensError('NO_KEY', 'Нужен ключ Gemini — открой настройки.');

  const [a, b] = await Promise.all([getEntry(msg.idA), getEntry(msg.idB)]);
  if (!a || !b) throw new LensError('NO_ENTRY', 'Одна из записей не найдена.');

  const target = TARGETS[msg.target] ? msg.target : settings.target;
  const instruction = buildCompareInstruction(a.analysis, b.analysis, target);
  const raw = await ask(settings, [{ text: instruction }]);
  const parsed = parseModelJson(raw);
  return {
    result: {
      differences: Array.isArray(parsed.differences) ? parsed.differences.map(String) : [],
      delta_prompt: String(parsed.delta_prompt || '').trim(),
      merged_prompt: String(parsed.merged_prompt || '').trim(),
    },
    target,
  };
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function ask(settings, parts) {
  const url = `${API_BASE}/${encodeURIComponent(settings.model)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.35,
          topP: 0.95,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (e) {
    throw new LensError('NETWORK', 'Сеть недоступна: ' + e.message);
  }

  const text = await res.text();

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { detail = text.slice(0, 300); }

    if (res.status === 429) {
      throw new LensError('RATE_LIMIT', 'Лимит исчерпан, подожди минуту.', { raw: detail });
    }
    if (res.status === 400 && /api key/i.test(detail)) {
      throw new LensError('KEY_INVALID', 'Ключ не принят — проверь его в настройках.', { raw: detail });
    }
    if (res.status === 403) {
      throw new LensError('KEY_INVALID', 'Доступ запрещён: ключ недействителен или у него нет прав.', { raw: detail });
    }
    if (res.status === 404) {
      throw new LensError('MODEL_NOT_FOUND', `Модель «${settings.model}» недоступна для этого ключа — поправь id в настройках.`, { raw: detail });
    }
    throw new LensError('HTTP', `Gemini ответил ${res.status}.`, { raw: detail });
  }

  await bumpUsage();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LensError('BAD_JSON', 'Ответ Gemini не разобрался.', { raw: text.slice(0, 2000) });
  }

  const block = data?.promptFeedback?.blockReason;
  if (block) throw new LensError('BLOCKED', `Модель отказалась разбирать картинку (${block}).`);

  const candidate = data?.candidates?.[0];
  const out = (candidate?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!out) {
    const reason = candidate?.finishReason || 'пустой ответ';
    throw new LensError('EMPTY', `Модель ничего не вернула (${reason}).`, { raw: text.slice(0, 2000) });
  }
  return out;
}
