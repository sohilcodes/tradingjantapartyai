const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CONFIGURATION ============
const ACCESS_PASSWORD = 'TJPHACK786';
const TWELVE_API_KEY = '5739d9602c3e41d7a9df9a8bfda2892b';
// =======================================

const activeTokens = new Set();
const pendingSignals = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PAIRS = [
  'EUR/USD OTC',
  'GBP/USD OTC',
  'USD/JPY OTC',
  'USD/CAD OTC',
  'USD/CHF OTC',
  'AUD/USD OTC',
  'AUD/CAD OTC',
  'AUD/NZD OTC',
  'NZD/CAD OTC',
  'USD/BRL OTC',
  'USD/INR OTC',
  'EUR/GBP OTC'
];

const TIMEFRAMES = [
  '10 Seconds',
  '15 Seconds',
  '30 Seconds',
  '1 Minute',
  '5 Minutes'
];

const TIMEFRAME_SECONDS = {
  '10 Seconds': 10,
  '15 Seconds': 15,
  '30 Seconds': 30,
  '1 Minute': 60,
  '5 Minutes': 300
};

// ============ PAIR SYMBOL ============
function toSymbol(pair) {
  return pair.replace(' OTC', '');
}

// ============ TIMEFRAME ============
function toSeconds(timeframe) {
  return TIMEFRAME_SECONDS[timeframe] || 60;
}

// ============ FETCH PRICE ============
async function getPrice(pair) {
  if (
    !TWELVE_API_KEY ||
    TWELVE_API_KEY ===
      'PASTE_YOUR_NEW_TWELVE_DATA_API_KEY'
  ) {
    throw new Error('Configure your Twelve Data API key');
  }

  const symbol = toSymbol(pair);

  const url =
    `https://api.twelvedata.com/price` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${encodeURIComponent(TWELVE_API_KEY)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Price API HTTP ${response.status}`);
  }

  if (
    data.status === 'error' ||
    data.price === undefined ||
    data.price === null
  ) {
    throw new Error(
      data.message || 'Price unavailable from Twelve Data'
    );
  }

  const price = Number(data.price);

  if (!Number.isFinite(price)) {
    throw new Error('Invalid price received from API');
  }

  return price;
}

// ============ SIGNAL DIRECTION ============
// NOTE: This is a deterministic direction generator,
// NOT a genuine market prediction algorithm.
function generateDirection(pair, timeframe) {
  const now = new Date();

  const timeBucket = Math.floor(
    now.getTime() / 60000
  );

  const seed =
    `${pair}|${timeframe}|${timeBucket}`;

  const hash = crypto
    .createHash('sha256')
    .update(seed)
    .digest('hex');

  return parseInt(hash.substring(0, 8), 16) % 2 === 0
    ? 'CALL'
    : 'PUT';
}

// ============ AUTHENTICATION ============
function requireAuth(req, res, next) {
  const authorization =
    req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized. Please log in again.'
    });
  }

  const token = authorization.slice(7);

  if (!activeTokens.has(token)) {
    return res.status(401).json({
      error: 'Invalid session. Please log in again.'
    });
  }

  req.token = token;
  next();
}

// ============ LOGIN ============
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};

  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({
      error: 'Wrong password'
    });
  }

  const token = crypto.randomBytes(32).toString('hex');

  activeTokens.add(token);

  res.json({
    success: true,
    token
  });
});

// ============ CONFIG ============
app.get('/api/config', (req, res) => {
  res.json({
    pairs: PAIRS,
    timeframes: TIMEFRAMES
  });
});

// ============ GENERATE SIGNAL ============
app.post('/api/signal', requireAuth, async (req, res) => {
  try {
    const { pair, timeframe } = req.body || {};

    if (!pair || !timeframe) {
      return res.status(400).json({
        error: 'Please select a pair and timeframe.'
      });
    }

    if (
      !PAIRS.includes(pair) ||
      !TIMEFRAMES.includes(timeframe)
    ) {
      return res.status(400).json({
        error: 'Invalid pair or timeframe.'
      });
    }

    const entryPrice = await getPrice(pair);
    const direction = generateDirection(pair, timeframe);

    const signalId = crypto.randomBytes(24).toString('hex');

    const entryTime = Date.now();
    const durationSeconds = toSeconds(timeframe);

    const signal = {
      signalId,
      userToken: req.token,
      pair,
      timeframe,
      direction,
      entryPrice,
      entryTime,
      durationSeconds,
      status: 'PENDING',
      result: null
    };

    pendingSignals.set(signalId, signal);

    // Remove old, unfinished signals after 15 minutes.
    setTimeout(() => {
      const saved = pendingSignals.get(signalId);

      if (saved && saved.status === 'PENDING') {
        pendingSignals.delete(signalId);
      }
    }, 15 * 60 * 1000).unref?.();

    res.json({
      success: true,
      signal: {
        signalId,
        pair,
        timeframe,
        direction,
        entryPrice,
        entryTime,
        expiryTime: entryTime + durationSeconds * 1000,
        durationSeconds
      }
    });
  } catch (error) {
    console.error('Signal error:', error.message);

    res.status(502).json({
      error: 'Unable to fetch entry price. Check your API key, API quota and pair availability.'
    });
  }
});

// ============ CHECK WIN / LOSS ============
app.post(
  '/api/check-result',
  requireAuth,
  async (req, res) => {
    try {
      const { signalId } = req.body || {};

      if (!signalId) {
        return res.status(400).json({
          error: 'Signal ID is required.'
        });
      }

      const signal = pendingSignals.get(signalId);

      if (!signal || signal.userToken !== req.token) {
        return res.status(404).json({
          error: 'Signal not found or expired.'
        });
      }

      // Return the saved result if already checked.
      if (signal.status === 'COMPLETED') {
        return res.json({
          success: true,
          ...signal.result
        });
      }

      // Do not check the result before expiry.
      const expiryTime =
        signal.entryTime + signal.durationSeconds * 1000;

      const remainingMs = expiryTime - Date.now();

      if (remainingMs > 0) {
        return res.status(202).json({
          success: false,
          status: 'WAITING',
          message: 'Signal has not expired yet.',
          remainingSeconds: Math.ceil(remainingMs / 1000),
          expiryTime
        });
      }

      // Prevent concurrent checks for the same signal.
      if (signal.status === 'CHECKING') {
        return res.status(409).json({
          error: 'This signal is already being checked. Try again shortly.'
        });
      }

      signal.status = 'CHECKING';

      let exitPrice;

      try {
        exitPrice = await getPrice(signal.pair);
      } catch (error) {
        signal.status = 'PENDING';
        throw error;
      }

      let result;

      if (exitPrice === signal.entryPrice) {
        result = 'DRAW';
      } else if (
        signal.direction === 'CALL' &&
        exitPrice > signal.entryPrice
      ) {
        result = 'WIN';
      } else if (
        signal.direction === 'PUT' &&
        exitPrice < signal.entryPrice
      ) {
        result = 'WIN';
      } else {
        result = 'LOSS';
      }

      const difference = exitPrice - signal.entryPrice;

      const multiplier = signal.pair.includes('JPY')
        ? 100
        : 10000;

      const resultData = {
        result,
        direction: signal.direction,
        pair: signal.pair,
        timeframe: signal.timeframe,
        entryPrice: signal.entryPrice,
        exitPrice,
        difference,
        diffPips: Number(
          (difference * multiplier).toFixed(2)
        ),
        completedAt: Date.now()
      };

      signal.status = 'COMPLETED';
      signal.result = resultData;

      res.json({
        success: true,
        ...resultData
      });
    } catch (error) {
      console.error(
        'Check result error:',
        error.message
      );

      res.status(502).json({
        error: 'Unable to fetch exit price. Check API connectivity and quota, then try again.'
      });
    }
  }
);

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Trading Janta Party',
    timestamp: new Date().toISOString()
  });
});

// ============ HOME PAGE ============
app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

// ============ START SERVER ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Trading Janta Party running on port ${PORT}`
  );
});
