// In-memory rate limiter (per-instance, resets on cold start)
const rateMap = new Map();
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
let requestCount = 0;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function maskIp(ip) {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }
  // IPv6 or other — mask last segment
  return ip.replace(/:[^:]+$/, ':xxx');
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.resetTime) {
      rateMap.delete(key);
    }
  }
}

function checkRateLimit(ip) {
  const now = Date.now();

  // Periodic cleanup every 100 requests
  requestCount++;
  if (requestCount % 100 === 0) {
    cleanupExpiredEntries();
  }

  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return null; // not limited
  }

  entry.count++;

  if (entry.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return retryAfter;
  }

  return null; // not limited
}

const ALLOWED_BODY_FIELDS = new Set(['model', 'max_tokens', 'system', 'messages']);
const MAX_SYSTEM_LENGTH = 1000;
const MAX_TEXT_LENGTH = 5000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

function validateRequest(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object.';
  }

  // Reject unexpected fields
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.has(key)) {
      return `Unexpected field: "${key}". Only model, max_tokens, system, and messages are allowed.`;
    }
  }

  // Validate messages
  if (!body.messages || !Array.isArray(body.messages)) {
    return 'messages must be an array.';
  }
  if (body.messages.length < 1 || body.messages.length > 2) {
    return 'messages must contain 1-2 messages.';
  }

  // Validate system prompt
  if (body.system !== undefined) {
    if (typeof body.system !== 'string') {
      return 'system must be a string.';
    }
    if (body.system.length > MAX_SYSTEM_LENGTH) {
      return `system prompt must be under ${MAX_SYSTEM_LENGTH} characters.`;
    }
  }

  // Validate message content
  for (const msg of body.messages) {
    if (!msg || typeof msg !== 'object') {
      return 'Each message must be an object.';
    }

    const content = msg.content;

    // String content
    if (typeof content === 'string') {
      if (content.length > MAX_TEXT_LENGTH) {
        return `Message text must be under ${MAX_TEXT_LENGTH} characters.`;
      }
      continue;
    }

    // Array content (text + image blocks)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          if (typeof block.text !== 'string' || block.text.length > MAX_TEXT_LENGTH) {
            return `Message text must be under ${MAX_TEXT_LENGTH} characters.`;
          }
        } else if (block.type === 'image') {
          if (block.source?.type === 'base64' && typeof block.source.data === 'string') {
            const approxBytes = block.source.data.length * 0.75;
            if (approxBytes > MAX_IMAGE_BYTES) {
              return 'Image data must be under 5MB.';
            }
          }
        }
      }
      continue;
    }

    return 'Message content must be a string or array of content blocks.';
  }

  return null; // valid
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://frogpond.lol');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-frog-admin');
    return res.status(204).end();
  }

  const ip = getClientIp(req);
  const maskedIp = maskIp(ip);
  const timestamp = new Date().toISOString();

  if (req.method !== 'POST') {
    console.log(`${timestamp} | ${maskedIp} | rate_limited=false | status=405`);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Admin bypass — skip rate limiting entirely
  const isAdmin = req.headers['x-frog-admin'] === 'ribbit';

  // Rate limiting
  const retryAfter = isAdmin ? null : checkRateLimit(ip);
  if (retryAfter !== null) {
    console.log(`${timestamp} | ${maskedIp} | rate_limited=true | status=429`);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'slow down — too many requests. try again later.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log(`${timestamp} | ${maskedIp} | rate_limited=false | status=500`);
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Request validation
  const validationError = validateRequest(req.body);
  if (validationError) {
    console.log(`${timestamp} | ${maskedIp} | rate_limited=false | status=400`);
    return res.status(400).json({ error: validationError });
  }

  const { system, messages } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system,
        messages,
      }),
    });

    const data = await response.json();
    const status = response.ok ? 200 : response.status;

    console.log(`${timestamp} | ${maskedIp} | rate_limited=false | status=${status}`);

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.log(`${timestamp} | ${maskedIp} | rate_limited=false | status=500`);
    return res.status(500).json({ error: err.message });
  }
}
