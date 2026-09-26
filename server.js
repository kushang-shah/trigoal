'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game, N } = require('./game');

const PORT = process.env.PORT || 3000;
const TICK = 1 / 60;
const MAX_PLAYERS = N;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map(); // code -> { code, host, game }

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || 'Player';
}

function lobbyInfo(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.game.phase,
    players: room.game.players.map((p) => p && { id: p.id, name: p.name, slot: p.slot }),
  };
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby', lobbyInfo(room));
}

function createRoom() {
  const code = makeCode();
  const room = { code, host: null, game: null };
  room.game = new Game((type, data) => {
    io.to(code).emit(type, data);
    if (type === 'over') broadcastLobby(room);
  });
  rooms.set(code, room);
  return room;
}

function leaveRoom(socket) {
  const code = socket.data.room;
  if (!code) return;
  socket.data.room = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  room.game.removePlayer(socket.id);
  const left = room.game.players.filter(Boolean);
  if (left.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.host === socket.id) room.host = left[0].id;
  broadcastLobby(room);
}

function joinRoom(socket, room, name) {
  if (room.game.count() >= MAX_PLAYERS) return `Room is full (${MAX_PLAYERS}/${MAX_PLAYERS} players)`;
  if (!['lobby', 'over'].includes(room.game.phase)) return 'A match is in progress, try again soon';
  room.game.addPlayer(socket.id, cleanName(name));
  if (!room.host) room.host = socket.id;
  socket.data.room = room.code;
  socket.join(room.code);
  broadcastLobby(room);
  return null;
}

io.on('connection', (socket) => {
  socket.on('create', (msg, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket);
    const room = createRoom();
    joinRoom(socket, room, msg && msg.name);
    cb({ ok: true, code: room.code });
  });

  socket.on('join', (msg, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((msg && msg.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (socket.data.room === code) return cb({ ok: true, code });
    leaveRoom(socket);
    const err = joinRoom(socket, room, msg && msg.name);
    cb(err ? { ok: false, error: err } : { ok: true, code });
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    if (room.game.count() < 2 || !['lobby', 'over'].includes(room.game.phase)) return;
    room.game.start();
    broadcastLobby(room);
  });

  socket.on('input', (inp) => {
    const room = rooms.get(socket.data.room);
    const p = room && room.game.find(socket.id);
    if (!p || !inp || typeof inp !== 'object') return;
    p.input = { u: !!inp.u, d: !!inp.d, l: !!inp.l, r: !!inp.r, b: !!inp.b };
  });

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

// Fixed-step simulation at 60 Hz, snapshots at 30 Hz.
let last = process.hrtime.bigint();
let acc = 0;
let tick = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc = Math.min(acc + Number(now - last) / 1e9, 0.25);
  last = now;
  while (acc >= TICK) {
    acc -= TICK;
    tick++;
    for (const room of rooms.values()) {
      const before = room.game.phase;
      room.game.step(TICK);
      if (before !== room.game.phase && room.game.phase === 'lobby') broadcastLobby(room);
      if (tick % 2 === 0 && room.game.phase !== 'lobby') io.to(room.code).emit('state', room.game.snapshot());
    }
  }
}, 1000 / 60);

server.listen(PORT, () => console.log(`TriGoal running on http://localhost:${PORT}`));
