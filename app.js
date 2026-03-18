// ── IndexedDB for source images ──
const DB_NAME = 'frogpond';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeImage(id, base64, mime) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, base64, mime });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getImage(id) {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteImage(id) {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAllImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generateImageId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ── State ──
let mode = 'text';
let tone = 'sincere';
let imageB64 = null;
let imageMime = null;
let customImageB64 = null;
let customImageMime = null;
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
const tabCustom      = $('tab-custom');
const textPanel      = $('text-panel');
const imagePanel     = $('image-panel');
const customPanel    = $('custom-panel');
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
tabCustom.addEventListener('click', () => setMode('custom'));

function setMode(m) {
  mode = m;
  tabText.classList.toggle('active',  m === 'text');
  tabImage.classList.toggle('active', m === 'image');
  tabCustom.classList.toggle('active', m === 'custom');
  tabText.textContent  = m === 'text'   ? '> paste_text' : '  paste_text';
  tabImage.textContent = m === 'image'  ? '> screenshot'  : '  screenshot';
  tabCustom.textContent = m === 'custom' ? '> custom'      : '  custom';
  textPanel.classList.toggle('hidden',  m !== 'text');
  imagePanel.classList.toggle('hidden', m !== 'image');
  customPanel.classList.toggle('hidden', m !== 'custom');
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
    convertBtn.textContent = 'convert → haiku';
  } else if (mode === 'image') {
    convertBtn.disabled = !imageB64;
    convertBtn.textContent = 'convert → haiku';
  } else if (mode === 'custom') {
    const l1 = $('custom-line1').value.trim();
    const l2 = $('custom-line2').value.trim();
    const l3 = $('custom-line3').value.trim();
    convertBtn.disabled = !(l1 && l2 && l3);
    convertBtn.textContent = 'export → haiku';
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
    let imageType = null;
    const capturedImageB64 = imageB64;
    const capturedImageMime = imageMime;
    if (mode === 'custom') {
      const l1 = $('custom-line1').value.trim();
      const l2 = $('custom-line2').value.trim();
      const l3 = $('custom-line3').value.trim();
      const source = $('custom-source').value.trim();
      const haiku = { line1: l1, line2: l2, line3: l3, s1: 5, s2: 7, s3: 5 };
      results = [{
        source: source || '',
        fullSource: source || '',
        haiku,
        tone: tone,
        sourceImageB64: customImageB64 || null,
        sourceMime: customImageMime || null,
      }];
      if (window.posthog) {
        posthog.capture('haiku_custom', { has_source_image: !!customImageB64, has_source_text: !!source });
      }
    } else if (mode === 'text') {
      const text = tweetArea.value.trim();
      const haiku = await convertText(text);
      results = [{ source: text.slice(0, 80), fullSource: text, haiku, tone, sourceImageB64: null, sourceMime: null }];
    } else {
      imageType = await classifyImage(capturedImageB64, capturedImageMime);

      if (imageType === 'social') {
        results = await parseAndConvertImage(capturedImageB64, capturedImageMime);
        results.forEach(r => {
          r.sourceImageB64 = capturedImageB64;
          r.sourceMime = capturedImageMime;
        });
      } else {
        const haiku = await convertImage(capturedImageB64, capturedImageMime);
        results = [{
          source: 'image',
          fullSource: 'image',
          haiku,
          tone,
          sourceImageB64: capturedImageB64,
          sourceMime: capturedImageMime,
        }];
      }
    }
    await saveToHistory(results);
    if (window.posthog) {
      posthog.capture('haiku_converted', {
        mode: mode,
        tone: tone,
        haiku_count: results.length,
        image_type: imageType || null,
      });
    }
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
  const headers = { 'Content-Type': 'application/json' };
  if (localStorage.getItem('fp_admin') === 'true') {
    headers['x-frog-admin'] = 'ribbit';
  }

  const res = await fetch('/api/convert', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages,
    }),
  });

  if (res.status === 429) throw new Error('too many haiku, too fast.\nthe frog needs a moment.\ntry again shortly. 🐸');
  if (res.status === 500) throw new Error('server error — api key may not be configured.');
  if (!res.ok) throw new Error(`request failed (${res.status}). try again.`);

  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseJSON(raw) {
  try { return JSON.parse(raw.trim()); }
  catch { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
}

async function parseJSONWithRetry(raw, originalMessages, jsonFormat) {
  try {
    return parseJSON(raw);
  } catch {
    const retryRaw = await callClaude({
      system: `Your previous response was not valid JSON. Respond ONLY with raw JSON — no markdown, no backticks, no explanation, nothing else.\nFormat: ${jsonFormat}`,
      messages: [
        ...originalMessages,
        { role: 'assistant', content: raw },
        { role: 'user', content: 'That was not valid JSON. Please respond with ONLY the raw JSON object, nothing else.' }
      ],
    });
    return parseJSON(retryRaw);
  }
}

// ── Dictionary-based syllable check ──
async function checkSyllablesServer(haiku) {
  try {
    const res = await fetch('/api/syllables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [haiku.line1, haiku.line2, haiku.line3] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results;
  } catch {
    return null;
  }
}

// ── Syllable verification ──
async function verifyAndFixHaiku(haiku) {
  const verifyMessages = [{
    role: 'user',
    content: `Verify this haiku is exactly 5-7-5 syllables. Fix any line that's wrong.\n\nLine 1 (needs 5): "${haiku.line1}"\nLine 2 (needs 7): "${haiku.line2}"\nLine 3 (needs 5): "${haiku.line3}"`,
  }];
  const jsonFormat = '{"line1":"text","line2":"text","line3":"text","s1":<count>,"s2":<count>,"s3":<count>,"fixed":true/false}';
  const raw = await callClaude({
    system: `You are a syllable counting expert. Your ONLY job is to verify and fix haiku syllable counts.

TASK:
1. Count the syllables in each line by breaking every word into its syllable parts
2. If ALL lines are correct (5-7-5), return the haiku unchanged
3. If ANY line has the wrong count, rewrite ONLY that line to hit the target while preserving the meaning and tone as closely as possible

SYLLABLE COUNTING RULES:
- Break each word into spoken syllable parts: "or-e-gon" = 3, "an-oth-er" = 3, "beau-ty" = 2
- Silent e: "fire" = 1, "smile" = 1, "life" = 1, "love" = 1
- Common words: "every" = 3 (ev-er-y), "different" = 2 (dif-frent), "interesting" = 3 (in-trest-ing), "chocolate" = 3 (choc-o-late), "comfortable" = 3 (comf-ter-ble), "evening" = 2 (eve-ning), "family" = 3 (fam-i-ly), "several" = 3 (sev-er-al), "actually" = 4 (ac-tu-al-ly), "camera" = 3 (cam-er-a), "natural" = 3 (nat-ur-al)
- When in doubt, say the word aloud slowly and count the beats

Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: ${jsonFormat}

Set "fixed" to true if you changed any line, false if the original was correct.
All lines must be lowercase.`,
    messages: verifyMessages,
  });

  let verified;
  try {
    const result = await parseJSONWithRetry(raw, verifyMessages, jsonFormat);
    verified = {
      line1: result.line1 || haiku.line1,
      line2: result.line2 || haiku.line2,
      line3: result.line3 || haiku.line3,
      s1: result.s1 ?? 5,
      s2: result.s2 ?? 7,
      s3: result.s3 ?? 5,
    };
  } catch {
    console.warn('haiku verification failed, using original');
    verified = haiku;
  }

  // Dictionary-based syllable check
  const sylCheck = await checkSyllablesServer(verified);
  if (sylCheck) {
    verified.s1 = sylCheck[0].total;
    verified.s2 = sylCheck[1].total;
    verified.s3 = sylCheck[2].total;

    // Auto-rewrite if any line has wrong count
    const targets = [5, 7, 5];
    const wrong = sylCheck.map((s, i) => s.total !== targets[i] ? i : -1).filter(i => i !== -1);

    if (wrong.length > 0) {
      const fixPrompt = wrong.map(i => {
        const lineKey = ['line1', 'line2', 'line3'][i];
        return `Line ${i + 1} "${verified[lineKey]}" has ${sylCheck[i].total} syllables (needs ${targets[i]}). Rewrite it to exactly ${targets[i]} syllables while keeping the same meaning.`;
      }).join('\n');

      try {
        const fixRaw = await callClaude({
          system: `Fix the syllable counts in these haiku lines. Each word's syllable count has been verified by dictionary lookup — trust these counts. Rewrite ONLY the specified lines. Keep the tone and meaning. Respond ONLY with raw JSON: {"line1":"...","line2":"...","line3":"..."}. All lowercase.`,
          messages: [{ role: 'user', content: `Original haiku:\nLine 1: "${verified.line1}"\nLine 2: "${verified.line2}"\nLine 3: "${verified.line3}"\n\nProblems:\n${fixPrompt}\n\nProvide the corrected haiku with ALL three lines (keep correct lines unchanged).` }],
        });
        const fixed = parseJSON(fixRaw);

        // Re-check the fixed version
        const recheck = await checkSyllablesServer(fixed);
        if (recheck && recheck[0].total === 5 && recheck[1].total === 7 && recheck[2].total === 5) {
          verified.line1 = fixed.line1;
          verified.line2 = fixed.line2;
          verified.line3 = fixed.line3;
          verified.s1 = 5;
          verified.s2 = 7;
          verified.s3 = 5;
        }
      } catch {
        // Fix attempt failed — keep original, bars show actual counts
      }
    }
  }

  return verified;
}

// ── Text conversion ──
async function convertText(text) {
  const messages = [{ role: 'user', content: `Text: "${text}"` }];
  const jsonFormat = '{"line1":"text","line2":"text","line3":"text","s1":5,"s2":7,"s3":5}';
  const raw = await callClaude({
    system: `You are a haiku master. Convert the essence of this text into a perfect haiku (5-7-5 syllables).

VOCABULARY GUIDELINES:
- Avoid overusing these common poetic defaults: weep, weeping, cosmic, eternal, sacred, ancient, whisper, whispers, void, soul, divine, mortal, fate, silent, echo, tears, abyss, fleeting, destiny, beneath, descend, gentle, wisdom — they're not banned, but vary your word choices and reach for fresher alternatives when possible
- Prefer concrete, specific, surprising language over generic poetic filler
- Everyday words used in unexpected ways are more interesting than "poetic" vocabulary
- The best haiku feel like a joke, a punch line, or a sharp observation — not a greeting card
- Surprise the reader with the third line — subvert expectations

SYLLABLE COUNTING — THIS IS CRITICAL:
- Before finalizing, count the syllables in each line by breaking every word into syllable parts
- Common traps: "fire" = 1 syllable (not 2), "every" = 3 syllables, "poem" = 2, "real" = 1, "cruel" = 1, "orange" = 2, "chocolate" = 3, "comfortable" = 3, "different" = 2, "interesting" = 3 (not 4), "camera" = 3 (not 2), "natural" = 3 (not 2), "actually" = 4 (not 3), "valuable" = 3, "several" = 3 (not 2), "business" = 2, "evening" = 2 (not 3), "family" = 3 (not 2)
- Double-check: count each word's syllables individually, then sum per line
- Line 1 MUST equal exactly 5, line 2 MUST equal exactly 7, line 3 MUST equal exactly 5
- If a line doesn't hit the target, rewrite it until it does — do not submit a haiku with wrong counts

Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: ${jsonFormat}
All lines lowercase. ${TONES[tone]}`,
    messages,
  });
  const haiku = await parseJSONWithRetry(raw, messages, jsonFormat);
  return verifyAndFixHaiku(haiku);
}

// ── Image conversion ──
async function parseAndConvertImage(b64, mime) {
  const extractMessages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
      { type: 'text', text: 'Extract all posts from this screenshot.' }
    ]
  }];
  const extractFormat = '[{"author":"username or empty string","text":"full post text"},...]';
  const extractRaw = await callClaude({
    system: `Extract individual social media posts from a screenshot.
Respond ONLY with a raw JSON array — no markdown, no backticks.
Format: ${extractFormat}
Rules:
- Capture the COMPLETE text of each post — do not truncate or summarise
- Multi-line and multi-paragraph posts should be captured in full with newlines preserved
- Include all visible posts in order, top to bottom
- If a post is a reply, include it as a separate item
- Skip UI elements, timestamps, like counts — only post text and author
- If text is unreadable, skip that post entirely`,
    messages: extractMessages,
  });

  const posts = await parseJSONWithRetry(extractRaw, extractMessages, extractFormat);
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('no posts found in screenshot.');

  const batchMessages = [{ role: 'user', content: `Convert these:\n${JSON.stringify(posts.map(p => p.text))}` }];
  const batchFormat = '[{"line1":"text","line2":"text","line3":"text","s1":5,"s2":7,"s3":5},...]';
  const batchRaw = await callClaude({
    system: `You are a haiku master. Convert each post into a perfect haiku (5-7-5 syllables).

VOCABULARY GUIDELINES:
- Avoid overusing these common poetic defaults: weep, weeping, cosmic, eternal, sacred, ancient, whisper, whispers, void, soul, divine, mortal, fate, silent, echo, tears, abyss, fleeting, destiny, beneath, descend, gentle, wisdom — they're not banned, but vary your word choices and reach for fresher alternatives when possible
- Prefer concrete, specific, surprising language over generic poetic filler
- Everyday words used in unexpected ways are more interesting than "poetic" vocabulary
- The best haiku feel like a joke, a punch line, or a sharp observation — not a greeting card
- Surprise the reader with the third line — subvert expectations

SYLLABLE COUNTING — THIS IS CRITICAL:
- Before finalizing, count the syllables in each line by breaking every word into syllable parts
- Common traps: "fire" = 1 syllable (not 2), "every" = 3 syllables, "poem" = 2, "real" = 1, "cruel" = 1, "orange" = 2, "chocolate" = 3, "comfortable" = 3, "different" = 2, "interesting" = 3 (not 4), "camera" = 3 (not 2), "natural" = 3 (not 2), "actually" = 4 (not 3), "valuable" = 3, "several" = 3 (not 2), "business" = 2, "evening" = 2 (not 3), "family" = 3 (not 2)
- Double-check: count each word's syllables individually, then sum per line
- Line 1 MUST equal exactly 5, line 2 MUST equal exactly 7, line 3 MUST equal exactly 5
- If a line doesn't hit the target, rewrite it until it does — do not submit a haiku with wrong counts

Respond ONLY with a raw JSON array — no markdown, no backticks.
Format: ${batchFormat}
Same order as input. All lines lowercase. ${TONES[tone]}`,
    messages: batchMessages,
  });

  const haikus = await parseJSONWithRetry(batchRaw, batchMessages, batchFormat);
  if (!Array.isArray(haikus)) throw new Error('unexpected api response.');

  const verifiedHaikus = await Promise.all(
    haikus.map(h => h ? verifyAndFixHaiku(h) : null)
  );

  return posts.map((p, i) => ({
    source: (p.author ? `@${p.author}: ` : '') + p.text.slice(0, 80),
    fullSource: (p.author ? `@${p.author}: ` : '') + p.text,
    haiku: verifiedHaikus[i] || null,
    tone,
  })).filter(r => r.haiku);
}

// ── Image classification ──
async function classifyImage(b64, mime) {
  const raw = await callClaude({
    system: `Classify this image. Respond with ONLY one word: "social" if this is a screenshot of social media posts (tweets, Instagram, Reddit, Bluesky, Facebook, etc. with visible usernames, timestamps, like counts, or platform UI), or "general" for anything else (photos, memes, game screenshots, artwork, news headlines, etc.).
Respond with ONLY the single word "social" or "general". Nothing else.`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: 'Classify this image.' }
      ]
    }],
  });
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return cleaned === 'social' ? 'social' : 'general';
}

// ── General image → haiku ──
async function convertImage(b64, mime) {
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
      { type: 'text', text: 'Write a haiku about this image.' }
    ]
  }];
  const jsonFormat = '{"line1":"text","line2":"text","line3":"text","s1":5,"s2":7,"s3":5}';
  const raw = await callClaude({
    system: `You are a haiku master. Look at this image and write a perfect haiku (5-7-5 syllables) about what you see, feel, or find funny about it.

Don't describe the image literally — capture the feeling, the absurdity, the irony, or the beauty of the moment. React to it like a human would.

VOCABULARY GUIDELINES:
- Avoid overusing these common poetic defaults: weep, weeping, cosmic, eternal, sacred, ancient, whisper, whispers, void, soul, divine, mortal, fate, silent, echo, tears, abyss, fleeting, destiny, beneath, descend, gentle, wisdom — they're not banned, but vary your word choices and reach for fresher alternatives when possible
- Prefer concrete, specific, surprising language over generic poetic filler
- Everyday words used in unexpected ways are more interesting than "poetic" vocabulary
- The best haiku feel like a joke, a punch line, or a sharp observation — not a greeting card
- Surprise the reader with the third line — subvert expectations

SYLLABLE COUNTING — THIS IS CRITICAL:
- Before finalizing, count the syllables in each line by breaking every word into syllable parts
- Common traps: "fire" = 1 syllable (not 2), "every" = 3 syllables, "poem" = 2, "real" = 1, "cruel" = 1, "orange" = 2, "chocolate" = 3, "comfortable" = 3, "different" = 2, "interesting" = 3 (not 4), "camera" = 3 (not 2), "natural" = 3 (not 2), "actually" = 4 (not 3), "valuable" = 3, "several" = 3 (not 2), "business" = 2, "evening" = 2 (not 3), "family" = 3 (not 2)
- Double-check: count each word's syllables individually, then sum per line
- Line 1 MUST equal exactly 5, line 2 MUST equal exactly 7, line 3 MUST equal exactly 5
- If a line doesn't hit the target, rewrite it until it does — do not submit a haiku with wrong counts

Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: ${jsonFormat}
All lines lowercase. ${TONES[tone]}`,
    messages,
  });
  const haiku = await parseJSONWithRetry(raw, messages, jsonFormat);
  return verifyAndFixHaiku(haiku);
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

  // ── Fixed bottom: frog + branding ──
  const frogLines = ['  @..@  ', ' (----) ', '( >__< )', ' ^^  ^^ '];
  const frogFontSize = 14;
  const frogLineH = 17;
  const frogBlockH = frogLines.length * frogLineH;
  const brandGap = 16;
  ctx.font = `${frogFontSize}px ${mono}`;
  let frogW = 0;
  frogLines.forEach(line => { frogW = Math.max(frogW, ctx.measureText(line).width); });
  ctx.font = `20px ${mono}`;
  const brandText = 'frogpond.lol';
  const brandW = ctx.measureText(brandText).width;
  const unitW = frogW + brandGap + brandW;
  const unitX = (W - unitW) / 2;
  const frogTopY = H - 60 - frogBlockH;
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = accent;
  ctx.font = `${frogFontSize}px ${mono}`;
  ctx.textBaseline = 'top';
  frogLines.forEach((line, i) => {
    ctx.fillText(line, unitX, frogTopY + i * frogLineH);
  });
  ctx.restore();
  ctx.font = `20px ${mono}`;
  ctx.fillStyle = dim;
  ctx.textBaseline = 'middle';
  ctx.fillText(brandText, unitX + frogW + brandGap, frogTopY + frogBlockH / 2);

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

// ── Contrast image generation ──
async function generateContrastImage(haiku, source, sourceImageB64, sourceMime, preview) {
  await document.fonts.ready;

  const W = preview ? 540 : 1080;
  const scale = W / 1080;
  const PAD = Math.round(40 * scale);
  const INNER_W = W - 2 * PAD;
  const mono = "'Courier New', monospace";
  const serif = "'IM Fell English', Georgia, serif";

  const bg = '#f7f3ea', surface = '#f0ebe0', border = '#c8bfa8';
  const dim = '#887050', mid = '#554430', text = '#2c2418';
  const accent = '#4a6a30', green = '#3a6020';

  // Load source image if available
  let srcImg = null;
  let srcDrawW = 0, srcDrawH = 0;
  if (sourceImageB64 && sourceMime) {
    srcImg = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'data:' + sourceMime + ';base64,' + sourceImageB64;
    });
    const maxH = Math.round(700 * scale);
    const ratio = Math.min(INNER_W / srcImg.naturalWidth, maxH / srcImg.naturalHeight);
    srcDrawW = Math.round(srcImg.naturalWidth * ratio);
    srcDrawH = Math.round(srcImg.naturalHeight * ratio);
  }

  // Measure source text lines for text mode
  let srcTextLines = [];
  if (!srcImg && source) {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = W; tmpCanvas.height = 100;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.font = `${Math.round(18 * scale)}px ${mono}`;
    const maxTW = INNER_W - Math.round(30 * scale);
    const prefix = '// ';
    const prefixW = tmpCtx.measureText(prefix).width;
    const words = source.split(' ');
    let cur = '';
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      const lw = (srcTextLines.length === 0 ? prefixW : 0) + tmpCtx.measureText(test).width;
      if (lw > maxTW && cur) { srcTextLines.push(cur); if (srcTextLines.length === 3) { cur = ''; break; } cur = word; }
      else cur = test;
    }
    if (cur && srcTextLines.length < 3) srcTextLines.push(cur);
  }

  // Calculate haiku card dimensions
  const barH = Math.round(30 * scale);
  const lineH = Math.round(55 * scale);
  const haikuPadTop = Math.round(25 * scale);
  const haikuPadBot = Math.round(20 * scale);
  const sylH = Math.round(30 * scale);
  const cardH = barH + haikuPadTop + 3 * lineH + Math.round(15 * scale) + sylH + haikuPadBot;

  const arrowGap = Math.round(30 * scale);
  const brandH = Math.round(60 * scale);

  let srcSectionH = 0;
  if (srcImg) {
    srcSectionH = srcDrawH + Math.round(2 * scale);
  } else if (srcTextLines.length > 0) {
    srcSectionH = Math.round((srcTextLines.length * 22 + 20) * scale);
  }

  const totalH = PAD + srcSectionH + arrowGap + cardH + brandH;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, totalH);

  let y = PAD;

  // Draw source
  if (srcImg) {
    const imgX = PAD + (INNER_W - srcDrawW) / 2;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(imgX - 0.5, y - 0.5, srcDrawW + 1, srcDrawH + 1);
    ctx.drawImage(srcImg, imgX, y, srcDrawW, srcDrawH);
    y += srcDrawH;
  } else if (srcTextLines.length > 0) {
    const boxPad = Math.round(15 * scale);
    const boxH = srcSectionH;
    ctx.fillStyle = surface;
    ctx.fillRect(PAD, y, INNER_W, boxH);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD + 0.5, y + 0.5, INNER_W - 1, boxH - 1);
    ctx.font = `${Math.round(18 * scale)}px ${mono}`;
    ctx.fillStyle = dim;
    ctx.textBaseline = 'top';
    srcTextLines.forEach((line, i) => {
      ctx.fillText(i === 0 ? '// ' + line : line, PAD + boxPad, y + boxPad + i * Math.round(22 * scale));
    });
    y += boxH;
  }

  // Arrow
  y += arrowGap / 2;
  ctx.font = `${Math.round(20 * scale)}px ${mono}`;
  ctx.fillStyle = border;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('↓', W / 2, y);
  ctx.textAlign = 'left';
  y += arrowGap / 2;

  // Haiku card
  const cardX = PAD;
  const cardW = INNER_W;
  ctx.fillStyle = surface;
  ctx.fillRect(cardX, y, cardW, cardH);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, y + 0.5, cardW - 1, cardH - 1);

  // Top bar
  ctx.fillStyle = 'rgba(0,0,0,0.02)';
  ctx.fillRect(cardX + 1, y + 1, cardW - 2, barH - 1);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(cardX, y + barH);
  ctx.lineTo(cardX + cardW, y + barH);
  ctx.stroke();
  ctx.font = `${Math.round(12 * scale)}px ${mono}`;
  ctx.fillStyle = dim;
  ctx.textBaseline = 'middle';
  ctx.fillText('output.haiku', cardX + Math.round(10 * scale), y + barH / 2);
  ctx.fillStyle = green;
  const checkText = '✓ generated';
  const checkW = ctx.measureText(checkText).width;
  ctx.fillText(checkText, cardX + cardW - checkW - Math.round(10 * scale), y + barH / 2);

  y += barH + haikuPadTop;

  // Haiku lines
  const LEFT = cardX + Math.round(15 * scale);
  const TEXT_LEFT = cardX + Math.round(45 * scale);
  [[haiku.line1, 5], [haiku.line2, 7], [haiku.line3, 5]].forEach(([line, syl]) => {
    ctx.font = `${Math.round(18 * scale)}px ${mono}`;
    ctx.fillStyle = dim;
    ctx.textBaseline = 'top';
    ctx.fillText(String(syl), LEFT, y + Math.round(12 * scale));
    ctx.font = `italic ${Math.round(40 * scale)}px ${serif}`;
    ctx.fillStyle = text;
    ctx.fillText(line, TEXT_LEFT, y);
    y += lineH;
  });

  // Separator
  y += Math.round(5 * scale);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(cardX + Math.round(10 * scale), y);
  ctx.lineTo(cardX + cardW - Math.round(10 * scale), y);
  ctx.stroke();
  y += Math.round(10 * scale);

  // Syllable bars
  ctx.font = `${Math.round(14 * scale)}px ${mono}`;
  ctx.textBaseline = 'top';
  let barX = LEFT;
  [[haiku.s1 ?? 5, 5], [haiku.s2 ?? 7, 7], [haiku.s3 ?? 5, 5]].forEach(([count, total], i) => {
    const filled = Math.min(count ?? total, total);
    const filledStr = '█'.repeat(filled);
    const unfilledStr = '░'.repeat(total - filled);
    ctx.fillStyle = accent;
    ctx.fillText(filledStr, barX, y);
    ctx.fillStyle = border;
    ctx.fillText(unfilledStr, barX + ctx.measureText(filledStr).width, y);
    if (i < 2) barX += ctx.measureText(filledStr + unfilledStr).width + Math.round(20 * scale);
  });

  // Branding
  const brandY = totalH - brandH / 2;
  ctx.font = `${Math.round(16 * scale)}px ${mono}`;
  ctx.fillStyle = dim;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('frogpond.lol', W / 2, brandY);
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── Carousel slides ──
async function generateCarouselSlides(haiku, source, sourceImageB64, sourceMime) {
  await document.fonts.ready;

  const W = 1080, H = 1080;
  const mono = "'Courier New', monospace";
  const bg = '#f7f3ea', border = '#c8bfa8', dim = '#887050', surface = '#f0ebe0';

  // Slide 1: Source
  const c1 = document.createElement('canvas');
  c1.width = W; c1.height = H;
  const ctx1 = c1.getContext('2d');
  ctx1.fillStyle = bg;
  ctx1.fillRect(0, 0, W, H);
  ctx1.strokeStyle = border;
  ctx1.lineWidth = 1;
  ctx1.strokeRect(0.5, 0.5, W - 1, H - 1);

  if (sourceImageB64 && sourceMime) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = 'data:' + sourceMime + ';base64,' + sourceImageB64;
    });
    const pad = 60;
    const maxW = W - 2 * pad, maxH = H - 2 * pad;
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dw = Math.round(img.naturalWidth * ratio);
    const dh = Math.round(img.naturalHeight * ratio);
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx1.strokeStyle = border;
    ctx1.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1);
    ctx1.drawImage(img, dx, dy, dw, dh);
  } else if (source) {
    // Text mode: render source text centered
    ctx1.font = `20px ${mono}`;
    ctx1.fillStyle = dim;
    ctx1.textBaseline = 'middle';
    ctx1.textAlign = 'center';
    const words = source.split(' ');
    const lines = [];
    let cur = '';
    const maxTW = W - 200;
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx1.measureText(test).width > maxTW && cur) { lines.push(cur); if (lines.length >= 5) { cur = ''; break; } cur = word; }
      else cur = test;
    }
    if (cur && lines.length < 5) lines.push(cur);
    const lineH = 32;
    const startY = H / 2 - (lines.length * lineH) / 2;
    ctx1.fillStyle = surface;
    const boxPad = 30;
    const boxH = lines.length * lineH + 2 * boxPad;
    ctx1.fillRect(80, startY - boxPad, W - 160, boxH);
    ctx1.strokeStyle = border;
    ctx1.strokeRect(80.5, startY - boxPad + 0.5, W - 161, boxH - 1);
    ctx1.fillStyle = dim;
    lines.forEach((line, i) => {
      ctx1.fillText(i === 0 ? '// ' + line : line, W / 2, startY + i * lineH + lineH / 2);
    });
    ctx1.textAlign = 'left';
  }

  const slide1 = await new Promise(resolve => c1.toBlob(resolve, 'image/png'));

  // Slide 2: Haiku (reuse existing function)
  const slide2 = await generateHaikuImage(haiku, source);

  return [slide1, slide2];
}

// ── Export handler ──
async function handleExport(format, resultData, action) {
  let blob;
  let filename = 'haiku-frogpond.png';

  if (format === 'card') {
    blob = await generateHaikuImage(resultData.haiku, resultData.source);
  } else if (format === 'contrast') {
    blob = await generateContrastImage(
      resultData.haiku, resultData.source,
      resultData.sourceImageB64, resultData.sourceMime, false
    );
    filename = 'haiku-contrast-frogpond.png';
  } else if (format === 'carousel') {
    const slides = await generateCarouselSlides(
      resultData.haiku, resultData.source,
      resultData.sourceImageB64, resultData.sourceMime
    );

    if (action === 'share' && navigator.share && navigator.canShare) {
      const files = [
        new File([slides[0]], 'source-frogpond.png', { type: 'image/png' }),
        new File([slides[1]], 'haiku-frogpond.png', { type: 'image/png' }),
      ];
      if (navigator.canShare({ files })) {
        await navigator.share({ files, title: 'haiku — frogpond.lol' });
        return;
      }
    }
    // Download both
    for (let i = 0; i < slides.length; i++) {
      const url = URL.createObjectURL(slides[i]);
      const a = document.createElement('a');
      a.href = url;
      a.download = i === 0 ? 'source-frogpond.png' : 'haiku-frogpond.png';
      a.click();
      URL.revokeObjectURL(url);
    }
    return;
  }

  if (action === 'share' && navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'haiku — frogpond.lol' });
      return;
    }
  }
  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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

async function saveToHistory(results) {
  const hist = getHistory();
  const ts = Date.now();

  for (const r of results) {
    if (!r.haiku) continue;

    let imageId = null;
    if (r.sourceImageB64) {
      imageId = generateImageId();
      try {
        await storeImage(imageId, r.sourceImageB64, r.sourceMime);
      } catch (e) {
        console.warn('failed to store image in IndexedDB:', e);
        imageId = null;
      }
    }

    hist.unshift({
      haiku: r.haiku,
      source: r.source,
      fullSource: r.fullSource || r.source,
      tone: r.tone,
      ts,
      imageId,
    });
  }

  // Clean up images from entries that fell off the history
  const removed = hist.slice(MAX_HISTORY);
  for (const old of removed) {
    if (old.imageId) {
      try { await deleteImage(old.imageId); } catch (e) { /* ignore */ }
    }
  }

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

    el.addEventListener('click', async () => {
      // Load source image from IndexedDB if available
      let sourceImageB64 = null;
      let sourceMime = null;
      if (item.imageId) {
        try {
          const imgData = await getImage(item.imageId);
          if (imgData) {
            sourceImageB64 = imgData.base64;
            sourceMime = imgData.mime;
          }
        } catch (e) {
          console.warn('failed to load image from IndexedDB:', e);
        }
      }

      // Render as a result card with export panel
      resultsEl.innerHTML = '';
      document.querySelector('.regen-btn')?.remove();

      const result = {
        source: item.source,
        fullSource: item.fullSource || item.source,
        haiku: { ...item.haiku },
        tone: item.tone,
        sourceImageB64,
        sourceMime,
      };

      const card = makeCard(result, 0);
      resultsEl.appendChild(card);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')));

      // Scroll to results
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    historyList.appendChild(el);
  });
}

historyClear.addEventListener('click', async () => {
  localStorage.removeItem('fp_history');
  try { await clearAllImages(); } catch (e) { /* ignore */ }
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
  const { source, fullSource, haiku, tone: t, sourceImageB64: srcB64, sourceMime: srcMime } = r;
  const card = document.createElement('div');
  card.className = 'haiku-card';
  card.style.transitionDelay = `${idx * 0.08}s`;

  const fullText = `${haiku.line1}\n${haiku.line2}\n${haiku.line3}`;
  const hasImage = !!srcB64;
  const defaultFormat = hasImage ? 'contrast' : 'card';

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
          <span class="haiku-line-text" contenteditable="true" spellcheck="false">${esc(line)}</span>
        </div>
      `).join('')}
      <div class="haiku-footer">
        <div class="syl-bars">
          ${[[haiku.s1??5,5],[haiku.s2??7,7],[haiku.s3??5,5]].map(([c,t2]) => `<span>${sylBar(c,t2)}</span>`).join('')}
        </div>
        <div class="card-actions">
          <button class="action-btn" data-copy="${esc(fullText)}">copy haiku</button>
          <button class="action-btn" data-export>export ↓</button>
          <button class="action-btn" data-speak="${esc(fullText)}" data-speak-source="${esc(fullSource || source)}">read aloud</button>
        </div>
      </div>
    </div>
    <div class="share-panel hidden">
      <div class="share-formats">
        <button class="share-fmt-btn${defaultFormat === 'contrast' ? ' active' : ''}" data-format="contrast">contrast</button>
        <button class="share-fmt-btn${defaultFormat === 'card' ? ' active' : ''}" data-format="card">haiku only</button>
        <button class="share-fmt-btn" data-format="carousel">carousel</button>
      </div>
      <div class="share-preview"></div>
      <div class="share-actions-row">
        <button class="share-download-btn">download</button>
        <button class="share-native-btn">share</button>
      </div>
    </div>
  `;

  const resultData = { haiku, source: fullSource || source, sourceImageB64: srcB64, sourceMime: srcMime };
  const panel = card.querySelector('.share-panel');
  let currentFormat = defaultFormat;

  // Generate preview at half resolution
  async function updatePreview() {
    const previewEl = panel.querySelector('.share-preview');
    previewEl.innerHTML = '<span style="color:var(--dim);font-size:12px">generating...</span>';
    try {
      let blob;
      if (currentFormat === 'card') {
        blob = await generateHaikuImage(haiku, resultData.source);
      } else if (currentFormat === 'contrast') {
        blob = await generateContrastImage(haiku, resultData.source, srcB64, srcMime, true);
      } else if (currentFormat === 'carousel') {
        blob = await generateContrastImage(haiku, resultData.source, srcB64, srcMime, true);
      }
      const url = URL.createObjectURL(blob);
      previewEl.innerHTML = `<img src="${url}" alt="preview" />`;
    } catch {
      previewEl.innerHTML = '<span style="color:var(--red);font-size:12px">preview failed</span>';
    }
  }

  // Format buttons
  panel.querySelectorAll('.share-fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.share-fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFormat = btn.dataset.format;
      updatePreview();
    });
  });

  // Download button
  panel.querySelector('.share-download-btn').addEventListener('click', async function() {
    const btn = this;
    btn.textContent = '// generating...'; btn.classList.add('ok');
    try {
      if (window.posthog) posthog.capture('haiku_shared', { tone: t, method: 'download', format: currentFormat });
      await handleExport(currentFormat, resultData, 'download');
      btn.textContent = '// done!';
      setTimeout(() => { btn.textContent = 'download'; btn.classList.remove('ok'); }, 1800);
    } catch { btn.textContent = 'download'; btn.classList.remove('ok'); }
  });

  // Share button
  panel.querySelector('.share-native-btn').addEventListener('click', async function() {
    const btn = this;
    btn.textContent = '// sharing...'; btn.classList.add('ok');
    try {
      if (window.posthog) posthog.capture('haiku_shared', { tone: t, method: 'native_share', format: currentFormat });
      await handleExport(currentFormat, resultData, 'share');
      btn.textContent = '// shared!';
      setTimeout(() => { btn.textContent = 'share'; btn.classList.remove('ok'); }, 1800);
    } catch { btn.textContent = 'share'; btn.classList.remove('ok'); }
  });

  // Editable haiku lines — sync back to result data
  const lineSpans = card.querySelectorAll('.haiku-line-text');
  lineSpans[0].addEventListener('input', () => { r.haiku.line1 = lineSpans[0].textContent.trim(); });
  lineSpans[1].addEventListener('input', () => { r.haiku.line2 = lineSpans[1].textContent.trim(); });
  lineSpans[2].addEventListener('input', () => { r.haiku.line3 = lineSpans[2].textContent.trim(); });

  // Paste handler — plain text only
  lineSpans.forEach(span => {
    span.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  card.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const orig = this.textContent;
      if (this.dataset.copy) {
        navigator.clipboard.writeText(this.dataset.copy + '\n\n-- frogpond.lol').then(() => {
          this.textContent = '// copied!'; this.classList.add('ok');
          setTimeout(() => { this.textContent = orig; this.classList.remove('ok'); }, 1800);
          if (window.posthog) posthog.capture('haiku_copied');
        });
      } else if ('export' in this.dataset) {
        const isOpen = !panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        this.textContent = isOpen ? 'export ↓' : 'export ↑';
        if (!isOpen) updatePreview();
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

// ── Syllable counter (soft indicator) ──
function countSyllables(text) {
  if (!text || !text.trim()) return 0;
  const words = text.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  let total = 0;
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, '');
    if (!clean) continue;
    let count = (clean.match(/[aeiouy]+/g) || []).length;
    if (clean.endsWith('e') && count > 1 && !clean.endsWith('le')) count--;
    if (count < 1) count = 1;
    total += count;
  }
  return total;
}

function updateSylCount(inputEl, countEl, target) {
  const text = inputEl.value.trim();
  if (!text) {
    countEl.textContent = '';
    countEl.className = 'syl-count empty';
    return;
  }
  const count = countSyllables(text);
  if (count === target) {
    countEl.textContent = count + '/' + target + ' ✓';
    countEl.className = 'syl-count ok';
  } else {
    countEl.textContent = count + '/' + target + ' ⚠';
    countEl.className = 'syl-count warn';
  }
}

let sylDebounceTimer = null;

function updateSylCountAsync(inputEl, countEl, target) {
  const text = inputEl.value.trim();
  if (!text) {
    countEl.textContent = '';
    countEl.className = 'syl-count empty';
    return;
  }

  // Show loading state
  countEl.textContent = '...';
  countEl.className = 'syl-count empty';

  clearTimeout(sylDebounceTimer);
  sylDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/syllables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: [text] }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const count = data.results[0].total;

      if (inputEl.value.trim() === text) {
        if (count === target) {
          countEl.textContent = count + '/' + target + ' ✓';
          countEl.className = 'syl-count ok';
        } else {
          countEl.textContent = count + '/' + target + ' ⚠';
          countEl.className = 'syl-count warn';
        }
      }
    } catch {
      // Fall back to client-side heuristic
      const count = countSyllables(text);
      if (inputEl.value.trim() === text) {
        countEl.textContent = '~' + count + '/' + target;
        countEl.className = count === target ? 'syl-count ok' : 'syl-count warn';
      }
    }
  }, 400);
}

// ── Custom mode wiring ──
const customDropzone = $('custom-dropzone');
const customFileInput = $('custom-file-input');
const customPreviewWrap = $('custom-preview-wrap');
const customPreviewImg = $('custom-preview-img');
const customClearImg = $('custom-clear-img');
const customImgStatus = $('custom-img-status');

customDropzone.addEventListener('dragover', e => { e.preventDefault(); customDropzone.classList.add('drag-over'); });
customDropzone.addEventListener('dragleave', () => customDropzone.classList.remove('drag-over'));
customDropzone.addEventListener('drop', e => { e.preventDefault(); customDropzone.classList.remove('drag-over'); handleCustomFile(e.dataTransfer.files[0]); });
customFileInput.addEventListener('change', () => handleCustomFile(customFileInput.files[0]));

customClearImg.addEventListener('click', () => {
  customImageB64 = null; customImageMime = null;
  customPreviewWrap.classList.add('hidden');
  customDropzone.classList.remove('hidden');
  customFileInput.value = '';
  customImgStatus.textContent = 'no file';
  customImgStatus.className = '';
});

function handleCustomFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  customImageMime = file.type;
  const reader = new FileReader();
  reader.onload = e => {
    const url = e.target.result;
    customImageB64 = url.split(',')[1];
    customPreviewImg.src = url;
    customPreviewWrap.classList.remove('hidden');
    customDropzone.classList.add('hidden');
    customImgStatus.textContent = file.name.slice(0, 20) + (file.name.length > 20 ? '…' : '');
    customImgStatus.className = 'status-ok';
  };
  reader.readAsDataURL(file);
}

// Custom line input listeners
$('custom-line1').addEventListener('input', () => {
  updateSylCountAsync($('custom-line1'), $('syl-count-1'), 5);
  updateConvertBtn();
});
$('custom-line2').addEventListener('input', () => {
  updateSylCountAsync($('custom-line2'), $('syl-count-2'), 7);
  updateConvertBtn();
});
$('custom-line3').addEventListener('input', () => {
  updateSylCountAsync($('custom-line3'), $('syl-count-3'), 5);
  updateConvertBtn();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
