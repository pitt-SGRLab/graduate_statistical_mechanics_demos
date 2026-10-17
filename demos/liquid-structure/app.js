/*
 * app.js : user interface for the liquid-structure demo.
 * Depends on md.js (window.MD).
 */
(function () {
  'use strict';

  var N = MD.N, RMAX = MD.RMAX, GB = MD.GBINS, CB = MD.CBINS;
  var DG = RMAX / GB, DC = RMAX / CB;          // bin widths (sigma)
  var sys = new MD.System();

  var PRESETS = {
    gas:       { rho: 0.08, T: 1.5,  model: 'lj',  warm: 1500 },
    liquid:    { rho: 0.75, T: 0.55, model: 'lj',  warm: 2500 },
    solid:     { rho: 0.95, T: 0.25, model: 'lj',  warm: 0 },
    repulsive: { rho: 0.75, T: 1.0,  model: 'wca', warm: 2500 }
  };

  var CAPTIONS = {
    count: 'Click any particle to make it the reference. Each bar counts the particles in a thin ring at that distance <em>right now</em>; the black line is the average over the last few seconds.',
    ideal: 'The dashed line is what a structureless ideal gas of the same density would give. It rises with <var>r</var> simply because rings get bigger. Structure is where the black line departs from the dashed one.',
    g:     '<var>g</var>(<var>r</var>) = (average count) ÷ (ideal-gas count), now averaged over all particles. The thin line is one snapshot, the thick line the time average, and the dashed line at <var>g</var> = 1 is the ideal gas.'
  };

  /* ------------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var theme = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    ['ink', 'muted', 'grid', 'accent', 'canvas', 'ideal', 'pin', 'line'].forEach(function (k) {
      theme[k] = cs.getPropertyValue('--' + k).trim();
    });
  }

  // colour map: near = red, far = purple
  var STOPS = [[230, 57, 70], [244, 162, 97], [42, 157, 143], [58, 110, 165], [108, 91, 158]];
  var LUT = [];
  (function () {
    for (var k = 0; k < 128; k++) {
      var t = k / 127 * (STOPS.length - 1), i = Math.min(Math.floor(t), STOPS.length - 2), f = t - i, c = [];
      for (var j = 0; j < 3; j++) c.push(Math.round(STOPS[i][j] + (STOPS[i + 1][j] - STOPS[i][j]) * f));
      LUT.push('rgb(' + c.join(',') + ')');
    }
  })();
  function colorAtR(r) { return LUT[clamp((r / RMAX * 127) | 0, 0, 127)]; }

  // the "reference line": a heavy translucent red line, used for the ring in the box AND the vertical line in the plot
  var REF_LINE = 'rgba(220, 38, 38, 0.6)', REF_LINE_W = 5;

  /* ------------------------------------------------------------------ state */
  var boxCv = $('box'), plotCv = $('plot');
  var bctx = boxCv.getContext('2d'), pctx = plotCv.getContext('2d');
  var dpr = 1, boxW = 600, boxH = 400, plotW = 500, plotH = 320;

  var mode = 'count';
  var ref = 0;
  var hoverR = null;
  var paused = false, colorize = true;
  var warm = 0;                       // remaining fast-forward steps after a preset
  var spf = 10;                       // MD steps per animation frame (adapts to the device)
  var frameNo = 0;

  var gInst = new Float64Array(GB), gAvg = new Float64Array(GB), nG = 0;
  var cInst = new Int32Array(CB), cAvg = new Float64Array(CB), nC = 0;
  var pinned = null, pinLabel = '';
  var yMax = 2, yMaxMode = '';

  /* ------------------------------------------------------------------ sizing */
  function sizeCanvases() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    boxW = Math.max(240, Math.floor(boxCv.parentElement.clientWidth));
    boxH = Math.round(boxW * sys.ly / sys.lx);
    boxCv.style.height = boxH + 'px';
    boxCv.width = Math.round(boxW * dpr); boxCv.height = Math.round(boxH * dpr);

    plotW = Math.max(240, Math.floor(plotCv.parentElement.clientWidth));
    plotH = clamp(Math.round(plotW * 0.62), 230, 340);
    plotCv.style.height = plotH + 'px';
    plotCv.width = Math.round(plotW * dpr); plotCv.height = Math.round(plotH * dpr);
  }

  /* ------------------------------------------------------------------ averaging */
  function resetAvg() { nG = 0; nC = 0; }
  function setRef(i) { ref = i; nC = 0; }

  function sample() {
    var b, a;
    sys.snapshotG(gInst); nG++;
    a = Math.max(1 / nG, 0.01);
    for (b = 0; b < GB; b++) gAvg[b] += (gInst[b] - gAvg[b]) * a;
    sys.countsAround(ref, cInst); nC++;
    a = Math.max(1 / nC, 0.004);
    for (b = 0; b < CB; b++) cAvg[b] += (cInst[b] - cAvg[b]) * a;
  }

  function rhoNow() { return N / (sys.lx * sys.ly); }
  function idealCount(b) { return rhoNow() * Math.PI * ((b + 1) * (b + 1) - b * b) * DC * DC; }
  /** average number of neighbours closer than the end of g-bin `binEnd`, from the averaged g(r) */
  function coordUpTo(binEnd) {
    var s = 0, rho = rhoNow();
    for (var b = 0; b < binEnd; b++) s += rho * gAvg[b] * Math.PI * ((b + 1) * (b + 1) - b * b) * DG * DG;
    return s;
  }

  /* ------------------------------------------------------------------ simulation box drawing */
  function binBounds() {
    if (hoverR == null) return null;
    var bw = mode === 'g' ? DG : DC;
    var lo = Math.floor(hoverR / bw) * bw;
    return [lo, lo + bw];
  }

  function drawBox() {
    var ctx = bctx, W = boxW, H = boxH, sc = W / sys.lx, lx = sys.lx, ly = sys.ly;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var rx = sys.x[ref], ry = sys.y[ref];
    var hb = binBounds();
    var ix, iy, r;

    // faint reference rings at 1..5 sigma (and the hovered ring), drawn around the reference and its periodic images
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = hb ? 0.18 : 0.4;
    for (ix = -1; ix <= 1; ix++) for (iy = -1; iy <= 1; iy++) {
      var cx = (rx + ix * lx) * sc, cy = (ry + iy * ly) * sc;
      if (cx < -RMAX * sc || cx > W + RMAX * sc || cy < -RMAX * sc || cy > H + RMAX * sc) continue;
      for (r = 1; r <= 5; r++) { ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, 6.2832); ctx.stroke(); }
    }
    ctx.restore();

    // particles
    var rad = 0.5 * sc, tmp = [0, 0];
    ctx.lineWidth = 2;
    for (var i = 0; i < N; i++) {
      if (i === ref) continue;
      sys.minImage(ref, i, tmp);
      var d = Math.sqrt(tmp[0] * tmp[0] + tmp[1] * tmp[1]);
      var inBin = hb && d >= hb[0] && d < hb[1];
      ctx.globalAlpha = (hb && !inBin) ? 0.6 : 1;
      ctx.fillStyle = (colorize && d < RMAX) ? colorAtR(d) : (colorize ? theme.pin : theme.accent);
      ctx.beginPath();
      ctx.arc(sys.x[i] * sc, sys.y[i] * sc, rad, 0, 6.2832);
      ctx.fill();
      if (inBin) { ctx.strokeStyle = theme.ink; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;

    // reference particle
    ctx.fillStyle = theme.ink;
    ctx.beginPath(); ctx.arc(rx * sc, ry * sc, rad, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = theme.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(rx * sc, ry * sc, rad + 3.5, 0, 6.2832); ctx.stroke();

    // reference line: circle of radius r around the reference particle (and its periodic images)
    if (hoverR != null) {
      ctx.strokeStyle = REF_LINE; ctx.lineWidth = REF_LINE_W; ctx.setLineDash([]);
      for (ix = -1; ix <= 1; ix++) for (iy = -1; iy <= 1; iy++) {
        ctx.beginPath();
        ctx.arc((rx + ix * lx) * sc, (ry + iy * ly) * sc, hoverR * sc, 0, 6.2832);
        ctx.stroke();
      }
    }
  }

  /* ------------------------------------------------------------------ plot drawing */
  var M = { l: 50, r: 14, t: 14, b: 40 };

  function niceMax(v) {
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    var n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
    return n * e;
  }
  function tickStep(max) {
    var raw = max / 5, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }

  function drawPlot() {
    var ctx = pctx, W = plotW, H = plotH, pw = W - M.l - M.r, ph = H - M.t - M.b, b, r;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // y-axis scale (smoothly follows the data)
    var target, bmax = 0;
    if (mode === 'g') {
      for (b = 0; b < GB; b++) if (gAvg[b] > bmax) bmax = gAvg[b];
      if (pinned) for (b = 0; b < GB; b++) if (pinned[b] > bmax) bmax = pinned[b];
      target = niceMax(Math.max(1.6, bmax * 1.12));
    } else {
      for (b = 0; b < CB; b++) bmax = Math.max(bmax, cAvg[b], cInst[b], mode === 'ideal' ? idealCount(b) : 0);
      target = niceMax(Math.max(1.5, bmax * 1.15));
    }
    if (yMaxMode !== mode) { yMax = target; yMaxMode = mode; } else yMax += (target - yMax) * 0.12;
    function X(rr) { return M.l + rr / RMAX * pw; }
    function Y(v) { return M.t + ph - v / yMax * ph; }

    ctx.font = '12px system-ui, sans-serif';
    ctx.lineWidth = 1;

    // grid + ticks
    var step = tickStep(yMax), v;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (v = 0; v <= yMax + 1e-9; v += step) {
      var yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(M.l, yy); ctx.lineTo(M.l + pw, yy); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(+v.toFixed(2) + '', M.l - 6, yy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (r = 0; r <= RMAX; r++) {
      var xx = Math.round(X(r)) + 0.5;
      ctx.strokeStyle = theme.grid; ctx.beginPath(); ctx.moveTo(xx, M.t); ctx.lineTo(xx, M.t + ph); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.fillText(r + '', xx, M.t + ph + 5);
    }
    ctx.fillStyle = theme.ink;
    ctx.fillText('distance from reference, r / σ', M.l + pw / 2, H - 16);
    ctx.save();
    ctx.translate(13, M.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(mode === 'g' ? 'g(r)' : 'neighbours per ring', 0, 0);
    ctx.restore();

    // clip to the plotting area for data
    ctx.save();
    ctx.beginPath(); ctx.rect(M.l, M.t - 2, pw, ph + 4); ctx.clip();

    var hb = binBounds();

    if (mode === 'g') {
      // ideal gas baseline
      ctx.setLineDash([6, 4]); ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(M.l, Y(1)); ctx.lineTo(M.l + pw, Y(1)); ctx.stroke(); ctx.setLineDash([]);
      // area under average
      ctx.beginPath(); ctx.moveTo(X(0), Y(0));
      for (b = 0; b < GB; b++) ctx.lineTo(X((b + 0.5) * DG), Y(gAvg[b]));
      ctx.lineTo(X(RMAX), Y(0)); ctx.closePath();
      ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
      // pinned
      if (pinned) {
        ctx.strokeStyle = theme.pin; ctx.lineWidth = 2; ctx.setLineDash([2, 3]); ctx.beginPath();
        for (b = 0; b < GB; b++) { var px = X((b + 0.5) * DG), py = Y(pinned[b]); if (b) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      // single snapshot
      ctx.strokeStyle = theme.accent; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.beginPath();
      for (b = 0; b < GB; b++) { var sx = X((b + 0.5) * DG), sy = Y(gInst[b]); if (b) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }
      ctx.stroke(); ctx.globalAlpha = 1;
      // time average
      ctx.strokeStyle = theme.ink; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.beginPath();
      for (b = 0; b < GB; b++) { var ax = X((b + 0.5) * DG), ay = Y(gAvg[b]); if (b) ctx.lineTo(ax, ay); else ctx.moveTo(ax, ay); }
      ctx.stroke();
    } else {
      // instantaneous bars, coloured like the particles
      ctx.globalAlpha = mode === 'ideal' ? 0.5 : 0.92;
      for (b = 0; b < CB; b++) {
        if (!cInst[b]) continue;
        var x0 = X(b * DC), x1 = X((b + 1) * DC), y0 = Y(cInst[b]);
        ctx.fillStyle = colorAtR((b + 0.5) * DC);
        ctx.fillRect(x0 + 0.5, y0, Math.max(1, x1 - x0 - 1), Y(0) - y0);
      }
      ctx.globalAlpha = 1;
      if (mode === 'ideal') {
        ctx.strokeStyle = theme.ideal; ctx.lineWidth = 2.2; ctx.setLineDash([7, 4]); ctx.beginPath();
        ctx.moveTo(X(0), Y(0));
        for (b = 0; b < CB; b++) ctx.lineTo(X((b + 0.5) * DC), Y(idealCount(b)));
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = theme.ink; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.beginPath();
      for (b = 0; b < CB; b++) { var ex = X((b + 0.5) * DC), ey = Y(cAvg[b]); if (b) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey); }
      ctx.stroke();
    }
    ctx.restore();

    // reference line (same style as the ring in the box)
    if (hoverR != null) {
      ctx.strokeStyle = REF_LINE; ctx.lineWidth = REF_LINE_W; ctx.setLineDash([]);
      var hx = X(hoverR);
      ctx.beginPath(); ctx.moveTo(hx, M.t); ctx.lineTo(hx, M.t + ph); ctx.stroke();
    }

    // legend (top right, inside plot)
    var items = [];
    if (mode === 'g') {
      items.push([theme.ink, 2.4, [], 'time average']);
      items.push([theme.accent, 1, [], 'this frame']);
      items.push([theme.muted, 1.2, [6, 4], 'ideal gas']);
      if (pinned) items.push([theme.pin, 2, [2, 3], 'pinned: ' + pinLabel]);
    } else {
      items.push([theme.ink, 2.2, [], 'time average (this particle)']);
      if (mode === 'ideal') items.push([theme.ideal, 2.2, [7, 4], 'ideal gas, same density']);
      else items.push([theme.muted, 6, [], 'bars = this frame']);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '11.5px system-ui, sans-serif';
    var ly0 = M.t + 10;
    items.forEach(function (it, k) {
      var yy = ly0 + k * 16, label = it[3], tw = ctx.measureText(label).width;
      var xr = M.l + pw - 8;
      ctx.fillStyle = theme.muted; ctx.fillText(label, xr, yy);
      ctx.strokeStyle = it[0]; ctx.lineWidth = it[1]; ctx.setLineDash(it[2]);
      ctx.beginPath(); ctx.moveTo(xr - tw - 30, yy); ctx.lineTo(xr - tw - 8, yy); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  /* ------------------------------------------------------------------ readout + stats */
  var lastReadout = '';
  function fmt(v, d) { return v.toFixed(d); }

  function updateReadout() {
    var html;
    if (hoverR == null) {
      html = '<span style="color:var(--muted)">Move the mouse over the box (or across the plot) to set the distance <var>r</var>.</span>';
    } else if (mode === 'g') {
      var gb = clamp((hoverR / DG) | 0, 0, GB - 1), g = gAvg[gb];
      var verdict = g >= 1.05 ? fmt(g, 2) + '× as crowded as an ideal gas: neighbours favoured here'
                  : g <= 0.95 ? 'only ' + fmt(g, 2) + '× as crowded as an ideal gas: neighbours avoided here'
                  : 'same as an ideal gas: no preference';
      html = '<span class="big">r = ' + fmt((gb + 0.5) * DG, 2) + ' σ</span> · g = <span class="big">' + fmt(g, 2) + '</span><br>' +
             'This ring is ' + verdict + '. On average <span class="big">' + fmt(coordUpTo(gb + 1), 1) + '</span> neighbours lie closer than ' + fmt((gb + 1) * DG, 2) + ' σ.';
    } else {
      var cb = clamp((hoverR / DC) | 0, 0, CB - 1);
      html = '<span class="big">ring ' + fmt(cb * DC, 1) + '–' + fmt((cb + 1) * DC, 1) + ' σ</span> · this frame: <span class="big">' + cInst[cb] +
             '</span> · time average: <span class="big">' + fmt(cAvg[cb], 2) + '</span>';
      if (mode === 'ideal') {
        var id = idealCount(cb), ratio = cAvg[cb] / id;
        html += '<br>Ideal gas would give <span class="big" style="color:var(--ideal)">' + fmt(id, 2) + '</span> → ratio ≈ <span class="big">' + fmt(ratio, 2) + '</span> (this particle only; step 3 averages over all of them)';
      } else {
        html += '<br>Ring area = 2π·r·dr = ' + fmt(Math.PI * ((cb + 1) * (cb + 1) - cb * cb) * DC * DC, 2) + ' σ²';
      }
    }
    if (html !== lastReadout) { $('readout').innerHTML = html; lastReadout = html; }
  }

  function updateStats() {
    $('st-T').textContent = fmt(sys.temperature(), 2) + '  (target ' + fmt(sys.T0, 2) + ')';
    $('st-rho').textContent = fmt(rhoNow(), 2);
    if (nG < 8) { $('st-peak').textContent = 'settling…'; $('st-coord').textContent = 'settling…'; return; }
    var pk = 14, b;
    for (b = 14; b <= 44; b++) if (gAvg[b] > gAvg[pk]) pk = b;
    if (gAvg[pk] < 1.25) {
      $('st-peak').textContent = 'none (g ≈ 1)';
      $('st-coord').textContent = '–';
      return;
    }
    $('st-peak').textContent = 'r = ' + fmt((pk + 0.5) * DG, 2) + ' σ, g = ' + fmt(gAvg[pk], 2);
    function sm(k) { var s = 0, c = 0; for (var q = k - 2; q <= k + 2; q++) if (q >= 0 && q < GB) { s += gAvg[q]; c++; } return s / c; }
    var mn = pk + 4;
    for (b = pk + 4; b < Math.min(GB - 3, pk + 30); b++) { if (sm(b) <= sm(b + 1) && sm(b) <= sm(b + 2)) { mn = b; break; } mn = b; }
    var nc = coordUpTo(mn + 1);
    $('st-coord').textContent = fmt(nc, 1) + (nc < 2 ? '  (too few for a real shell)' : '') + '  within ' + fmt((mn + 1) * DG, 2) + ' σ';
  }

  /* ------------------------------------------------------------------ controls */
  function syncControls() {
    $('rho').value = sys.rhoTarget; $('rho-out').textContent = (+sys.rhoTarget).toFixed(2);
    $('T').value = sys.T0; $('T-out').textContent = (+sys.T0).toFixed(2);
    var radios = document.getElementsByName('model');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === sys.model;
  }
  function markPreset(name) {
    document.querySelectorAll('[data-preset]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-preset') === name ? 'true' : 'false');
    });
  }
  function centreParticle() {
    var best = 0, bd = 1e9;
    for (var i = 0; i < N; i++) {
      var dx = sys.x[i] - sys.lx / 2, dy = sys.y[i] - sys.ly / 2, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function start(p, name) {
    sys.setModel(p.model);
    sys.initLattice(p.rho, p.T);
    warm = p.warm;
    resetAvg();
    setRef(centreParticle());
    syncControls();
    markPreset(name || '');
    hoverR = null;
  }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.tabs [role="tab"]').forEach(function (t) {
      t.setAttribute('aria-selected', t.getAttribute('data-mode') === m ? 'true' : 'false');
    });
    $('caption').innerHTML = CAPTIONS[m];
    lastReadout = '';
  }

  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () { var n = b.getAttribute('data-preset'); start(PRESETS[n], n); });
  });
  document.querySelectorAll('.tabs [role="tab"]').forEach(function (t) {
    t.addEventListener('click', function () { setMode(t.getAttribute('data-mode')); });
  });
  $('rho').addEventListener('input', function (e) {
    sys.rhoTarget = +e.target.value; $('rho-out').textContent = (+e.target.value).toFixed(2); markPreset(''); resetAvg();
  });
  $('T').addEventListener('input', function (e) {
    sys.T0 = +e.target.value; $('T-out').textContent = (+e.target.value).toFixed(2); markPreset(''); resetAvg();
  });
  Array.prototype.forEach.call(document.getElementsByName('model'), function (r) {
    r.addEventListener('change', function () { if (r.checked) { sys.setModel(r.value); markPreset(''); resetAvg(); } });
  });
  $('colorize').addEventListener('change', function (e) { colorize = e.target.checked; });
  $('pause').addEventListener('click', function () {
    paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause';
  });
  $('reset-avg').addEventListener('click', resetAvg);
  $('pin').addEventListener('click', function () {
    var btn = $('pin');
    if (pinned) { pinned = null; btn.textContent = 'Pin g(r)'; btn.setAttribute('aria-pressed', 'false'); return; }
    if (nG < 8) return;
    pinned = new Float64Array(gAvg);
    pinLabel = (sys.model === 'lj' ? 'LJ' : 'repulsive') + ', ρ=' + rhoNow().toFixed(2) + ', T=' + sys.T0.toFixed(2);
    btn.textContent = 'Clear pin'; btn.setAttribute('aria-pressed', 'true');
    setMode('g');
  });

  /* ------------------------------------------------------------------ pointer: simulation box */
  // Moving the pointer over the box sets r = distance from the reference particle (shown as the red ring
  // and the red line in the plot). A click or tap (no movement) makes the nearest particle the reference.
  var downAt = null;
  function simPoint(e) {
    var rc = boxCv.getBoundingClientRect();
    return { x: (e.clientX - rc.left) / rc.width * sys.lx, y: (e.clientY - rc.top) / rc.height * sys.ly };
  }
  function ringFromEvent(e) {
    var p = simPoint(e), dx = p.x - sys.x[ref], dy = p.y - sys.y[ref];
    if (dx > sys.lx / 2) dx -= sys.lx; else if (dx < -sys.lx / 2) dx += sys.lx;
    if (dy > sys.ly / 2) dy -= sys.ly; else if (dy < -sys.ly / 2) dy += sys.ly;
    var r = Math.sqrt(dx * dx + dy * dy);
    hoverR = r < RMAX ? r : null;
  }
  function pickParticle(p, maxd) {
    var best = -1, bd = maxd * maxd;
    for (var i = 0; i < N; i++) {
      var dx = sys.x[i] - p.x, dy = sys.y[i] - p.y;
      if (dx > sys.lx / 2) dx -= sys.lx; else if (dx < -sys.lx / 2) dx += sys.lx;
      if (dy > sys.ly / 2) dy -= sys.ly; else if (dy < -sys.ly / 2) dy += sys.ly;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  boxCv.addEventListener('pointermove', ringFromEvent);
  boxCv.addEventListener('pointerdown', function (e) { downAt = { x: e.clientX, y: e.clientY }; ringFromEvent(e); });
  boxCv.addEventListener('pointerup', function (e) {
    var moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
    downAt = null;
    if (moved < 6) {
      var i = pickParticle(simPoint(e), e.pointerType === 'touch' ? 1.7 : 1.0);
      if (i >= 0 && i !== ref) setRef(i);
    }
    if (e.pointerType === 'touch') hoverR = null; else ringFromEvent(e);
  });
  boxCv.addEventListener('pointerleave', function () { hoverR = null; downAt = null; });
  boxCv.addEventListener('pointercancel', function () { hoverR = null; downAt = null; });
  // keep touch drags on the box from scrolling the page
  boxCv.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  boxCv.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  /* ------------------------------------------------------------------ pointer: plot */
  function plotToR(e) {
    var rc = plotCv.getBoundingClientRect();
    var x = (e.clientX - rc.left) * (plotW / rc.width);
    var r = (x - M.l) / (plotW - M.l - M.r) * RMAX;
    return (r >= 0 && r < RMAX) ? r : null;
  }
  plotCv.addEventListener('pointermove', function (e) { hoverR = plotToR(e); });
  plotCv.addEventListener('pointerdown', function (e) { hoverR = plotToR(e); });
  plotCv.addEventListener('pointerleave', function () { hoverR = null; });
  plotCv.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') hoverR = null; });
  plotCv.addEventListener('pointercancel', function () { hoverR = null; });
  plotCv.tabIndex = 0;
  plotCv.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') hoverR = clamp((hoverR == null ? 0.9 : hoverR) + 0.05, 0, RMAX - 0.001);
    else if (e.key === 'ArrowLeft') hoverR = clamp((hoverR == null ? 1.1 : hoverR) - 0.05, 0, RMAX - 0.001);
    else if (e.key === 'Escape') hoverR = null;
    else return;
    e.preventDefault();
  });

  /* ------------------------------------------------------------------ main loop */
  function frame() {
    window.requestAnimationFrame(frame);
    if (document.hidden) return;
    frameNo++;
    if (!paused) {
      var t0 = performance.now(), ramp = sys.relaxDensity(), k;
      if (warm > 0) {
        var done = 0;
        while (done < 600 && performance.now() - t0 < 12) { for (k = 0; k < 20; k++) sys.step(); done += 20; }
        warm -= done;
        if (warm <= 0) { warm = 0; resetAvg(); }
      } else {
        for (k = 0; k < spf; k++) sys.step();
        var dt = performance.now() - t0;
        if (dt > 14 && spf > 3) spf--; else if (dt < 7 && spf < 10) spf++;
      }
      if (ramp || warm > 0) resetAvg();
      sample();
    }
    drawBox();
    drawPlot();
    updateReadout();
    if (frameNo % 6 === 0) updateStats();
  }

  /* ------------------------------------------------------------------ start-up */
  function num(q, key, lo, hi) {
    if (!q.has(key)) return null;
    var v = parseFloat(q.get(key));
    return isFinite(v) ? clamp(v, lo, hi) : null;
  }
  function init() {
    readTheme();
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { readTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    var q = new URLSearchParams(window.location.search);
    var hash = window.location.hash.replace('#', '');
    var name = PRESETS[q.get('preset')] ? q.get('preset') : (PRESETS[hash] ? hash : 'liquid');
    var p = {}, key;
    for (key in PRESETS[name]) p[key] = PRESETS[name][key];
    var rho = num(q, 'rho', 0.05, 1.05), T = num(q, 'T', 0.15, 2), custom = false;
    if (rho != null) { p.rho = rho; custom = true; }
    if (T != null) { p.T = T; custom = true; }
    if (q.get('model') === 'lj' || q.get('model') === 'wca') { p.model = q.get('model'); custom = true; }
    if (custom) p.warm = (p.rho >= 0.9 && p.T <= 0.4) ? 0 : 2500;
    sizeCanvases();
    start(p, custom ? '' : name);
    var view = q.get('view');
    setMode(view === 'ideal' || view === 'g' ? view : 'count');
    window.addEventListener('resize', sizeCanvases);
    if (window.ResizeObserver) new ResizeObserver(sizeCanvases).observe(boxCv.parentElement);
    window.requestAnimationFrame(frame);
  }
  init();
})();
