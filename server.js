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

// Feste Spawnpunkte — berechnet aus den tatsächlichen "C"-Zonen im (korrigierten) Grid von
// map.js: 121x33 Zellen, TILE_SIZE=3, Grid rechts mit '#' aufgefüllt auf einheitlich 131 Spalten.
// Falls sich das Grid in map.js nochmal ändert, müssen diese Werte neu berechnet werden (Node-Skript
// verwenden, das das Grid genauso auswertet wie setupMap() -> Weltkoordinaten der 'C'-Zeichen).
const SPAWN_POINTS = [
    { x: -192, y: 2, z: -45 }, { x: -48, y: 2, z: -45 }, { x: 18, y: 2, z: -45 }, { x: 162, y: 2, z: -45 },
    { x: -168, y: 2, z: -36 }, { x: -72, y: 2, z: -36 }, { x: 48, y: 2, z: -36 }, { x: 144, y: 2, z: -36 },
    { x: -192, y: 2, z: -24 }, { x: -144, y: 2, z: -24 }, { x: -96, y: 2, z: -24 }, { x: -48, y: 2, z: -24 },
    { x: -12, y: 2, z: -24 }, { x: 24, y: 2, z: -24 }, { x: 72, y: 2, z: -24 }, { x: 120, y: 2, z: -24 }, { x: 168, y: 2, z: -24 },
    { x: -138, y: 2, z: -12 }, { x: -90, y: 2, z: -12 }, { x: 84, y: 2, z: -12 }, { x: 132, y: 2, z: -12 },
    { x: -177, y: 2, z: 0 }, { x: -147, y: 2, z: 0 }, { x: -81, y: 2, z: 0 }, { x: -51, y: 2, z: 0 },
    { x: -12, y: 2, z: 0 }, { x: 12, y: 2, z: 0 }, { x: 51, y: 2, z: 0 }, { x: 81, y: 2, z: 0 }, { x: 147, y: 2, z: 0 }, { x: 177, y: 2, z: 0 },
    { x: -138, y: 2, z: 12 }, { x: -90, y: 2, z: 12 }, { x: 84, y: 2, z: 12 }, { x: 132, y: 2, z: 12 },
    { x: -192, y: 2, z: 24 }, { x: -144, y: 2, z: 24 }, { x: -96, y: 2, z: 24 }, { x: -48, y: 2, z: 24 },
    { x: -12, y: 2, z: 24 }, { x: 24, y: 2, z: 24 }, { x: 72, y: 2, z: 24 }, { x: 120, y: 2, z: 24 }, { x: 168, y: 2, z: 24 },
    { x: -168, y: 2, z: 36 }, { x: -72, y: 2, z: 36 }, { x: 48, y: 2, z: 36 }, { x: 144, y: 2, z: 36 },
    { x: -192, y: 2, z: 45 }, { x: -48, y: 2, z: 45 }, { x: 18, y: 2, z: 45 }, { x: 162, y: 2, z: 45 }
];

function getRandomSpawnPoint() {
    const point = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    return { x: point.x, y: point.y, z: point.z };
}

const players = {};

io.on('connection', (socket) => {
    console.log('Spieler verbunden:', socket.id);

    // Spieler an einem festen Spawnpunkt registrieren, inkl. 100 HP
    const spawn = getRandomSpawnPoint();
    players[socket.id] = { x: spawn.x, y: spawn.y, z: spawn.z, health: 100 };

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
                // Respawn bei 0 HP an einem festen Spawnpunkt (statt zufällig irgendwo auf der Karte)
                players[targetId].health = 100;
                const respawnPos = getRandomSpawnPoint();
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
