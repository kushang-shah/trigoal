'use strict';

// World is 1000x1000 with a circular arena. Three goals sit 120° apart on the wall.
const C = {
  CX: 500, CY: 500, R: 440,
  GOAL_HALF: 0.3, // half-width of each goal mouth, in radians
  POST_R: 9,
  CAR_R: 21, BALL_R: 17,
  ACCEL: 760, BOOST_ACCEL: 1000,
  MAX_SPEED: 400, MAX_BOOST: 660, MAX_REV: 220,
  TURN: 3.9, DRAG: 0.988, GRIP: 0.88,
  BALL_DRAG: 0.993, BALL_MAX: 1150,
  CAR_MASS: 3, BALL_MASS: 1,
  BOOST_DRAIN: 38, BOOST_REGEN: 16,
  COUNTDOWN: 3, GOAL_PAUSE: 2.6, WIN_SCORE: 5,
};
const GOAL_ANGLES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];

const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const r1 = (v) => Math.round(v * 10) / 10;

// Elastic-ish collision between two moving circles. Returns impact speed.
function collide(a, ra, ma, b, rb, mb, e) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = ra + rb;
  if (d >= min || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  const ov = min - d, tot = ma + mb;
  a.x -= nx * ov * (mb / tot); a.y -= ny * ov * (mb / tot);
  b.x += nx * ov * (ma / tot); b.y += ny * ov * (ma / tot);
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return 0;
  const j = (-(1 + e) * vn) / (1 / ma + 1 / mb);
  a.vx -= (j * nx) / ma; a.vy -= (j * ny) / ma;
  b.vx += (j * nx) / mb; b.vy += (j * ny) / mb;
  return -vn;
}

// Keep a circle inside the arena wall. Returns impact speed.
function wall(o, r, e) {
  const dx = o.x - C.CX, dy = o.y - C.CY;
  const d = Math.hypot(dx, dy);
  if (d + r <= C.R || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  o.x = C.CX + nx * (C.R - r); o.y = C.CY + ny * (C.R - r);
  const vn = o.vx * nx + o.vy * ny;
  if (vn <= 0) return 0;
  o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny;
  return vn;
}

// Bounce a circle off a static goal post.
function post(o, r, px, py, e) {
  const dx = o.x - px, dy = o.y - py;
  const d = Math.hypot(dx, dy);
  const min = r + C.POST_R;
  if (d >= min || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  o.x = px + nx * min; o.y = py + ny * min;
  const vn = o.vx * nx + o.vy * ny;
  if (vn >= 0) return 0;
  o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny;
  return -vn;
}

class Game {
  constructor(emit) {
    this.emit = emit;
    this.players = [null, null, null];
    this.ball = { x: C.CX, y: C.CY, vx: 0, vy: 0 };
    this.phase = 'lobby'; // lobby | countdown | playing | goal | over
    this.timer = 0;
    this.clock = 0;
    this.nextSound = 0;
    this.lastTouch = -1;
    this.winner = null;
  }

  count() { return this.players.filter(Boolean).length; }
  find(id) { return this.players.find((p) => p && p.id === id) || null; }

  addPlayer(id, name) {
    const slot = this.players.findIndex((p) => !p);
    if (slot < 0) return -1;
    const p = { id, name, slot, x: 0, y: 0, vx: 0, vy: 0, a: 0, energy: 100, boosting: false, score: 0,
      input: { u: false, d: false, l: false, r: false, b: false } };
    this.players[slot] = p;
    this.spawn(p);
    return slot;
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p && p.id === id);
    if (i < 0) return;
    this.players[i] = null;
    if (this.phase !== 'lobby' && this.count() < 2) this.phase = 'lobby';
  }

  start() {
    for (const p of this.players) if (p) p.score = 0;
    this.winner = null;
    this.kickoff();
  }

  kickoff() {
    Object.assign(this.ball, { x: C.CX, y: C.CY, vx: 0, vy: 0 });
    for (const p of this.players) if (p) this.spawn(p);
    this.lastTouch = -1;
    this.phase = 'countdown';
    this.timer = C.COUNTDOWN;
  }

  spawn(p) {
    const g = GOAL_ANGLES[p.slot];
    p.x = C.CX + Math.cos(g) * C.R * 0.6;
    p.y = C.CY + Math.sin(g) * C.R * 0.6;
    p.a = g + Math.PI; // face the ball
    p.vx = p.vy = 0;
    p.energy = 100;
    p.boosting = false;
  }

  sound(type, s) {
    if (this.clock < this.nextSound) return;
    this.nextSound = this.clock + 0.06;
    this.emit('fx', { type, s: Math.min(1, r1(s)) });
  }

  goalAt(angle) {
    for (let s = 0; s < 3; s++) {
      if (this.players[s] && Math.abs(wrap(angle - GOAL_ANGLES[s])) < C.GOAL_HALF) return s;
    }
    return -1;
  }

  updateCar(p, dt) {
    const inp = p.input;
    const fx = Math.cos(p.a), fy = Math.sin(p.a);
    let fwd = p.vx * fx + p.vy * fy;
    let lat = -p.vx * fy + p.vy * fx;

    let acc = 0;
    if (inp.u) acc += C.ACCEL;
    if (inp.d) acc -= C.ACCEL * 0.65;
    p.boosting = inp.b && p.energy > 0;
    if (p.boosting) {
      acc += C.BOOST_ACCEL;
      p.energy = Math.max(0, p.energy - C.BOOST_DRAIN * dt);
    } else {
      p.energy = Math.min(100, p.energy + C.BOOST_REGEN * dt);
    }

    fwd += acc * dt;
    fwd *= Math.pow(C.DRAG, dt * 60);
    lat *= Math.pow(C.GRIP, dt * 60);
    const max = p.boosting ? C.MAX_BOOST : C.MAX_SPEED;
    if (fwd > max) fwd = max + (fwd - max) * 0.92; // ease back down after a boost
    if (fwd < -C.MAX_REV) fwd = -C.MAX_REV;

    p.vx = fx * fwd - fy * lat;
    p.vy = fy * fwd + fx * lat;

    // Rotate after rebuilding velocity so hard turns leave a little slide (drift).
    const steer = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    p.a = wrap(p.a + steer * C.TURN * dt * Math.max(-1, Math.min(1, fwd / 140)));

    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  step(dt) {
    if (this.phase === 'lobby' || this.phase === 'over') return;
    this.clock += dt;

    if (this.phase === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) { this.phase = 'playing'; this.timer = 0; }
      return;
    }

    const cars = this.players.filter(Boolean);
    for (const p of cars) this.updateCar(p, dt);

    const b = this.ball;
    const damp = this.phase === 'goal' ? 0.9 : C.BALL_DRAG;
    b.vx *= Math.pow(damp, dt * 60);
    b.vy *= Math.pow(damp, dt * 60);
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > C.BALL_MAX) { b.vx *= C.BALL_MAX / sp; b.vy *= C.BALL_MAX / sp; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const imp = collide(cars[i], C.CAR_R, 1, cars[j], C.CAR_R, 1, 0.5);
        if (imp > 120) this.sound('bump', imp / 500);
      }
    }

    const posts = [];
    for (let s = 0; s < 3; s++) {
      if (!this.players[s]) continue;
      for (const sign of [-1, 1]) {
        const a = GOAL_ANGLES[s] + sign * C.GOAL_HALF;
        posts.push([C.CX + Math.cos(a) * C.R, C.CY + Math.sin(a) * C.R]);
      }
    }

    for (const p of cars) {
      wall(p, C.CAR_R, 0.3);
      for (const [px, py] of posts) post(p, C.CAR_R, px, py, 0.3);
    }

    if (this.phase === 'playing') {
      for (const p of cars) {
        const imp = collide(p, C.CAR_R, C.CAR_MASS, b, C.BALL_R, C.BALL_MASS, 0.75);
        if (imp > 0) {
          this.lastTouch = p.slot;
          if (imp > 40) this.sound('hit', imp / 700);
        }
      }
      for (const [px, py] of posts) {
        const imp = post(b, C.BALL_R, px, py, 0.8);
        if (imp > 100) this.sound('post', imp / 800);
      }
      const dx = b.x - C.CX, dy = b.y - C.CY;
      const g = this.goalAt(Math.atan2(dy, dx));
      if (g >= 0) {
        if (Math.hypot(dx, dy) > C.R + C.BALL_R + 4) this.scoreGoal(g);
      } else {
        const imp = wall(b, C.BALL_R, 0.85);
        if (imp > 150) this.sound('wall', imp / 900);
      }
    } else if (this.phase === 'goal') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.winner !== null) {
          this.phase = 'over';
          this.emit('over', { winner: this.winner });
        } else {
          this.kickoff();
        }
      }
    }
  }

  scoreGoal(g) {
    this.phase = 'goal';
    this.timer = C.GOAL_PAUSE;
    const t = this.lastTouch;
    let scorer = -1;
    const own = t === g;
    if (t >= 0 && !own && this.players[t]) {
      this.players[t].score++;
      scorer = t;
    } else {
      // Own goal (or nobody touched it): everyone else gets a point.
      for (const p of this.players) if (p && p.slot !== g) p.score++;
    }
    const scores = this.players.map((p) => (p ? p.score : -1));
    const top = Math.max(...scores);
    const leaders = scores.filter((s) => s === top).length;
    if (top >= C.WIN_SCORE && leaders === 1) this.winner = scores.indexOf(top);
    this.emit('goal', { conceder: g, scorer, own });
  }

  snapshot() {
    const b = this.ball;
    return {
      t: Date.now(),
      ph: this.phase,
      tm: r1(this.timer),
      b: [r1(b.x), r1(b.y)],
      c: this.players.filter(Boolean).map((p) => [
        p.slot, r1(p.x), r1(p.y), Math.round(p.a * 1000) / 1000, p.boosting ? 1 : 0, Math.round(p.energy),
      ]),
      s: this.players.map((p) => (p ? p.score : null)),
    };
  }
}

module.exports = { Game, C };
