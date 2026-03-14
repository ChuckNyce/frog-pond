// ── State ──
let mode = 'text';
let tone = 'sincere';
let imageB64 = null;
let imageMime = null;
const MAX_HISTORY = 30;
let hasConverted = false;

// ── Speech ──
let speaking = false;
let pendingPauseTimeout = null;

function speak(haikuText, sourceText, btn) {
  if (!window.speechSynthesis) return;

  // If already speaking, stop everything
  if (speaking) {
    window.speechSynthesis.cancel();
    if (pendingPauseTimeout) { clearTimeout(pendingPauseTimeout); pendingPauseTimeout = null; }
    speaking = false;
    document.querySelectorAll('.action-btn[data-speak]').forEach(b => {
      b.textContent = 'read aloud';
      b.classList.remove('ok');
    });
    if (btn.dataset.speak === haikuText) return; // tapped same button = just stop
  }

  // Pick a voice: prefer a dull neutral English one for maximum robo energy
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'))
  ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

  function makeUtt(text) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88;
    utt.pitch = 1.0;
    utt.volume = 1;
    if (preferred) utt.voice = preferred;
    return utt;
  }

  function setActive() {
    speaking = true;
    if (btn) { btn.textContent = '// reading...'; btn.classList.add('ok'); }
  }

  function resetBtn() {
    speaking = false;
    if (btn) { btn.textContent = 'read aloud'; btn.classList.remove('ok'); }
  }

  if (sourceText) {
    const srcUtt = makeUtt(sourceText);
    const haikuUtt = makeUtt(haikuText);

    srcUtt.onstart = setActive;
    srcUtt.onerror = resetBtn;
    srcUtt.onend = () => {
      if (!speaking) return; // cancelled during source utterance
      pendingPauseTimeout = setTimeout(() => {
        pendingPauseTimeout = null;
        if (!speaking) return; // cancelled during pause
        window.speechSynthesis.speak(haikuUtt);
      }, 1200);
    };

    haikuUtt.onend = haikuUtt.onerror = resetBtn;

    window.speechSynthesis.speak(srcUtt);
  } else {
    const utt = makeUtt(haikuText);
    utt.onstart = setActive;
    utt.onend = utt.onerror = resetBtn;
    window.speechSynthesis.speak(utt);
  }
}

const TONES = {
  sincere: 'Treat the content with genuine sincerity and real emotional weight.',
  absurd:  'Make it hilariously absurd — elevate mundane things into cosmic tragedy. Go weird.',
  poetic:  'Find hidden beauty and quiet melancholy, like a classic Japanese poet. Wabi-sabi.',
};

// ── Random example posts ──
const RANDOM_POSTS = [
  "just spent 20 minutes looking for my phone. it was in my hand.",
  "my therapist said I need to stop comparing myself to others. I bet other people's therapists don't say that.",
  "normalize leaving a party early because you already peaked socially in the first 10 minutes",
  "the wifi went down for five minutes so I had to talk to my family. they seem like nice people.",
  "I love when people say 'we should hang out' and then we never do. anyway I'm free right now. goodbye.",
  "hot take: sleep is the only hobby that has never let me down",
  "I cleaned my room and now I don't know what to do with my hands",
  "sent a risky text and immediately became very interested in the ceiling",
  "me: I'm going to be productive today. also me: [opens the fridge for the fifth time in an hour]",
  "running late is my love language. I'm sorry. I'm working on it. I am not working on it.",
];

// ── Dark mode ──
function initTheme() {
  const saved = localStorage.getItem('fp_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  setTheme(isDark ? 'dark' : 'light');
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '[ light ]' : '[ dark ]';
  localStorage.setItem('fp_theme', t);
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});


const $ = id => document.getElementById(id);
const tabText        = $('tab-text');
const tabImage       = $('tab-image');
const textPanel      = $('text-panel');
const imagePanel     = $('image-panel');
const tweetArea      = $('tweet-area');
const charCount      = $('char-count');
const dropzone       = $('dropzone');
const fileInput      = $('file-input');
const previewWrap    = $('preview-wrap');
const previewImg     = $('preview-img');
const clearImg       = $('clear-img');
const imgStatus      = $('img-status');
const convertBtn     = $('convert-btn');
const loadingEl      = $('loading');
const resultsEl      = $('results');
const errorEl        = $('error');
const historySection = $('history-section');
const historyList    = $('history-list');
const historyClear   = $('history-clear');
const randomBtn      = $('random-btn');
const toneDesc       = $('tone-description');
const kofiLine       = $('kofi-line');

// ── Init ──
function init() {
  initTheme();
  updateConvertBtn();
  renderHistory();
}

// ── Tabs ──
tabText.addEventListener('click',  () => setMode('text'));
tabImage.addEventListener('click', () => setMode('image'));

function setMode(m) {
  mode = m;
  tabText.classList.toggle('active',  m === 'text');
  tabImage.classList.toggle('active', m === 'image');
  tabText.textContent  = m === 'text'  ? '> paste_text' : '  paste_text';
  tabImage.textContent = m === 'image' ? '> screenshot'  : '  screenshot';
  textPanel.classList.toggle('hidden',  m !== 'text');
  imagePanel.classList.toggle('hidden', m !== 'image');
  resultsEl.innerHTML = '';
  errorEl.classList.add('hidden');
  updateConvertBtn();
}

// ── Tone ──
document.querySelectorAll('.tone-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tone-btn').forEach(b => {
      b.classList.remove('active');
      b.textContent = ` ${b.dataset.tone} `;
    });
    btn.classList.add('active');
    btn.textContent = `[${btn.dataset.tone}]`;
    tone = btn.dataset.tone;
    if (toneDesc) toneDesc.textContent = TONES[tone];
  });
});

// ── Random post ──
randomBtn.addEventListener('click', () => {
  const post = RANDOM_POSTS[Math.floor(Math.random() * RANDOM_POSTS.length)];
  tweetArea.value = post;
  charCount.textContent = post.length + ' / 560';
  updateConvertBtn();
  convert();
});

// ── Text input ──
tweetArea.addEventListener('input', () => {
  charCount.textContent = tweetArea.value.length + ' / 560';
  updateConvertBtn();
});

// ── Image ──
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

clearImg.addEventListener('click', () => {
  imageB64 = null; imageMime = null;
  previewWrap.classList.add('hidden');
  dropzone.classList.remove('hidden');
  fileInput.value = '';
  imgStatus.textContent = 'no file';
  imgStatus.className = '';
  updateConvertBtn();
});

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  imageMime = file.type;
  const reader = new FileReader();
  reader.onload = e => {
    const url = e.target.result;
    imageB64 = url.split(',')[1];
    previewImg.src = url;
    previewWrap.classList.remove('hidden');
    dropzone.classList.add('hidden');
    imgStatus.textContent = file.name.slice(0, 20) + (file.name.length > 20 ? '…' : '');
    imgStatus.className = 'status-ok';
    updateConvertBtn();
  };
  reader.readAsDataURL(file);
}

function updateConvertBtn() {
  if (mode === 'text') {
    convertBtn.disabled = !tweetArea.value.trim();
  } else {
    convertBtn.disabled = !imageB64;
  }
}

// ── Convert ──
convertBtn.addEventListener('click', convert);

async function convert() {
  setLoading(true);
  errorEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  document.querySelector('.regen-btn')?.remove();

  try {
    let results;
    if (mode === 'text') {
      const text = tweetArea.value.trim();
      const haiku = await convertText(text);
      results = [{ source: text.slice(0, 80), fullSource: text, haiku, tone }];
    } else {
      results = await parseAndConvertImage(imageB64, imageMime);
    }
    saveToHistory(results);
    renderResults(results);

    // Show Ko-fi after first successful conversion
    if (!hasConverted) {
      hasConverted = true;
      kofiLine.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = err.message || 'something went wrong. try again.';
    errorEl.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
}

// ── API call — hits our backend, not Anthropic directly ──
async function callClaude({ system, messages }) {
  const res = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages,
    }),
  });

  if (res.status === 500) throw new Error('server error — api key may not be configured.');
  if (!res.ok) throw new Error(`request failed (${res.status}). try again.`);

  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseJSON(raw) {
  try { return JSON.parse(raw.trim()); }
  catch { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
}

// ── Text conversion ──
async function convertText(text) {
  const raw = await callClaude({
    system: `You are a haiku master. Convert the essence of this text into a perfect haiku (5-7-5 syllables).
Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: {"line1":"text","line2":"text","line3":"text","s1":5,"s2":7,"s3":5}
Count syllables very carefully. All lines lowercase. ${TONES[tone]}`,
    messages: [{ role: 'user', content: `Text: "${text}"` }],
  });
  return parseJSON(raw);
}

// ── Image conversion ──
async function parseAndConvertImage(b64, mime) {
  const extractRaw = await callClaude({
    system: `Extract individual social media posts from a screenshot.
Respond ONLY with a raw JSON array — no markdown, no backticks.
Format: [{"author":"username or empty string","text":"full post text"},...]
Rules:
- Capture the COMPLETE text of each post — do not truncate or summarise
- Multi-line and multi-paragraph posts should be captured in full with newlines preserved
- Include all visible posts in order, top to bottom
- If a post is a reply, include it as a separate item
- Skip UI elements, timestamps, like counts — only post text and author
- If text is unreadable, skip that post entirely`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: 'Extract all posts from this screenshot.' }
      ]
    }],
  });

  const posts = parseJSON(extractRaw);
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('no posts found in screenshot.');

  const batchRaw = await callClaude({
    system: `You are a haiku master. Convert each post into a perfect haiku (5-7-5 syllables).
Respond ONLY with a raw JSON array — no markdown, no backticks.
Format: [{"line1":"text","line2":"text","line3":"text","s1":5,"s2":7,"s3":5},...]
Same order as input. Count syllables carefully. All lines lowercase. ${TONES[tone]}`,
    messages: [{ role: 'user', content: `Convert these:\n${JSON.stringify(posts.map(p => p.text))}` }],
  });

  const haikus = parseJSON(batchRaw);
  if (!Array.isArray(haikus)) throw new Error('unexpected api response.');

  return posts.map((p, i) => ({
    source: (p.author ? `@${p.author}: ` : '') + p.text.slice(0, 80),
    fullSource: (p.author ? `@${p.author}: ` : '') + p.text,
    haiku: haikus[i] || null,
    tone,
  })).filter(r => r.haiku);
}

// ── Haiku image generation ──
async function generateHaikuImage(haiku, source) {
  await document.fonts.ready;

  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Colors — always light mode
  const bg      = '#f7f3ea';
  const text    = '#2c2418';
  const dim     = '#887050';
  const accent  = '#4a6a30';
  const border  = '#c8bfa8';
  const mono    = "'Courier New', monospace";
  const serif   = "'IM Fell English', Georgia, serif";

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle border
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const LEFT = 100;
  const RIGHT = W - LEFT; // 980
  const TEXT_LEFT = LEFT + 40;
  const srcLineH = 26;
  const srcBottomMargin = 40;
  const lineHeight = 70;
  const barTopMargin = 30;

  // ── Measure phase: compute source text lines before drawing ──
  let srcLines = [];
  if (source) {
    ctx.font = `20px ${mono}`;
    const MAX_W = W - 2 * LEFT;
    const prefix = '// ';
    const prefixW = ctx.measureText(prefix).width;
    const words = source.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      const lineW = (srcLines.length === 0 ? prefixW : 0) + ctx.measureText(test).width;
      if (lineW > MAX_W && current) {
        srcLines.push(current);
        if (srcLines.length === 3) { current = ''; break; }
        current = word;
      } else {
        current = test;
      }
    }
    if (current && srcLines.length < 3) srcLines.push(current);
    if (srcLines.join(' ').length < source.replace(/\s+/g, ' ').trim().length) {
      let last = srcLines[srcLines.length - 1];
      const isFirst = srcLines.length === 1;
      while (last.length > 0 && (isFirst ? prefixW : 0) + ctx.measureText(last + '…').width > MAX_W) {
        const sp = last.lastIndexOf(' ');
        last = sp > 0 ? last.slice(0, sp) : last.slice(0, -1);
      }
      srcLines[srcLines.length - 1] = last + '…';
    }
  }

  // ── Calculate total content block height and startY ──
  const srcHeight = srcLines.length > 0 ? srcLines.length * srcLineH + srcBottomMargin : 0;
  const totalContentHeight = srcHeight + 3 * lineHeight + barTopMargin + 18;
  let y = Math.max(180, Math.min(400, (H - totalContentHeight) / 2));

  // ── Fixed top-right: ASCII frog mascot, 40% opacity ──
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = accent;
  ctx.font = `16px ${mono}`;
  ctx.textBaseline = 'top';
  ['  @..@  ', ' (----) ', '( >__< )', ' ^^  ^^ '].forEach((line, i) => {
    ctx.fillText(line, RIGHT - ctx.measureText(line).width, 80 + i * 20);
  });
  ctx.restore();

  // ── Source text ──
  if (srcLines.length > 0) {
    ctx.font = `20px ${mono}`;
    ctx.fillStyle = dim;
    ctx.textBaseline = 'top';
    const prefix = '// ';
    srcLines.forEach((lineText, i) => {
      ctx.fillText(i === 0 ? prefix + lineText : lineText, LEFT, y + i * srcLineH);
    });
    y += srcLines.length * srcLineH + srcBottomMargin;
  }

  // ── Haiku lines ──
  [[haiku.line1, 5], [haiku.line2, 7], [haiku.line3, 5]].forEach(([line, syl]) => {
    ctx.font = `22px ${mono}`;
    ctx.fillStyle = dim;
    ctx.textBaseline = 'top';
    ctx.fillText(String(syl), LEFT, y + 16);
    ctx.font = `italic 52px ${serif}`;
    ctx.fillStyle = text;
    ctx.fillText(line, TEXT_LEFT, y);
    y += lineHeight;
  });

  // ── Syllable bars ──
  y += barTopMargin;
  const barData = [
    [haiku.s1 ?? 5, 5],
    [haiku.s2 ?? 7, 7],
    [haiku.s3 ?? 5, 5],
  ];
  ctx.font = `18px ${mono}`;
  ctx.textBaseline = 'top';
  let barX = LEFT;
  barData.forEach(([count, total], i) => {
    const filled = Math.min(count ?? total, total);
    const filledStr = '█'.repeat(filled);
    const unfilledStr = '░'.repeat(total - filled);
    ctx.fillStyle = accent;
    ctx.fillText(filledStr, barX, y);
    ctx.fillStyle = border;
    ctx.fillText(unfilledStr, barX + ctx.measureText(filledStr).width, y);
    if (i < barData.length - 1) barX += ctx.measureText(filledStr + unfilledStr).width + 25;
  });

  // ── Fixed bottom: branding ──
  ctx.font = `20px ${mono}`;
  ctx.fillStyle = dim;
  ctx.textBaseline = 'bottom';
  const brandText = 'frogpond.lol';
  ctx.fillText(brandText, (W - ctx.measureText(brandText).width) / 2, 1010);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function saveHaikuImage(haiku, source, btn) {
  const orig = btn.textContent;
  btn.textContent = '// generating...';
  btn.classList.add('ok');

  try {
    const blob = await generateHaikuImage(haiku, source);

    // Try native share on mobile
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], 'haiku-frogpond.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'haiku — frogpond.lol' });
        btn.textContent = '// shared!'; btn.classList.add('ok');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1800);
        return;
      }
    }

    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'haiku-frogpond.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    btn.textContent = '// shared!';
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1800);
  } catch (err) {
    btn.textContent = orig;
    btn.classList.remove('ok');
  }
}

// ── Share URL — lean payload, no source or syl counts to keep URLs short ──
function makeShareUrl(haiku, source, t) {
  const payload = {
    line1: haiku.line1,
    line2: haiku.line2,
    line3: haiku.line3,
    tone: t,
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${location.origin}/share?h=${encoded}`;
}

// ── History ──
function getHistory() {
  try { return JSON.parse(localStorage.getItem('fp_history') || '[]'); }
  catch { return []; }
}

function saveToHistory(results) {
  const hist = getHistory();
  const ts = Date.now();
  results.forEach(r => {
    if (!r.haiku) return;
    hist.unshift({ haiku: r.haiku, source: r.source, tone: r.tone, ts });
  });
  localStorage.setItem('fp_history', JSON.stringify(hist.slice(0, MAX_HISTORY)));
  renderHistory();
}

function renderHistory() {
  const hist = getHistory();
  if (hist.length === 0) { historySection.classList.add('hidden'); return; }
  historySection.classList.remove('hidden');
  historyList.innerHTML = '';
  hist.slice(0, 10).forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div class="history-lines">${esc(item.haiku.line1)} / ${esc(item.haiku.line2)} / ${esc(item.haiku.line3)}</div>
      <span class="history-date">${timeAgo(item.ts)}</span>
    `;
    el.addEventListener('click', () => window.open(makeShareUrl(item.haiku, item.source, item.tone), '_blank'));
    historyList.appendChild(el);
  });
}

historyClear.addEventListener('click', () => {
  localStorage.removeItem('fp_history');
  renderHistory();
});

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}

// ── Render ──
function renderResults(results) {
  resultsEl.innerHTML = '';
  results.forEach((r, i) => {
    if (!r.haiku) return;
    const card = makeCard(r, i);
    resultsEl.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')));
  });

  if (results.length > 0) {
    const regen = document.createElement('button');
    regen.className = 'regen-btn';
    regen.textContent = '↻ regenerate';
    regen.addEventListener('click', convert);
    resultsEl.after(regen);
  }
}

function makeCard(r, idx) {
  const { source, fullSource, haiku, tone: t } = r;
  const card = document.createElement('div');
  card.className = 'haiku-card';
  card.style.transitionDelay = `${idx * 0.08}s`;

  const fullText = `${haiku.line1}\n${haiku.line2}\n${haiku.line3}`;

  const sylBar = (count, total) => {
    const f = Math.min(count ?? total, total);
    return `<span class="syl-bar-filled">${'█'.repeat(f)}</span>${'░'.repeat(total - f)}`;
  };

  card.innerHTML = `
    ${source ? `<div class="haiku-source-bar">${esc(source)}${source.length >= 80 ? '…' : ''}</div>` : ''}
    <div class="haiku-body">
      ${[
        [haiku.line1, 5], [haiku.line2, 7], [haiku.line3, 5]
      ].map(([line, n]) => `
        <div class="haiku-line-row">
          <span class="haiku-line-num">${n}</span>
          <span class="haiku-line-text">${esc(line)}</span>
        </div>
      `).join('')}
      <div class="haiku-footer">
        <div class="syl-bars">
          ${[[haiku.s1??5,5],[haiku.s2??7,7],[haiku.s3??5,5]].map(([c,t2]) => `<span>${sylBar(c,t2)}</span>`).join('')}
        </div>
        <div class="card-actions">
          <button class="action-btn" data-copy="${esc(fullText)}">copy haiku</button>
          <button class="action-btn" data-save-image>share</button>
          <button class="action-btn" data-speak="${esc(fullText)}" data-speak-source="${esc(fullSource || source)}">read aloud</button>
        </div>
      </div>
    </div>
  `;

  card.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const orig = this.textContent;
      if (this.dataset.copy) {
        navigator.clipboard.writeText(this.dataset.copy + '\n\n-- frogpond.app').then(() => {
          this.textContent = '// copied!'; this.classList.add('ok');
          setTimeout(() => { this.textContent = orig; this.classList.remove('ok'); }, 1800);
        });
      } else if ('saveImage' in this.dataset) {
        saveHaikuImage(haiku, fullSource || source, this);
      } else if (this.dataset.speak) {
        speak(this.dataset.speak, this.dataset.speakSource, this);
      }
    });
  });

  return card;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(on) {
  loadingEl.classList.toggle('hidden', !on);
  convertBtn.disabled = on;
  if (!on) updateConvertBtn();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
