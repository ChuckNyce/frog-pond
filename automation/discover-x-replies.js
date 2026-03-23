#!/usr/bin/env node

/**
 * Digital Organism — X/Twitter Engagement Discovery for Personal Brand
 *
 * Finds trending vibe coding / build-in-public posts on X via web search,
 * scores them via Claude, generates reply suggestions in Charles's voice,
 * and queues to Buffer Ideas for review.
 *
 * Usage:
 *   node automation/discover-x-replies.js
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY       - Claude API key
 *   BUFFER_API_KEY_PERSONAL - Buffer API key (Charles's personal account)
 *   DISCORD_WEBHOOK         - Discord webhook URL
 *
 * Optional:
 *   MAX_CANDIDATES          - Max posts to evaluate (default: 15)
 *   MAX_REPLIES             - Max reply ideas to queue (default: 5)
 */

const fs = require("fs");

// ── Config ──────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BUFFER_API_KEY = process.env.BUFFER_API_KEY_PERSONAL;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MAX_CANDIDATES = parseInt(process.env.MAX_CANDIDATES || "15", 10);
const MAX_REPLIES = parseInt(process.env.MAX_REPLIES || "5", 10);

if (!ANTHROPIC_API_KEY || !BUFFER_API_KEY) {
  console.error("Missing required env vars: ANTHROPIC_API_KEY, BUFFER_API_KEY_PERSONAL");
  process.exit(1);
}

// ── Discord ─────────────────────────────────────────────────────────────────

async function notifyDiscord(message) {
  if (!DISCORD_WEBHOOK) return;
  const chunks = [];
  let remaining = message;
  while (remaining.length > 0) {
    if (remaining.length <= 1950) { chunks.push(remaining); break; }
    let cutoff = remaining.lastIndexOf("\n", 1950);
    if (cutoff === -1) cutoff = 1950;
    chunks.push(remaining.slice(0, cutoff));
    remaining = remaining.slice(cutoff);
  }
  for (const chunk of chunks) {
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error("Discord error:", err.message);
    }
  }
}

// ── Stage 1: Discover X posts via web search ────────────────────────────────

// ── Discovery via Bluesky cross-search + RSS feeds ──────────────────────────
// X doesn't have a free search API, so we use two approaches:
// 1. Search Bluesky for vibe coding content (many builders cross-post)
// 2. Fetch RSS feeds from known vibe coding aggregators/accounts
// 3. Use web search API if available

const BSKY_SEARCH_TERMS = [
  "vibe coding",
  "vibe code",
  "built with claude",
  "built with cursor",
  "building in public",
  "indie hacker AI",
  "just shipped",
  "side project AI",
  "claude code",
  "vibe coded",
];

// Known vibe coding accounts on X to monitor (curate over time)
const MONITORED_ACCOUNTS = [
  "maboroshi_and", "swyx", "levelsio", "danshipper", "mckaywrigley",
  "maboroshi_and", "raaborahi", "tdinh_me", "marc_louvion",
];

// RSS feeds for vibe coding / build-in-public content
const RSS_FEEDS = [
  "https://hnrss.org/newest?q=vibe+coding&points=10",
  "https://hnrss.org/newest?q=build+in+public&points=10",
];

async function searchBlueskyForX() {
  // Many vibe coders cross-post to Bluesky — find them there
  // These posts often contain X links or the same content
  const posts = [];
  const seen = new Set();

  for (const term of BSKY_SEARCH_TERMS) {
    try {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=10&sort=top`,
      );
      if (!res.ok) continue;
      const data = await res.json();

      if (data.posts) {
        for (const post of data.posts) {
          const text = post.record?.text || "";
          if (seen.has(text.slice(0, 50))) continue;
          seen.add(text.slice(0, 50));

          // Only include posts with decent engagement
          if ((post.likeCount || 0) < 5) continue;

          posts.push({
            author: `@${post.author?.handle || "unknown"}`,
            text,
            url: `https://bsky.app/profile/${post.author?.handle}/post/${post.uri?.split("/").pop()}`,
            engagement: `${post.likeCount || 0} likes`,
            followers: `${post.author?.followersCount || "unknown"}`,
            source: "bluesky",
          });
        }
      }
    } catch {
      // Continue on error
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return posts;
}

async function fetchRSSFeeds() {
  const posts = [];

  for (const feedUrl of RSS_FEEDS) {
    try {
      const res = await fetch(feedUrl);
      if (!res.ok) continue;
      const xml = await res.text();

      // Simple XML parsing for RSS items
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 5)) {
        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || "";
        const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || "";
        const comments = (item.match(/<comments>(.*?)<\/comments>/) || [])[1] || "";

        if (title && link) {
          posts.push({
            author: "HN",
            text: title,
            url: comments || link,
            engagement: "HN front page",
            followers: "unknown",
            source: "hackernews",
          });
        }
      }
    } catch {
      // Continue on error
    }
  }

  return posts;
}

async function discoverCandidates() {
  const allPosts = [];
  const seen = new Set();

  // Source 1: Bluesky cross-search
  console.log("   Searching Bluesky for vibe coding content...");
  const bskyPosts = await searchBlueskyForX();
  console.log(`   Found ${bskyPosts.length} posts on Bluesky`);
  for (const post of bskyPosts) {
    const key = (post.author + post.text?.slice(0, 50)).toLowerCase();
    if (!seen.has(key)) { seen.add(key); allPosts.push(post); }
  }

  // Source 2: HN RSS feeds
  console.log("   Fetching Hacker News RSS feeds...");
  const rssPosts = await fetchRSSFeeds();
  console.log(`   Found ${rssPosts.length} posts from HN`);
  for (const post of rssPosts) {
    const key = (post.author + post.text?.slice(0, 50)).toLowerCase();
    if (!seen.has(key)) { seen.add(key); allPosts.push(post); }
  }

  console.log(`   Total unique candidates: ${allPosts.length}`);
  return allPosts.slice(0, MAX_CANDIDATES);
}

// ── Stage 2: Score posts ────────────────────────────────────────────────────

const SCORING_PROMPT = `You are scoring X/Twitter posts for reply potential. The account is @ChuckNyce83 — Charles, an SRE by day, indie builder by night, building in public with AI tools. His voice is direct, honest, self-aware. No guru energy, no hype.

Score 1-10 on how well a thoughtful reply would work for building his personal brand.

HIGH SCORES (8-10):
- Vibe coding discussions, opinions, and debates
- Build-in-public updates where a genuine reply adds value
- Founders sharing honest struggles with distribution/growth
- AI tool comparisons and workflow discussions
- "I shipped this" posts where genuine feedback would be appreciated
- Questions about AI coding that Charles can answer from experience

LOW SCORES (1-4) - AUTO SKIP:
- Guru energy, fake hype, "I made $50K in 3 days" posts
- Engagement bait ("like if you agree", "drop your link")
- Political content
- Posts from massive accounts (1M+) where replies get buried
- Crypto/NFT shilling disguised as tech content
- Posts that are just ads for courses or communities

Also recommend engagement strategy:
- "quote" — Post is interesting enough to share with Charles's audience + add his take
- "reply" — Better to add value directly in the thread

Respond with ONLY valid JSON: {"score": N, "reason": "brief explanation", "strategy": "quote" or "reply"}`;

async function scorePost(post) {
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
      system: SCORING_PROMPT,
      messages: [{
        role: "user",
        content: `Post by ${post.author} (${post.followers || "unknown"} followers, ${post.engagement || "unknown"} engagement):\n"${(post.text || "").slice(0, 500)}"`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude scoring error: ${res.status}`);
  const data = await res.json();
  const text = data.content[0].text.trim().replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  return JSON.parse(text);
}

// ── Stage 3: Generate replies in Charles's voice ────────────────────────────

const REPLY_PROMPT = `You are helping Charles (@ChuckNyce83) draft replies to X/Twitter posts about vibe coding and building in public.

Charles's voice:
- Direct, honest, self-aware
- SRE by day, indie builder by night
- 45+ days of vibe coding experience across dozens of project ideas
- Has real opinions based on real experience (not theory)
- No guru energy, no fake hype, no "great post!" energy
- Dry humor occasionally, but not forced
- Shares what he actually learned, not what sounds impressive
- Short, punchy replies — not essays

Generate 2 reply options:
1. A direct, practical take (share experience or honest opinion)
2. A slightly more personal/vulnerable angle (the "real talk" version)

Each reply should be 1-3 sentences max. This is X, not a blog post.

Respond with ONLY valid JSON array: [{"text":"reply text","style":"practical"}, {"text":"reply text","style":"real-talk"}]`;

async function generateReplies(post) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: REPLY_PROMPT,
      messages: [{
        role: "user",
        content: `Write replies to this post by ${post.author}:\n"${(post.text || "").slice(0, 500)}"`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude reply error: ${res.status}`);
  const data = await res.json();
  const text = data.content[0].text.trim().replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  return JSON.parse(text);
}

// ── Buffer API ──────────────────────────────────────────────────────────────

const BUFFER_ORG_ID = "69be970fe28b949126fc0c2b";

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

// ── Main pipeline ───────────────────────────────────────────────────────────

async function main() {
  console.log("=== Digital Organism — X/Twitter Discovery (@ChuckNyce83) ===\n");

  // 1. Discover candidates
  console.log("1. Discovering candidate posts on X...");
  const candidates = await discoverCandidates();
  console.log(`\n   Found ${candidates.length} unique candidates\n`);

  if (candidates.length === 0) {
    const msg = "Digital Organism X Discovery: No candidates found this run.";
    console.log(msg);
    await notifyDiscord(msg);
    return;
  }

  // 2. Score candidates
  console.log("2. Scoring candidates...");
  const scored = [];
  for (const post of candidates) {
    try {
      const score = await scorePost(post);
      const text = (post.text || "").slice(0, 70);
      console.log(`   [${score.score}/10] [${score.strategy}] ${post.author}: "${text}..." — ${score.reason}`);

      if (score.score >= 8) {
        scored.push({ post, score });
      }
    } catch (err) {
      console.log(`   Error scoring: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n   ${scored.length} posts scored 8+ out of ${candidates.length}\n`);

  if (scored.length === 0) {
    const msg = `Digital Organism X Discovery: Evaluated ${candidates.length} posts, none scored 8+.`;
    console.log(msg);
    await notifyDiscord(msg);
    return;
  }

  // 3. Generate replies and queue
  const toProcess = scored.slice(0, MAX_REPLIES);
  console.log(`3. Generating replies for top ${toProcess.length} posts...\n`);

  let queued = 0;
  const discordLines = [];

  for (const { post, score } of toProcess) {
    const strategy = score.strategy || "reply";
    const strategyLabel = strategy === "quote" ? "📢 QUOTE" : "💬 REPLY";

    console.log(`   ${strategyLabel} to ${post.author}:`);
    console.log(`   "${(post.text || "").slice(0, 80)}..."`);

    try {
      const replies = await generateReplies(post);

      for (const reply of replies) {
        const ideaText = [
          `${strategyLabel} to ${post.author}`,
          `"${(post.text || "").slice(0, 250)}"`,
          "",
          post.url || "[URL not available]",
          "",
          "---",
          "",
          reply.text,
          "",
          `Style: ${reply.style}`,
        ].join("\n");

        const title = `${strategy} ${post.author}: ${reply.text.slice(0, 50)}... (${reply.style})`;
        await createBufferIdea(ideaText, title);
        console.log(`   → [${reply.style}] ${reply.text.slice(0, 80)}...`);
      }

      const strategyEmoji = strategy === "quote" ? "📢" : "💬";
      discordLines.push(`${strategyEmoji} **${post.author}** — "${(post.text || "").slice(0, 50)}..."`);
      queued++;
    } catch (err) {
      console.error(`   Error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n=== Done ===`);
  console.log(`   ${queued} posts with reply options queued in Buffer Ideas`);

  if (discordLines.length > 0) {
    const summary = [
      `🐦 **Digital Organism X Discovery** — ${queued} reply targets for @ChuckNyce83`,
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
  await notifyDiscord(`🐦❌ **X Discovery FAILED:** ${err.message}`);
  process.exit(1);
});
