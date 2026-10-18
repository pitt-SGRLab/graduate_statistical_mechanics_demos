/*
 * harddisks.js : exact event-driven molecular dynamics of hard disks in a closed 2D box.
 *
 * Units: disk diameter = 1, mass = 1, k_B = 1, so the thermal speed is sqrt(k_B T / m) = 1 when T = 1.
 * Between collisions disks move in straight lines; collisions with each other and the walls are
 * perfectly elastic, so kinetic energy is conserved exactly (no time step error).
 *
 * Works in the browser (window.HD) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var MAX_EVENTS = 20000;          // safety cap per advance() call

  function randn() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function HardDisks(opts) {
    this.w = opts.w; this.h = opts.h;
    this.T0 = opts.T0 || 1;
    this.t = 0;
    this.collisions = 0;
    this.setN(opts.n || 60);
  }

  /** (Re)start with n disks, all in the left half of the box, Maxwell-distributed velocities. */
  HardDisks.prototype.setN = function (n) {
    this.n = n;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.reset();
  };

  HardDisks.prototype.reset = function () {
    var n = this.n, w = this.w, h = this.h, i, j, tries, ok;
    this.t = 0; this.collisions = 0;
    // random sequential placement in the left half; fall back to a jittered grid if too crowded
    var placed = 0, attempts = 0;
    while (placed < n && attempts < 200000) {
      attempts++;
      var px = 0.5 + Math.random() * (w / 2 - 1), py = 0.5 + Math.random() * (h - 1);
      ok = true;
      for (j = 0; j < placed; j++) {
        var dx = px - this.x[j], dy = py - this.y[j];
        if (dx * dx + dy * dy < 1.05) { ok = false; break; }
      }
      if (ok) { this.x[placed] = px; this.y[placed] = py; placed++; }
    }
    if (placed < n) {
      var cols = Math.ceil(Math.sqrt(n * (w / 2) / h)), rows = Math.ceil(n / cols);
      for (i = 0; i < n; i++) {
        this.x[i] = 0.5 + ((i % cols) + 0.5) / cols * (w / 2 - 1);
        this.y[i] = 0.5 + (Math.floor(i / cols) + 0.5) / rows * (h - 1);
      }
    }
    var sd = Math.sqrt(this.T0);
    for (i = 0; i < n; i++) { this.vx[i] = sd * randn(); this.vy[i] = sd * randn(); }
    var s = Math.sqrt(this.T0 / this.temperature());      // set the temperature exactly
    for (i = 0; i < n; i++) { this.vx[i] *= s; this.vy[i] *= s; }
  };

  HardDisks.prototype.kineticEnergy = function () {
    var s = 0;
    for (var i = 0; i < this.n; i++) s += this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
    return 0.5 * s;
  };
  /** T = mean kinetic energy per disk (2 degrees of freedom each, k_B = 1). */
  HardDisks.prototype.temperature = function () { return this.kineticEnergy() / this.n; };
  HardDisks.prototype.countLeft = function () {
    var c = 0, half = this.w / 2;
    for (var i = 0; i < this.n; i++) if (this.x[i] < half) c++;
    return c;
  };
  HardDisks.prototype.speed = function (i) { return Math.sqrt(this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]); };

  /** A "kick": add dv to the speed of disk i, along its direction of motion (random direction if at rest). */
  HardDisks.prototype.kick = function (i, dv) {
    var s = this.speed(i), ux, uy;
    if (s > 1e-9) { ux = this.vx[i] / s; uy = this.vy[i] / s; }
    else { var a = Math.random() * 2 * Math.PI; ux = Math.cos(a); uy = Math.sin(a); }
    this.vx[i] += dv * ux; this.vy[i] += dv * uy;
  };

  /** Advance the system by dt (simulation time units), processing every collision exactly. */
  HardDisks.prototype.advance = function (dt) {
    var n = this.n, x = this.x, y = this.y, vx = this.vx, vy = this.vy;
    var W = this.w - 0.5, H = this.h - 0.5, LO = 0.5;      // centre must stay in [0.5, w-0.5] x [0.5, h-0.5]
    var done = 0, events = 0, i, j;
    while (done < dt && events < MAX_EVENTS) {
      var tmin = dt - done, type = 0, a = -1, b = -1;
      // wall events
      for (i = 0; i < n; i++) {
        var tw;
        if (vx[i] > 0) { tw = (W - x[i]) / vx[i]; if (tw < tmin) { tmin = tw; type = 1; a = i; b = 0; } }
        else if (vx[i] < 0) { tw = (LO - x[i]) / vx[i]; if (tw < tmin) { tmin = tw; type = 1; a = i; b = 0; } }
        if (vy[i] > 0) { tw = (H - y[i]) / vy[i]; if (tw < tmin) { tmin = tw; type = 1; a = i; b = 1; } }
        else if (vy[i] < 0) { tw = (LO - y[i]) / vy[i]; if (tw < tmin) { tmin = tw; type = 1; a = i; b = 1; } }
      }
      // pair events
      for (i = 0; i < n - 1; i++) {
        var xi = x[i], yi = y[i], vxi = vx[i], vyi = vy[i];
        for (j = i + 1; j < n; j++) {
          var dx = xi - x[j], dy = yi - y[j];
          var dvx = vxi - vx[j], dvy = vyi - vy[j];
          var bb = dx * dvx + dy * dvy;
          if (bb >= 0) continue;                                  // moving apart
          var aa = dvx * dvx + dvy * dvy, cc = dx * dx + dy * dy - 1;
          var disc = bb * bb - aa * cc;
          if (disc < 0) continue;                                 // will miss
          var tc = cc <= 0 ? 0 : (-bb - Math.sqrt(disc)) / aa;
          if (tc < tmin) { tmin = tc; type = 2; a = i; b = j; }
        }
      }
      if (tmin < 0) tmin = 0;
      for (i = 0; i < n; i++) { x[i] += vx[i] * tmin; y[i] += vy[i] * tmin; }
      done += tmin;
      if (type === 1) {
        if (b === 0) { vx[a] = -vx[a]; x[a] = x[a] > this.w / 2 ? W : LO; }
        else { vy[a] = -vy[a]; y[a] = y[a] > this.h / 2 ? H : LO; }
        events++;
      } else if (type === 2) {
        var ex = x[a] - x[b], ey = y[a] - y[b], d2 = ex * ex + ey * ey;
        var f = ((vx[a] - vx[b]) * ex + (vy[a] - vy[b]) * ey) / d2;
        vx[a] -= f * ex; vy[a] -= f * ey; vx[b] += f * ex; vy[b] += f * ey;
        this.collisions++; events++;
      } else break;
    }
    this.t += done;
  };


  /* ---- additions for the time-reversal demo ---- */

  /** Initial "beam" state: all disks in a strip at the left, all moving right with the same velocity (speed, 0). */
  HardDisks.prototype.initBeam = function (speed, stripWidth) {
    var n = this.n, h = this.h, placed = 0, attempts = 0, j, ok;
    this.t = 0; this.collisions = 0;
    while (placed < n && attempts < 400000) {
      attempts++;
      var px = 0.5 + Math.random() * (stripWidth - 1), py = 0.5 + Math.random() * (h - 1);
      ok = true;
      for (j = 0; j < placed; j++) {
        var dx = px - this.x[j], dy = py - this.y[j];
        if (dx * dx + dy * dy < 1.05) { ok = false; break; }
      }
      if (ok) { this.x[placed] = px; this.y[placed] = py; placed++; }
    }
    for (var i = 0; i < n; i++) { this.vx[i] = speed; this.vy[i] = 0; }
    this.saveInitial();
  };

  /** Remember the current state as "the initial configuration" (for measuring how well reversal recovers it). */
  HardDisks.prototype.saveInitial = function () {
    this.x0 = new Float64Array(this.x); this.y0 = new Float64Array(this.y);
    this.vx0 = new Float64Array(this.vx); this.vy0 = new Float64Array(this.vy);
  };

  /** Time reversal: v -> -v for every disk. */
  HardDisks.prototype.reverseVelocities = function () {
    for (var i = 0; i < this.n; i++) { this.vx[i] = -this.vx[i]; this.vy[i] = -this.vy[i]; }
  };

  /** Round every coordinate and velocity to `digits` decimal places (emulates limited numerical precision). */
  HardDisks.prototype.quantize = function (digits) {
    var s = Math.pow(10, digits);
    for (var i = 0; i < this.n; i++) {
      this.x[i] = Math.round(this.x[i] * s) / s; this.y[i] = Math.round(this.y[i] * s) / s;
      this.vx[i] = Math.round(this.vx[i] * s) / s; this.vy[i] = Math.round(this.vy[i] * s) / s;
    }
  };

  /** root-mean-square distance of the disks from their initial positions */
  HardDisks.prototype.rmsFromInitial = function () {
    var s = 0;
    for (var i = 0; i < this.n; i++) { var dx = this.x[i] - this.x0[i], dy = this.y[i] - this.y0[i]; s += dx * dx + dy * dy; }
    return Math.sqrt(s / this.n);
  };

  var api = { HardDisks: HardDisks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HD = api;
})(typeof window !== 'undefined' ? window : this);
