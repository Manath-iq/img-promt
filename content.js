// content.js — хендл на картинках и карточка результата.
//
// Весь интерфейс живёт в Shadow DOM: стили Pinterest, Behance и Dribbble
// агрессивны, без изоляции карточку разносит. Импортов здесь нет — контент-скрипты
// грузятся не как модули, поэтому список генераторов и слоёв продублирован
// локально (единственное дублирование в проекте, оно того стоит).

(() => {
  if (window.__promptLensLoaded) return;
  window.__promptLensLoaded = true;

  const VERSION = chrome.runtime.getManifest().version;

  /** Иконки — контуры в стиле Lucide, обводка 1.5, без заливки. */
  const I = {
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  const TARGETS = [
    { id: 'nano-banana', label: 'Nano Banana' },
    { id: 'gpt-image-2', label: 'GPT Image 2' },
    { id: 'universal', label: 'Universal' },
  ];

  const LAYERS = [
    { key: 'medium', label: 'Носитель' },
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

  const state = {
    minSize: 140,
    target: 'nano-banana',
    mode: 'replicate',        // replicate | styleOnly
    entry: null,
    cacheKey: null,
    request: null,            // { urls, pageUrl, crop, rect, dpr } — чем сняли текущий разбор
    busy: false,
    collapsed: false,
    layersOpen: false,        // держим между перерисовками: правка поля их же и перерисовывает
    hover: null,              // { el, rect, urls }
  };

  // ── Корень ─────────────────────────────────────────────────────────────────

  const host = document.createElement('div');
  host.setAttribute('data-prompt-lens', '');
  for (const [prop, val] of Object.entries({
    position: 'fixed', inset: '0', 'pointer-events': 'none',
    'z-index': '2147483647', margin: '0', padding: '0', border: '0',
    background: 'transparent', 'color-scheme': 'dark',
  })) host.style.setProperty(prop, val, 'important');

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS()}</style>`;
  (document.documentElement || document.body).appendChild(host);

  // ── Пилюля ─────────────────────────────────────────────────────────────────

  const pill = el('button', 'pill', `<span class="dot"></span><span>prompt</span>`);
  pill.type = 'button';
  pill.title = 'Разобрать картинку в промпт  ·  Alt+P  ·  Alt+рамка — фрагмент';
  pill.hidden = true;
  root.appendChild(pill);

  pill.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.hover) analyze(describe(state.hover));
  });

  // Рамка выделения фрагмента.
  const marquee = el('div', 'marquee');
  marquee.hidden = true;
  root.appendChild(marquee);

  const toast = el('div', 'toast');
  toast.hidden = true;
  root.appendChild(toast);

  // ── Карточка ───────────────────────────────────────────────────────────────

  const card = el('section', 'card');
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Prompt Lens');
  card.innerHTML = `
    <header class="head">
      <span class="dot" data-el="head-dot"></span>
      <span class="name">PROMPT LENS</span>
      <span class="ver">${VERSION}</span>
      <span class="grow"></span>
      <button class="ico" type="button" data-act="collapse" title="Свернуть" aria-label="Свернуть">${I.minus}</button>
      <button class="ico" type="button" data-act="close" title="Закрыть (Esc)" aria-label="Закрыть">${I.close}</button>
    </header>
    <div class="body" data-el="body"></div>`;
  root.appendChild(card);

  const body = card.querySelector('[data-el="body"]');
  const headDot = card.querySelector('[data-el="head-dot"]');

  card.addEventListener('click', (e) => {
    const act = e.target.closest?.('[data-act]')?.dataset.act;
    if (act) onAction(act, e);
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeCard(); }
  });

  // ── Наведение ──────────────────────────────────────────────────────────────

  let pointer = { x: 0, y: 0 };
  let hoverTick = 0;
  let hideTimer = 0;

  document.addEventListener('mousemove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (dragging) return;
    if (hoverTick) return;
    hoverTick = requestAnimationFrame(() => {
      hoverTick = 0;
      updateHover();
    });
  }, true);

  document.addEventListener('scroll', () => {
    if (state.hover) placePill(state.hover.rect);
  }, true);

  window.addEventListener('resize', () => { if (state.hover) updateHover(); });

  function updateHover() {
    const found = findImage(pointer.x, pointer.y);
    if (!found) {
      // Пилюля держится, пока курсор на ней самой.
      if (!hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; hidePill(); }, 220);
      return;
    }
    clearTimeout(hideTimer); hideTimer = 0;
    if (state.hover?.el === found.el && pill.hidden === false) {
      state.hover.rect = found.rect;
      placePill(found.rect);
      return;
    }
    state.hover = found;
    showPill(found.rect);
  }

  pill.addEventListener('mouseenter', () => { clearTimeout(hideTimer); hideTimer = 0; });

  function showPill(rect) {
    pill.hidden = false;
    placePill(rect);
    pill.classList.remove('pill--in');
    void pill.offsetWidth;
    pill.classList.add('pill--in');
  }

  function hidePill() {
    pill.hidden = true;
    state.hover = null;
  }

  // Позиция через left/top, а не transform: transform занят анимацией появления.
  function placePill(rect) {
    const x = Math.max(6, Math.min(rect.left + 8, window.innerWidth - 96));
    const y = Math.max(6, Math.min(rect.top + 8, window.innerHeight - 34));
    pill.style.left = Math.round(x) + 'px';
    pill.style.top = Math.round(y) + 'px';
  }

  /**
   * Ищем картинку под курсором. Смотрим весь стек элементов, а не верхний:
   * Pinterest и Dribbble кладут поверх превью прозрачные оверлеи, из-за которых
   * `elementFromPoint` возвращает пустой div.
   */
  function findImage(x, y) {
    if (x < 0 || y < 0) return null;
    const stack = document.elementsFromPoint(x, y);
    for (const node of stack) {
      if (node === host || node.hasAttribute?.('data-prompt-lens')) return state.hover;
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width < state.minSize || rect.height < state.minSize) continue;

      if (node.tagName === 'IMG') {
        const urls = imgUrls(node);
        if (urls.length) return { el: node, rect, urls };
      }
      // Фон страницы картинкой — не референс, а обои сайта: html и body пропускаем.
      if (node.tagName === 'HTML' || node.tagName === 'BODY') continue;
      const bg = backgroundUrl(node);
      if (bg) return { el: node, rect, urls: expand(bg) };
    }
    return null;
  }

  function imgUrls(img) {
    const best = largestFromSrcset(img);
    const src = img.currentSrc || img.src || '';
    if (!best && !src) return [];
    const list = [];
    for (const u of [best, src]) if (u) list.push(...expand(u));
    return dedupe(list).filter(usable);
  }

  function backgroundUrl(node) {
    const bg = getComputedStyle(node).backgroundImage;
    if (!bg || bg === 'none') return null;
    const m = bg.match(/url\((['"]?)(.*?)\1\)/);
    if (!m || !m[2]) return null;
    return usable(m[2]) ? absolute(m[2]) : null;
  }

  function largestFromSrcset(img) {
    const raw = img.srcset || img.getAttribute('data-srcset') || '';
    if (!raw) return '';
    let best = '', bestW = 0;
    for (const part of raw.split(',')) {
      const [url, size] = part.trim().split(/\s+/);
      if (!url) continue;
      const w = size?.endsWith('w') ? parseInt(size) : size?.endsWith('x') ? parseFloat(size) * 1000 : 0;
      if (w >= bestW) { bestW = w; best = url; }
    }
    return best ? absolute(best) : '';
  }

  const usable = (u) => /^(https?:|data:image\/)/i.test(u) || u.startsWith('//') || u.startsWith('/');
  const absolute = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const dedupe = (list) => [...new Set(list.filter(Boolean))];

  /**
   * Подмена превью на оригинал. Порядок в списке — по убыванию качества,
   * воркер идёт по нему сверху вниз и откатывается на исходную ссылку.
   */
  function expand(url) {
    const abs = absolute(url);
    const out = [];
    try {
      const u = new URL(abs);

      if (/(^|\.)pinimg\.com$/.test(u.hostname)) {
        // i.pinimg.com/236x/ab/cd/ef/hash.jpg → /originals/ab/cd/ef/hash.jpg
        out.push(abs.replace(/\/\d+x\d*\//, '/originals/'));
        out.push(abs.replace(/\/\d+x\d*\//, '/736x/'));
      }
      if (/behance\.net$/.test(u.hostname) || u.pathname.includes('/project_modules/')) {
        out.push(abs.replace(/\/project_modules\/[^/]+\//, '/project_modules/source/'));
        out.push(abs.replace(/\/project_modules\/[^/]+\//, '/project_modules/1400/'));
      }
      if (/dribbble\.com$/.test(u.hostname) || u.hostname.includes('cdn.dribbble')) {
        out.push(u.origin + u.pathname); // размер живёт в query
      }
      if (u.search && /(\?|&)(w|width|h|height|resize|size|fit|q|quality|format)=/i.test(u.search)) {
        out.push(u.origin + u.pathname);
      }
      // unsplash и подобные: w=400 в query меняем на исходник
      if (/images\.unsplash\.com$/.test(u.hostname)) {
        out.push(u.origin + u.pathname + '?q=90&w=1600');
      }
    } catch { /* нестандартный url — уйдёт как есть */ }

    out.push(abs);
    return dedupe(out);
  }

  function describe(hover, crop = null) {
    const rect = hover.el.getBoundingClientRect();
    return {
      urls: hover.urls,
      pageUrl: location.href,
      crop,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      dpr: window.devicePixelRatio || 1,
    };
  }

  // ── Хоткей и выделение фрагмента ───────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyP' || e.key === 'p' || e.key === 'P')) {
      const found = state.hover || findImage(pointer.x, pointer.y);
      if (found) {
        e.preventDefault();
        state.hover = found;
        analyze(describe(found));
      }
      return;
    }
    if (e.key === 'Escape' && !card.hidden) closeCard();
  }, true);

  let dragging = null;

  document.addEventListener('mousedown', (e) => {
    if (!e.altKey || e.button !== 0) return;
    const found = findImage(e.clientX, e.clientY);
    if (!found) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = { start: { x: e.clientX, y: e.clientY }, hover: found };
    marquee.hidden = false;
    drawMarquee(dragging.start, dragging.start);
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    drawMarquee(dragging.start, { x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const { start, hover } = dragging;
    dragging = null;
    marquee.hidden = true;

    const rect = hover.el.getBoundingClientRect();
    const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX);
    const y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY);
    if (x1 - x0 < 24 || y1 - y0 < 24) { analyze(describe(hover)); return; }

    const clamp = (v) => Math.min(1, Math.max(0, v));
    const crop = {
      x: clamp((x0 - rect.left) / rect.width),
      y: clamp((y0 - rect.top) / rect.height),
      w: clamp((x1 - x0) / rect.width),
      h: clamp((y1 - y0) / rect.height),
    };
    analyze(describe(hover, crop));
  }, true);

  function drawMarquee(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    marquee.style.transform = `translate(${x}px, ${y}px)`;
    marquee.style.width = Math.abs(b.x - a.x) + 'px';
    marquee.style.height = Math.abs(b.y - a.y) + 'px';
  }

  // ── Запросы ────────────────────────────────────────────────────────────────

  async function analyze(request, force = false) {
    if (state.busy) return;
    state.request = request;
    state.busy = true;
    state.collapsed = false;
    card.classList.remove('card--collapsed');
    setDot('busy');
    openCard();
    renderLoading(force ? 'Перегенерирую' : 'Разбираю картинку');

    const res = await send({ type: 'ANALYZE', ...request, target: state.target, force });
    state.busy = false;

    if (!res.ok) { setDot('error'); renderError(res.error); return; }
    setDot('idle');
    state.entry = res.entry;
    state.cacheKey = res.cacheKey || null;
    state.target = res.target;
    renderResult({ fromCache: res.fromCache });
  }

  async function rebuild({ analysis = null, target = state.target } = {}) {
    if (!state.entry || state.busy) return;
    state.busy = true;
    setDot('busy');
    renderResult({ pending: true });

    const res = await send({ type: 'REBUILD', id: state.entry.id, analysis, target });
    state.busy = false;

    if (!res.ok) { setDot('error'); renderError(res.error, { keepEntry: true }); return; }
    setDot('idle');
    state.entry = res.entry;
    state.target = res.target;
    renderResult();
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Расширение перезагрузилось — обнови вкладку.', raw: err.message } });
          } else {
            resolve(res || { ok: false, error: { code: 'EMPTY', message: 'Пустой ответ воркера.' } });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Расширение перезагрузилось — обнови вкладку.', raw: e.message } });
      }
    });
  }

  // ── Отрисовка карточки ─────────────────────────────────────────────────────

  function openCard() {
    card.hidden = false;
    card.classList.remove('card--in');
    void card.offsetWidth;
    card.classList.add('card--in');
  }

  function closeCard() {
    card.hidden = true;
    state.entry = null;
    setDot('idle');
  }

  function setDot(mode) {
    for (const d of [pill.querySelector('.dot'), headDot]) {
      d.classList.toggle('dot--busy', mode === 'busy');
      d.classList.toggle('dot--error', mode === 'error');
    }
  }

  function renderLoading(text) {
    body.innerHTML = `<div class="state"><span class="dot dot--busy"></span><span>${esc(text)}…</span></div>`;
  }

  function renderError(error, { keepEntry = false } = {}) {
    const actions = [];
    if (error.code === 'NO_KEY' || error.code === 'KEY_INVALID' || error.code === 'MODEL_NOT_FOUND') {
      actions.push(`<button class="btn" type="button" data-act="options">Открыть настройки</button>`);
    }
    if (error.code === 'FETCH_FAILED') {
      actions.push(`<button class="btn" type="button" data-act="retry">Повторить</button>`);
    }
    if (['RATE_LIMIT', 'BAD_JSON', 'EMPTY', 'HTTP', 'NETWORK'].includes(error.code)) {
      actions.push(`<button class="btn" type="button" data-act="retry">Повторить</button>`);
    }

    body.innerHTML = `
      <div class="error">
        <div class="error__msg">${esc(error.message)}</div>
        ${error.raw ? `<details class="raw"><summary>Сырой ответ</summary><pre>${esc(String(error.raw).slice(0, 4000))}</pre></details>` : ''}
        <div class="row row--actions">${actions.join('')}</div>
      </div>`;

    if (!keepEntry) state.entry = null;
  }

  function renderResult({ fromCache = false, pending = false } = {}) {
    const entry = state.entry;
    if (!entry) return;
    const a = entry.analysis;
    const built = entry.prompts?.[state.target];
    const text = state.mode === 'styleOnly'
      ? (built?.styleOnly || a.prompt_style_only || '')
      : (built?.replicate || a.prompt || '');

    body.innerHTML = `
      <div class="row row--title">
        <h2 class="title">PROMPT</h2>
        <span class="words">${words(text)} сл.</span>
        ${fromCache ? `<span class="badge" title="Результат взят из кэша">из кэша</span>` : ''}
        <span class="grow"></span>
        <button class="ico" type="button" data-act="regen" title="Перегенерировать">${I.refresh}</button>
        <button class="ico" type="button" data-act="history" title="История">${I.clock}</button>
      </div>

      <pre class="prompt${pending ? ' prompt--pending' : ''}" tabindex="0" data-el="prompt">${esc(text)}</pre>

      ${a.tags?.length ? `<div class="tags">${a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}

      <div class="seg" role="group" aria-label="Целевой генератор">
        ${TARGETS.map((t) => `
          <button class="seg__btn${t.id === state.target ? ' is-on' : ''}" type="button"
                  data-act="target" data-target="${t.id}" aria-pressed="${t.id === state.target}">${t.label}</button>`).join('')}
      </div>

      <div class="seg" role="group" aria-label="Режим промпта">
        <button class="seg__btn${state.mode === 'replicate' ? ' is-on' : ''}" type="button"
                data-act="mode" data-mode="replicate" aria-pressed="${state.mode === 'replicate'}">Повторить</button>
        <button class="seg__btn${state.mode === 'styleOnly' ? ' is-on' : ''}" type="button"
                data-act="mode" data-mode="styleOnly" aria-pressed="${state.mode === 'styleOnly'}">Только стиль</button>
      </div>

      <button class="btn btn--primary" type="button" data-act="copy">Копировать</button>

      <div class="meta">
        ${a.aspect_ratio ? `<span class="meta__k">Пропорции</span><span class="meta__v">${esc(a.aspect_ratio)}${a.orientation ? ' · ' + esc(a.orientation) : ''}</span>` : ''}
      </div>

      ${a.palette?.length ? `
        <div class="palette" data-el="palette">
          ${a.palette.map((p, i) => paletteChip(p, i)).join('')}
        </div>` : ''}

      <details class="layers"${state.layersOpen ? ' open' : ''}>
        <summary>Разбор по слоям</summary>
        <p class="hint">Поля редактируемые: правишь — промпт пересобирается из текста, без повторной отправки картинки.</p>
        ${LAYERS.map((l) => `
          <label class="field">
            <span class="field__k">${l.label}</span>
            <textarea class="field__v" data-layer="${l.key}" rows="2"
                      spellcheck="false">${esc(a[l.key] || '')}</textarea>
          </label>`).join('')}
        ${a.text_in_image?.length ? `
          <div class="field">
            <span class="field__k">Текст в кадре</span>
            <ul class="list">${a.text_in_image.map((t) => `<li>«${esc(t.content)}»${t.placement ? ' — ' + esc(t.placement) : ''}</li>`).join('')}</ul>
          </div>` : ''}
        ${a.uncertain?.length ? `
          <div class="field">
            <span class="field__k">Не разобрано</span>
            <ul class="list list--muted">${a.uncertain.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>` : ''}
      </details>`;

    const layers = body.querySelector('.layers');
    layers?.addEventListener('toggle', () => { state.layersOpen = layers.open; });

    for (const ta of body.querySelectorAll('textarea[data-layer]')) {
      autosize(ta);
      ta.addEventListener('input', () => autosize(ta));
      ta.addEventListener('focus', () => { ta.dataset.was = ta.value; });
      ta.addEventListener('blur', () => {
        if (ta.value.trim() === (ta.dataset.was ?? '').trim()) return;
        const analysis = { ...state.entry.analysis };
        for (const f of body.querySelectorAll('textarea[data-layer]')) analysis[f.dataset.layer] = f.value.trim();
        rebuild({ analysis });
      });
    }
  }

  function paletteChip(entry, i) {
    const hex = matchHex(entry);
    const label = entry.replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i, '').replace(/[(),]\s*$/, '').trim();
    return `<button class="sw" type="button" data-act="hex" data-hex="${hex || ''}" data-i="${i}"
              title="${esc(label || entry)}${hex ? ' · ' + hex : ''}"
              style="${hex ? `background:${hex}` : 'background:var(--surface)'}">
              <span class="sw__t">${esc(hex || label.slice(0, 6))}</span>
            </button>`;
  }

  function matchHex(entry) {
    const m = String(entry).match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    if (!m) return null;
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return '#' + hex.toUpperCase();
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(220, ta.scrollHeight + 2) + 'px';
  }

  // ── Действия ───────────────────────────────────────────────────────────────

  function onAction(act, e) {
    const node = e.target.closest('[data-act]');
    switch (act) {
      case 'close': closeCard(); break;

      case 'collapse':
        state.collapsed = !state.collapsed;
        card.classList.toggle('card--collapsed', state.collapsed);
        node.setAttribute('title', state.collapsed ? 'Развернуть' : 'Свернуть');
        node.innerHTML = state.collapsed ? I.plus : I.minus;
        break;

      case 'history': send({ type: 'OPEN_HISTORY' }); break;
      case 'options': send({ type: 'OPEN_OPTIONS' }); break;

      case 'retry':
        if (state.request) analyze(state.request, true);
        break;

      case 'regen':
        if (state.request) analyze(state.request, true);
        break;

      case 'target': {
        const next = node.dataset.target;
        if (next === state.target) break;
        state.target = next;
        if (state.entry) rebuild({ target: next });
        break;
      }

      case 'mode':
        state.mode = node.dataset.mode;
        renderResult();
        break;

      case 'copy': {
        const text = body.querySelector('[data-el="prompt"]')?.textContent || '';
        copy(text).then((ok) => flash(ok ? 'Промпт скопирован' : 'Скопировать не вышло'));
        break;
      }

      case 'hex': {
        const hex = node.dataset.hex;
        if (!hex) { flash('У этого цвета нет hex в разборе'); break; }
        copy(hex).then((ok) => flash(ok ? hex + ' скопирован' : 'Скопировать не вышло'));
        break;
      }
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Часть сайтов запрещает clipboard-api политикой — старый путь через textarea.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

  let toastTimer = 0;
  function flash(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }

  // ── Настройки ──────────────────────────────────────────────────────────────

  send({ type: 'SETTINGS' }).then((res) => {
    if (!res.ok) return;
    state.minSize = res.settings.minImageSize || 140;
    state.target = res.settings.target || state.target;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const s = changes.settings.newValue || {};
    if (s.minImageSize) state.minSize = s.minImageSize;
  });

  // ── Мелочи ─────────────────────────────────────────────────────────────────

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    node.className = cls;
    if (html) node.innerHTML = html;
    return node;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function words(text) {
    return (String(text).match(/[^\s]+/g) || []).length;
  }

  function CSS() {
    return `
:host, * { box-sizing: border-box; }

/* Классы ниже задают display, а он перебивает стиль браузера для [hidden].
   Без этой строки пилюля и карточка видны с самого начала. */
[hidden] { display: none !important; }

.pill, .card, .toast, .marquee {
  --bg: #0C0C0E;
  --surface: #16161A;
  --line: #26262B;
  --text: #E8E6E1;
  --muted: #8A8A93;
  --accent: #7DD3A0;
  --warn: #FF9D8A;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  color: var(--text);
  pointer-events: auto;
}

button { font: inherit; color: inherit; cursor: pointer; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Пилюля ─────────────────────────────────────────────────────────────── */

.pill {
  position: fixed; top: 0; left: 0;
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px 0 8px;
  border: 1px solid var(--line); border-radius: 999px;
  background: rgba(12,12,14,.92);
  backdrop-filter: blur(8px);
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  box-shadow: 0 8px 24px rgba(0,0,0,.45);
}
.pill:hover { border-color: #37373E; }
.pill--in { animation: rise .12s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } }

.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent); flex: none;
}
.dot--busy { animation: pulse 1s ease-in-out infinite; }
.dot--error { background: var(--warn); animation: none; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }

/* ── Рамка выделения ────────────────────────────────────────────────────── */

.marquee {
  position: fixed; top: 0; left: 0;
  border: 1px solid var(--accent);
  background: rgba(125,211,160,.12);
  pointer-events: none;
}

/* ── Карточка ───────────────────────────────────────────────────────────── */

.card {
  position: fixed; right: 16px; bottom: 16px;
  width: min(400px, calc(100vw - 24px));
  max-height: min(calc(100vh - 32px), 760px);
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,.6);
  overflow: hidden;
}
.card--in { animation: open .16s ease-out; }
@keyframes open { from { opacity: 0; transform: translateY(8px); } }
.card--collapsed .body { display: none; }

.head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 10px 10px 12px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.name { font-size: 11px; letter-spacing: .12em; }
.ver { font-size: 10px; color: var(--muted); }
.grow { flex: 1 1 auto; }

.ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex: none;
  background: transparent; border: 1px solid transparent; border-radius: 8px;
  color: var(--muted);
}
.ico:hover { color: var(--text); border-color: var(--line); }
.ico svg { width: 15px; height: 15px; }

.body { padding: 12px; overflow-y: auto; overscroll-behavior: contain; }

.state { display: flex; align-items: center; gap: 8px; padding: 18px 4px; color: var(--muted); font-size: 12px; }

.row { display: flex; align-items: center; gap: 8px; }
.row--title { margin-bottom: 8px; }
.row--actions { margin-top: 10px; gap: 8px; }

.title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: .04em; }
.words { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.badge {
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px;
}

.prompt {
  margin: 0; padding: 10px;
  max-height: 240px; overflow: auto; overscroll-behavior: contain;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  user-select: text;
}
.prompt--pending { opacity: .45; }

.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.tag {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px;
}

.seg { display: flex; gap: 4px; margin-top: 10px; padding: 3px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.seg__btn {
  flex: 1 1 0; min-height: 28px; padding: 4px 6px;
  background: transparent; border: 0; border-radius: 6px;
  font-size: 11px; letter-spacing: .04em; color: var(--muted);
}
.seg__btn:hover { color: var(--text); }
.seg__btn.is-on { background: #202027; color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }

.btn {
  min-height: 34px; padding: 0 14px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text);
}
.btn:hover { border-color: #37373E; }
.btn--primary { width: 100%; margin-top: 10px; color: var(--accent); }
.btn--primary:hover { border-color: var(--accent); }

.meta { display: flex; gap: 8px; align-items: baseline; margin-top: 10px; font-size: 11px; }
.meta__k { color: var(--muted); letter-spacing: .12em; text-transform: uppercase; font-size: 10px; }
.meta__v { color: var(--text); }

.palette { display: flex; gap: 4px; margin-top: 10px; }
.sw {
  flex: 1 1 0; height: 34px; border: 1px solid var(--line); border-radius: 8px;
  display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px;
  overflow: hidden;
}
.sw__t {
  font-size: 8px; letter-spacing: .04em; color: #0C0C0E;
  background: rgba(232,230,225,.75); border-radius: 3px; padding: 0 3px;
  white-space: nowrap;
}

.layers { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.layers > summary {
  cursor: pointer; list-style: none;
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
}
.layers > summary::-webkit-details-marker { display: none; }
.layers > summary::before { content: '+ '; }
.layers[open] > summary::before { content: '– '; }
.layers > summary:hover { color: var(--text); }

.hint { margin: 8px 0 10px; font-size: 11px; line-height: 1.5; color: var(--muted); }

.field { display: block; margin-bottom: 8px; }
.field__k {
  display: block; margin-bottom: 4px;
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
}
.field__v {
  display: block; width: 100%; resize: vertical;
  padding: 7px 8px; min-height: 32px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  font-family: inherit; font-size: 12px; line-height: 1.5; color: var(--text);
}
.field__v:focus { border-color: var(--accent); outline: none; }

.list { margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.55; }
.list--muted { color: var(--muted); }

.error { font-size: 12px; line-height: 1.55; }
.error__msg { color: var(--warn); }
.raw { margin-top: 10px; }
.raw > summary { cursor: pointer; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.raw pre {
  margin: 8px 0 0; padding: 8px; max-height: 180px; overflow: auto;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  font-size: 11px; white-space: pre-wrap; word-break: break-word; color: var(--muted);
}

.toast {
  position: fixed; right: 16px; bottom: 16px;
  padding: 8px 12px;
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0,0,0,.5);
  font-size: 11px; letter-spacing: .04em;
  z-index: 2;
}

@media (prefers-reduced-motion: reduce) {
  .pill--in, .card--in, .dot--busy { animation: none; }
}`;
  }
})();
