#!/usr/bin/env node

/**
 * Frog Pond Daily Haiku Automation
 *
 * Fetches trending news, generates haikus via Claude,
 * renders card images via node-canvas, and pushes to Buffer Ideas.
 *
 * Usage:
 *   node automation/daily-haiku.js
 *
 * Environment variables:
 *   NEWSAPI_KEY       - NewsAPI.org API key
 *   ANTHROPIC_API_KEY - Claude API key
 *   BUFFER_API_KEY    - Buffer API key (Bash0 account)
 *
 * Optional:
 *   HAIKU_COUNT       - Number of haikus to generate (default: 5)
 *   TONE              - "absurd" | "sincere" | "poetic" (default: weighted random, 80% absurd)
 */

const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

// ── Register bundled fonts (needed for CI/GitHub Actions) ───────────────────
const fontsDir = path.join(__dirname, "fonts");
GlobalFonts.registerFromPath(path.join(fontsDir, "CourierPrime-Regular.ttf"));
GlobalFonts.registerFromPath(path.join(fontsDir, "CourierPrime-Bold.ttf"));
GlobalFonts.registerFromPath(path.join(fontsDir, "LiberationSerif-Regular.ttf"));
GlobalFonts.registerFromPath(path.join(fontsDir, "LiberationSerif-Italic.ttf"));

// ── Config ──────────────────────────────────────────────────────────────────

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const HAIKU_COUNT = parseInt(process.env.HAIKU_COUNT || "5", 10);

if (!NEWSAPI_KEY || !ANTHROPIC_API_KEY || !BUFFER_API_KEY) {
  console.error(
    "Missing required env vars: NEWSAPI_KEY, ANTHROPIC_API_KEY, BUFFER_API_KEY"
  );
  process.exit(1);
}

// ── Syllable counting (ported from api/syllables.js) ────────────────────────

const dict = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "cmu-syllables.json"), "utf8")
);

function heuristicCount(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const exceptions = {
    fire: 1, hire: 1, wire: 1, tire: 1, dire: 1,
    our: 1, hour: 1, their: 1, there: 1, where: 1,
    were: 1, here: 1, mere: 1, the: 1, are: 1,
    world: 1, girl: 1, pearl: 1, curl: 1, swirl: 1,
  };
  if (exceptions[w]) return exceptions[w];
  let count = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  if (
    w.endsWith("ed") &&
    !w.endsWith("ted") &&
    !w.endsWith("ded") &&
    count > 1
  )
    count--;
  return Math.max(1, count);
}

function countWord(word) {
  const clean = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!clean) return 0;
  const lookup = clean.replace(/'s$/, "").replace(/'$/, "");
  if (dict[lookup] !== undefined) return dict[lookup];
  return heuristicCount(lookup);
}

function countLine(line) {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return words.reduce((sum, w) => sum + countWord(w), 0);
}

function verifySyllables(haiku) {
  return {
    s1: countLine(haiku.line1),
    s2: countLine(haiku.line2),
    s3: countLine(haiku.line3),
    valid:
      countLine(haiku.line1) === 5 &&
      countLine(haiku.line2) === 7 &&
      countLine(haiku.line3) === 5,
  };
}

// ── Tone system ─────────────────────────────────────────────────────────────

const TONES = {
  absurd:
    "Make it hilariously absurd — elevate mundane things into cosmic tragedy. Go weird. Subvert expectations. The haiku should make someone snort-laugh.",
  sincere:
    "Treat the content with genuine sincerity and real emotional weight. Find the human truth in it.",
  poetic:
    "Find hidden beauty and quiet melancholy, like a classic Japanese poet. Wabi-sabi. The fleeting nature of things.",
};

function pickTone() {
  // 80% absurd, 10% sincere, 10% poetic
  const r = Math.random();
  if (r < 0.8) return "absurd";
  if (r < 0.9) return "sincere";
  return "poetic";
}

// ── Fetch trending topics ───────────────────────────────────────────────────

// Topics to avoid — politics, tragedies, violence
const SKIP_KEYWORDS = [
  "kill", "dead", "death", "murder", "shoot", "attack", "war", "bomb",
  "strike", "troops", "military", "missile", "hostage", "victim",
  "trump", "biden", "democrat", "republican", "senate", "congress",
  "election", "politician", "gop", "liberal", "conservative",
  "tragedy", "disaster", "massacre", "genocide", "terror",
  "crash", "fatal", "suicide", "abuse",
];

function shouldSkipTopic(article) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  return SKIP_KEYWORDS.some((kw) => text.includes(kw));
}

async function fetchTrendingTopics(count) {
  // Fetch from tech, science, entertainment, and general — skip politics
  const categories = ["technology", "science", "entertainment", "general"];
  const allArticles = [];

  for (const category of categories) {
    const url = `https://newsapi.org/v2/top-headlines?country=us&category=${category}&pageSize=${count * 2}&apiKey=${NEWSAPI_KEY}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    if (data.articles) allArticles.push(...data.articles);
  }

  // Also try "everything" for tech/gaming/AI
  const everythingUrl = `https://newsapi.org/v2/everything?q=(AI OR gaming OR "video games" OR tech OR weird OR bizarre)&language=en&sortBy=publishedAt&pageSize=${count * 3}&apiKey=${NEWSAPI_KEY}`;
  const evRes = await fetch(everythingUrl);
  if (evRes.ok) {
    const evData = await evRes.json();
    if (evData.articles) allArticles.push(...evData.articles);
  }

  // Filter, deduplicate, skip politics/tragedies
  const seen = new Set();
  const filtered = allArticles
    .filter((a) => a.title && a.title !== "[Removed]" && a.description)
    .filter((a) => !shouldSkipTopic(a))
    .filter((a) => {
      const key = a.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Shuffle and pick
  const shuffled = filtered.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);

  return picked.map((a) => ({
    title: a.title,
    description: a.description,
    source: a.source?.name || "Unknown",
    url: a.url,
  }));
}

// ── Generate haiku via Claude ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a haiku master for frogpond.lol. You convert trending news into haikus.

STRICT RULES:
- Line 1: exactly 5 syllables
- Line 2: exactly 7 syllables
- Line 3: exactly 5 syllables
- Count carefully. Verify each line before responding.
- Respond ONLY with valid JSON: {"line1":"...","line2":"...","line3":"..."}
- No markdown, no explanation, just the JSON object.
- Use lowercase for all lines unless a proper noun.
- Be clever. Find the unexpected angle. Don't just summarize — react.`;

async function generateHaiku(topic, tone) {
  const toneInstruction = TONES[tone];
  const userMessage = `Tone: ${toneInstruction}

News headline: "${topic.title}"
Context: ${topic.description}

Write a haiku about this. Remember: 5-7-5 syllables, strictly.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content[0].text.trim();

  // Parse JSON response
  const haiku = JSON.parse(text);

  // Verify and attach syllable counts
  const counts = verifySyllables(haiku);
  haiku.s1 = counts.s1;
  haiku.s2 = counts.s2;
  haiku.s3 = counts.s3;

  return haiku;
}

async function generateHaikuWithRetry(topic, tone, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const haiku = await generateHaiku(topic, tone);
      const counts = verifySyllables(haiku);

      if (counts.valid) {
        return haiku;
      }

      if (attempt < maxRetries) {
        console.log(
          `  Syllable mismatch (${counts.s1}/${counts.s2}/${counts.s3}), retrying...`
        );
      } else {
        console.log(
          `  Keeping haiku despite syllable count (${counts.s1}/${counts.s2}/${counts.s3})`
        );
        return haiku;
      }
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`  Parse error, retrying: ${err.message}`);
    }
  }
}

// ── Render card image (ported from app.js generateHaikuImage) ───────────────

function renderCardImage(haiku, sourceText) {
  const W = 1080,
    H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Colors
  const bg = "#f7f3ea";
  const text = "#2c2418";
  const dim = "#887050";
  const accent = "#4a6a30";
  const border = "#c8bfa8";
  const mono = "Courier Prime";
  const serif = "Liberation Serif";

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const LEFT = 100;
  const TEXT_LEFT = LEFT + 40;
  const srcLineH = 26;
  const srcBottomMargin = 40;
  const lineHeight = 70;
  const barTopMargin = 30;

  // Measure source text lines
  let srcLines = [];
  if (sourceText) {
    ctx.font = `20px "${mono}"`;
    const MAX_W = W - 2 * LEFT;
    const prefix = "// ";
    const prefixW = ctx.measureText(prefix).width;
    const words = sourceText.split(" ");
    let current = "";
    for (const word of words) {
      const test = current ? current + " " + word : word;
      const lineW =
        (srcLines.length === 0 ? prefixW : 0) + ctx.measureText(test).width;
      if (lineW > MAX_W && current) {
        srcLines.push(current);
        if (srcLines.length === 3) {
          current = "";
          break;
        }
        current = word;
      } else {
        current = test;
      }
    }
    if (current && srcLines.length < 3) srcLines.push(current);
    if (
      srcLines.join(" ").length <
      sourceText.replace(/\s+/g, " ").trim().length
    ) {
      let last = srcLines[srcLines.length - 1];
      const isFirst = srcLines.length === 1;
      while (
        last.length > 0 &&
        (isFirst ? prefixW : 0) + ctx.measureText(last + "\u2026").width >
          MAX_W
      ) {
        const sp = last.lastIndexOf(" ");
        last = sp > 0 ? last.slice(0, sp) : last.slice(0, -1);
      }
      srcLines[srcLines.length - 1] = last + "\u2026";
    }
  }

  // Calculate vertical position
  const srcHeight =
    srcLines.length > 0 ? srcLines.length * srcLineH + srcBottomMargin : 0;
  const totalContentHeight = srcHeight + 3 * lineHeight + barTopMargin + 18;
  let y = Math.max(180, Math.min(400, (H - totalContentHeight) / 2));

  // Source text
  if (srcLines.length > 0) {
    ctx.font = `20px "${mono}"`;
    ctx.fillStyle = dim;
    ctx.textBaseline = "top";
    const prefix = "// ";
    srcLines.forEach((lineText, i) => {
      ctx.fillText(
        i === 0 ? prefix + lineText : lineText,
        LEFT,
        y + i * srcLineH
      );
    });
    y += srcLines.length * srcLineH + srcBottomMargin;
  }

  // Haiku lines
  const lines = [
    [haiku.line1, 5],
    [haiku.line2, 7],
    [haiku.line3, 5],
  ];
  lines.forEach(([line, syl]) => {
    ctx.font = `22px "${mono}"`;
    ctx.fillStyle = dim;
    ctx.textBaseline = "top";
    ctx.fillText(String(syl), LEFT, y + 16);
    ctx.font = `italic 52px "${serif}"`;
    ctx.fillStyle = text;
    ctx.fillText(line, TEXT_LEFT, y);
    y += lineHeight;
  });

  // Syllable bars
  y += barTopMargin;
  const barData = [
    [haiku.s1 ?? 5, 5],
    [haiku.s2 ?? 7, 7],
    [haiku.s3 ?? 5, 5],
  ];
  ctx.font = `18px "${mono}"`;
  ctx.textBaseline = "top";
  let barX = LEFT;
  barData.forEach(([count, total], i) => {
    const filled = Math.min(count ?? total, total);
    const filledStr = "\u2588".repeat(filled);
    const unfilledStr = "\u2591".repeat(total - filled);
    ctx.fillStyle = accent;
    ctx.fillText(filledStr, barX, y);
    ctx.fillStyle = border;
    ctx.fillText(unfilledStr, barX + ctx.measureText(filledStr).width, y);
    if (i < barData.length - 1)
      barX += ctx.measureText(filledStr + unfilledStr).width + 25;
  });

  // Frog + branding
  const frogLines = ["  @..@  ", " (----) ", "( >__< )", " ^^  ^^ "];
  const frogFontSize = 14;
  const frogLineH = 17;
  const frogBlockH = frogLines.length * frogLineH;
  const brandGap = 16;
  ctx.font = `${frogFontSize}px "${mono}"`;
  let frogW = 0;
  frogLines.forEach((line) => {
    frogW = Math.max(frogW, ctx.measureText(line).width);
  });
  ctx.font = `20px "${mono}"`;
  const brandText = "frogpond.lol";
  const brandW = ctx.measureText(brandText).width;
  const unitW = frogW + brandGap + brandW;
  const unitX = (W - unitW) / 2;
  const frogTopY = H - 60 - frogBlockH;
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = accent;
  ctx.font = `${frogFontSize}px "${mono}"`;
  ctx.textBaseline = "top";
  frogLines.forEach((line, i) => {
    ctx.fillText(line, unitX, frogTopY + i * frogLineH);
  });
  ctx.restore();
  ctx.font = `20px "${mono}"`;
  ctx.fillStyle = dim;
  ctx.textBaseline = "middle";
  ctx.fillText(
    brandText,
    unitX + frogW + brandGap,
    frogTopY + frogBlockH / 2
  );

  return canvas.toBuffer("image/png");
}

// ── Image hosting (Imgur anonymous upload) ──────────────────────────────────

const IMGUR_CLIENT_ID = "546c25a59c58ad7";

async function uploadImageToImgur(imageBuffer) {
  const { Blob } = await import("buffer");
  const FormData = (await import("formdata-node")).FormData;

  const form = new FormData();
  form.set(
    "image",
    new Blob([imageBuffer], { type: "image/png" }),
    "haiku.png"
  );

  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Imgur upload error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Imgur upload failed: ${JSON.stringify(data)}`);
  }

  return data.data.link;
}

// ── Buffer GraphQL API ──────────────────────────────────────────────────────

const BUFFER_ORG_ID = "69b95e9c2ed9c075aa3b310e";

async function bufferGraphQL(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BUFFER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Buffer GraphQL error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(`Buffer GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function getBufferChannels() {
  const data = await bufferGraphQL(
    "{ account { channels { id name service } } }"
  );
  return data.account.channels;
}

async function createBufferIdea(text, title, imageUrl) {
  const media = imageUrl
    ? [{ url: imageUrl, type: "image", alt: title }]
    : [];

  const data = await bufferGraphQL(
    `mutation CreateIdea($input: CreateIdeaInput!) {
      createIdea(input: $input) {
        ... on Idea { id content { title text } }
      }
    }`,
    {
      input: {
        organizationId: BUFFER_ORG_ID,
        content: {
          title,
          text,
          aiAssisted: true,
          ...(media.length > 0 ? { media } : {}),
        },
      },
    }
  );
  return data.createIdea;
}

// ── Main pipeline ───────────────────────────────────────────────────────────

async function main() {
  console.log("=== Frog Pond Daily Haiku Pipeline ===\n");

  // 1. Verify Buffer connection
  console.log("1. Verifying Buffer connection...");
  const channels = await getBufferChannels();
  console.log(
    `   Connected to ${channels.length} channel(s): ${channels.map((c) => `${c.service} (@${c.name})`).join(", ")}\n`
  );

  // 2. Fetch trending topics
  console.log(`2. Fetching ${HAIKU_COUNT} trending topics...`);
  const topics = await fetchTrendingTopics(HAIKU_COUNT);
  console.log(`   Got ${topics.length} topics:\n`);
  topics.forEach((t, i) =>
    console.log(`   ${i + 1}. [${t.source}] ${t.title}`)
  );
  console.log();

  // 3. Generate haikus and push to Buffer
  let success = 0;
  let failed = 0;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const tone = pickTone();
    console.log(
      `3.${i + 1}. Processing: "${topic.title.slice(0, 60)}..." (tone: ${tone})`
    );

    try {
      // Generate haiku
      const haiku = await generateHaikuWithRetry(topic, tone);
      console.log(
        `   Haiku: ${haiku.line1} / ${haiku.line2} / ${haiku.line3} (${haiku.s1}/${haiku.s2}/${haiku.s3})`
      );

      // Render card image
      const imageBuffer = renderCardImage(haiku, topic.title);
      console.log(`   Image rendered (${(imageBuffer.length / 1024).toFixed(0)}KB)`);

      // Upload image to Imgur
      const imageUrl = await uploadImageToImgur(imageBuffer);
      console.log(`   Image uploaded: ${imageUrl}`);

      // Format post text — source on top, link, haiku image is the attachment
      const postText = [
        `// ${topic.title}`,
        "",
        topic.url,
        "",
        "#haiku #frogpond",
      ].join("\n");

      // Push to Buffer as Idea
      const idea = await createBufferIdea(postText, topic.title, imageUrl);
      console.log(`   Buffer Idea created: ${idea.id}\n`);
      success++;
    } catch (err) {
      console.error(`   ERROR: ${err.message}\n`);
      failed++;
    }

    // Brief delay between API calls
    if (i < topics.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log("=== Done ===");
  console.log(`   ${success} haikus queued in Buffer Ideas, ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
