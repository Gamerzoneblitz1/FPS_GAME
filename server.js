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
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- Spielerdaten ---
const players = {};  // id -> { x, y, z, health, name, kills, deaths }

// --- Spawnpunkte aus map.js lesen ---
const FALLBACK_SPAWN_POINTS = [
    { x: -177, y: 2, z: -45 }, { x: -153, y: 2, z: -45 }, { x: 153, y: 2, z: -45 }, { x: 177, y: 2, z: -45 },
    { x: -177, y: 2, z: -33 }, { x: 177, y: 2, z: -33 }, { x: -168, y: 2, z: -12 }, { x: 168, y: 2, z: -12 },
    { x: -177, y: 2, z:  0  }, { x: 177,  y: 2, z:  0  }, { x: -168, y: 2, z:  12 }, { x: 168, y: 2, z:  12 },
    { x: -177, y: 2, z:  33 }, { x: 177,  y: 2, z:  33 }, { x: -177, y: 2, z:  45 }, { x: -153, y: 2, z: 45 },
    { x:  153, y: 2, z:  45 }, { x: 177,  y: 2, z:  45 }
];

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
        const cols = grid[0].length, rows = grid.length;
        const halfW = (cols * tile) / 2, halfD = (rows * tile) / 2;
        const points = [];
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
                if (grid[r][c] === 'C')
                    points.push({ x: c * tile - halfW + tile / 2, y: 2, z: r * tile - halfD + tile / 2 });
        if (points.length === 0) throw new Error('keine C-Felder im Grid gefunden');
        console.log(`Spawnpunkte: ${points.length} (Grid ${cols}x${rows}, TILE_SIZE ${tile})`);
        return points;
    } catch (err) {
        console.warn('Fallback-Spawnpunkte:', err.message);
        return FALLBACK_SPAWN_POINTS;
    }
}

const SPAWN_POINTS = loadSpawnPointsFromMap();
const MIN_SAFE_SPAWN_DISTANCE = 40;

function getRandomSpawnPoint(excludeId) {
    const others = Object.values(players).filter((_, i) => Object.keys(players)[i] !== excludeId);
    const dist = (p) => others.length === 0 ? Infinity : Math.min(...others.map(o => Math.hypot(p.x - o.x, p.z - o.z)));
    let candidates = SPAWN_POINTS.filter(p => dist(p) >= MIN_SAFE_SPAWN_DISTANCE);
    if (candidates.length === 0) candidates = [SPAWN_POINTS.reduce((a, b) => dist(a) >= dist(b) ? a : b)];
    return { ...candidates[Math.floor(Math.random() * candidates.length)] };
}

// Leaderboard an alle schicken (nach jeder Änderung von kills/deaths)
function broadcastLeaderboard() {
    const board = Object.entries(players).map(([id, p]) => ({
        id, name: p.name || id.slice(0, 6), kills: p.kills || 0, deaths: p.deaths || 0
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    io.emit('leaderboard', board);
}

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);

    // Spieler registrieren (Name kommt kurz danach via 'setName')
    const spawn = getRandomSpawnPoint(socket.id);
    players[socket.id] = { ...spawn, health: 100, name: 'Player', kills: 0, deaths: 0 };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, position: players[socket.id], name: players[socket.id].name });
    broadcastLeaderboard();

    // Name setzen (Client schickt direkt nach Connect)
    socket.on('setName', (rawName) => {
        const name = String(rawName).trim().slice(0, 20) || 'Player';
        if (players[socket.id]) {
            players[socket.id].name = name;
            io.emit('playerNameUpdate', { id: socket.id, name });
            broadcastLeaderboard();
        }
    });

    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x; players[socket.id].y = data.y; players[socket.id].z = data.z;
            socket.broadcast.emit('playerMoved', { id: socket.id, position: data });
        }
    });

    socket.on('shoot', (shotData) => {
        socket.broadcast.emit('playerShot', { id: socket.id, start: shotData.start, end: shotData.end });
    });

    socket.on('hitPlayer', (data) => {
        const targetId = typeof data === 'string' ? data : data?.targetId;
        let damage = typeof data === 'object' && data !== null ? Number(data.damage) : 20;
        if (!Number.isFinite(damage) || damage <= 0) damage = 20;
        damage = Math.min(damage, 100);

        if (!players[targetId]) return;
        players[targetId].health -= damage;

        // Schaden-Feedback an den Schützen (Treffermeldung im Client)
        socket.emit('hitConfirm', { targetId, damage, remaining: Math.max(0, players[targetId].health) });

        if (players[targetId].health <= 0) {
            // Kill registrieren
            if (players[socket.id]) players[socket.id].kills = (players[socket.id].kills || 0) + 1;
            players[targetId].deaths = (players[targetId].deaths || 0) + 1;
            players[targetId].health = 100;

            const killerName = players[socket.id]?.name || socket.id.slice(0, 6);
            const victimName = players[targetId]?.name || targetId.slice(0, 6);

            const respawnPos = getRandomSpawnPoint(targetId);
            Object.assign(players[targetId], respawnPos);

            // Kill-Feed-Event an ALLE (auch Zuschauer sehen es)
            io.emit('playerKilled', {
                killerId: socket.id, killerName,
                victimId: targetId,  victimName,
                respawnPos
            });

            broadcastLeaderboard();
        } else {
            io.emit('playerHealthUpdate', { id: targetId, health: players[targetId].health });
        }
    });

    socket.on('disconnect', () => {
        console.log('Getrennt:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        broadcastLeaderboard();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
