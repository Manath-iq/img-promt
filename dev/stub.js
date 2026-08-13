// dev/stub.js — заглушка chrome.* для стенда.
// В расширении не участвует: нужна, чтобы гонять карточку и историю
// в обычной вкладке, без ключа и без сети.

(() => {
  // Демо-разбор собран по реальному референсу — тому самому Y2K-коллажу с логотипом IE.
  // Он специально не «красивый»: на нём видно, ради чего добавлены слои
  // «эпоха», «сборка» и «обработка».
  const ANALYSIS = {
    aspect_ratio: '1:1',
    orientation: 'square',
    medium: 'Цифровой коллаж из стоковых фото и одного CG-элемента, поверх всего единый слой зерна.',
    era: 'Эстетика старого интернета: Y2K-хром и ностальгикор, элемент из ранних нулевых, собрано вручную в редакторе, а не отрисовано целиком.',
    assembly: 'Коллаж: цветы и кролик — вырезки с жёсткими краями, свет и масштаб между элементами не сходятся, справа на траве остался тёмный смазанный след ретуши.',
    subject: 'Хромовый синий шар-логотип с округлой буквой «e», опоясанный толстым золотым кольцом, парит над холмом.',
    scene: 'Тёмно-синее почти ночное небо с плотным шумом, поперёк кадра крупная перенасыщенная радуга, у горизонта белые облака, внизу зелёный травяной холм.',
    composition: 'Квадрат, логотип по центру верхней половины, радуга обрамляет его дугой от края до края, горизонт в нижней трети, кролик в правом нижнем углу, цветы — пятном слева.',
    light: 'Рассеянный ровный свет без единого источника, между элементами не согласован; на хроме жёсткие звёздчатые блики.',
    camera: 'Не фотография: ранний CG с жёсткими спекулярами на хроме, фотофрагменты сняты обычной цифрой.',
    materials: 'Полированный хром, матовое золото кольца, короткая сочная трава, мех кролика с размытым контуром.',
    post: 'Крупное зерно по всему кадру, заметные артефакты сжатия, лёгкая виньетка, звёздчатые блики, мелкий нечитаемый вотермарк в правом нижнем углу.',
    style: 'Найденная в интернете картинка-настроение, а не рекламный рендер.',
    mood: 'Ностальгия по раннему вебу: наивная радуга и тёмное небо дают тревожную сладость.',
    constraints: 'не вычищать зерно и артефакты, не осветлять небо до дневного, не выравнивать края вырезок',
    palette: ['глубокий синий #16308A', 'травяной зелёный #3FA13B', 'кислотный жёлтый #F2E33C', 'хромовый голубой #7FB2E5'],
    text_in_image: [],
    tags: ['y2k', 'nostalgiacore', 'collage', 'grain', 'rainbow', 'old web'],
    uncertain: ['что написано в вотермарке', 'что за тёмный след справа на траве'],
    prompt: 'Grainy low-fidelity Y2K digital collage in old-web nostalgiacore style, assembled by hand from stock photos and one early-2000s CG element. A chrome blue sphere logo shaped like a rounded letter "e", wrapped in a thick matte gold ring, floats in the upper centre above a green hill. Behind it a deep navy near-night sky heavy with noise, and a huge oversaturated rainbow arcing from edge to edge; small white clouds sit low on the horizon. The grassy hill fills the lower third, a flat cutout patch of acid-yellow flowers on the left, a small grey rabbit mid-leap at lower right with hard cutout edges and slightly mismatched scale. Flat ambient light that does not match between elements, hard star-shaped sparkles on the chrome. Heavy film-style grain over the whole frame, visible compression artifacts, gentle vignette, a small illegible watermark in the lower right corner. Square 1:1 format.',
    prompt_style_only: 'Grainy low-fidelity Y2K digital collage in old-web nostalgiacore style: {{SUBJECT}} floating in the upper centre above a green hill, against a deep navy near-night sky heavy with noise and a huge oversaturated rainbow arcing edge to edge. Hand-assembled look with hard cutout edges and lighting that does not match between elements, flat ambient light, hard star-shaped sparkles. Heavy film-style grain over the whole frame, visible compression artifacts, gentle vignette, small illegible watermark in the lower right corner. Square 1:1 format.',
  };

  /** Промпт под GPT Image 2 — подписанные строки, как их собирает новая инструкция. */
  const GPT_PROMPT = [
    'Format: square 1:1',
    'Look: hand-made Y2K digital collage, old-web nostalgiacore, low fidelity, not a clean render',
    'Scene: deep navy near-night sky heavy with noise, huge oversaturated rainbow arcing edge to edge, small white clouds low on the horizon, green grassy hill across the lower third',
    'Subject: a chrome blue sphere logo shaped like a rounded letter "e" wrapped in a thick matte gold ring, floating in the upper centre above the hill',
    'Details: flat cutout patch of acid-yellow flowers at left, a small grey rabbit mid-leap at lower right with hard cutout edges and slightly mismatched scale; flat ambient light that does not match between elements; hard star-shaped sparkles on the chrome; polished chrome and matte gold against short lush grass',
    'Texture: heavy film-style grain over the whole frame, visible compression artifacts, gentle vignette, hard cutout edges with slight fringing, small illegible watermark lower right',
    'Purpose: mood board image that looks found on the early internet',
    'Constraints: keep the low-fidelity look, do not clean it up, do not brighten the sky to daylight',
  ].join('\n');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const thumb = (hue) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, `hsl(${hue} 30% 62%)`);
    grad.addColorStop(1, `hsl(${hue + 40} 24% 32%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c.toDataURL('image/png');
  };

  const entry = (i) => ({
    id: 'demo-' + i,
    createdAt: Date.now() - i * 3600e3 * 7,
    sourceUrl: `https://i.pinimg.com/originals/de/mo/${i}.jpg`,
    pageUrl: ['https://ru.pinterest.com/pin/12345/', 'https://www.behance.net/gallery/999/demo', 'https://dribbble.com/shots/777'][i % 3],
    target: ['nano-banana', 'gpt-image-2', 'universal'][i % 3],
    crop: i === 2 ? { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } : null,
    analysis: ANALYSIS,
    prompts: {
      [['nano-banana', 'gpt-image-2', 'universal'][i % 3]]: {
        replicate: ANALYSIS.prompt,
        styleOnly: ANALYSIS.prompt_style_only,
      },
    },
    tags: ANALYSIS.tags,
    starred: i % 4 === 0,
    note: i === 1 ? 'Свет вышел жёстче, чем в референсе — попробовать «large softbox, feathered».' : '',
  });

  const seeded = Array.from({ length: 6 }, (_, i) => entry(i));

  const mem = {
    settings: { apiKey: 'demo', model: 'gemini-3.6-flash', target: 'nano-banana', minImageSize: 140, template: '…' },
    history: seeded,
    cache: {},
    usage: { [new Date().toISOString().slice(0, 10)]: 14 },
  };
  for (const [i, e] of seeded.entries()) mem['thumb:' + e.id] = thumb(20 + i * 40);

  async function respond(msg) {
    await wait(msg.type === 'ANALYZE' ? 900 : 500);
    switch (msg.type) {
      case 'SETTINGS': return { ok: true, settings: mem.settings };
      case 'ANALYZE': return { ok: true, entry: entry(0), target: msg.target || 'nano-banana', fromCache: false, cacheKey: 'demo' };
      case 'REBUILD': {
        const e = entry(0);
        const analysis = msg.analysis || e.analysis;
        e.analysis = analysis;
        const replicate = msg.target === 'gpt-image-2' ? GPT_PROMPT : analysis.prompt;
        e.prompts = { [msg.target]: { replicate, styleOnly: analysis.prompt_style_only } };
        return { ok: true, entry: e, target: msg.target, fromCache: false };
      }
      case 'COMPARE': return {
        ok: true,
        target: 'nano-banana',
        result: {
          differences: ['Свет: жёсткий контровой вместо мягкого бокового', 'Палитра: холоднее на два шага', 'Оптика: шире, 35 мм против 85 мм'],
          delta_prompt: 'Replace the soft 45-degree key with a hard backlight behind the subject, cool the palette toward steel blue, and reframe wider as if shot on 35mm.',
          merged_prompt: ANALYSIS.prompt.replace('A single large softbox', 'A hard backlight'),
        },
      };
      default: return { ok: true };
    }
  }

  window.chrome = {
    runtime: {
      id: 'dev-stub',
      lastError: undefined,
      getManifest: () => ({ version: '1.0.0' }),
      openOptionsPage: () => alert('Настройки (в стенде не открываются)'),
      sendMessage: (msg, cb) => (cb ? respond(msg).then(cb) : respond(msg)),
      getURL: (p) => p,
    },
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...mem };
          const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of list) if (k in mem) out[k] = mem[k];
          return out;
        },
        set: async (obj) => Object.assign(mem, obj),
        remove: async (keys) => (typeof keys === 'string' ? [keys] : keys).forEach((k) => delete mem[k]),
      },
      onChanged: { addListener: () => {} },
    },
  };
})();
