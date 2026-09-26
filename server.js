const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let players = {};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  const playerId = socket.id;
  players[playerId] = { x: 0, y: 5, z: 0, health: 100 };

  // Send spawn info to new player
  socket.emit('playerSpawn', { id: playerId, position: players[playerId], health: players[playerId].health });

  // Send all existing players to the new player
  for (const [id, player] of Object.entries(players)) {
    if (id !== playerId) {
      socket.emit('newPlayer', { id, position: player, health: player.health });
    }
  }

  // Notify everyone else about the new player (FIXED BROADCAST SYNTAX)
  socket.broadcast.emit('newPlayer', { id: playerId, position: players[playerId], health: players[playerId].health });

  // Handle position updates
  socket.on('playerMove', (data) => {
    if (players[playerId]) {
      players[playerId] = data;
      socket.broadcast.emit('playerMoved', { id: playerId, position: data });
    }
  });

  // Handle shooting
  socket.on('shoot', (targetId) => {
    if (players[targetId]) {
      players[targetId].health -= 10;
      io.emit('healthUpdate', { id: targetId, health: players[targetId].health });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', playerId);
    delete players[playerId];
    io.emit('playerDisconnected', playerId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
