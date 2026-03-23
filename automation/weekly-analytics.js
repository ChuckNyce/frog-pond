#!/usr/bin/env node

/**
 * Digital Organism — Unified Weekly Analytics Report
 *
 * Pulls engagement data from both accounts:
 *   - Bash0 (@frogpond.lol) on Bluesky
 *   - Charles (@ChuckNyce83) on X/Twitter
 *
 * Analyzes performance via Claude, saves raw data, posts unified
 * summary to Discord.
 *
 * Environment variables:
 *   BSKY_IDENTIFIER    - Bluesky login
 *   BSKY_APP_PASSWORD  - Bluesky app password
 *   X_BEARER_TOKEN     - X/Twitter API Bearer Token
 *   X_USERNAME         - X/Twitter username (without @)
 *   ANTHROPIC_API_KEY  - Claude API key
 *   DISCORD_WEBHOOK    - Discord webhook URL (Bash0 channel)
 *   DISCORD_WEBHOOK_PERSONAL - Discord webhook URL (personal channel)
 */

const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────────────

const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const X_USERNAME = process.env.X_USERNAME || "ChuckNyce83";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const DISCORD_WEBHOOK_PERSONAL = process.env.DISCORD_WEBHOOK_PERSONAL;

if (!ANTHROPIC_API_KEY) {
  console.error("Missing required: ANTHROPIC_API_KEY");
  process.exit(1);
}

// ── Discord ─────────────────────────────────────────────────────────────────

async function notifyDiscord(message, webhook) {
  if (!webhook) return;
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
      await fetch(webhook, {
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

// ── Bluesky API ─────────────────────────────────────────────────────────────

let bskySession = null;

async function bskyLogin() {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: BSKY_IDENTIFIER, password: BSKY_APP_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Bluesky login failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Bluesky API error ${endpoint}: ${res.status}`);
  return res.json();
}

async function collectBluesky() {
  if (!BSKY_IDENTIFIER || !BSKY_APP_PASSWORD) {
    console.log("   Bluesky credentials not configured, skipping...");
    return null;
  }

  await bskyLogin();
  const profile = await bskyGet("app.bsky.actor.getProfile", { actor: bskySession.did });

  const posts = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const params = { actor: bskySession.did, limit: 50 };
    if (cursor) params.cursor = cursor;
    const data = await bskyGet("app.bsky.feed.getAuthorFeed", params);
    if (!data.feed || data.feed.length === 0) break;
    posts.push(...data.feed);
    cursor = data.cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  // Normalize to common format
  const normalized = posts.map((item) => {
    const post = item.post;
    return {
      text: (post.record?.text || "").slice(0, 150),
      likes: post.likeCount || 0,
      reposts: post.repostCount || 0,
      replies: post.replyCount || 0,
      engagement: (post.likeCount || 0) + (post.repostCount || 0) + (post.replyCount || 0),
      type: item.reply ? "reply" : "post",
      createdAt: post.record?.createdAt || "",
      url: `https://bsky.app/profile/${post.author?.handle}/post/${post.uri?.split("/").pop()}`,
    };
  });

  return {
    platform: "Bluesky",
    handle: `@${profile.handle}`,
    followers: profile.followersCount,
    following: profile.followsCount,
    totalPosts: profile.postsCount,
    posts: normalized,
  };
}

// ── X/Twitter API ───────────────────────────────────────────────────────────

async function xGet(endpoint, params = {}) {
  const url = new URL(`https://api.x.com/2/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
  });
  if (!res.ok) {
    if (res.status === 429) {
      console.log("   X API rate limited, waiting...");
      await new Promise((r) => setTimeout(r, 15000));
      return null;
    }
    throw new Error(`X API error: ${res.status}`);
  }
  return res.json();
}

async function collectX() {
  if (!X_BEARER_TOKEN) {
    console.log("   X API credentials not configured, skipping...");
    return null;
  }

  // Get user profile
  const userRes = await xGet(`users/by/username/${X_USERNAME}`, {
    "user.fields": "public_metrics,created_at",
  });
  if (!userRes?.data) throw new Error("Could not fetch X user profile");
  const user = userRes.data;
  const userId = user.id;
  const metrics = user.public_metrics || {};

  // Get recent tweets
  const tweetsRes = await xGet(`users/${userId}/tweets`, {
    max_results: "100",
    "tweet.fields": "public_metrics,created_at,in_reply_to_user_id,referenced_tweets",
    exclude: "retweets",
  });

  const tweets = tweetsRes?.data || [];

  // Normalize to common format
  const normalized = tweets.map((tweet) => {
    const m = tweet.public_metrics || {};
    const isReply = !!tweet.in_reply_to_user_id;
    const isQuote = tweet.referenced_tweets?.some((r) => r.type === "quoted");
    let type = "post";
    if (isReply) type = "reply";
    else if (isQuote) type = "quote";

    return {
      text: (tweet.text || "").slice(0, 150),
      likes: m.like_count || 0,
      reposts: m.retweet_count || 0,
      replies: m.reply_count || 0,
      engagement: (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0),
      type,
      createdAt: tweet.created_at || "",
      url: `https://x.com/${X_USERNAME}/status/${tweet.id}`,
    };
  });

  return {
    platform: "X/Twitter",
    handle: `@${X_USERNAME}`,
    followers: metrics.followers_count || 0,
    following: metrics.following_count || 0,
    totalPosts: metrics.tweet_count || 0,
    posts: normalized,
  };
}

// ── Shared Analysis ─────────────────────────────────────────────────────────

function analyzeAccount(account, daysBack = 7) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const thisWeek = account.posts.filter((p) => new Date(p.createdAt).getTime() > cutoff);
  thisWeek.sort((a, b) => b.engagement - a.engagement);

  const posts = thisWeek.filter((p) => p.type === "post");
  const replies = thisWeek.filter((p) => p.type === "reply");
  const quotes = thisWeek.filter((p) => p.type === "quote");

  const totalEngagement = thisWeek.reduce((s, p) => s + p.engagement, 0);
  const avgPostEng = posts.length > 0 ? (posts.reduce((s, p) => s + p.engagement, 0) / posts.length).toFixed(1) : "0";
  const avgReplyEng = replies.length > 0 ? (replies.reduce((s, p) => s + p.engagement, 0) / replies.length).toFixed(1) : "0";
  const avgQuoteEng = quotes.length > 0 ? (quotes.reduce((s, p) => s + p.engagement, 0) / quotes.length).toFixed(1) : "0";

  // Topic detection
  const topicKeywords = {
    tech: ["ai", "tech", "software", "app", "code", "coding", "developer", "startup", "nvidia", "apple", "google", "microsoft", "amazon", "claude", "cursor", "openai"],
    gaming: ["game", "gaming", "xbox", "playstation", "nintendo", "steam", "minecraft", "fortnite", "roblox", "console"],
    "vibe coding": ["vibe cod", "vibe code", "vibecod"],
    "build in public": ["build in public", "buildinpublic", "shipped", "launched", "side project"],
    animals: ["cat", "dog", "bird", "frog", "pet", "animal"],
    absurd: ["cosmic", "gods", "weep", "void", "existential", "doom", "chaos"],
  };

  const topics = {};
  for (const entry of thisWeek) {
    const textLower = entry.text.toLowerCase();
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => textLower.includes(kw))) {
        if (!topics[topic]) topics[topic] = { count: 0, totalEngagement: 0 };
        topics[topic].count++;
        topics[topic].totalEngagement += entry.engagement;
      }
    }
  }

  return {
    platform: account.platform,
    handle: account.handle,
    followers: account.followers,
    following: account.following,
    totalPostsAllTime: account.totalPosts,
    thisWeek: {
      total: thisWeek.length,
      posts: posts.length,
      replies: replies.length,
      quotes: quotes.length,
      totalEngagement,
      avgPostEng,
      avgReplyEng,
      avgQuoteEng,
      top5: thisWeek.slice(0, 5),
    },
    topics,
  };
}

// ── Claude Unified Analysis ─────────────────────────────────────────────────

async function getUnifiedAnalysis(analyses, previousReport) {
  const accountSummaries = analyses.map((a) => {
    const top5 = a.thisWeek.top5
      .map((p, i) => `  ${i + 1}. [${p.type}] ${p.likes}❤️ ${p.reposts}🔁 ${p.replies}💬 — "${p.text.slice(0, 80)}"`)
      .join("\n");

    const topicLines = Object.entries(a.topics)
      .map(([t, d]) => `  ${t}: ${d.count} posts, ${d.totalEngagement} eng, ${(d.totalEngagement / d.count).toFixed(1)} avg`)
      .join("\n");

    return `
ACCOUNT: ${a.handle} (${a.platform})
Followers: ${a.followers} | Following: ${a.following} | All-time posts: ${a.totalPostsAllTime}
This week: ${a.thisWeek.posts} posts, ${a.thisWeek.replies} replies, ${a.thisWeek.quotes} quotes (${a.thisWeek.total} total)
Total engagement: ${a.thisWeek.totalEngagement}
Avg per post: ${a.thisWeek.avgPostEng} | Avg per reply: ${a.thisWeek.avgReplyEng} | Avg per quote: ${a.thisWeek.avgQuoteEng}

Top 5:
${top5 || "  No posts this week"}

Topics:
${topicLines || "  Not enough data"}`;
  }).join("\n\n---\n");

  const previousContext = previousReport
    ? `\nPrevious report: ${JSON.stringify(previousReport.accounts?.map((a) => ({ handle: a.handle, followers: a.followers })) || "none")}`
    : "\nNo previous report available.";

  const prompt = `Analyze these two social media accounts' weekly performance. They are both run by the same person (Charles) as part of the "Digital Organism" growth experiment.

${accountSummaries}
${previousContext}

CONTEXT:
- @frogpond.lol (Bluesky): Haiku bot that creates absurd haiku responses to trending news. Early growth phase. Goal: 500 followers.
- @ChuckNyce83 (X/Twitter): Personal brand, build-in-public, vibe coding journey. SRE by day, indie builder by night. Early growth phase.
- Both accounts are powered by the same AI growth engine (Digital Organism / Algo Cracker).

Provide a UNIFIED analysis:
1. Per-account: What's working, what's not (be specific, use data)
2. Cross-platform comparison: Which platform is responding better and why
3. Top 3 recommendations for EACH account next week
4. Growth projections for both accounts
5. One insight that only emerges from seeing both accounts side by side

Keep it concise and actionable. No fluff.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude analysis error: ${res.status}`);
  const data = await res.json();
  return data.content[0].text.trim();
}

// ── Data persistence ────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "analytics-data");

function saveReport(report) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const filename = `report-${date}.json`;
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(report, null, 2));
  console.log(`   Saved to ${filename}`);
  return filename;
}

function loadPreviousReport() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .sort()
    .reverse();
  // Skip today's report if it exists, get the previous one
  const today = new Date().toISOString().split("T")[0];
  const prev = files.find((f) => !f.includes(today));
  if (!prev) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, prev), "utf8"));
  } catch {
    return null;
  }
}

// ── Format Discord message ──────────────────────────────────────────────────

function formatAccountSummary(analysis, previousFollowers) {
  const a = analysis;
  const delta = previousFollowers !== null
    ? ` (${a.followers - previousFollowers >= 0 ? "+" : ""}${a.followers - previousFollowers})`
    : "";

  const top3 = a.thisWeek.top5.slice(0, 3)
    .map((p, i) => {
      const icon = p.type === "reply" ? "💬" : p.type === "quote" ? "🔄" : "📢";
      return `${i + 1}. ${icon} ${p.likes}❤️ ${p.reposts}🔁 ${p.replies}💬 — "${p.text.slice(0, 55)}..."`;
    })
    .join("\n");

  return [
    `**${a.handle}** (${a.platform})`,
    `Followers: **${a.followers}**${delta}`,
    `This week: ${a.thisWeek.posts} posts, ${a.thisWeek.replies} replies, ${a.thisWeek.quotes} quotes`,
    `Engagement: ${a.thisWeek.totalEngagement} total | Post avg: ${a.thisWeek.avgPostEng} | Reply avg: ${a.thisWeek.avgReplyEng}`,
    "",
    `Top 3:`,
    top3 || "No posts this week",
  ].join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Digital Organism — Unified Weekly Analytics ===\n");

  const accounts = [];
  const analyses = [];

  // 1. Collect Bluesky data
  console.log("1. Collecting Bluesky data...");
  try {
    const bsky = await collectBluesky();
    if (bsky) {
      accounts.push(bsky);
      console.log(`   @${bsky.handle}: ${bsky.followers} followers, ${bsky.posts.length} posts fetched`);
    }
  } catch (err) {
    console.log(`   Bluesky error: ${err.message}`);
  }

  // 2. Collect X data
  console.log("\n2. Collecting X/Twitter data...");
  try {
    const x = await collectX();
    if (x) {
      accounts.push(x);
      console.log(`   ${x.handle}: ${x.followers} followers, ${x.posts.length} posts fetched`);
    }
  } catch (err) {
    console.log(`   X error: ${err.message}`);
  }

  if (accounts.length === 0) {
    console.log("\nNo accounts collected. Exiting.");
    return;
  }

  // 3. Analyze each account
  console.log("\n3. Analyzing engagement...");
  for (const account of accounts) {
    const analysis = analyzeAccount(account);
    analyses.push(analysis);
    console.log(`   ${analysis.handle}: ${analysis.thisWeek.total} posts this week, ${analysis.thisWeek.totalEngagement} engagement`);
  }

  // 4. Load previous report
  const previousReport = loadPreviousReport();
  if (previousReport) {
    console.log(`\n   Previous report: ${previousReport.date}`);
  }

  // 5. Claude unified analysis
  console.log("\n4. Getting AI analysis...");
  const aiAnalysis = await getUnifiedAnalysis(analyses, previousReport);
  console.log("   Analysis complete");

  // 6. Save report
  console.log("\n5. Saving report...");
  const report = {
    date: new Date().toISOString().split("T")[0],
    accounts: analyses.map((a) => ({
      platform: a.platform,
      handle: a.handle,
      followers: a.followers,
      following: a.following,
      thisWeek: a.thisWeek,
      topics: a.topics,
    })),
  };
  saveReport(report);

  // 7. Generate PDF report
  console.log("\n6. Generating PDF report...");
  const { generateReport } = require("./report-pdf");
  const date = new Date().toISOString().split("T")[0];

  const pdfData = {
    date,
    accounts: analyses,
    previous: previousReport,
  };

  const pdfPath = path.join(DATA_DIR, `report-${date}.pdf`);
  await generateReport(pdfData, aiAnalysis, pdfPath);
  console.log(`   PDF saved to ${pdfPath}`);

  // 8. Send PDF to Discord as file attachment
  console.log("\n7. Sending Discord notifications...");

  // Quick summary for Discord text
  const summaryLines = analyses.map((a) => {
    const prevFollowers = previousReport?.accounts?.find((p) => p.handle === a.handle)?.followers ?? null;
    const delta = prevFollowers !== null ? ` (${a.followers - prevFollowers >= 0 ? "+" : ""}${a.followers - prevFollowers})` : "";
    return `**${a.handle}** (${a.platform}): ${a.followers} followers${delta}, ${a.thisWeek.totalEngagement} engagement this week`;
  });

  const summaryMsg = [
    `📊 **Digital Organism — Weekly Report** (${date})`,
    "",
    ...summaryLines,
    "",
    "Full report attached as PDF.",
  ].join("\n");

  // Upload PDF to Discord as file attachment
  async function sendPDFToDiscord(webhook) {
    if (!webhook) return;
    const { Blob } = await import("buffer");
    const FormData = (await import("formdata-node")).FormData;

    const form = new FormData();
    form.set("content", summaryMsg);
    form.set(
      "files[0]",
      new Blob([fs.readFileSync(pdfPath)], { type: "application/pdf" }),
      `digital-organism-report-${date}.pdf`,
    );

    await fetch(webhook, { method: "POST", body: form });
  }

  await sendPDFToDiscord(DISCORD_WEBHOOK);
  await sendPDFToDiscord(DISCORD_WEBHOOK_PERSONAL);

  console.log("\n=== Done ===");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  const errMsg = `📊❌ **Weekly Analytics FAILED:** ${err.message}`;
  await notifyDiscord(errMsg, DISCORD_WEBHOOK);
  await notifyDiscord(errMsg, DISCORD_WEBHOOK_PERSONAL);
  process.exit(1);
});
