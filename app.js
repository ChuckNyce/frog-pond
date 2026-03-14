// ── State ──
let mode = 'text';
let tone = 'sincere';
let imageB64 = null;
let imageMime = null;
const MAX_HISTORY = 30;

// ── Speech ──
let speaking = false;

function speak(text, btn) {
  if (!window.speechSynthesis) return;

  // If already speaking, stop
  if (speaking) {
    window.speechSynthesis.cancel();
    speaking = false;
    // Reset all speak buttons
    document.querySelectorAll('.action-btn[data-speak]').forEach(b => {
      b.textContent = 'read --aloud';
      b.classList.remove('ok');
    });
    if (btn.dataset.speak === text) return; // tapped same button = just stop
  }

  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.88;   // slightly slow — more gravitas
  utt.pitch = 1.0;
  utt.volume = 1;

  // Pick a voice: prefer a dull neutral English one for maximum robo energy
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'))
  ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (preferred) utt.voice = preferred;

  utt.onstart = () => {
    speaking = true;
    if (btn) { btn.textContent = '// reading...'; btn.classList.add('ok'); }
  };
  utt.onend = utt.onerror = () => {
    speaking = false;
    if (btn) { btn.textContent = 'read --aloud'; btn.classList.remove('ok'); }
  };

  window.speechSynthesis.speak(utt);
}

const TONES = {
  sincere: 'Treat the content with genuine sincerity and real emotional weight.',
  absurd:  'Make it hilariously absurd — elevate mundane things into cosmic tragedy. Go weird.',
  poetic:  'Find hidden beauty and quiet melancholy, like a classic Japanese poet. Wabi-sabi.',
};

// ── DOM ──
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

// ── Init ──
function init() {
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
  });
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
      results = [{ source: text.slice(0, 80), haiku, tone }];
    } else {
      results = await parseAndConvertImage(imageB64, imageMime);
    }
    saveToHistory(results);
    renderResults(results);
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
Format: [{"author":"username or empty","text":"post text"},...]
Include all visible posts top to bottom. Skip unreadable text.`,
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
    haiku: haikus[i] || null,
    tone,
  })).filter(r => r.haiku);
}

// ── Share URL ──
function makeShareUrl(haiku, source, t) {
  const payload = {
    line1: haiku.line1, line2: haiku.line2, line3: haiku.line3,
    s1: haiku.s1, s2: haiku.s2, s3: haiku.s3,
    source, tone: t
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${location.origin}/share.html?h=${encoded}`;
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
    regen.textContent = '// retry';
    regen.addEventListener('click', convert);
    resultsEl.after(regen);
  }
}

function makeCard(r, idx) {
  const { source, haiku, tone: t } = r;
  const card = document.createElement('div');
  card.className = 'haiku-card';
  card.style.transitionDelay = `${idx * 0.08}s`;

  const shareUrl = makeShareUrl(haiku, source, t);
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
          <button class="action-btn" data-copy="${esc(fullText)}">cp ./haiku</button>
          <button class="action-btn" data-url="${esc(shareUrl)}">share --link</button>
          <button class="action-btn" data-speak="${esc(fullText)}" data-speak-source="${esc(source)}">read --aloud</button>
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
      } else if (this.dataset.url) {
        navigator.clipboard.writeText(this.dataset.url).then(() => {
          this.textContent = '// link copied!'; this.classList.add('ok');
          setTimeout(() => { this.textContent = orig; this.classList.remove('ok'); }, 1800);
        });
      } else if (this.dataset.speak) {
        // Read the original source tweet, then the haiku — comedy timing
        const tweet = this.dataset.speakSource;
        const haiku = this.dataset.speak;
        const script = tweet
          ? `${tweet} ... ... ${haiku}`
          : haiku;
        speak(script, this);
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
