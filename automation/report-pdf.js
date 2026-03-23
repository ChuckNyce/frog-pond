/**
 * Digital Organism — PDF Report Generator
 *
 * Generates a styled weekly analytics PDF report.
 */

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// ── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#f9fafb",
  primary: "#10B981",       // Digital Organism green
  primaryDark: "#059669",
  text: "#1f2937",
  textLight: "#6b7280",
  textMuted: "#9ca3af",
  accent: "#3b82f6",
  warning: "#f59e0b",
  surface: "#ffffff",
  border: "#e5e7eb",
  bluesky: "#0085ff",
  twitter: "#1d9bf0",
  up: "#10b981",
  down: "#ef4444",
  neutral: "#6b7280",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function drawRoundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fill(fill);
  if (stroke) { doc.roundedRect(x, y, w, h, r); doc.stroke(stroke); }
}

function deltaString(current, previous) {
  if (previous === null || previous === undefined) return "";
  const d = current - previous;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "±0";
}

function deltaColor(current, previous) {
  if (previous === null || previous === undefined) return COLORS.neutral;
  return current > previous ? COLORS.up : current < previous ? COLORS.down : COLORS.neutral;
}

// ── PDF Generation ──────────────────────────────────────────────────────────

function generateReport(reportData, aiAnalysis, outputPath) {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
    info: {
      Title: `Digital Organism — Weekly Report (${reportData.date})`,
      Author: "Digital Organism",
    },
  });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const W = doc.page.width - 100; // usable width
  const LEFT = 50;

  // ── Header ──────────────────────────────────────────────────────────────

  // Brand bar
  doc.rect(0, 0, doc.page.width, 4).fill(COLORS.primary);

  doc.fontSize(28).font("Helvetica-Bold").fillColor(COLORS.text)
    .text("Digital Organism", LEFT, 30);
  doc.fontSize(12).font("Helvetica").fillColor(COLORS.textLight)
    .text("Weekly Analytics Report", LEFT, 62);
  doc.fontSize(11).fillColor(COLORS.textMuted)
    .text(reportData.date, LEFT + W - 80, 35, { width: 80, align: "right" });

  // Thin separator
  doc.moveTo(LEFT, 85).lineTo(LEFT + W, 85).strokeColor(COLORS.border).lineWidth(0.5).stroke();

  let y = 100;

  // ── Account Cards ───────────────────────────────────────────────────────

  for (const account of reportData.accounts) {
    const prev = reportData.previous?.accounts?.find((a) => a.handle === account.handle) || null;
    const platformColor = account.platform === "Bluesky" ? COLORS.bluesky : COLORS.twitter;

    // Check if we need a new page
    if (y > 580) { doc.addPage(); y = 50; }

    // Card background
    drawRoundedRect(doc, LEFT, y, W, 200, 8, "#ffffff");
    drawRoundedRect(doc, LEFT, y, W, 200, 8, null, COLORS.border);

    // Platform badge
    drawRoundedRect(doc, LEFT + 15, y + 15, 75, 22, 4, platformColor);
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff")
      .text(account.platform, LEFT + 20, y + 20, { width: 65, align: "center" });

    // Handle
    doc.fontSize(18).font("Helvetica-Bold").fillColor(COLORS.text)
      .text(account.handle, LEFT + 100, y + 15);

    // Stats row
    const statsY = y + 50;
    const statW = W / 4 - 10;

    // Followers
    const fDelta = prev ? deltaString(account.followers, prev.followers) : "";
    const fColor = prev ? deltaColor(account.followers, prev.followers) : COLORS.neutral;
    doc.fontSize(24).font("Helvetica-Bold").fillColor(COLORS.text)
      .text(String(account.followers), LEFT + 15, statsY);
    if (fDelta) {
      doc.fontSize(11).font("Helvetica").fillColor(fColor)
        .text(fDelta, LEFT + 15 + doc.widthOfString(String(account.followers), { fontSize: 24 }) + 8, statsY + 6);
    }
    doc.fontSize(9).font("Helvetica").fillColor(COLORS.textMuted)
      .text("Followers", LEFT + 15, statsY + 28);

    // Posts this week
    doc.fontSize(24).font("Helvetica-Bold").fillColor(COLORS.text)
      .text(String(account.thisWeek.total), LEFT + statW + 25, statsY);
    doc.fontSize(9).font("Helvetica").fillColor(COLORS.textMuted)
      .text("Posts this week", LEFT + statW + 25, statsY + 28);

    // Total engagement
    doc.fontSize(24).font("Helvetica-Bold").fillColor(COLORS.text)
      .text(String(account.thisWeek.totalEngagement), LEFT + statW * 2 + 35, statsY);
    doc.fontSize(9).font("Helvetica").fillColor(COLORS.textMuted)
      .text("Total engagement", LEFT + statW * 2 + 35, statsY + 28);

    // Avg engagement
    const bestAvg = Math.max(
      parseFloat(account.thisWeek.avgPostEng) || 0,
      parseFloat(account.thisWeek.avgReplyEng) || 0,
      parseFloat(account.thisWeek.avgQuoteEng) || 0,
    );
    doc.fontSize(24).font("Helvetica-Bold").fillColor(COLORS.text)
      .text(bestAvg.toFixed(1), LEFT + statW * 3 + 45, statsY);
    doc.fontSize(9).font("Helvetica").fillColor(COLORS.textMuted)
      .text("Best avg eng.", LEFT + statW * 3 + 45, statsY + 28);

    // Breakdown row
    const breakY = statsY + 55;
    doc.fontSize(10).font("Helvetica").fillColor(COLORS.textLight);
    const parts = [];
    if (account.thisWeek.posts > 0) parts.push(`${account.thisWeek.posts} posts (avg ${account.thisWeek.avgPostEng})`);
    if (account.thisWeek.replies > 0) parts.push(`${account.thisWeek.replies} replies (avg ${account.thisWeek.avgReplyEng})`);
    if (account.thisWeek.quotes > 0) parts.push(`${account.thisWeek.quotes} quotes (avg ${account.thisWeek.avgQuoteEng})`);
    doc.text(parts.join("  •  ") || "No posts this week", LEFT + 15, breakY);

    // Top performers
    const topY = breakY + 22;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.text)
      .text("Top Performers", LEFT + 15, topY);

    let pY = topY + 16;
    const top3 = (account.thisWeek.top5 || []).slice(0, 3);
    if (top3.length === 0) {
      doc.fontSize(9).font("Helvetica").fillColor(COLORS.textMuted)
        .text("No posts this week", LEFT + 15, pY);
    }
    for (const p of top3) {
      const typeLabel = p.type === "reply" ? "[reply]" : p.type === "quote" ? "[quote]" : "[post]";
      const stats = `${p.likes}L ${p.reposts}RT ${p.replies}R`;
      const line = `${typeLabel} ${stats} — ${p.text.slice(0, 65)}...`;
      doc.fontSize(8.5).font("Helvetica").fillColor(COLORS.textLight)
        .text(line, LEFT + 15, pY, { width: W - 30 });
      pY += 14;
    }

    // Topic tags
    const topics = Object.entries(account.topics || {});
    if (topics.length > 0) {
      const tagY = Math.max(pY + 5, y + 170);
      let tagX = LEFT + 15;
      for (const [topic, data] of topics.slice(0, 5)) {
        const label = `${topic} (${data.count})`;
        const tagW = doc.widthOfString(label, { fontSize: 8 }) + 12;
        if (tagX + tagW > LEFT + W - 15) break;
        drawRoundedRect(doc, tagX, tagY, tagW, 16, 3, "#f0fdf4");
        doc.fontSize(8).font("Helvetica").fillColor(COLORS.primaryDark)
          .text(label, tagX + 6, tagY + 4);
        tagX += tagW + 6;
      }
    }

    y += 215;
  }

  // ── AI Analysis Section ─────────────────────────────────────────────────

  if (aiAnalysis) {
    if (y > 450) { doc.addPage(); y = 50; }

    // Section header
    doc.fontSize(16).font("Helvetica-Bold").fillColor(COLORS.text)
      .text("AI Analysis & Recommendations", LEFT, y);
    y += 25;

    // Analysis text in a card
    drawRoundedRect(doc, LEFT, y, W, 10, 8, "#f0fdf4"); // placeholder height, will grow

    doc.fontSize(9.5).font("Helvetica").fillColor(COLORS.text);

    // Split AI analysis into paragraphs and render
    const paragraphs = aiAnalysis.split("\n").filter((l) => l.trim());
    let textY = y + 15;

    for (const para of paragraphs) {
      // Check for headers (lines starting with # or **)
      const isHeader = para.match(/^#{1,3}\s+(.+)/) || para.match(/^\*\*(.+?)\*\*/);
      const isBullet = para.match(/^[-•*]\s+/);

      if (isHeader) {
        const headerText = isHeader[1] || para.replace(/[#*]/g, "").trim();
        if (textY > 700) { doc.addPage(); textY = 50; }
        doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.primaryDark)
          .text(headerText, LEFT + 15, textY, { width: W - 30 });
        textY += 18;
      } else if (isBullet) {
        if (textY > 700) { doc.addPage(); textY = 50; }
        const bulletText = para.replace(/^[-•*]\s+/, "").replace(/\*\*/g, "");
        doc.fontSize(9.5).font("Helvetica").fillColor(COLORS.text)
          .text(`•  ${bulletText}`, LEFT + 25, textY, { width: W - 50 });
        textY += doc.heightOfString(`•  ${bulletText}`, { width: W - 50, fontSize: 9.5 }) + 4;
      } else {
        if (textY > 700) { doc.addPage(); textY = 50; }
        const cleanText = para.replace(/\*\*/g, "");
        doc.fontSize(9.5).font("Helvetica").fillColor(COLORS.text)
          .text(cleanText, LEFT + 15, textY, { width: W - 30 });
        textY += doc.heightOfString(cleanText, { width: W - 30, fontSize: 9.5 }) + 6;
      }
    }
  }

  // ── Footer (on each page) ────────────────────────────────────────────────

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    // Position cursor explicitly and disable auto page-add
    const footerText = `Digital Organism — Weekly Report — ${reportData.date} — Page ${i + 1} of ${range.count}`;
    const footerY = doc.page.height - 35;

    doc.save();
    doc.fontSize(8).font("Helvetica").fillColor(COLORS.textMuted);
    const textWidth = doc.widthOfString(footerText);
    const textX = LEFT + (W - textWidth) / 2;
    doc.text(footerText, textX, footerY, { lineBreak: false, height: 10 });

    // Bottom brand bar
    doc.rect(0, doc.page.height - 4, doc.page.width, 4).fill(COLORS.primary);
    doc.restore();
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generateReport };
