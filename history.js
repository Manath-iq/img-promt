// history.js — страница истории: поиск, фильтры, избранное, заметки,
// сравнение двух записей и экспорт.

import { getHistory, getThumb, updateEntry, removeEntry, clearHistory } from './lib/store.js';
import { TARGETS, HINT_KINDS, wordCount } from './lib/prompt.js';

const $ = (sel) => document.querySelector(sel);

const grid = $('#grid');
const empty = $('#empty');
const toast = $('#toast');

const filters = { q: '', target: '', from: '', to: '', starred: false };
const picked = new Set();

let entries = [];

const ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/></svg>',
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/></svg>',
  pickOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg>',
};

init();

async function init() {
  entries = await getHistory();
  bind();
  render();
}

function bind() {
  $('#q').addEventListener('input', (e) => { filters.q = e.target.value.trim().toLowerCase(); render(); });
  $('#target').addEventListener('change', (e) => { filters.target = e.target.value; render(); });
  $('#from').addEventListener('change', (e) => { filters.from = e.target.value; render(); });
  $('#to').addEventListener('change', (e) => { filters.to = e.target.value; render(); });

  $('#starred').addEventListener('click', (e) => {
    filters.starred = !filters.starred;
    e.target.setAttribute('aria-pressed', String(filters.starred));
    e.target.classList.toggle('btn--primary', filters.starred);
    render();
  });

  $('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#export-json').addEventListener('click', exportJson);
  $('#export-md').addEventListener('click', exportMarkdown);
  $('#compare').addEventListener('click', runCompare);

  $('#clear').addEventListener('click', async () => {
    if (!entries.length) return;
    if (!confirm(`Удалить всю историю — ${entries.length} шт.? Отменить будет нельзя.`)) return;
    await clearHistory();
    entries = [];
    picked.clear();
    render();
    flash('История очищена');
  });
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

function visible() {
  return entries.filter((e) => {
    if (filters.starred && !e.starred) return false;
    if (filters.target && !e.prompts?.[filters.target]) return false;
    if (filters.from && e.createdAt < Date.parse(filters.from + 'T00:00:00')) return false;
    if (filters.to && e.createdAt > Date.parse(filters.to + 'T23:59:59')) return false;
    if (filters.q) {
      const hay = [
        ...Object.values(e.prompts || {}).flatMap((p) => [p.replicate, p.styleOnly]),
        ...(e.tags || []),
        e.tweak?.edit,
        ...(e.tweak?.refs || []).map((r) => r.caption),
        ...(e.analysis?.hints || []).map((h) => h.text),
        e.note,
        e.analysis?.style,
        e.analysis?.mood,
      ].join(' ').toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    return true;
  });
}

function render() {
  const list = visible();
  $('#count').textContent = list.length === entries.length
    ? `${entries.length} шт.`
    : `${list.length} из ${entries.length}`;

  grid.textContent = '';
  empty.hidden = list.length > 0;

  for (const entry of list) grid.appendChild(itemNode(entry));
  updateCompareButton();
  loadThumbs();
}

function itemNode(entry) {
  const target = filters.target && entry.prompts?.[filters.target] ? filters.target : (entry.target || Object.keys(entry.prompts || {})[0]);
  const prompt = entry.prompts?.[target]?.replicate || entry.analysis?.prompt || '';
  const node = document.createElement('article');
  node.className = 'item' + (picked.has(entry.id) ? ' is-picked' : '');
  node.dataset.id = entry.id;

  node.innerHTML = `
    <div class="item__shot" data-thumb="${entry.id}">
      <div class="placeholder">превью</div>
      <img alt="Превью разобранной картинки" hidden>
      <div class="item__tools">
        <button class="tool${picked.has(entry.id) ? ' is-on' : ''}" type="button" data-act="pick"
                title="Отметить для сравнения" aria-pressed="${picked.has(entry.id)}">${picked.has(entry.id) ? ICONS.pickOn : ICONS.pick}</button>
        <button class="tool${entry.starred ? ' is-on' : ''}" type="button" data-act="star"
                title="В избранное" aria-pressed="${entry.starred}">${entry.starred ? ICONS.starOn : ICONS.star}</button>
      </div>
    </div>

    <div class="item__body">
      <div class="item__meta">
        <span>${date(entry.createdAt)}</span>
        <span>·</span>
        <span>${esc(domain(entry.pageUrl || entry.sourceUrl))}</span>
        <span>·</span>
        <span>${esc(TARGETS[target] || target || '—')}</span>
        <span>·</span>
        <span>${wordCount(prompt)} сл.</span>
        ${entry.analysis?.aspect_ratio ? `<span>·</span><span>${esc(entry.analysis.aspect_ratio)}</span>` : ''}
        ${entry.crop ? '<span>·</span><span>фрагмент</span>' : ''}
        ${tweakMeta(entry.tweak)}
      </div>

      ${tweakLine(entry.tweak)}

      <pre class="item__prompt" data-el="prompt">${esc(prompt)}</pre>

      ${tipsRow(entry.analysis?.hints)}

      ${entry.tags?.length ? `<div class="item__tags">${entry.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}

      <textarea class="item__note" rows="1" placeholder="Заметка: что получилось при генерации, что подкрутить"
                data-act="note">${esc(entry.note || '')}</textarea>

      <div class="item__row">
        <button class="btn" type="button" data-act="copy">Копировать</button>
        ${entry.prompts?.[target]?.styleOnly ? '<button class="btn" type="button" data-act="style">Только стиль</button>' : ''}
        ${entry.pageUrl ? `<a class="btn" href="${esc(entry.pageUrl)}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}
        <button class="btn btn--warn" type="button" data-act="del">Удалить</button>
      </div>
    </div>`;

  node.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) onAction(act, entry, node, e);
  });

  const note = node.querySelector('textarea[data-act="note"]');
  note.addEventListener('input', () => {
    note.style.height = 'auto';
    note.style.height = Math.min(160, note.scrollHeight + 2) + 'px';
  });
  note.addEventListener('blur', async () => {
    if ((entry.note || '') === note.value) return;
    entry.note = note.value;
    await updateEntry(entry.id, { note: entry.note });
    flash('Заметка сохранена');
  });

  return node;
}

/** Рекомендации — чего промпт не передаёт словами. Причина в подсказке. */
function tipsRow(hints) {
  if (!hints?.length) return '';
  return `<div class="item__tips">${hints.map((h) => `
    <span class="tip tip--do" title="${esc(h.why || h.text)}">${esc(HINT_KINDS[h.kind] || '')} · ${esc(h.text)}</span>`).join('')}</div>`;
}

/**
 * Правки и референсы, с которыми собран этот разбор. Сами картинки-референсы
 * не хранятся — только подписи: понять, откуда взялся человек в кадре, хватает.
 */
function tweakMeta(tweak) {
  if (!tweak?.edit && !tweak?.refs?.length) return '';
  const bits = [tweak.edit ? 'с правками' : null, tweak.refs?.length ? `${tweak.refs.length} реф.` : null];
  return bits.filter(Boolean).map((b) => `<span>·</span><span>${esc(b)}</span>`).join('');
}

function tweakLine(tweak) {
  if (!tweak?.edit && !tweak?.refs?.length) return '';
  const rows = [
    tweak.edit ? `<li>${esc(tweak.edit)}</li>` : '',
    ...(tweak.refs || []).map((r, i) => `<li>реф ${i + 1} — ${esc(r.caption)}</li>`),
  ].join('');
  return `<ul class="item__tweak">${rows}</ul>`;
}

async function onAction(act, entry, node, e) {
  switch (act) {
    case 'star': {
      entry.starred = !entry.starred;
      await updateEntry(entry.id, { starred: entry.starred });
      const btn = node.querySelector('[data-act="star"]');
      btn.classList.toggle('is-on', entry.starred);
      btn.setAttribute('aria-pressed', String(entry.starred));
      btn.innerHTML = entry.starred ? ICONS.starOn : ICONS.star;
      if (filters.starred) render();
      break;
    }

    case 'pick': {
      if (picked.has(entry.id)) picked.delete(entry.id);
      else {
        if (picked.size >= 2) { flash('Сравниваются ровно две записи — сними отметку с лишней'); break; }
        picked.add(entry.id);
      }
      node.classList.toggle('is-picked', picked.has(entry.id));
      const btn = node.querySelector('[data-act="pick"]');
      btn.classList.toggle('is-on', picked.has(entry.id));
      btn.setAttribute('aria-pressed', String(picked.has(entry.id)));
      btn.innerHTML = picked.has(entry.id) ? ICONS.pickOn : ICONS.pick;
      updateCompareButton();
      break;
    }

    case 'copy':
      await copy(node.querySelector('[data-el="prompt"]').textContent);
      flash('Промпт скопирован');
      break;

    case 'style': {
      const target = entry.target || Object.keys(entry.prompts || {})[0];
      await copy(entry.prompts?.[target]?.styleOnly || '');
      flash('Промпт стиля скопирован');
      break;
    }

    case 'del':
      if (!confirm('Удалить запись?')) break;
      await removeEntry(entry.id);
      entries = entries.filter((x) => x.id !== entry.id);
      picked.delete(entry.id);
      render();
      break;
  }
}

function updateCompareButton() {
  $('#compare').disabled = picked.size !== 2;
}

// ── Превью ───────────────────────────────────────────────────────────────────

const seen = new WeakSet();
const io = new IntersectionObserver((rows) => {
  for (const row of rows) {
    if (!row.isIntersecting) continue;
    io.unobserve(row.target);
    fillThumb(row.target);
  }
}, { rootMargin: '200px' });

// Наблюдаем за рамкой, а не за самой картинкой: скрытый <img> не имеет бокса,
// и IntersectionObserver про него молчит — превью не подгрузились бы никогда.
function loadThumbs() {
  for (const shot of grid.querySelectorAll('.item__shot[data-thumb]')) {
    if (seen.has(shot)) continue;
    seen.add(shot);
    io.observe(shot);
  }
}

async function fillThumb(shot) {
  const data = await getThumb(shot.dataset.thumb);
  if (!data) return;
  const img = shot.querySelector('img');
  img.src = data;
  img.hidden = false;
  shot.querySelector('.placeholder')?.remove();
}

// ── Сравнение ────────────────────────────────────────────────────────────────

async function runCompare() {
  const [idA, idB] = [...picked];
  const out = $('#compare-out');
  const a = entries.find((e) => e.id === idA);
  const target = a?.target || 'nano-banana';

  out.hidden = false;
  out.innerHTML = '<div class="note">Сравниваю…</div>';
  out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const res = await chrome.runtime.sendMessage({ type: 'COMPARE', idA, idB, target });
  if (!res?.ok) {
    out.innerHTML = `<div class="warn">${esc(res?.error?.message || 'Не вышло сравнить')}</div>`;
    return;
  }

  const r = res.result;
  out.innerHTML = `
    <div class="top">
      <h1 style="font-size:18px">Дельта</h1>
      <span class="sub">первая → вторая · ${esc(TARGETS[res.target] || res.target)}</span>
      <span class="grow"></span>
      <button class="btn" type="button" data-cmp="close">Закрыть</button>
    </div>
    ${r.differences.length ? `<ul class="cmp__list">${r.differences.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    ${r.delta_prompt ? `<span class="k">Что дописать к первому</span><pre class="cmp__prompt" data-cmp-text>${esc(r.delta_prompt)}</pre>
      <button class="btn" type="button" data-cmp="copy-delta">Копировать дельту</button>` : ''}
    ${r.merged_prompt ? `<div style="margin-top:14px"><span class="k">Готовый промпт второй картинки</span>
      <pre class="cmp__prompt" data-cmp-merged>${esc(r.merged_prompt)}</pre>
      <button class="btn" type="button" data-cmp="copy-merged">Копировать целиком</button></div>` : ''}`;

  out.onclick = async (e) => {
    const act = e.target.closest('[data-cmp]')?.dataset.cmp;
    if (act === 'close') { out.hidden = true; return; }
    if (act === 'copy-delta') { await copy(out.querySelector('[data-cmp-text]').textContent); flash('Дельта скопирована'); }
    if (act === 'copy-merged') { await copy(out.querySelector('[data-cmp-merged]').textContent); flash('Промпт скопирован'); }
  };
}

// ── Экспорт ──────────────────────────────────────────────────────────────────

function exportJson() {
  const list = visible().map((e) => ({ ...e }));
  if (!list.length) { flash('Нечего выгружать'); return; }
  download(
    `prompt-lens-${stamp()}.json`,
    'application/json',
    JSON.stringify({ exportedAt: new Date().toISOString(), count: list.length, entries: list }, null, 2),
  );
}

function exportMarkdown() {
  const list = visible().filter((e) => e.starred);
  if (!list.length) { flash('В избранном пусто'); return; }

  const md = ['# Prompt Lens — избранное', '', `Выгружено: ${new Date().toLocaleString('ru-RU')}`, ''];
  for (const e of list) {
    const target = e.target || Object.keys(e.prompts || {})[0];
    md.push(`## ${date(e.createdAt)} · ${domain(e.pageUrl || e.sourceUrl)}`, '');
    if (e.tags?.length) md.push(`**Теги:** ${e.tags.join(', ')}`, '');
    if (e.analysis?.aspect_ratio) md.push(`**Пропорции:** ${e.analysis.aspect_ratio}`, '');
    if (e.tweak?.edit) md.push(`**Правка:** ${e.tweak.edit}`, '');
    if (e.tweak?.refs?.length) {
      md.push(`**Референсы:** ${e.tweak.refs.map((r, i) => `${i + 1} — ${r.caption}`).join('; ')}`, '');
    }
    md.push(`**Промпт (${TARGETS[target] || target}):**`, '', '```', e.prompts?.[target]?.replicate || e.analysis?.prompt || '', '```', '');
    const styleOnly = e.prompts?.[target]?.styleOnly;
    if (styleOnly) md.push('**Только стиль:**', '', '```', styleOnly, '```', '');
    if (e.analysis?.hints?.length) {
      md.push('**Доложить самому:**', '');
      for (const h of e.analysis.hints) md.push(`- ${h.text}${h.why ? ` — ${h.why}` : ''}`);
      md.push('');
    }
    if (e.note) md.push(`**Заметка:** ${e.note}`, '');
    if (e.pageUrl) md.push(`Источник: ${e.pageUrl}`, '');
    md.push('---', '');
  }
  download(`prompt-lens-favorites-${stamp()}.md`, 'text/markdown', md.join('\n'));
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  flash('Файл выгружен');
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* не вышло — молчим, флеш скажет */ }
}

let toastTimer = 0;
function flash(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function date(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '—'; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
