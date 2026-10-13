const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CHANGE THESE ============
const ACCESS_PASSWORD = 'TJPHACK786';
const TWELVE_API_KEY = '5739d9602c3e41d7a9df9a8bfda2892b';
// ======================================

const activeTokens = new Set();
const pendingSignals = new Map();

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

// FIXED: slash ke saath symbol (EUR/USD)
function toSymbol(pair) {
  const map = {
    'EUR/USD OTC': 'EUR/USD',
    'GBP/USD OTC': 'GBP/USD',
    'USD/JPY OTC': 'USD/JPY',
    'USD/CAD OTC': 'USD/CAD',
    'USD/CHF OTC': 'USD/CHF',
    'AUD/USD OTC': 'AUD/USD',
    'AUD/CAD OTC': 'AUD/CAD',
    'AUD/NZD OTC': 'AUD/NZD',
    'NZD/CAD OTC': 'NZD/CAD',
    'USD/BRL OTC': 'USD/BRL',
    'USD/INR OTC': 'USD/INR',
    'EUR/GBP OTC': 'EUR/GBP'
  };
  return map[pair] || pair.replace(' OTC', '');
}

function toSeconds(tf) {
  if (tf === '10 Seconds') return 10;
  if (tf === '15 Seconds') return 15;
  if (tf === '30 Seconds') return 30;
  if (tf === '1 Minute') return 60;
  if (tf === '5 Minutes') return 300;
  return 60;
}

async function getPrice(pair) {
  const symbol = toSymbol(pair);
  const url = `https://api.twelvedata.com/price?symbol=\( {encodeURIComponent(symbol)}&apikey= \){TWELVE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error' || !data.price) {
    throw new Error(data.message || 'Price fetch failed');
  }
  return parseFloat(data.price);
}

function generateDirection(pair, timeframe) {
  const now = new Date();
  const minuteKey = `\( {now.getUTCFullYear()}- \){now.getUTCMonth()}-\( {now.getUTCDate()}- \){now.getUTCHours()}-${now.getUTCMinutes()}`;
  const seed = `\( {pair}| \){timeframe}|${minuteKey}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return parseInt(hash.substring(0, 2), 16) % 2 === 0 ? 'CALL' : 'PUT';
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
  req.token = token;
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

app.post('/api/signal', requireAuth, async (req, res) => {
  try {
    const { pair, timeframe } = req.body || {};
    if (!pair || !timeframe) {
      return res.status(400).json({ error: 'Missing pair or timeframe' });
    }
    if (!PAIRS.includes(pair) || !TIMEFRAMES.includes(timeframe)) {
      return res.status(400).json({ error: 'Invalid pair or timeframe' });
    }

    const entryPrice = await getPrice(pair);
    const direction = generateDirection(pair, timeframe);
    const confidence = 55 + Math.floor(Math.random() * 31);

    const key = `\( {req.token}| \){pair}|${Date.now()}`;
    pendingSignals.set(key, {
      entryPrice,
      direction,
      pair,
      timeframe,
      entryTime: Date.now(),
      seconds: toSeconds(timeframe)
    });

    setTimeout(() => pendingSignals.delete(key), 10 * 60 * 1000);

    res.json({
      signal: {
        direction,
        pair,
        timeframe,
        confidence,
        entryPrice,
        signalId: key
      }
    });
  } catch (err) {
    console.error('Signal error:', err.message);
    res.status(500).json({ error: 'Unable to fetch price. Check API key or limit.' });
  }
});

app.post('/api/check-result', requireAuth, async (req, res) => {
  try {
    const { signalId } = req.body || {};
    if (!signalId || !pendingSignals.has(signalId)) {
      return res.status(400).json({ error: 'Invalid or expired signal' });
    }

    const sig = pendingSignals.get(signalId);
    const exitPrice = await getPrice(sig.pair);

    let result = 'LOSS';
    if (sig.direction === 'CALL' && exitPrice > sig.entryPrice) result = 'WIN';
    if (sig.direction === 'PUT' && exitPrice < sig.entryPrice) result = 'WIN';

    const diff = exitPrice - sig.entryPrice;
    const multiplier = sig.pair.includes('JPY') ? 100 : 10000;
    const diffPips = (diff * multiplier).toFixed(1);

    pendingSignals.delete(signalId);

    res.json({
      result,
      direction: sig.direction,
      pair: sig.pair,
      timeframe: sig.timeframe,
      entryPrice: sig.entryPrice,
      exitPrice,
      diff,
      diffPips
    });
  } catch (err) {
    console.error('Check result error:', err.message);
    res.status(500).json({ error: 'Unable to fetch exit price' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trading Janta Party running at http://localhost:${PORT}`);
});
