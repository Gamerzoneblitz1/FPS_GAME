const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const players = {};

io.on('connection', (socket) => {
    console.log('Spieler verbunden:', socket.id);

    // Spieler registrieren inkl. 100 HP
    players[socket.id] = { x: 0, y: 2, z: 0, health: 100 };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, position: players[socket.id], health: 100 });

    socket.on('playerMove', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            socket.broadcast.emit('playerMoved', { id: socket.id, position: movementData });
        }
    });

    // Schuss-Effekt an alle weiterleiten
    socket.on('shoot', (shotData) => {
        socket.broadcast.emit('playerShot', { id: socket.id, start: shotData.start, end: shotData.end });
    });

    // Treffer & Schaden verarbeiten
    socket.on('hitPlayer', (targetId) => {
        if (players[targetId]) {
            players[targetId].health -= 25; // 25 Schaden pro Treffer

            if (players[targetId].health <= 0) {
                // Respawn bei 0 HP
                players[targetId].health = 100;
                const respawnPos = {
                    x: (Math.random() - 0.5) * 80,
                    y: 2,
                    z: (Math.random() - 0.5) * 80
                };
                players[targetId].x = respawnPos.x;
                players[targetId].y = respawnPos.y;
                players[targetId].z = respawnPos.z;

                io.emit('playerRespawned', { id: targetId, position: respawnPos, health: 100 });
            } else {
                io.emit('playerHealthUpdate', { id: targetId, health: players[targetId].health });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Spieler getrennt:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
