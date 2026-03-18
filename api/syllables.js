const dict = require('../cmu-syllables.json');

// Heuristic fallback for words not in dictionary
function heuristicCount(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;

  // Known exceptions
  const exceptions = {
    'fire': 1, 'hire': 1, 'wire': 1, 'tire': 1, 'dire': 1,
    'our': 1, 'hour': 1, 'their': 1, 'there': 1, 'where': 1,
    'were': 1, 'here': 1, 'mere': 1,
    'the': 1, 'are': 1,
    'world': 1, 'girl': 1, 'pearl': 1, 'curl': 1, 'swirl': 1,
  };
  if (exceptions[w]) return exceptions[w];

  // Standard vowel-group heuristic
  let count = (w.match(/[aeiouy]+/g) || []).length;

  // Silent e at end (but not "le" endings like "bottle")
  if (w.endsWith('e') && !w.endsWith('le') && count > 1) count--;

  // -ed endings that don't add a syllable
  if (w.endsWith('ed') && !w.endsWith('ted') && !w.endsWith('ded') && count > 1) count--;

  // Minimum 1
  return Math.max(1, count);
}

function countWord(word) {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return 0;

  // Strip possessives
  const lookup = clean.replace(/'s$/, '').replace(/'$/, '');

  if (dict[lookup] !== undefined) return dict[lookup];

  return heuristicCount(lookup);
}

function countLine(line) {
  const words = line.trim().split(/\s+/).filter(w => w.length > 0);
  let total = 0;
  const breakdown = [];

  for (const word of words) {
    const count = countWord(word);
    const cleanWord = word.toLowerCase().replace(/[^a-z']/g, '').replace(/'s$/, '').replace(/'$/, '');
    total += count;
    breakdown.push({ word, syllables: count, source: dict[cleanWord] !== undefined ? 'dict' : 'heuristic' });
  }

  return { total, breakdown };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://frogpond.lol');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { lines } = req.body;

  if (!lines || !Array.isArray(lines) || lines.length === 0 || lines.length > 10) {
    return res.status(400).json({ error: 'Provide 1-10 text lines as an array.' });
  }

  const results = lines.map(line => {
    if (typeof line !== 'string') return { total: 0, breakdown: [] };
    return countLine(line);
  });

  return res.status(200).json({ results });
};
