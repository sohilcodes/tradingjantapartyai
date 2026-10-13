(function () {
  'use strict';

  const loginScreen = document.getElementById('loginScreen');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('loginError');

  const mainScreen = document.getElementById('mainScreen');
  const pairTitle = document.getElementById('pairTitle');
  const logoutBtn = document.getElementById('logout');
  const pairBtn = document.getElementById('pairBtn');
  const soundBtn = document.getElementById('soundBtn');
  const musicBtn = document.getElementById('musicBtn');

  const timeframeSelect = document.getElementById('timeframe');
  const pairSelect = document.getElementById('pair');

  const spinner = document.getElementById('spinner');
  const scanText = document.getElementById('scanText');
  const entryText = document.getElementById('entryText');

  const liveResult = document.getElementById('liveResult');
  const liveSticker = document.getElementById('liveSticker');
  const liveDirection = document.getElementById('liveDirection');
  const liveInfo = document.getElementById('liveInfo');

  const countdownEl = document.getElementById('countdown');
  const progressBar = document.getElementById('progressBar');
  const chartCanvas = document.getElementById('chart');

  const getSignalBtn = document.getElementById('getSignal');
  const successMsg = document.getElementById('successMsg');
  const scanCard = document.getElementById('scanCard');

  let token = localStorage.getItem('tjp_token') || null;
  let soundEnabled = true;
  let musicEnabled = false;
  let scanning = false;
  let countdownTimer = null;
  let chartAnimId = null;

  function showLogin() {
    loginScreen.hidden = false;
    mainScreen.hidden = true;
    token = null;
    localStorage.removeItem('tjp_token');
    resetScanUI();
  }

  function showMain() {
    loginScreen.hidden = true;
    mainScreen.hidden = false;
  }

  function resetScanUI() {
    scanning = false;
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    spinner.hidden = false;
    spinner.style.display = '';
    scanText.hidden = false;
    scanText.textContent = 'Ready for signal';
    entryText.hidden = true;
    entryText.textContent = '';
    liveResult.hidden = true;
    successMsg.hidden = true;
    successMsg.style.color = '';
    scanCard.classList.remove('scanning', 'waiting', 'has-result');
    countdownEl.textContent = '--';
    progressBar.style.width = '0%';
    getSignalBtn.disabled = false;
    getSignalBtn.textContent = 'GET SIGNAL';
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatTime(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function getNextEntryTime(tfLabel) {
    const now = new Date();
    let secondsToAdd = 60;
    if (tfLabel === '10 Seconds') secondsToAdd = 10;
    else if (tfLabel === '15 Seconds') secondsToAdd = 15;
    else if (tfLabel === '30 Seconds') secondsToAdd = 30;
    else if (tfLabel === '1 Minute') secondsToAdd = 60;
    else if (tfLabel === '5 Minutes') secondsToAdd = 300;

    const totalSec = now.getSeconds() + now.getMilliseconds() / 1000;
    let wait = secondsToAdd - (totalSec % secondsToAdd);
    if (wait < 1.5) wait += secondsToAdd;

    const entry = new Date(now.getTime() + wait * 1000);
    entry.setMilliseconds(0);
    return entry;
  }

  function toWaitMs(tf) {
    if (tf === '10 Seconds') return 10000;
    if (tf === '15 Seconds') return 15000;
    if (tf === '30 Seconds') return 30000;
    if (tf === '1 Minute') return 60000;
    if (tf === '5 Minutes') return 300000;
    return 60000;
  }

  async function tryAutoLogin() {
    if (!token) {
      showLogin();
      return;
    }
    showMain();
    await loadConfig();
    drawChart();
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    loginError.hidden = true;
    const pwd = passwordInput.value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.hidden = false;
        loginError.textContent = data.error || 'Wrong password';
        return;
      }
      token = data.token;
      localStorage.setItem('tjp_token', token);
      passwordInput.value = '';
      showMain();
      await loadConfig();
      drawChart();
    } catch (err) {
      loginError.hidden = false;
      loginError.textContent = 'Connection error';
    }
  });

  logoutBtn.addEventListener('click', function () {
    showLogin();
  });

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      pairSelect.innerHTML = '';
      data.pairs.forEach(function (p) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        pairSelect.appendChild(opt);
      });
      timeframeSelect.innerHTML = '';
      data.timeframes.forEach(function (t) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        timeframeSelect.appendChild(opt);
      });
      if (data.pairs.length) {
        pairSelect.value = data.pairs[0];
        pairTitle.textContent = data.pairs[0];
      }
      if (data.timeframes.length) {
        const preferred = data.timeframes.find(function (t) {
          return t === '1 Minute';
        });
        timeframeSelect.value = preferred || data.timeframes[0];
      }
    } catch (err) {
      console.error('Config load failed', err);
    }
  }

  pairSelect.addEventListener('change', function () {
    pairTitle.textContent = pairSelect.value;
  });

  pairBtn.addEventListener('click', function () {
    pairSelect.focus();
    if (typeof pairSelect.showPicker === 'function') {
      try {
        pairSelect.showPicker();
      } catch (_) {}
    }
  });

  soundBtn.addEventListener('click', function () {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? 'Sound ON' : 'Sound OFF';
    soundBtn.classList.toggle('active', soundEnabled);
  });

  musicBtn.addEventListener('click', function () {
    musicEnabled = !musicEnabled;
    musicBtn.textContent = musicEnabled ? 'Music ON' : 'Music OFF';
    musicBtn.classList.toggle('active', musicEnabled);
  });

  function playBeep() {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch (_) {}
  }

  function drawChart() {
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext('2d');
    const w = chartCanvas.width;
    const h = chartCanvas.height;

    function render() {
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(107,92,255,0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = (h / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const points = 40;
      const now = Date.now() / 1000;
      ctx.beginPath();
      ctx.strokeStyle = '#6b5cff';
      ctx.lineWidth = 2;
      for (let i = 0; i < points; i++) {
        const x = (w / (points - 1)) * i;
        const y =
          h / 2 +
          Math.sin(now * 0.4 + i * 0.35) * 28 +
          Math.cos(now * 0.25 + i * 0.2) * 12;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(107,92,255,0.08)';
      ctx.fill();
      chartAnimId = requestAnimationFrame(render);
    }
    if (chartAnimId) cancelAnimationFrame(chartAnimId);
    render();
  }

  getSignalBtn.addEventListener('click', function () {
    if (scanning) return;
    startSignalFlow();
  });

  async function startSignalFlow() {
    scanning = true;
    getSignalBtn.disabled = true;
    getSignalBtn.textContent = 'SCANNING...';
    successMsg.hidden = true;
    successMsg.style.color = '';
    liveResult.hidden = true;
    scanCard.classList.remove('has-result');
    scanCard.classList.add('scanning');

    spinner.hidden = false;
    spinner.style.display = '';
    scanText.hidden = false;
    scanText.textContent = 'CALCULATING NEXT ENTRY...';
    entryText.hidden = true;

    const pair = pairSelect.value;
    const tf = timeframeSelect.value;
    const entry = getNextEntryTime(tf);

    await sleep(600);

    entryText.hidden = false;
    entryText.textContent = 'ENTRY TIME: ' + formatTime(entry);
    scanText.textContent = 'WAITING FOR ENTRY TIME';
    scanCard.classList.add('waiting');

    const totalMs = entry.getTime() - Date.now();
    const startMs = Date.now();

    function updateCountdown() {
      const remaining = Math.max(0, Math.ceil((entry.getTime() - Date.now()) / 1000));
      countdownEl.textContent = remaining + 's';
      const elapsed = Date.now() - startMs;
      const pct = Math.min(100, (elapsed / totalMs) * 100);
      progressBar.style.width = pct + '%';
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        progressBar.style.width = '100%';
        generateSignal(pair, tf);
      }
    }

    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 200);
  }

  async function generateSignal(pair, tf) {
    scanText.textContent = 'GENERATING SIGNAL...';
    entryText.hidden = true;
    spinner.hidden = false;
    spinner.style.display = '';

    try {
      const res = await fetch('/api/signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({ pair: pair, timeframe: tf })
      });

      if (res.status === 401) {
        showLogin();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.error || 'Signal API error');
      }

      const data = await res.json();
      const sig = data.signal;

      // Show CALL / PUT first
      spinner.style.display = 'none';
      scanText.hidden = true;
      entryText.hidden = true;
      liveResult.hidden = false;

      liveSticker.src = sig.direction === 'CALL' ? '/assets/call.webp' : '/assets/put.webp';
      liveSticker.alt = sig.direction;

      liveDirection.textContent = sig.direction;
      liveDirection.className = 'direction ' + sig.direction.toLowerCase();

      liveInfo.innerHTML =
        sig.pair +
        ' • ' +
        sig.timeframe +
        '<br>Entry: ' +
        sig.entryPrice +
        '<br>Confidence ' +
        sig.confidence +
        '%';

      scanCard.classList.remove('scanning', 'waiting');
      scanCard.classList.add('has-result');

      successMsg.hidden = false;
      successMsg.style.color = '#35ee8a';
      successMsg.textContent = '✓ Signal generated • Waiting for result...';
      playBeep();

      // After timeframe → check WIN / LOSS
      const waitMs = toWaitMs(tf);

      setTimeout(async function () {
        try {
          const r = await fetch('/api/check-result', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({ signalId: sig.signalId })
          });

          if (!r.ok) throw new Error('Result check failed');
          const result = await r.json();

          // WIN / LOSS image
          liveSticker.src = result.result === 'WIN' ? '/assets/win.webm' : '/assets/loss.webp';
          liveSticker.alt = result.result;

          liveDirection.textContent = result.result;
          liveDirection.className =
            'direction ' + (result.result === 'WIN' ? 'call' : 'put');

          liveInfo.innerHTML =
            result.pair +
            ' • ' +
            result.timeframe +
            '<br>Entry: ' +
            result.entryPrice +
            ' → Exit: ' +
            result.exitPrice +
            '<br><strong style="color:' +
            (result.result === 'WIN' ? '#35ee8a' : '#ff5876') +
            '">' +
            result.result +
            ' (' +
            result.diffPips +
            ' pips)</strong>';

          successMsg.textContent =
            result.result === 'WIN'
              ? '✓ WIN — Price moved in your direction'
              : '✗ LOSS — Price moved against signal';
          successMsg.style.color =
            result.result === 'WIN' ? '#35ee8a' : '#ff5876';

          playBeep();
        } catch (e) {
          successMsg.textContent = 'Result check failed';
          successMsg.style.color = '#ff5876';
        }
      }, waitMs);
    } catch (err) {
      spinner.style.display = 'none';
      scanText.hidden = false;
      scanText.textContent = 'SIGNAL ERROR';
      entryText.hidden = false;
      entryText.textContent = err.message || 'Unable to generate signal';
      liveResult.hidden = true;
      scanCard.classList.remove('scanning', 'waiting');
    } finally {
      scanning = false;
      getSignalBtn.disabled = false;
      getSignalBtn.textContent = 'GET SIGNAL';
      countdownEl.textContent = '--';
    }
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  tryAutoLogin();
})();
