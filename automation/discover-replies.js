#!/usr/bin/env node

/**
 * Frog Pond Engagement Discovery Pipeline
 *
 * Discovers high-potential Bluesky posts for haiku replies,
 * scores them via Claude, generates reply options, and queues
 * to Buffer Ideas for human review.
 *
 * Usage:
 *   node automation/discover-replies.js
 *
 * Environment variables:
 *   BSKY_IDENTIFIER    - Bluesky login (e.g., bash0@frogpond.lol)
 *   BSKY_APP_PASSWORD  - Bluesky app password
 *   ANTHROPIC_API_KEY  - Claude API key
 *   BUFFER_API_KEY     - Buffer API key (Bash0 account)
 *   DISCORD_WEBHOOK    - Discord webhook URL for notifications
 *
 * Optional:
 *   MAX_CANDIDATES     - Max posts to evaluate (default: 20)
 *   MAX_REPLIES        - Max reply ideas to queue (default: 5)
 */

const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────────────

const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MAX_CANDIDATES = parseInt(process.env.MAX_CANDIDATES || "20", 10);
const MAX_REPLIES = parseInt(process.env.MAX_REPLIES || "5", 10);

if (!BSKY_IDENTIFIER || !BSKY_APP_PASSWORD || !ANTHROPIC_API_KEY || !BUFFER_API_KEY) {
  console.error("Missing required env vars: BSKY_IDENTIFIER, BSKY_APP_PASSWORD, ANTHROPIC_API_KEY, BUFFER_API_KEY");
  process.exit(1);
}

// ── Discord notifications ───────────────────────────────────────────────────

async function notifyDiscord(message) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) {
    console.error("Discord notification failed:", err.message);
  }
}

// ── Bluesky API ─────────────────────────────────────────────────────────────

let bskySession = null;

async function bskyLogin() {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: BSKY_IDENTIFIER,
      password: BSKY_APP_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Bluesky login failed: ${res.status} ${await res.text()}`);
  bskySession = await res.json();
  return bskySession;
}

async function bskyGet(endpoint, params = {}) {
  const url = new URL(`https://bsky.social/xrpc/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bskySession.accessJwt}` },
  });
  if (!res.ok) throw new Error(`Bluesky API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Stage 1: Discover candidates ────────────────────────────────────────────

async function discoverCandidates() {
  const candidates = [];
  const seen = new Set();
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

  // Source 1: Popular/discover feed
  try {
    const popular = await bskyGet("app.bsky.unspecced.getPopularFeedGenerators", { limit: 10 });
    // Get posts from the "What's Hot" feed
    const whatsHot = await bskyGet("app.bsky.feed.getFeed", {
      feed: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
      limit: 30,
    });
    if (whatsHot.feed) {
      for (const item of whatsHot.feed) {
        const post = item.post;
        if (seen.has(post.uri)) continue;
        seen.add(post.uri);
        candidates.push(post);
      }
    }
  } catch (err) {
    console.log("  Warning: Could not fetch What's Hot feed:", err.message);
  }

  // Source 2: Search for trending tech/gaming/AI topics
  const searchTerms = ["AI", "gaming", "tech", "vibe coding", "Claude", "ChatGPT", "Nintendo", "PlayStation", "startup"];
  for (const term of searchTerms) {
    try {
      const results = await bskyGet("app.bsky.feed.searchPosts", {
        q: term,
        limit: 10,
        sort: "top",
      });
      if (results.posts) {
        for (const post of results.posts) {
          if (seen.has(post.uri)) continue;
          seen.add(post.uri);
          candidates.push(post);
        }
      }
    } catch (err) {
      // Search may not be available, continue
    }
    // Brief delay between searches
    await new Promise((r) => setTimeout(r, 300));
  }

  // Source 3: Discover feed
  try {
    const discover = await bskyGet("app.bsky.feed.getFeed", {
      feed: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/hot-classic",
      limit: 30,
    });
    if (discover.feed) {
      for (const item of discover.feed) {
        const post = item.post;
        if (seen.has(post.uri)) continue;
        seen.add(post.uri);
        candidates.push(post);
      }
    }
  } catch (err) {
    console.log("  Warning: Could not fetch discover feed:", err.message);
  }

  // Filter: engagement threshold + recency
  const filtered = candidates.filter((post) => {
    const likes = post.likeCount || 0;
    const createdAt = new Date(post.record?.createdAt || 0).getTime();
    const isRecent = createdAt > sixHoursAgo;
    const hasText = post.record?.text && post.record.text.length > 20;
    const isEnglish = /[a-zA-Z]/.test(post.record?.text || "");

    return likes >= 30 && isRecent && hasText && isEnglish;
  });

  // Sort by engagement (likes), take top candidates
  filtered.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));

  return filtered.slice(0, MAX_CANDIDATES);
}

// ── Stage 2: Score and filter via Claude ────────────────────────────────────

const SCORING_PROMPT = `You are scoring Bluesky posts for haiku reply potential. The account "bash0" (@frogpond.lol) creates absurd, witty haiku responses to trending posts.

For each post, score 1-10 on how well a haiku reply would work.

HIGH SCORES (8-10):
- Hot takes, unhinged rants, relatable complaints
- Celebrity/tech/gaming moments
- Absurd news or weird stories
- Wholesome content that could get a playful haiku
- Product launches, announcements
- Viral observations about daily life

LOW SCORES (1-4) - AUTO SKIP:
- Tragedy, grief, genuine distress, death
- Heated political arguments
- Follow-for-follow threads, engagement bait
- Self-promotion with no substance
- Very inside-joke content that outsiders can't engage with
- Content in languages other than English

Also recommend the engagement strategy:
- "quote" — Post shows up on Bash0's timeline as content. Use when the post is interesting enough that Bash0's followers should see it too.
- "reply" — Reply sits in the OP's thread. Use when the OP has a large following (10K+) and the thread is active, so the reply gets seen by their audience.

Consider the author's follower count and the post's engagement when choosing.

Respond with ONLY valid JSON: {"score": N, "reason": "brief explanation", "strategy": "quote" or "reply"}`;

async function scorePost(post) {
  const text = post.record?.text || "";
  const author = post.author?.handle || "unknown";
  const likes = post.likeCount || 0;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: SCORING_PROMPT,
      messages: [{
        role: "user",
        content: `Post by @${author} (${likes} likes, ${post.author?.followersCount || "unknown"} followers):\n"${text.slice(0, 500)}"`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude scoring error: ${res.status}`);
  const data = await res.json();
  const result = JSON.parse(data.content[0].text.trim());
  return result;
}

// ── Stage 3: Generate haiku replies (using shared engine) ───────────────────

const { generateReplyOptions } = require("./haiku-engine");

async function generateReplies(post) {
  const text = post.record?.text || "";
  return generateReplyOptions(ANTHROPIC_API_KEY, text, ["absurd", "sincere"]);
}

// ── Buffer API ──────────────────────────────────────────────────────────────

const BUFFER_ORG_ID = "69b95e9c2ed9c075aa3b310e";

async function createBufferIdea(text, title) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BUFFER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation CreateIdea($input: CreateIdeaInput!) {
        createIdea(input: $input) { ... on Idea { id } }
      }`,
      variables: {
        input: {
          organizationId: BUFFER_ORG_ID,
          content: { title, text, aiAssisted: true },
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`Buffer error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.errors) throw new Error(`Buffer error: ${JSON.stringify(data.errors)}`);
  return data.data.createIdea;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function postUrl(post) {
  const handle = post.author?.handle || "";
  const rkey = post.uri?.split("/").pop() || "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

// ── Main pipeline ───────────────────────────────────────────────────────────

async function main() {
  console.log("=== Frog Pond Engagement Discovery ===\n");

  // 1. Login to Bluesky
  console.log("1. Logging in to Bluesky...");
  await bskyLogin();
  console.log(`   Authenticated as @${bskySession.handle}\n`);

  // 2. Discover candidates
  console.log("2. Discovering candidate posts...");
  const candidates = await discoverCandidates();
  console.log(`   Found ${candidates.length} candidates meeting threshold\n`);

  if (candidates.length === 0) {
    const msg = "Frog Pond Discovery: No candidates found this run.";
    console.log(msg);
    await notifyDiscord(msg);
    return;
  }

  // 3. Score candidates
  console.log("3. Scoring candidates...");
  const scored = [];
  for (const post of candidates) {
    try {
      const score = await scorePost(post);
      const text = (post.record?.text || "").slice(0, 80);
      console.log(`   [${score.score}/10] [${score.strategy || "quote"}] @${post.author?.handle}: "${text}..." — ${score.reason}`);

      if (score.score >= 8) {
        scored.push({ post, score });
      }
    } catch (err) {
      console.log(`   Error scoring post: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n   ${scored.length} posts scored 8+ out of ${candidates.length}\n`);

  if (scored.length === 0) {
    const msg = `Frog Pond Discovery: Evaluated ${candidates.length} posts, none scored 8+. Better luck next run.`;
    console.log(msg);
    await notifyDiscord(msg);
    return;
  }

  // 4. Generate replies and queue to Buffer
  const toProcess = scored.slice(0, MAX_REPLIES);
  console.log(`4. Generating haiku replies for top ${toProcess.length} posts...\n`);

  let queued = 0;
  const discordLines = [];

  for (const { post, score } of toProcess) {
    const author = post.author?.handle || "unknown";
    const text = (post.record?.text || "").slice(0, 100);
    const url = postUrl(post);
    const likes = post.likeCount || 0;

    const strategy = score.strategy || "quote";
    const followers = post.author?.followersCount || "?";
    console.log(`   @${author} (${likes} likes, ${followers} followers, score ${score.score}, ${strategy}):`);
    console.log(`   "${text}..."`);

    try {
      const replies = await generateReplies(post);

      for (let i = 0; i < replies.length; i++) {
        const reply = replies[i];
        const strategyLabel = strategy === "quote" ? "📢 QUOTE REPLY" : "💬 DIRECT REPLY";
        const ideaText = [
          `${strategyLabel} to @${author} (${likes} likes, ${followers} followers)`,
          `"${(post.record?.text || "").slice(0, 200)}"`,
          "",
          `${url}`,
          "",
          "---",
          "",
          `${reply.line1}`,
          `${reply.line2}`,
          `${reply.line3}`,
          "",
          `🐸`,
          "",
          `Tone: ${reply.tone}`,
        ].join("\n");

        const title = `Reply to @${author}: ${reply.line1} (${reply.tone})`;
        await createBufferIdea(ideaText, title);
        console.log(`   → [${reply.tone}] ${reply.line1} / ${reply.line2} / ${reply.line3}`);
      }

      const strategyEmoji = strategy === "quote" ? "📢" : "💬";
      discordLines.push(`${strategyEmoji} **@${author}** (${likes}❤️) → "${text.slice(0, 60)}..."`);
      queued++;
    } catch (err) {
      console.error(`   Error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n=== Done ===`);
  console.log(`   ${queued} posts with haiku reply options queued in Buffer Ideas`);

  // Discord summary
  if (discordLines.length > 0) {
    const summary = [
      `🐸 **Frog Pond Discovery** — ${queued} reply targets found`,
      "",
      ...discordLines,
      "",
      `Check Buffer Ideas to review and post.`,
    ].join("\n");
    await notifyDiscord(summary);
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await notifyDiscord(`🐸❌ **Frog Pond Discovery FAILED:** ${err.message}`);
  process.exit(1);
});
