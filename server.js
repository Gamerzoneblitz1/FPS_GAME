const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

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

// Fallback-Liste (Stand: "Open Sniper Arena", 121x33 Tiles, TILE_SIZE 3): wird nur benutzt, falls
// js/map.js nicht gelesen/geparst werden kann.
const FALLBACK_SPAWN_POINTS = [
    { x: -177, y: 2, z: -45 }, { x: -153, y: 2, z: -45 }, { x: 153, y: 2, z: -45 }, { x: 177, y: 2, z: -45 },
    { x: -177, y: 2, z: -33 }, { x: 177, y: 2, z: -33 }, { x: -168, y: 2, z: -12 }, { x: 168, y: 2, z: -12 },
    { x: -177, y: 2, z: 0 }, { x: 177, y: 2, z: 0 }, { x: -168, y: 2, z: 12 }, { x: 168, y: 2, z: 12 },
    { x: -177, y: 2, z: 33 }, { x: 177, y: 2, z: 33 }, { x: -177, y: 2, z: 45 }, { x: -153, y: 2, z: 45 },
    { x: 153, y: 2, z: 45 }, { x: 177, y: 2, z: 45 }
];

// Spawnpunkte werden direkt aus js/map.js gelesen (alle 'C'-Felder im Grid, gleiche Formel wie
// setupMap()). So weichen sie nie wieder von der echten Karte ab, wenn du das Grid änderst.
function loadSpawnPointsFromMap() {
    try {
        const src = fs.readFileSync(path.join(__dirname, 'js', 'map.js'), 'utf8');
        const tileMatch = src.match(/const\s+TILE_SIZE\s*=\s*([\d.]+)/);
        const gridStart = src.indexOf('const NEON_VAULT_GRID = [');
        if (!tileMatch || gridStart === -1) throw new Error('TILE_SIZE oder NEON_VAULT_GRID nicht gefunden');

        const literalStart = src.indexOf('[', gridStart);
        const literalEnd = src.indexOf('];', gridStart);
        const grid = new Function('return ' + src.slice(literalStart, literalEnd + 1))();

        const tile = parseFloat(tileMatch[1]);
        const cols = grid[0].length;
        const rows = grid.length;
        const halfW = (cols * tile) / 2;
        const halfD = (rows * tile) / 2;

        const points = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] === 'C') {
                    points.push({ x: c * tile - halfW + tile / 2, y: 2, z: r * tile - halfD + tile / 2 });
                }
            }
        }
        if (points.length === 0) throw new Error('keine C-Felder im Grid gefunden');

        console.log(`Spawnpunkte aus js/map.js geladen: ${points.length} Stück (Grid ${cols}x${rows}, TILE_SIZE ${tile})`);
        return points;
    } catch (err) {
        console.warn('Spawnpunkte konnten nicht aus js/map.js gelesen werden, nutze Fallback-Liste:', err.message);
        return FALLBACK_SPAWN_POINTS;
    }
}

const SPAWN_POINTS = loadSpawnPointsFromMap();
const MIN_SAFE_SPAWN_DISTANCE = 40; // Spawn mindestens so weit von anderen Spielern entfernt (wenn möglich)

// Zufälliger Spawnpunkt, der bevorzugt weit weg von anderen Spielern liegt (kein Spawn-Kill).
function getRandomSpawnPoint(excludeId) {
    const others = Object.keys(players)
        .filter(id => id !== excludeId)
        .map(id => players[id]);

    const distToNearest = (p) => others.length === 0
        ? Infinity
        : Math.min(...others.map(o => Math.hypot(p.x - o.x, p.z - o.z)));

    let candidates = SPAWN_POINTS.filter(p => distToNearest(p) >= MIN_SAFE_SPAWN_DISTANCE);

    if (candidates.length === 0) {
        // Alle Spawns liegen nah an Gegnern -> den mit dem größten Abstand zum nächsten Spieler nehmen
        let best = SPAWN_POINTS[0];
        for (const p of SPAWN_POINTS) {
            if (distToNearest(p) > distToNearest(best)) best = p;
        }
        candidates = [best];
    }

    const point = candidates[Math.floor(Math.random() * candidates.length)];
    return { x: point.x, y: point.y, z: point.z };
}

io.on('connection', (socket) => {
    console.log('Spieler verbunden:', socket.id);

    // Spieler an einem festen Spawnpunkt registrieren, inkl. 100 HP
    const spawn = getRandomSpawnPoint(socket.id);
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
    socket.on('hitPlayer', (data) => {
        // Neues Format: { targetId, damage } (seit dem Waffenwechsel-System - jede Waffe hat eigenen
        // Schaden). Abwärtskompatibel: falls doch mal nur ein String/ID ankommt, 20 Schaden annehmen.
        const targetId = typeof data === 'string' ? data : data?.targetId;
        let damage = typeof data === 'object' && data !== null ? Number(data.damage) : 20;
        if (!Number.isFinite(damage) || damage <= 0) damage = 20;
        damage = Math.min(damage, 100); // grobe Clamp gegen offensichtlich manipulierte Werte

        if (players[targetId]) {
            players[targetId].health -= damage;

            if (players[targetId].health <= 0) {
                // Respawn bei 0 HP an einem festen Spawnpunkt (statt zufällig irgendwo auf der Karte)
                players[targetId].health = 100;
                const respawnPos = getRandomSpawnPoint(targetId);
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
