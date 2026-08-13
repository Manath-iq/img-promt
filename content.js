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

  /** Иконки — тонкие контуры, обводка 1.6, без заливки. */
  const I = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14l5-5 5 5"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3"/><path d="M20.5 4.5v5h-5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5V7a.5.5 0 0 0 .5.5H18"/><path d="M9 12.5h6M9 16h4"/></svg>',
  };

  const TARGETS = [
    { id: 'nano-banana', label: 'Nano Banana' },
    { id: 'gpt-image-2', label: 'GPT Image 2' },
    { id: 'universal', label: 'Universal' },
  ];

  const LAYERS = [
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

  // Воркер просит спрятать интерфейс перед снимком вкладки: иначе пилюля
  // попадает в кадр и уезжает в модель как часть картинки.
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type !== 'LENS_UI') return;
    host.style.setProperty('visibility', msg.hidden ? 'hidden' : 'visible', 'important');
    respond({ ok: true });
  });

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
      <span class="name">Prompt Lens · v${VERSION}</span>
      <span class="grow"></span>
      <button class="ico" type="button" data-act="collapse" title="Свернуть" aria-label="Свернуть">${I.up}</button>
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

    const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX);
    const y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY);
    if (x1 - x0 < 24 || y1 - y0 < 24) { analyze(describe(hover)); return; }

    // Считаем от нарисованной картинки, а не от элемента: при object-fit: cover
    // — а так свёрстана вся плитка Pinterest — они не совпадают, и фрагмент
    // уезжает относительно того, что человек выделил.
    const box = paintedBox(hover.el);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const left = clamp((x0 - box.left) / box.width);
    const top = clamp((y0 - box.top) / box.height);
    const crop = {
      x: left,
      y: top,
      w: clamp((x1 - box.left) / box.width) - left,
      h: clamp((y1 - box.top) / box.height) - top,
    };
    if (crop.w < 0.02 || crop.h < 0.02) { analyze(describe(hover)); return; }
    analyze(describe(hover, crop));
  }, true);

  /**
   * Прямоугольник самой картинки во вьюпорте с учётом object-fit.
   * У `cover` он больше элемента и обрезается им, у `contain` — меньше.
   * Для фонов и нестандартного object-position падаем на рамку элемента.
   */
  function paintedBox(node) {
    const rect = node.getBoundingClientRect();
    if (node.tagName !== 'IMG' || !node.naturalWidth || !node.naturalHeight) return rect;

    const style = getComputedStyle(node);
    if (style.objectPosition && style.objectPosition !== '50% 50%') return rect;

    const nw = node.naturalWidth, nh = node.naturalHeight;
    const byWidth = rect.width / nw, byHeight = rect.height / nh;
    let scale;
    switch (style.objectFit) {
      case 'contain': scale = Math.min(byWidth, byHeight); break;
      case 'cover': scale = Math.max(byWidth, byHeight); break;
      case 'none': scale = 1; break;
      case 'scale-down': scale = Math.min(1, Math.min(byWidth, byHeight)); break;
      default: return rect; // fill — картинка растянута ровно по элементу
    }

    const width = nw * scale, height = nh * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width, height,
    };
  }

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
    expandCard();
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

  /** Разворачивает карточку и возвращает кнопке правильную иконку. */
  function expandCard() {
    state.collapsed = false;
    card.classList.remove('card--collapsed');
    const btn = card.querySelector('[data-act="collapse"]');
    btn.innerHTML = I.up;
    btn.setAttribute('title', 'Свернуть');
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
        <button class="ico" type="button" data-act="history" title="История">${I.doc}</button>
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
    layers?.addEventListener('toggle', () => {
      state.layersOpen = layers.open;
      // У свёрнутой секции высота полей меряется по нулевому боксу, и текст
      // обрезается — пересчитываем в момент раскрытия.
      if (layers.open) for (const ta of body.querySelectorAll('textarea[data-layer]')) autosize(ta);
    });

    for (const ta of body.querySelectorAll('textarea[data-layer]')) {
      if (state.layersOpen) autosize(ta);
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
        node.innerHTML = state.collapsed ? I.down : I.up;
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
  /* Тёмное стекло: цвет подложки просвечивает сквозь размытие, поэтому корпус
     не сплошной, а полупрозрачный. Все значения — из системной палитры Apple. */
  --glass: rgba(24, 24, 27, .72);
  --glass-thin: rgba(255, 255, 255, .06);
  --glass-fill: rgba(120, 120, 128, .22);
  --glass-fill-2: rgba(120, 120, 128, .14);
  --hairline: rgba(255, 255, 255, .12);
  --text: #F5F5F7;
  --muted: rgba(235, 235, 245, .62);
  --faint: rgba(235, 235, 245, .34);
  --solid: #F5F5F7;
  --on-solid: #101012;
  --accent: #30D158;
  --warn: #FF453A;

  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
               "Helvetica Neue", system-ui, sans-serif;
  color: var(--text);
  pointer-events: auto;
  -webkit-font-smoothing: antialiased;
}

button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }

:focus-visible { outline: 2px solid rgba(255, 255, 255, .55); outline-offset: 2px; }

/* ── Пилюля ─────────────────────────────────────────────────────────────── */

.pill {
  position: fixed; top: 0; left: 0;
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 13px 0 11px;
  border-radius: 999px;
  background: var(--glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: inset 0 .5px 0 var(--hairline), 0 0 0 .5px rgba(0, 0, 0, .35),
              0 8px 22px rgba(0, 0, 0, .38);
  font-size: 12.5px; font-weight: 500; letter-spacing: -.01em;
}
.pill:hover { background: rgba(38, 38, 42, .78); }
.pill:active { transform: scale(.97); }
.pill--in { animation: rise .16s cubic-bezier(.32, .72, 0, 1); }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } }

.dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  background: var(--accent);
  box-shadow: 0 0 6px rgba(48, 209, 88, .55);
}
.dot--busy { animation: pulse 1.1s ease-in-out infinite; }
.dot--error { background: var(--warn); box-shadow: 0 0 6px rgba(255, 69, 58, .55); animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .28; } }

/* ── Рамка выделения ────────────────────────────────────────────────────── */

.marquee {
  position: fixed; top: 0; left: 0;
  border: 1px solid rgba(255, 255, 255, .9);
  border-radius: 6px;
  background: rgba(255, 255, 255, .14);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .25);
  pointer-events: none;
}

/* ── Карточка ───────────────────────────────────────────────────────────── */

.card {
  position: fixed; right: 18px; bottom: 18px;
  width: min(390px, calc(100vw - 24px));
  max-height: min(calc(100vh - 36px), 780px);
  display: flex; flex-direction: column;
  border-radius: 30px;
  background: var(--glass);
  backdrop-filter: blur(44px) saturate(180%);
  -webkit-backdrop-filter: blur(44px) saturate(180%);
  box-shadow:
    inset 0 .5px 0 rgba(255, 255, 255, .18),
    inset 0 0 0 .5px rgba(255, 255, 255, .07),
    0 1px 3px rgba(0, 0, 0, .3),
    0 24px 68px rgba(0, 0, 0, .55);
  overflow: hidden;
}
.card--in { animation: open .28s cubic-bezier(.32, .72, 0, 1); }
@keyframes open { from { opacity: 0; transform: translateY(12px) scale(.97); } }
.card--collapsed .body { display: none; }
.card--collapsed { border-radius: 24px; }

.head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 14px 10px 18px;
  flex: none;
}
.name {
  font-size: 11.5px; font-weight: 590; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted);
}
.grow { flex: 1 1 auto; }

.ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; flex: none;
  border-radius: 50%;
  background: var(--glass-fill-2);
  color: var(--muted);
  transition: background .15s ease, color .15s ease;
}
.ico:hover { background: var(--glass-fill); color: var(--text); }
.ico:active { transform: scale(.94); }
.ico svg { width: 16px; height: 16px; }

.body { padding: 0 18px 18px; overflow-y: auto; overscroll-behavior: contain; }

.state {
  display: flex; align-items: center; gap: 9px;
  padding: 22px 2px 26px; color: var(--muted); font-size: 14px;
}

.row { display: flex; align-items: center; gap: 8px; }
.row--title { margin-bottom: 14px; }
.row--actions { margin-top: 14px; gap: 8px; }

.title {
  margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -.022em;
  line-height: 1.1;
}
.words {
  display: inline-flex; align-items: center; height: 28px; padding: 0 13px;
  border-radius: 999px; background: var(--glass-fill-2);
  box-shadow: inset 0 .5px 0 var(--hairline);
  font-size: 13px; font-weight: 500; color: var(--muted);
}
.badge {
  display: inline-flex; align-items: center; height: 24px; padding: 0 10px;
  border-radius: 999px; background: var(--glass-fill-2);
  font-size: 11.5px; font-weight: 500; color: var(--faint);
}

.prompt {
  margin: 0; padding: 0;
  max-height: 268px; overflow: auto; overscroll-behavior: contain;
  font-family: inherit; font-size: 15px; line-height: 1.5; letter-spacing: -.01em;
  color: var(--text);
  white-space: pre-wrap; word-break: break-word;
  user-select: text;
}
.prompt--pending { opacity: .38; }

.tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
.tag {
  padding: 6px 12px; border-radius: 999px;
  background: var(--glass-fill-2);
  box-shadow: inset 0 .5px 0 var(--hairline);
  font-size: 12.5px; color: var(--muted); letter-spacing: -.005em;
}

.seg {
  display: flex; gap: 3px; margin-top: 12px; padding: 3px;
  border-radius: 999px; background: var(--glass-fill-2);
  box-shadow: inset 0 .5px 0 var(--hairline);
}
.seg__btn {
  flex: 1 1 0; min-height: 32px; padding: 4px 8px;
  border-radius: 999px;
  font-size: 13px; font-weight: 500; letter-spacing: -.01em; color: var(--muted);
  transition: background .18s ease, color .18s ease;
}
.seg__btn:hover { color: var(--text); }
.seg__btn.is-on {
  background: rgba(255, 255, 255, .16);
  color: var(--text);
  box-shadow: inset 0 .5px 0 rgba(255, 255, 255, .22), 0 1px 3px rgba(0, 0, 0, .28);
}

.btn {
  min-height: 38px; padding: 0 16px;
  border-radius: 999px;
  background: var(--glass-fill);
  box-shadow: inset 0 .5px 0 var(--hairline);
  font-size: 14px; font-weight: 500; letter-spacing: -.01em; color: var(--text);
  transition: background .15s ease;
}
.btn:hover { background: rgba(120, 120, 128, .32); }
.btn:active { transform: scale(.985); }
.btn--primary {
  width: 100%; margin-top: 14px; min-height: 46px;
  background: var(--solid); color: var(--on-solid);
  font-weight: 590; font-size: 15px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
}
.btn--primary:hover { background: #FFFFFF; }

.meta { display: flex; gap: 8px; align-items: baseline; margin-top: 14px; font-size: 13px; }
.meta__k { color: var(--faint); }
.meta__v { color: var(--muted); }

.palette { display: flex; gap: 6px; margin-top: 12px; }
.sw {
  flex: 1 1 0; height: 40px; border-radius: 14px;
  display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px;
  box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .16);
  overflow: hidden;
  transition: transform .15s ease;
}
.sw:hover { transform: translateY(-1px); }
.sw__t {
  font-size: 9px; font-weight: 600; letter-spacing: .01em; color: rgba(16, 16, 18, .82);
  background: rgba(255, 255, 255, .72); border-radius: 999px; padding: 1px 5px;
  white-space: nowrap;
}

.layers { margin-top: 18px; }
.layers > summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: var(--muted);
}
.layers > summary::-webkit-details-marker { display: none; }
.layers > summary::after {
  content: ''; width: 6px; height: 6px; margin-left: 1px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translate(-2px, -2px);
  transition: transform .2s ease;
}
.layers[open] > summary::after { transform: rotate(-135deg) translate(-1px, -1px); }
.layers > summary:hover { color: var(--text); }

.hint { margin: 12px 0 14px; font-size: 13px; line-height: 1.45; color: var(--faint); }

.field { display: block; margin-bottom: 10px; }
.field__k {
  display: block; margin: 0 0 5px 4px;
  font-size: 12px; font-weight: 500; color: var(--faint);
}
.field__v {
  display: block; width: 100%; resize: vertical;
  padding: 10px 12px; min-height: 38px;
  border: 0; border-radius: 16px;
  background: var(--glass-fill-2);
  box-shadow: inset 0 .5px 0 var(--hairline);
  font-family: inherit; font-size: 14px; line-height: 1.45; color: var(--text);
  transition: background .15s ease;
}
.field__v:focus {
  outline: none; background: var(--glass-fill);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .28);
}

.list { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.5; color: var(--muted); }
.list--muted { color: var(--faint); }

.error { font-size: 14px; line-height: 1.5; padding-top: 4px; }
.error__msg { color: var(--warn); }
.raw { margin-top: 12px; }
.raw > summary { cursor: pointer; font-size: 12.5px; color: var(--faint); }
.raw pre {
  margin: 8px 0 0; padding: 12px; max-height: 180px; overflow: auto;
  border-radius: 16px; background: var(--glass-fill-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word; color: var(--faint);
}

.toast {
  position: fixed; right: 18px; bottom: 18px;
  padding: 11px 16px; border-radius: 999px;
  background: var(--glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: inset 0 .5px 0 var(--hairline), 0 10px 30px rgba(0, 0, 0, .5);
  font-size: 13.5px; font-weight: 500; letter-spacing: -.01em;
  z-index: 2;
  animation: rise .2s cubic-bezier(.32, .72, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  .pill--in, .card--in, .dot--busy, .toast { animation: none; }
  .ico, .btn, .sw, .seg__btn, .layers > summary::after { transition: none; }
}`;
  }
})();
