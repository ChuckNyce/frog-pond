/**
 * Shared haiku generation engine
 *
 * Full-quality haiku generation with vocabulary constraints,
 * syllable verification via CMU dictionary, and fix-retry loop.
 * Ported from the frogpond.lol app.js pipeline.
 */

const fs = require("fs");
const path = require("path");

// ── CMU Syllable Dictionary ─────────────────────────────────────────────────

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
  if (w.endsWith("ed") && !w.endsWith("ted") && !w.endsWith("ded") && count > 1) count--;
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
  const words = line.trim().split(/\s+/).filter((w) => w.length > 0);
  let total = 0;
  const breakdown = [];
  for (const word of words) {
    const count = countWord(word);
    const cleanWord = word.toLowerCase().replace(/[^a-z']/g, "").replace(/'s$/, "").replace(/'$/, "");
    total += count;
    breakdown.push({ word, syllables: count, source: dict[cleanWord] !== undefined ? "dict" : "heuristic" });
  }
  return { total, breakdown };
}

function checkSyllables(haiku) {
  const results = [
    countLine(haiku.line1),
    countLine(haiku.line2),
    countLine(haiku.line3),
  ];
  return results;
}

// ── Tone system ─────────────────────────────────────────────────────────────

const TONES = {
  absurd:
    "Make it hilariously absurd — elevate mundane things into cosmic tragedy. Go weird. Subvert expectations.",
  sincere:
    "Treat the content with genuine sincerity and real emotional weight.",
  poetic:
    "Find hidden beauty and quiet melancholy, like a classic Japanese poet. Wabi-sabi.",
};

// ── Vocabulary and syllable constraints (from frogpond.lol) ─────────────────

const VOCABULARY_RULES = `VOCABULARY GUIDELINES:
- Avoid overusing these common poetic defaults: weep, weeping, cosmic, eternal, sacred, ancient, whisper, whispers, void, soul, divine, mortal, fate, silent, echo, tears, abyss, fleeting, destiny, beneath, descend, gentle, wisdom — they're not banned, but vary your word choices and reach for fresher alternatives when possible
- Prefer concrete, specific, surprising language over generic poetic filler
- Everyday words used in unexpected ways are more interesting than "poetic" vocabulary
- The best haiku feel like a joke, a punch line, or a sharp observation — not a greeting card
- Surprise the reader with the third line — subvert expectations`;

const SYLLABLE_RULES = `SYLLABLE COUNTING — THIS IS CRITICAL:
- Before finalizing, count the syllables in each line by breaking every word into syllable parts
- Common traps: "fire" = 1 syllable (not 2), "every" = 3 syllables, "poem" = 2, "real" = 1, "cruel" = 1, "orange" = 2, "chocolate" = 3, "comfortable" = 3, "different" = 2, "interesting" = 3 (not 4), "camera" = 3 (not 2), "natural" = 3 (not 2), "actually" = 4 (not 3), "valuable" = 3, "several" = 3 (not 2), "business" = 2, "evening" = 2 (not 3), "family" = 3 (not 2)
- Double-check: count each word's syllables individually, then sum per line
- Line 1 MUST equal exactly 5, line 2 MUST equal exactly 7, line 3 MUST equal exactly 5
- If a line doesn't hit the target, rewrite it until it does — do not submit a haiku with wrong counts`;

const JSON_FORMAT = '{"line1":"text","line2":"text","line3":"text"}';

// ── Claude API helper ───────────────────────────────────────────────────────

async function callClaude(apiKey, system, userContent, maxTokens = 300) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text.trim();
}

function parseJSON(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Verify and fix haiku (full frogpond.lol pipeline) ───────────────────────

async function verifyAndFix(haiku, apiKey) {
  // Step 1: Claude verification pass
  const verifySystem = `You are a syllable counting expert. Your ONLY job is to verify and fix haiku syllable counts.

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
Format: {"line1":"...","line2":"...","line3":"..."}
All lines must be lowercase.`;

  try {
    const verifyRaw = await callClaude(
      apiKey,
      verifySystem,
      `Verify this haiku is exactly 5-7-5 syllables. Fix any line that's wrong.\n\nLine 1 (needs 5): "${haiku.line1}"\nLine 2 (needs 7): "${haiku.line2}"\nLine 3 (needs 5): "${haiku.line3}"`,
    );
    const verified = parseJSON(verifyRaw);
    haiku.line1 = verified.line1 || haiku.line1;
    haiku.line2 = verified.line2 || haiku.line2;
    haiku.line3 = verified.line3 || haiku.line3;
  } catch {
    // Verification failed, continue with original
  }

  // Step 2: Dictionary-based syllable check
  const sylCheck = checkSyllables(haiku);
  haiku.s1 = sylCheck[0].total;
  haiku.s2 = sylCheck[1].total;
  haiku.s3 = sylCheck[2].total;

  // Step 3: If still wrong, ask Claude to fix specific lines
  const targets = [5, 7, 5];
  const wrong = sylCheck.map((s, i) => s.total !== targets[i] ? i : -1).filter((i) => i !== -1);

  if (wrong.length > 0) {
    const fixPrompt = wrong
      .map((i) => {
        const lineKey = ["line1", "line2", "line3"][i];
        return `Line ${i + 1} "${haiku[lineKey]}" has ${sylCheck[i].total} syllables (needs ${targets[i]}). Rewrite it to exactly ${targets[i]} syllables while keeping the same meaning.`;
      })
      .join("\n");

    try {
      const fixRaw = await callClaude(
        apiKey,
        `Fix the syllable counts in these haiku lines. Each word's syllable count has been verified by dictionary lookup — trust these counts. Rewrite ONLY the specified lines. Keep the tone and meaning. Respond ONLY with raw JSON: {"line1":"...","line2":"...","line3":"..."}. All lowercase.`,
        `Original haiku:\nLine 1: "${haiku.line1}"\nLine 2: "${haiku.line2}"\nLine 3: "${haiku.line3}"\n\nProblems:\n${fixPrompt}\n\nProvide the corrected haiku with ALL three lines (keep correct lines unchanged).`,
      );
      const fixed = parseJSON(fixRaw);

      // Re-check the fixed version
      const recheck = checkSyllables(fixed);
      if (recheck[0].total === 5 && recheck[1].total === 7 && recheck[2].total === 5) {
        haiku.line1 = fixed.line1;
        haiku.line2 = fixed.line2;
        haiku.line3 = fixed.line3;
        haiku.s1 = 5;
        haiku.s2 = 7;
        haiku.s3 = 5;
      }
    } catch {
      // Fix attempt failed — keep original with actual counts
    }
  }

  return haiku;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a single haiku from a text prompt.
 * Full pipeline: generate → verify → dictionary check → fix → re-verify.
 */
async function generateHaiku(apiKey, promptText, tone = "absurd") {
  const toneInstruction = TONES[tone] || TONES.absurd;

  const system = `You are a haiku master. Convert the essence of this text into a perfect haiku (5-7-5 syllables).

${VOCABULARY_RULES}

${SYLLABLE_RULES}

Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: ${JSON_FORMAT}
All lines lowercase. ${toneInstruction}`;

  const raw = await callClaude(apiKey, system, promptText, 200);
  const haiku = parseJSON(raw);

  return verifyAndFix(haiku, apiKey);
}

/**
 * Generate multiple haiku reply options for a post.
 * Each goes through the full verification pipeline.
 */
async function generateReplyOptions(apiKey, postText, tones = ["absurd", "sincere"]) {
  const results = [];

  for (const tone of tones) {
    const toneInstruction = TONES[tone] || TONES.absurd;

    const system = `You are bash0, a haiku bot on Bluesky (@frogpond.lol). You write witty haiku replies to posts.

${VOCABULARY_RULES}

${SYLLABLE_RULES}

Respond ONLY with raw JSON — no markdown, no backticks, nothing else.
Format: ${JSON_FORMAT}
All lines lowercase. ${toneInstruction}

Never be mean-spirited. Absurd ≠ cruel. Match the energy of the original post.`;

    try {
      const raw = await callClaude(apiKey, system, `Write a haiku reply to this post:\n"${postText.slice(0, 500)}"`, 200);
      const haiku = parseJSON(raw);
      const verified = await verifyAndFix(haiku, apiKey);
      verified.tone = tone;
      results.push(verified);
    } catch (err) {
      console.log(`  Warning: Failed to generate ${tone} reply: ${err.message}`);
    }
  }

  return results;
}

/**
 * Pick a tone with weighted randomness (80% absurd, 10% sincere, 10% poetic)
 */
function pickTone() {
  const r = Math.random();
  if (r < 0.8) return "absurd";
  if (r < 0.9) return "sincere";
  return "poetic";
}

module.exports = {
  generateHaiku,
  generateReplyOptions,
  verifyAndFix,
  checkSyllables,
  countLine,
  pickTone,
  TONES,
};
