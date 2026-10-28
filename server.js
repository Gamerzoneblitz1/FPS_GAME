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

// ---------- Spielstand-Speicher (Fortschritt pro Name) ----------
// Standard: JSON-Datei. ACHTUNG Render (Free): Das Dateisystem wird bei jedem Neustart/Deploy zurückgesetzt!
// Dauerhaft wird es auf zwei Wegen:
//   1) Render "Persistent Disk" einbinden und DATA_DIR auf den Mount-Pfad setzen (z.B. /var/data), oder
//   2) kostenlose Redis-Datenbank bei Upstash anlegen und UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//      als Environment-Variablen setzen (dann wird automatisch Upstash benutzt).
// Zusätzlich hält jeder Client eine lokale Kopie (localStorage), die beim Einloggen mit dem Server abgeglichen wird
// (das jeweils höhere XP gewinnt) - so geht auch nach einem Server-Reset nichts verloren, solange man denselben Browser nutzt.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'progress.json');
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = !!(UPSTASH_URL && UPSTASH_TOKEN && typeof fetch === 'function');
// "Dauerhaft" = der Spielstand überlebt Neustarts/Deploys: Upstash-Datenbank oder eingebundene Render-Disk (DATA_DIR gesetzt)
const storageDurable = useUpstash || !!process.env.DATA_DIR;
const MAX_XP = 10000000;
const MAX_XP_PER_SAVE = 5000;   // so viel XP kann zwischen zwei Speicherungen (ca. 4 s) nie legitim dazukommen
const SAVE_INTERVAL_MS = 5000;

const profileCache = new Map(); // nameKey -> { name, xp, skin, updated }
const dirtyKeys = new Set();
let fileDb = {};
if (!useUpstash) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignorieren */ }
    try { fileDb = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {}; } catch (e) { fileDb = {}; }
}
console.log('Spielstand-Speicher:', useUpstash ? 'Upstash Redis (dauerhaft)'
    : process.env.DATA_DIR ? `Datei ${DATA_FILE} (DATA_DIR gesetzt - dauerhaft, falls dort eine Render Persistent Disk eingebunden ist)`
    : `Datei ${DATA_FILE} (auf Render Free NICHT dauerhaft, siehe Kommentar)`);

const nameKey = (name) => String(name || '').trim().toLowerCase().slice(0, 20);

// Test-Accounts: diese Namen bekommen beim Einloggen immer Maximal-Level (Level 30 = alle Waffen + alle Skins).
// Standard: "Tester". Ändern/erweitern per Environment-Variable TEST_ACCOUNTS (Namen mit Komma getrennt,
// Groß-/Kleinschreibung egal), z.B. TEST_ACCOUNTS=tester,nicolas. Leer lassen (TEST_ACCOUNTS=) schaltet sie ab.
// Achtung: Wer den Namen kennt, bekommt den Max-Stand - für Tests praktisch, für ein öffentliches Spiel abschalten.
const TEST_ACCOUNTS = new Set(String(process.env.TEST_ACCOUNTS ?? 'tester').split(',').map(nameKey).filter(Boolean));
const TEST_XP = 50000; // Level 30 braucht 46400 XP (200 + 300 + ... , siehe progression.js)
if (TEST_ACCOUNTS.size) console.log('Test-Accounts (Max-Level):', [...TEST_ACCOUNTS].join(', '));

async function upstash(cmd) {
    const res = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd)
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.result;
}

// Beim Start prüfen, ob die Upstash-Zugangsdaten stimmen (Fehler stehen dann sofort im Render-Log statt erst beim ersten Spieler)
if (useUpstash) {
    upstash(['PING'])
        .then(() => console.log('Upstash: Verbindung OK - Spielstände werden dauerhaft gespeichert.'))
        .catch(e => console.warn('Upstash: Verbindung FEHLGESCHLAGEN - bitte URL/Token prüfen:', e.message));
} else if (UPSTASH_URL || UPSTASH_TOKEN) {
    console.warn('Upstash: URL und TOKEN müssen BEIDE gesetzt sein (und Node >= 18). Es wird die Datei benutzt.');
}

// Gibt { ok, prof } zurück. ok=false heißt: Speicher nicht erreichbar (dann NICHT überschreiben!)
async function loadProfile(key) {
    if (profileCache.has(key)) return { ok: true, prof: profileCache.get(key) };
    try {
        let prof = null;
        if (useUpstash) {
            const raw = await upstash(['GET', 'nv:' + key]);
            prof = raw ? JSON.parse(raw) : null;
        } else {
            prof = fileDb[key] || null;
        }
        if (prof) profileCache.set(key, prof);
        return { ok: true, prof };
    } catch (e) {
        console.warn('Spielstand laden fehlgeschlagen:', e.message);
        return { ok: false, prof: null };
    }
}

function queueSave(key, prof) {
    profileCache.set(key, prof);
    dirtyKeys.add(key);
}

async function flushSaves() {
    if (dirtyKeys.size === 0) return;
    const keys = [...dirtyKeys];
    dirtyKeys.clear();
    try {
        if (useUpstash) {
            await Promise.all(keys.map(k => upstash(['SET', 'nv:' + k, JSON.stringify(profileCache.get(k))])));
        } else {
            keys.forEach(k => { fileDb[k] = profileCache.get(k); });
            const tmp = DATA_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(fileDb));
            fs.renameSync(tmp, DATA_FILE); // atomar: keine halb geschriebene Datei bei Absturz
        }
    } catch (e) {
        console.warn('Spielstand speichern fehlgeschlagen:', e.message);
        keys.forEach(k => dirtyKeys.add(k)); // beim nächsten Durchlauf erneut versuchen
    }
}
setInterval(flushSaves, SAVE_INTERVAL_MS);
// Render beendet den Server bei Deploy/Neustart mit SIGTERM -> vorher noch alles wegschreiben
process.on('SIGTERM', async () => { await flushSaves(); process.exit(0); });

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

    // Spielstand beim Einloggen abgleichen: der höhere XP-Wert (Server oder Client-Backup) gewinnt.
    // Wird nur gesendet, wenn der Spieler einen Namen eingegeben hat (Gäste werden nicht gespeichert).
    socket.on('syncProgress', async (d) => {
        const me = players[socket.id];
        if (!me) return;
        const key = nameKey(me.name);
        if (!key) return;
        const clientXp = clampInt(d?.xp, 0, MAX_XP, 0);
        const clientSkin = clampInt(d?.skin, 0, 15, 0);

        const isTest = TEST_ACCOUNTS.has(key);
        const { ok, prof } = await loadProfile(key);
        if (!players[socket.id]) return; // währenddessen getrennt
        if (!ok) { // Speicher down: nichts überschreiben (Test-Accounts bekommen trotzdem Max-Level)
            socket.emit('progressSynced', { xp: isTest ? Math.max(clientXp, TEST_XP) : clientXp, skin: clientSkin, saved: false, storageWarning: isTest });
            return;
        }

        let chosen;
        if (!prof || clientXp > prof.xp) {
            chosen = { name: me.name, xp: clientXp, skin: clientSkin, updated: Date.now() };
            queueSave(key, chosen);
        } else {
            chosen = prof;
        }
        if (isTest && chosen.xp < TEST_XP) { // Test-Account: immer Maximal-Level
            chosen = { name: me.name, xp: TEST_XP, skin: chosen.skin, updated: Date.now() };
            queueSave(key, chosen);
        }
        me.persistKey = key;
        me.progressXp = chosen.xp;
        // storageWarning: nur Test-Accounts (= du als Entwickler) sehen den Hinweis, normale Spieler nicht
        socket.emit('progressSynced', { xp: chosen.xp, skin: chosen.skin, saved: true, restored: !!prof && prof.xp >= clientXp, storageWarning: isTest && !storageDurable });
    });

    // Laufende Speicherung (Client sendet gedrosselt alle paar Sekunden + bei Level-Up/Skinwechsel)
    socket.on('saveProgress', (d) => {
        const me = players[socket.id];
        if (!me || !me.persistKey) return;
        let xp = clampInt(d?.xp, 0, MAX_XP, -1);
        if (xp < 0 || xp < (me.progressXp || 0)) return;                 // XP gehen nie zurück
        xp = Math.min(xp, (me.progressXp || 0) + MAX_XP_PER_SAVE);       // und wachsen nur plausibel
        const skin = clampInt(d?.skin, 0, 15, 0);
        me.progressXp = xp;
        queueSave(me.persistKey, { name: me.name, xp, skin, updated: Date.now() });
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
