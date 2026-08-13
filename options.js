// options.js — ключ, модель, целевой генератор, шаблон инструкции, расход.

import { getSettings, saveSettings, getUsage, todayKey, DEFAULT_SETTINGS } from './lib/store.js';
import { DEFAULT_TEMPLATE } from './lib/prompt.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  key: $('#key'), model: $('#model'), target: $('#target'), minSize: $('#minSize'),
  template: $('#template'), status: $('#status'), usage: $('#usage'), keyNote: $('#key-note'),
  models: $('#models'),
};

let settings = null;

init();

async function init() {
  settings = await getSettings();
  els.key.value = settings.apiKey;
  els.model.value = settings.model;
  els.target.value = settings.target;
  els.minSize.value = settings.minImageSize;
  els.template.value = settings.template;

  renderUsage();
  if (settings.apiKey) fetchModels(settings.apiKey).then(fillModels).catch(() => {});

  $('#save').addEventListener('click', save);
  $('#history').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_HISTORY' }));
  $('#check').addEventListener('click', check);

  $('#reveal').addEventListener('click', (e) => {
    const shown = els.key.type === 'text';
    els.key.type = shown ? 'password' : 'text';
    e.target.textContent = shown ? 'Показать' : 'Скрыть';
    e.target.setAttribute('aria-pressed', String(!shown));
  });

  $('#reset-template').addEventListener('click', () => {
    if (els.template.value.trim() && els.template.value !== DEFAULT_TEMPLATE
        && !confirm('Заменить текущую инструкцию исходной?')) return;
    els.template.value = DEFAULT_TEMPLATE;
    status('Инструкция сброшена, не забудь сохранить');
  });

  // Ctrl/Cmd+S — привычка, а не украшение.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  });
}

async function save() {
  const minImageSize = clamp(parseInt(els.minSize.value, 10) || DEFAULT_SETTINGS.minImageSize, 40, 600);
  const template = els.template.value.trim() || DEFAULT_TEMPLATE;
  settings = await saveSettings({
    apiKey: els.key.value.trim(),
    model: els.model.value.trim() || DEFAULT_SETTINGS.model,
    target: els.target.value,
    minImageSize,
    template,
    // Нетронутая инструкция обновляется вместе с расширением, правленая — нет.
    templateEdited: template !== DEFAULT_TEMPLATE.trim() && template !== DEFAULT_TEMPLATE,
  });
  els.minSize.value = minImageSize;
  els.model.value = settings.model;
  status('Сохранено');
}

/** Список моделей, которые реально отдаёт ключ: гадать id незачем. */
async function fetchModels(key) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'HTTP ' + res.status);

  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((id) => id.includes('gemini'))
    .sort();
}

function fillModels(ids) {
  els.models.innerHTML = ids.map((id) => `<option value="${id}"></option>`).join('');
  return ids;
}

/** Проверка ключа: заодно показывает, есть ли указанная модель среди доступных. */
async function check() {
  const key = els.key.value.trim();
  if (!key) { note('Сначала вставь ключ.', 'warn'); return; }

  note('Проверяю…');
  try {
    const ids = fillModels(await fetchModels(key));
    const wanted = els.model.value.trim();

    if (ids.includes(wanted)) {
      const tier = /pro/.test(wanted) ? '' : ' Для разбора фактуры pro-модель точнее — список в поле «Модель».';
      note(`Ключ рабочий, модель «${wanted}» доступна.${tier}`, 'ok');
      return;
    }

    const pro = ids.filter((id) => id.includes('pro')).slice(0, 4);
    const flash = ids.filter((id) => id.includes('flash')).slice(0, 4);
    note(
      `Ключ рабочий, но модели «${wanted}» в списке нет. Доступные — pro: ${pro.join(', ') || '—'}; flash: ${flash.join(', ') || '—'}`,
      'warn',
    );
  } catch (e) {
    note('Не вышло: ' + e.message, 'warn');
  }
}

async function renderUsage() {
  const usage = await getUsage();
  const today = usage[todayKey()] || 0;
  const week = Object.entries(usage)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 7)
    .map(([d, n]) => `${d.slice(5)} — ${n}`)
    .join(' · ');
  els.usage.textContent = `Сегодня: ${today} запр.` + (week ? `   |   ${week}` : '');
}

function note(text, kind = '') {
  els.keyNote.textContent = text;
  els.keyNote.className = 'note ' + kind;
}

let statusTimer = 0;
function status(text) {
  els.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { els.status.textContent = ''; }, 2500);
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
