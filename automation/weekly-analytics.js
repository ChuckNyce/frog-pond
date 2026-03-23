#!/usr/bin/env node

/**
 * Algo Cracker — Weekly Analytics Report
 *
 * Pulls engagement data from Bluesky, analyzes performance via Claude,
 * saves raw data for trend tracking, and posts summary to Discord.
 *
 * Usage:
 *   node automation/weekly-analytics.js
 *
 * Environment variables:
 *   BSKY_IDENTIFIER    - Bluesky login
 *   BSKY_APP_PASSWORD  - Bluesky app password
 *   ANTHROPIC_API_KEY  - Claude API key
 *   DISCORD_WEBHOOK    - Discord webhook URL
 */

const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────────────

const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (!BSKY_IDENTIFIER || !BSKY_APP_PASSWORD || !ANTHROPIC_API_KEY) {
  console.error("Missing required env vars: BSKY_IDENTIFIER, BSKY_APP_PASSWORD, ANTHROPIC_API_KEY");
  process.exit(1);
}

// ── Discord ─────────────────────────────────────────────────────────────────

async function notifyDiscord(message) {
  if (!DISCORD_WEBHOOK) return;
  // Discord has a 2000 char limit per message — split if needed
  const chunks = [];
  let remaining = message;
  while (remaining.length > 0) {
    if (remaining.length <= 1950) {
      chunks.push(remaining);
      break;
    }
    // Find last newline before limit
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

// ── Data Collection ─────────────────────────────────────────────────────────

async function getProfile() {
  return bskyGet("app.bsky.actor.getProfile", { actor: bskySession.did });
}

async function getAllPosts() {
  const posts = [];
  let cursor;

  // Paginate through all posts
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

  return posts;
}

// ── Analysis ────────────────────────────────────────────────────────────────

function analyzeEngagement(posts, daysBack = 7) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const thisWeek = [];
  const allTime = [];

  for (const item of posts) {
    const post = item.post;
    const createdAt = new Date(post.record?.createdAt || 0).getTime();
    const text = post.record?.text || "";
    const isReply = !!item.reply;
    const likes = post.likeCount || 0;
    const reposts = post.repostCount || 0;
    const replies = post.replyCount || 0;
    const engagement = likes + reposts + replies;

    const entry = {
      text: text.slice(0, 150),
      likes,
      reposts,
      replies,
      engagement,
      isReply,
      type: isReply ? "reply" : "post",
      createdAt: new Date(createdAt).toISOString(),
      uri: post.uri,
      author: post.author?.handle,
    };

    allTime.push(entry);
    if (createdAt > cutoff) thisWeek.push(entry);
  }

  // Sort by engagement
  thisWeek.sort((a, b) => b.engagement - a.engagement);
  allTime.sort((a, b) => b.engagement - a.engagement);

  // Stats
  const weekPosts = thisWeek.filter((p) => p.type === "post");
  const weekReplies = thisWeek.filter((p) => p.type === "reply");

  const totalEngagement = thisWeek.reduce((s, p) => s + p.engagement, 0);
  const postEngagement = weekPosts.reduce((s, p) => s + p.engagement, 0);
  const replyEngagement = weekReplies.reduce((s, p) => s + p.engagement, 0);

  const avgPostEngagement = weekPosts.length > 0 ? (postEngagement / weekPosts.length).toFixed(1) : 0;
  const avgReplyEngagement = weekReplies.length > 0 ? (replyEngagement / weekReplies.length).toFixed(1) : 0;

  // Topic detection (simple keyword matching)
  const topics = {};
  const topicKeywords = {
    tech: ["ai", "tech", "software", "app", "code", "coding", "developer", "startup", "nvidia", "apple", "google", "microsoft", "amazon"],
    gaming: ["game", "gaming", "xbox", "playstation", "nintendo", "steam", "minecraft", "fortnite", "roblox", "console"],
    animals: ["cat", "dog", "bird", "frog", "pet", "animal", "kitten", "puppy"],
    absurd: ["cosmic", "gods", "weep", "void", "existential", "doom", "chaos"],
    wholesome: ["love", "kind", "beautiful", "wonderful", "amazing", "grateful", "happy"],
    news: ["breaking", "report", "study", "research", "announced", "launches", "reveals"],
  };

  for (const entry of thisWeek) {
    const textLower = entry.text.toLowerCase();
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => textLower.includes(kw))) {
        if (!topics[topic]) topics[topic] = { count: 0, totalEngagement: 0, posts: [] };
        topics[topic].count++;
        topics[topic].totalEngagement += entry.engagement;
        topics[topic].posts.push(entry);
      }
    }
  }

  // Time analysis
  const hourBuckets = {};
  for (const entry of thisWeek) {
    const hour = new Date(entry.createdAt).getUTCHours();
    // Convert to ET (approximate — UTC-4 or UTC-5)
    const etHour = (hour - 4 + 24) % 24;
    const bucket = `${etHour}:00 ET`;
    if (!hourBuckets[bucket]) hourBuckets[bucket] = { count: 0, totalEngagement: 0 };
    hourBuckets[bucket].count++;
    hourBuckets[bucket].totalEngagement += entry.engagement;
  }

  return {
    thisWeek,
    allTime,
    stats: {
      totalPosts: thisWeek.length,
      posts: weekPosts.length,
      replies: weekReplies.length,
      totalEngagement,
      avgPostEngagement,
      avgReplyEngagement,
      top5: thisWeek.slice(0, 5),
    },
    topics,
    hourBuckets,
  };
}

// ── Claude Analysis ─────────────────────────────────────────────────────────

async function getClaudeAnalysis(profile, analysis, previousReport) {
  const topPostsText = analysis.stats.top5
    .map((p, i) => `${i + 1}. [${p.type}] ${p.likes}❤️ ${p.reposts}🔁 ${p.replies}💬 — "${p.text.slice(0, 100)}"`)
    .join("\n");

  const topicSummary = Object.entries(analysis.topics)
    .map(([topic, data]) => `${topic}: ${data.count} posts, ${data.totalEngagement} total engagement, ${(data.totalEngagement / data.count).toFixed(1)} avg`)
    .join("\n");

  const timeSummary = Object.entries(analysis.hourBuckets)
    .sort((a, b) => b[1].totalEngagement - a[1].totalEngagement)
    .slice(0, 5)
    .map(([hour, data]) => `${hour}: ${data.count} posts, ${data.totalEngagement} engagement`)
    .join("\n");

  const previousContext = previousReport
    ? `\nPrevious week stats: ${previousReport.stats.totalPosts} posts, ${previousReport.stats.totalEngagement} total engagement, ${previousReport.profile.followersCount} followers`
    : "\nNo previous week data available (first report).";

  const prompt = `Analyze this Bluesky account's weekly performance and provide actionable recommendations.

ACCOUNT: @${profile.handle}
Followers: ${profile.followersCount}
Following: ${profile.followsCount}
Total posts all time: ${profile.postsCount}
${previousContext}

THIS WEEK:
Posts: ${analysis.stats.posts} standalone, ${analysis.stats.replies} replies (${analysis.stats.totalPosts} total)
Total engagement: ${analysis.stats.totalEngagement}
Avg engagement per post: ${analysis.stats.avgPostEngagement}
Avg engagement per reply: ${analysis.stats.avgReplyEngagement}

TOP 5 PERFORMERS:
${topPostsText}

TOPIC BREAKDOWN:
${topicSummary || "Not enough data for topic analysis"}

BEST TIMES:
${timeSummary || "Not enough data for time analysis"}

CONTEXT: This is a haiku bot account (@frogpond.lol) that creates absurd haiku responses to trending tech/gaming/AI news. The account is in early growth phase (under 100 followers). The goal is to reach 500 followers. The strategy is a mix of standalone haiku posts about news and haiku replies to trending posts.

Provide a concise analysis with:
1. What's working (specific patterns, not generic praise)
2. What's not working (be honest)
3. Top 3 actionable recommendations for next week
4. Projected follower milestone at current trajectory
5. One "wild card" suggestion — something creative or unconventional to try

Keep it direct, no fluff. Use data to back up every recommendation.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
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

  if (files.length === 0) return null;

  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[0]), "utf8"));
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Algo Cracker — Weekly Analytics ===\n");

  // 1. Login
  console.log("1. Logging in to Bluesky...");
  await bskyLogin();
  console.log(`   Authenticated as @${bskySession.handle}\n`);

  // 2. Collect data
  console.log("2. Collecting data...");
  const profile = await getProfile();
  console.log(`   @${profile.handle}: ${profile.followersCount} followers, ${profile.postsCount} posts`);

  const posts = await getAllPosts();
  console.log(`   Fetched ${posts.length} posts from feed\n`);

  // 3. Analyze
  console.log("3. Analyzing engagement...");
  const analysis = analyzeEngagement(posts, 7);
  console.log(`   This week: ${analysis.stats.totalPosts} posts, ${analysis.stats.totalEngagement} total engagement`);
  console.log(`   Posts avg: ${analysis.stats.avgPostEngagement} | Replies avg: ${analysis.stats.avgReplyEngagement}`);
  console.log(`   Top performer: ${analysis.stats.top5[0]?.engagement || 0} engagement\n`);

  // 4. Load previous report for comparison
  const previousReport = loadPreviousReport();
  if (previousReport) {
    console.log(`   Previous report found: ${previousReport.date}`);
    const followerDelta = profile.followersCount - (previousReport.profile?.followersCount || 0);
    console.log(`   Follower change: ${followerDelta >= 0 ? "+" : ""}${followerDelta}\n`);
  }

  // 5. Claude analysis
  console.log("4. Getting AI analysis...");
  const aiAnalysis = await getClaudeAnalysis(profile, analysis, previousReport);
  console.log("   Analysis complete\n");

  // 6. Save report
  console.log("5. Saving report...");
  const report = {
    date: new Date().toISOString().split("T")[0],
    profile: {
      handle: profile.handle,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      postsCount: profile.postsCount,
    },
    stats: analysis.stats,
    topics: analysis.topics,
    hourBuckets: analysis.hourBuckets,
    top5: analysis.stats.top5,
  };
  const filename = saveReport(report);

  // 7. Discord report
  console.log("6. Sending Discord report...\n");

  const top5Text = analysis.stats.top5
    .slice(0, 5)
    .map((p, i) => {
      const icon = p.type === "reply" ? "💬" : "📢";
      return `${i + 1}. ${icon} ${p.likes}❤️ ${p.reposts}🔁 ${p.replies}💬 — "${p.text.slice(0, 60)}..."`;
    })
    .join("\n");

  const followerDelta = previousReport
    ? profile.followersCount - (previousReport.profile?.followersCount || 0)
    : null;
  const followerLine = followerDelta !== null
    ? `Followers: **${profile.followersCount}** (${followerDelta >= 0 ? "+" : ""}${followerDelta} this week)`
    : `Followers: **${profile.followersCount}**`;

  const summaryMsg = [
    `📊 **Algo Cracker — Weekly Report** (${report.date})`,
    "",
    `**@${profile.handle}**`,
    followerLine,
    `Posts this week: ${analysis.stats.posts} standalone, ${analysis.stats.replies} replies`,
    `Total engagement: ${analysis.stats.totalEngagement}`,
    `Avg per post: ${analysis.stats.avgPostEngagement} | Avg per reply: ${analysis.stats.avgReplyEngagement}`,
    "",
    `**Top 5 Performers:**`,
    top5Text || "No posts this week",
  ].join("\n");

  await notifyDiscord(summaryMsg);

  // Send AI analysis as second message
  await notifyDiscord(`🤖 **AI Analysis:**\n\n${aiAnalysis}`);

  console.log("=== Done ===");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await notifyDiscord(`📊❌ **Weekly Analytics FAILED:** ${err.message}`);
  process.exit(1);
});
