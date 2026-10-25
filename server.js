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

// --- Reset-Button-Regeln ---
const LAST_ATTACKER_WINDOW_MS = 10000; // Schaden älter als 10s zählt nicht mehr als "wurde getötet von"
const RESET_COOLDOWN_MS = 5000;
const SYRINGE_KILL_INTERVAL = 5;       // alle 5 Kills gibt es eine Heilspritze

function getRandomSpawnPoint(excludeId) {
    const others = Object.values(players).filter((_, i) => Object.keys(players)[i] !== excludeId);
    const dist = (p) => others.length === 0 ? Infinity : Math.min(...others.map(o => Math.hypot(p.x - o.x, p.z - o.z)));
    let candidates = SPAWN_POINTS.filter(p => dist(p) >= MIN_SAFE_SPAWN_DISTANCE);
    if (candidates.length === 0) candidates = [SPAWN_POINTS.reduce((a, b) => dist(a) >= dist(b) ? a : b)];
    return { ...candidates[Math.floor(Math.random() * candidates.length)] };
}

// Räumlich nächster anderer Spieler (Fallback-Killer beim Reset, wenn niemand kürzlich Schaden gemacht hat)
function findNearestOtherPlayer(id) {
    const me = players[id];
    if (!me) return null;
    let best = null, bestDist = Infinity;
    for (const [otherId, o] of Object.entries(players)) {
        if (otherId === id) continue;
        const d = Math.hypot(me.x - o.x, me.y - o.y, me.z - o.z);
        if (d < bestDist) { bestDist = d; best = otherId; }
    }
    return best;
}

// Zentrale Kill-Logik: wird von normalen Treffern UND vom Reset-Button benutzt (Kill Feed,
// Leaderboard, Respawn laufen dadurch immer über denselben Pfad).
// killerId = null -> kein Killer (Reset, wenn man allein auf dem Server ist): keine Statistik-Änderung.
function killPlayer(victimId, killerId, reason = 'hit') {
    const victim = players[victimId];
    if (!victim) return;
    const killer = (killerId && killerId !== victimId) ? players[killerId] : null;

    if (killer) {
        killer.kills = (killer.kills || 0) + 1;
        // Heilspritze als Belohnung: alle SYRINGE_KILL_INTERVAL Kills (5, 10, 15, ...)
        if (killer.kills % SYRINGE_KILL_INTERVAL === 0) {
            killer.syringes = (killer.syringes || 0) + 1;
            io.to(killerId).emit('syringeUpdate', { count: killer.syringes, awarded: true });
        }
    }
    if (killer || reason !== 'reset') victim.deaths = (victim.deaths || 0) + 1;

    victim.health = 100;
    victim.lastAttacker = null;
    victim.lastDamageTime = 0;

    const respawnPos = getRandomSpawnPoint(victimId);
    Object.assign(victim, respawnPos);

    io.emit('playerKilled', {
        killerId: killer ? killerId : null,
        killerName: killer ? (killer.name || killerId.slice(0, 6)) : 'Reset',
        victimId,
        victimName: victim.name || victimId.slice(0, 6),
        respawnPos,
        reason
    });
    broadcastLeaderboard();
}

// Leaderboard an alle schicken (nach jeder Änderung von kills/deaths)
function broadcastLeaderboard() {
    const board = Object.entries(players).map(([id, p]) => ({
        id, name: p.name || id.slice(0, 6), kills: p.kills || 0, deaths: p.deaths || 0, level: p.level || 1
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    io.emit('leaderboard', board);
}

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);
    let lastResetTime = 0;

    // Spieler registrieren (Name kommt kurz danach via 'setName')
    const spawn = getRandomSpawnPoint(socket.id);
    players[socket.id] = { ...spawn, health: 100, name: 'Player', kills: 0, deaths: 0, syringes: 0, level: 1, skin: 0 };

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

    // Profil: Level (Anzeige im Leaderboard) und gewählter Skin (sichtbar für alle). Nur Zahlen im erlaubten Bereich.
    const clampInt = (v, min, max, fallback) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    socket.on('setProfile', (p) => {
        const me = players[socket.id];
        if (!me) return;
        me.level = clampInt(p?.level, 1, 99, 1);
        me.skin = clampInt(p?.skin, 0, 15, 0);
        io.emit('playerProfile', { id: socket.id, level: me.level, skin: me.skin });
        broadcastLeaderboard();
    });

    socket.on('playerMove', (data) => {
        const p = players[socket.id];
        if (!p) return;
        const x = Number(data?.x), y = Number(data?.y), z = Number(data?.z);
        if (![x, y, z].every(Number.isFinite)) return;
        const ry = Number.isFinite(Number(data.ry)) ? Number(data.ry) : 0; // Blickrichtung (Yaw) für den Spieler-Skin
        p.x = x; p.y = y; p.z = z;
        socket.broadcast.emit('playerMoved', { id: socket.id, position: { x, y, z, ry } });
    });

    // Heilspritze benutzen: heilt voll. Der Server prüft Besitz und ob Heilung überhaupt nötig ist.
    socket.on('useSyringe', () => {
        const me = players[socket.id];
        if (!me) return;
        if (!me.syringes || me.syringes <= 0) {
            socket.emit('syringeUpdate', { count: 0, denied: 'none' });
            return;
        }
        if (me.health >= 100) {
            socket.emit('syringeUpdate', { count: me.syringes, denied: 'full' });
            return;
        }
        me.syringes -= 1;
        me.health = 100;
        socket.emit('syringeUpdate', { count: me.syringes, used: true });
        io.emit('playerHealthUpdate', { id: socket.id, health: 100 });
    });

    // Schuss-Effekte weiterreichen (Tracer, Bullet Hole). Alles wird validiert, damit kein Client
    // Müll/riesige Objekte an alle anderen schicken kann.
    const toVec = (v) => {
        if (!v) return null;
        const x = Number(v.x), y = Number(v.y), z = Number(v.z);
        return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
    };
    socket.on('shoot', (shotData) => {
        const start = toVec(shotData?.start), end = toVec(shotData?.end);
        if (!start || !end) return;
        const w = Number.isInteger(shotData.w) && shotData.w >= 0 && shotData.w <= 5 ? shotData.w : 0;
        const c = Number.isInteger(shotData.c) && shotData.c >= 0 && shotData.c <= 0xffffff ? shotData.c : null;
        socket.broadcast.emit('playerShot', {
            id: socket.id, start, end, w, c,
            n: toVec(shotData.n), hitPlayer: !!shotData.hitPlayer,
            silent: !!shotData.silent // weitere Schrotkugeln desselben Schusses: Effekt ja, Sound nein
        });
    });

    socket.on('hitPlayer', (data) => {
        const targetId = typeof data === 'string' ? data : data?.targetId;
        let damage = typeof data === 'object' && data !== null ? Number(data.damage) : 20;
        if (!Number.isFinite(damage) || damage <= 0) damage = 20;
        damage = Math.min(damage, 100);

        if (!players[targetId] || targetId === socket.id) return;
        players[targetId].health -= damage;
        players[targetId].lastAttacker = socket.id;   // für den Reset-Button
        players[targetId].lastDamageTime = Date.now();

        // Schaden-Feedback an den Schützen (Treffermeldung im Client)
        socket.emit('hitConfirm', { targetId, damage, remaining: Math.max(0, players[targetId].health) });

        if (players[targetId].health <= 0) {
            killPlayer(targetId, socket.id, 'hit');
        } else {
            io.emit('playerHealthUpdate', { id: targetId, health: players[targetId].health });
        }
    });

    // Reset-Button: Spieler "stirbt" freiwillig. Kill geht an den letzten Schadensverursacher
    // (innerhalb des Zeitfensters, noch verbunden), sonst an den räumlich nächsten Spieler.
    socket.on('requestReset', () => {
        const me = players[socket.id];
        if (!me) return;

        const now = Date.now();
        const wait = RESET_COOLDOWN_MS - (now - lastResetTime);
        if (wait > 0) {
            socket.emit('resetDenied', { remainingMs: wait });
            return;
        }
        lastResetTime = now;

        let killerId = null;
        if (me.lastAttacker && players[me.lastAttacker] && now - me.lastDamageTime <= LAST_ATTACKER_WINDOW_MS) {
            killerId = me.lastAttacker;
        } else {
            killerId = findNearestOtherPlayer(socket.id); // null, wenn man allein ist
        }
        killPlayer(socket.id, killerId, 'reset');
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
