// dev/stub.js — заглушка chrome.* для стенда.
// В расширении не участвует: нужна, чтобы гонять карточку и историю
// в обычной вкладке, без ключа и без сети.

(() => {
  const ANALYSIS = {
    aspect_ratio: '3:4',
    orientation: 'portrait',
    medium: 'Цифровая фотография, студийная съёмка, без признаков плёнки.',
    subject: 'Женщина лет тридцати в льняном костюме песочного цвета, стоит вполоборота, взгляд в камеру, руки в карманах.',
    scene: 'Пустая студия с бумажным фоном тёплого серого тона, у ног лёгкая тень, глубины пространства почти нет.',
    composition: 'Поясной кадр, объект смещён вправо от центра, слева треть кадра пустая, горизонт на уровне глаз.',
    light: 'Один софтбокс слева сверху под 45°, мягкий контур, заполнение отражателем справа, тени плотные, но с деталями.',
    camera: 'Похоже на 85 мм при f/2.2, лёгкое сжатие планов, боке гладкое, зерна нет, цифровая съёмка.',
    materials: 'Мятая льняная ткань, матовая кожа, бумажный фон с еле заметной фактурой.',
    style: 'Студийный editorial-портрет в спокойной бежевой гамме.',
    mood: 'Собранность и тишина: пустое поле кадра и приглушённый цвет держат паузу.',
    constraints: 'без логотипов, без посторонних предметов в кадре, без пересветов на коже',
    palette: ['тёплый песочный #D8C3A5', 'серо-бежевый фон #C9C0B6', 'глубокий графит #2E2B28', 'тёплый телесный #E7C7A9'],
    text_in_image: [],
    tags: ['editorial', 'studio', 'beige', 'soft light', 'minimal'],
    uncertain: ['материал пуговиц', 'что за обувь — не попала в кадр'],
    prompt: 'Photorealistic editorial photograph of a woman in her early thirties wearing a sand-coloured linen suit, standing three-quarters to camera in an empty studio, hands in pockets, looking straight into the lens. Warm grey seamless paper fills the background with almost no depth, a soft shadow pooling at her feet. Waist-up framing, subject placed right of centre with a third of the frame left empty, camera at eye level. A single large softbox sits high and left at 45 degrees, wrapping her face in soft contour light while a white bounce opens the shadows on the right. Shot on 85mm at f/2.2, shallow depth of field, clean digital capture with no grain. Muted sand-and-graphite palette, warm highlights, cool shadows, low contrast, matte skin and crisp linen texture. Vertical 3:4 portrait format.',
    prompt_style_only: '{{SUBJECT}} photographed against warm grey seamless paper in an empty studio, a single large softbox high and left at 45 degrees with a white bounce opening the shadows on the right. Shot on 85mm at f/2.2, shallow depth of field, clean digital capture with no grain. Muted sand-and-graphite palette, warm highlights, cool shadows, low contrast, matte surfaces. Vertical 3:4 portrait format.',
  };

  /** Промпт под GPT Image 2 — подписанные строки, как их собирает новая инструкция. */
  const GPT_PROMPT = [
    'Format: vertical 3:4 portrait',
    'Scene: empty studio, warm grey seamless paper, almost no depth, soft shadow pooling at the feet',
    'Subject: a woman in her early thirties in a sand-coloured linen suit, three-quarters to camera, hands in pockets, looking into the lens',
    'Details: waist-up framing, subject right of centre with a third of the frame empty, eye level; single large softbox high and left at 45 degrees, white bounce on the right; shot on 85mm at f/2.2, shallow depth of field; matte skin, crisp linen, muted sand-and-graphite palette, low contrast',
    'Purpose: editorial fashion portrait',
    'Constraints: no watermark, no extra text, no props in frame',
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
