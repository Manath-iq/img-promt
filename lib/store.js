// lib/store.js — обёртка над chrome.storage.local: настройки, история, кэш, расход.
//
// Ключ живёт только в local: в storage.sync он уехал бы в облако Google
// вместе с настройками профиля.
//
// Раскладка хранилища чуть отличается от схемы в спеке: превью вынесены
// в отдельные ключи `thumb:<id>`, а в массиве истории лежит всё остальное.
// Иначе каждое нажатие звёздочки переписывало бы несколько мегабайт base64.

import { DEFAULT_TEMPLATE } from './prompt.js';

export const MAX_HISTORY = 300;

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gemini-3.6-flash',
  target: 'nano-banana',
  template: DEFAULT_TEMPLATE,
  templateEdited: false,
  minImageSize: 140,
};

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

/**
 * Пока инструкцию анализатора не правили руками, отдаём свежую из кода:
 * иначе улучшения шаблона не доедут до того, кто один раз нажал «Сохранить».
 */
export async function getSettings() {
  const { settings } = await get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!merged.templateEdited) merged.template = DEFAULT_TEMPLATE;
  return merged;
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set({ settings: next });
  return next;
}

// ── История ──────────────────────────────────────────────────────────────────

/** Записи без превью, новые сверху. */
export async function getHistory() {
  const { history } = await get('history');
  return Array.isArray(history) ? history : [];
}

export async function getEntry(id) {
  const history = await getHistory();
  return history.find((e) => e.id === id) || null;
}

export async function getThumb(id) {
  const key = 'thumb:' + id;
  const data = await get(key);
  return data[key] || '';
}

/**
 * Кладёт запись наверх истории. Превью уходит в свой ключ.
 * История режется на MAX_HISTORY, вытесняется самая старая незвёздная.
 */
export async function addEntry(entry, thumb) {
  const history = await getHistory();
  history.unshift(entry);

  const dropped = [];
  while (history.length > MAX_HISTORY) {
    let idx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].starred) { idx = i; break; }
    }
    if (idx === -1) idx = history.length - 1; // все в избранном — режем самую старую
    dropped.push(history.splice(idx, 1)[0]);
  }

  await set({ history, ['thumb:' + entry.id]: thumb || '' });
  if (dropped.length) await purge(dropped.map((e) => e.id));
  return entry;
}

export async function updateEntry(id, patch) {
  const history = await getHistory();
  const idx = history.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  history[idx] = { ...history[idx], ...patch };
  await set({ history });
  return history[idx];
}

export async function removeEntry(id) {
  const history = await getHistory();
  const next = history.filter((e) => e.id !== id);
  await set({ history: next });
  await purge([id]);
}

export async function clearHistory() {
  const history = await getHistory();
  await set({ history: [], cache: {} });
  await chrome.storage.local.remove(history.map((e) => 'thumb:' + e.id));
}

/** Убирает превью и ссылки из кэша для удалённых записей. */
async function purge(ids) {
  await chrome.storage.local.remove(ids.map((id) => 'thumb:' + id));
  const cache = await getCache();
  let touched = false;
  for (const [key, val] of Object.entries(cache)) {
    if (ids.includes(val?.id)) { delete cache[key]; touched = true; }
  }
  if (touched) await set({ cache });
}

// ── Кэш по хэшу URL ──────────────────────────────────────────────────────────

export async function getCache() {
  const { cache } = await get('cache');
  return cache && typeof cache === 'object' ? cache : {};
}

export async function cacheGet(key) {
  const cache = await getCache();
  return cache[key] || null;
}

export async function cacheSet(key, id) {
  const cache = await getCache();
  cache[key] = { id, createdAt: Date.now() };
  await set({ cache });
}

export async function cacheDrop(key) {
  const cache = await getCache();
  if (!(key in cache)) return;
  delete cache[key];
  await set({ cache });
}

/** sha1 от строки — ключ кэша. */
export async function hashKey(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Расход ───────────────────────────────────────────────────────────────────

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function getUsage() {
  const { usage } = await get('usage');
  return usage && typeof usage === 'object' ? usage : {};
}

export async function bumpUsage(n = 1) {
  const usage = await getUsage();
  const key = todayKey();
  usage[key] = (usage[key] || 0) + n;

  // Держим месяц — на большее счётчик всё равно не смотрят.
  const keys = Object.keys(usage).sort();
  while (keys.length > 31) delete usage[keys.shift()];

  await set({ usage });
  return usage[key];
}
