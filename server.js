const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ACCESS_PASSWORD = 'zavian@532#$';
const activeTokens = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PAIRS = [
  'EUR/USD OTC', 'GBP/USD OTC', 'USD/JPY OTC', 'USD/CAD OTC',
  'USD/CHF OTC', 'AUD/USD OTC', 'AUD/CAD OTC', 'AUD/NZD OTC',
  'NZD/CAD OTC', 'USD/BRL OTC', 'USD/INR OTC', 'EUR/GBP OTC'
];

const TIMEFRAMES = [
  '10 Seconds', '15 Seconds', '30 Seconds', '1 Minute', '5 Minutes'
];

function generateSignal(pair, timeframe) {
  const now = new Date();
  const minuteKey = `\( {now.getUTCFullYear()}- \){now.getUTCMonth()}-\( {now.getUTCDate()}- \){now.getUTCHours()}-${now.getUTCMinutes()}`;
  const seed = `\( {pair}| \){timeframe}|${minuteKey}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const directionBit = parseInt(hash.substring(0, 2), 16);
  const direction = directionBit % 2 === 0 ? 'CALL' : 'PUT';
  const confRaw = parseInt(hash.substring(2, 4), 16);
  const confidence = 55 + (confRaw % 31);
  return { direction, pair, timeframe, confidence };
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.slice(7);
  if (!activeTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ACCESS_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/config', (req, res) => {
  res.json({ pairs: PAIRS, timeframes: TIMEFRAMES });
});

app.post('/api/signal', requireAuth, (req, res) => {
  const { pair, timeframe } = req.body || {};
  if (!pair || !timeframe) {
    return res.status(400).json({ error: 'Missing pair or timeframe' });
  }
  if (!PAIRS.includes(pair) || !TIMEFRAMES.includes(timeframe)) {
    return res.status(400).json({ error: 'Invalid pair or timeframe' });
  }
  const signal = generateSignal(pair, timeframe);
  res.json({ signal });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trading Janta Party running at http://localhost:${PORT}`);
});
