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

function loadSpawnPointsFromGrid(file) {
    try {
        const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
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
        console.log(`Spawnpunkte (${file}): ${points.length} (Grid ${cols}x${rows}, TILE_SIZE ${tile})`);
        return points;
    } catch (err) {
        console.warn(`Fallback-Spawnpunkte (${file}):`, err.message);
        return FALLBACK_SPAWN_POINTS;
    }
}

// ---------- Karten (maps/index.json) ----------
// Alle Karten liegen im Ordner maps/. Der Server hält EINE aktive Karte für alle Spieler (Umschalten nur, wenn man allein ist).
// Start-Karte: Umgebungsvariable MAP (z.B. MAP=italy) oder "default" aus der index.json.
const FALLBACK_MANIFEST = { default: 'neon-vault', maps: [{ id: 'neon-vault', name: 'Neon Vault Megaplex', type: 'grid', file: 'maps/neon-vault.js' }] };
function loadManifest() {
    try {
        const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'maps', 'index.json'), 'utf8'));
        const maps = (Array.isArray(m.maps) ? m.maps : []).filter(e => e && typeof e.id === 'string' && typeof e.file === 'string')
            .map(e => ({ ...e, name: e.name || e.id, type: e.type === 'glb' ? 'glb' : 'grid' }));
        if (!maps.length) throw new Error('keine Karten eingetragen');
        return { default: maps.some(e => e.id === m.default) ? m.default : maps[0].id, maps };
    } catch (err) {
        console.warn('maps/index.json nicht lesbar - nur die eingebaute Karte:', err.message);
        return FALLBACK_MANIFEST;
    }
}
const MANIFEST = loadManifest();
let currentMapId = MANIFEST.maps.some(m => m.id === process.env.MAP) ? process.env.MAP : MANIFEST.default;
const spawnCache = {};      // Karten-ID -> Spawnpunkte aus Raster bzw. Manifest (null = unbekannt)
const learnedSpawns = {};   // Karten-ID -> Spawnpunkte, die ein Client nach dem Laden einer .glb-Karte gemeldet hat
function currentMapEntry() { return MANIFEST.maps.find(m => m.id === currentMapId) || MANIFEST.maps[0]; }
const finitePoint = (a) => a && [a.x, a.y, a.z].every(Number.isFinite);
function activeSpawnPoints() {
    const e = currentMapEntry();
    if (!(e.id in spawnCache)) {
        let pts = null;
        if (e.type === 'grid') pts = loadSpawnPointsFromGrid(e.file);
        else if (Array.isArray(e.spawns)) pts = e.spawns.map(a => ({ x: Number(a[0]), y: Number(a[1]), z: Number(a[2]) })).filter(finitePoint);
        spawnCache[e.id] = pts && pts.length ? pts : null;
    }
    return spawnCache[e.id] || learnedSpawns[e.id] || null; // null: noch keine bekannt -> der Client wählt selbst
}
// ---- Kartenrotation: alle ROUND_MINUTES Minuten (Standard 5) stimmen die Spieler über die nächste Karte ab ----
// Läuft nur, wenn mindestens 2 Karten in maps/index.json stehen. Umgebungsvariable ROUND_MINUTES=0 schaltet es ab.
const ROUND_MS = (process.env.ROUND_MINUTES !== undefined ? Number(process.env.ROUND_MINUTES) : 5) * 60000;
const VOTE_MS = 15000;
const rotationOn = () => MANIFEST.maps.length > 1 && ROUND_MS > 0;
let roundEndsAt = Date.now() + ROUND_MS;
let mapVote = null; // { options: [id], votes: { socketId: mapId }, endsAt }
function mapInfoPayload() {
    return {
        id: currentMapId, maps: MANIFEST.maps.map(m => ({ id: m.id, name: m.name })),
        roundLeftMs: rotationOn() && !mapVote ? Math.max(0, roundEndsAt - Date.now()) : null
    };
}
function votePayload() {
    const counts = {};
    if (mapVote) for (const id of Object.values(mapVote.votes)) counts[id] = (counts[id] || 0) + 1;
    return mapVote && {
        options: mapVote.options.map(id => ({ id, name: (MANIFEST.maps.find(m => m.id === id) || {}).name || id })),
        leftMs: Math.max(0, mapVote.endsAt - Date.now()), counts
    };
}
console.log('Karten:', MANIFEST.maps.map(m => m.id).join(', '), '| aktiv:', currentMapId);

// ---------- Waffen-Werte (Anti-Cheat) ----------
// Der Server rechnet Schaden, Feuerrate und Magazin SELBST aus diesen Werten - der Client darf nur melden "ich habe
// Waffe X abgefeuert / getroffen". Die Werte werden direkt aus js/weapon.js gelesen (eine Quelle der Wahrheit, wie bei
// der Map); schlägt das fehl, gilt die Rückfall-Tabelle (muss dann mit weapon.js übereinstimmen).
const FALLBACK_WEAPONS = [
    { name: 'Rifle',    damage: 20, pellets: 1, fireCooldown: 0.1,   magSize: 30, reloadDuration: 1700 },
    { name: 'Pistol',   damage: 15, pellets: 1, fireCooldown: 0.18,  magSize: 12, reloadDuration: 1100 },
    { name: 'Sniper',   damage: 75, pellets: 1, fireCooldown: 1.2,   magSize: 5,  reloadDuration: 2400 },
    { name: 'SMG',      damage: 11, pellets: 1, fireCooldown: 0.055, magSize: 40, reloadDuration: 1600 },
    { name: 'Shotgun',  damage: 12, pellets: 8, fireCooldown: 0.85,  magSize: 6,  reloadDuration: 2300 },
    { name: 'Revolver', damage: 55, pellets: 1, fireCooldown: 0.5,   magSize: 6,  reloadDuration: 2100 }
];
function loadWeaponTable() {
    try {
        const src = fs.readFileSync(path.join(__dirname, 'js', 'weapon.js'), 'utf8');
        const start = src.indexOf('export const WEAPON_CONFIGS = [');
        const end = src.indexOf('\n];', start);
        if (start === -1 || end === -1) throw new Error('WEAPON_CONFIGS nicht gefunden');
        const text = src.slice(src.indexOf('[', start), end + 3).replace(/buildModel:\s*\w+/g, 'buildModel: null');
        const table = new Function('return ' + text)().map(c => ({
            name: String(c.name), damage: Number(c.damage), pellets: Number(c.pellets || 1),
            fireCooldown: Number(c.fireCooldown), magSize: Number(c.magSize), reloadDuration: Number(c.reloadDuration)
        }));
        if (!table.length || !table.every(w => [w.damage, w.pellets, w.fireCooldown, w.magSize, w.reloadDuration].every(v => Number.isFinite(v) && v > 0))) {
            throw new Error('ungültige Werte in WEAPON_CONFIGS');
        }
        console.log('Waffen-Werte aus js/weapon.js:', table.map(w => `${w.name} ${w.damage}${w.pellets > 1 ? 'x' + w.pellets : ''}`).join(', '));
        return table;
    } catch (err) {
        console.warn('Rückfall-Waffentabelle:', err.message);
        return FALLBACK_WEAPONS;
    }
}
const WEAPONS = loadWeaponTable();
const HIT_WINDOW_MS = 1500;     // ein Treffer muss zu einem Schuss der letzten 1.5 s gehören
const HIT_RADIUS = 3.5;         // Meter: so weit darf der Einschlagspunkt von der (zeitversetzt gemeldeten) Zielposition entfernt sein
const SHOT_ORIGIN_MAX = 8;      // Meter: Mündung darf nicht weit vom gemeldeten Spieler entfernt sein
const SHOT_RANGE_MAX = 500;     // Meter: längster erlaubter Schuss (Map ist ca. 363 m lang)

// Kampf-Zustand eines Spielers (bei Beitritt und bei jedem Respawn zurückgesetzt, wie die vollen Magazine im Client)
function resetCombatState(p) {
    p.mags = WEAPONS.map(w => ({ ammo: w.magSize, reloadUntil: 0 }));
    p.tokens = WEAPONS.map(() => 2);          // Feuerrate: Token-Eimer, max. 2 (kleine Toleranz für Netzwerk-Schwankungen)
    p.tokenAt = WEAPONS.map(() => Date.now());
    p.shot = null;                             // letzter akzeptierter Schuss (Grundlage für Treffer)
}

// Einfache Nachrichten-Begrenzung (pro Spieler und Nachrichtenart), schützt vor Flut-Angriffen
function rateOk(p, key, perSecond) {
    const now = Date.now();
    p.rl = p.rl || {};
    const r = p.rl[key] || (p.rl[key] = { t0: now, n: 0 });
    if (now - r.t0 >= 1000) { r.t0 = now; r.n = 0; }
    return ++r.n <= perSecond;
}

// Darf dieser Schuss fallen? Prüft Waffe, Ausrüstung, Magazin, Nachladen, Feuerrate, Position und Reichweite.
function acceptShot(me, w, start, end, now) {
    const cfg = WEAPONS[w];
    if (!cfg || !me.loadout.includes(w)) return false;            // nur die 2 ausgerüsteten Waffen
    const mag = me.mags[w];
    if (mag.reloadUntil) {
        if (now < mag.reloadUntil) return false;                   // lädt noch nach
        mag.ammo = cfg.magSize; mag.reloadUntil = 0;
    }
    if (mag.ammo <= 0) return false;                               // Magazin leer (Client muss erst 'reloadStarted' melden)
    // Feuerrate: Token-Eimer füllt sich mit 1 Schuss pro Cooldown
    me.tokens[w] = Math.min(2, me.tokens[w] + (now - me.tokenAt[w]) / (cfg.fireCooldown * 1000));
    me.tokenAt[w] = now;
    if (me.tokens[w] < 1) return false;
    // Mündung muss in der Nähe des Spielers sein, Schuss nicht absurd lang
    if (Math.hypot(start.x - me.x, start.y - (me.y + 1.5), start.z - me.z) > SHOT_ORIGIN_MAX) return false;
    if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) > SHOT_RANGE_MAX) return false;

    me.tokens[w] -= 1;
    mag.ammo -= 1;
    me.shot = { t: now, w, ends: [end], credits: cfg.pellets, tracers: cfg.pellets - 1 };
    return true;
}

// Liegt der Einschlagspunkt in der Nähe des Ziels? (Zielposition: x/z Mitte, y = Augenhöhe - 1.5; Körper ca. y-0.5 .. y+1.75)
function hitPlausible(end, target) {
    return Math.hypot(end.x - target.x, end.z - target.z) <= HIT_RADIUS && end.y >= target.y - 1.5 && end.y <= target.y + 3.0;
}
const MIN_SAFE_SPAWN_DISTANCE = 40;

// --- Reset-Button-Regeln ---
const LAST_ATTACKER_WINDOW_MS = 10000; // Schaden älter als 10s zählt nicht mehr als "wurde getötet von"
const RESET_COOLDOWN_MS = 5000;
const SYRINGE_KILL_INTERVAL = 5;       // alle 5 Kills gibt es eine Heilspritze

function getRandomSpawnPoint(excludeId) {
    const SPAWN_POINTS = activeSpawnPoints();
    if (!SPAWN_POINTS) return null;
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
    victim.dead = true;                                   // wartet auf Waffenwahl/Respawn-Bestätigung des Clients
    clearTimeout(victim.deadTimer);
    victim.deadTimer = setTimeout(() => endDeadState(victimId), DEAD_TIMEOUT_MS); // Sicherung, falls der Client nie bestätigt

    const respawnPos = getRandomSpawnPoint(victimId);
    if (respawnPos) Object.assign(victim, respawnPos);

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

// Kosmetik eines Spielstands prüfen: Charakter-Skin, Skin pro Waffe (6 Waffen), Loadout (2 verschiedene Waffen).
// Alte Profile ohne wskins/loadout: der eine Skin galt für alles, Loadout = Standard.
const MAX_SKIN_ID = 63, WEAPON_COUNT = 6;
const intIn = (v, min, max, fallback) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
function sanitizeCosmetics(src) {
    const skin = intIn(src?.skin, 0, MAX_SKIN_ID, 0);
    const wskins = Array.from({ length: WEAPON_COUNT }, (_, i) =>
        Array.isArray(src?.wskins) ? intIn(src.wskins[i], 0, MAX_SKIN_ID, 0) : skin);
    let loadout = [0, 1];
    if (Array.isArray(src?.loadout) && src.loadout.length === 2) {
        const [a, b] = src.loadout;
        const valid = (v) => Number.isInteger(v) && v >= 0 && v < WEAPON_COUNT;
        if (valid(a) && valid(b) && a !== b) loadout = [a, b];
    }
    return { skin, wskins, loadout };
}

// Tod/Respawn: Wer stirbt, wählt seine Waffen neu und bestätigt per 'respawnReady'. Bis dahin (max. DEAD_TIMEOUT_MS)
// ist er nicht treffbar und teilt nicht aus; danach gibt es noch kurzen Spawn-Schutz.
const DEAD_TIMEOUT_MS = 15000;
const SPAWN_PROTECTION_MS = 2000;

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

// Tot -> wieder im Spiel (mit kurzem Spawn-Schutz)
function endDeadState(id) {
    const p = players[id];
    if (!p || !p.dead) return;
    clearTimeout(p.deadTimer);
    p.dead = false;
    p.protectUntil = Date.now() + SPAWN_PROTECTION_MS;
    resetCombatState(p); // volle Magazine (der Client füllt beim Respawn ebenfalls auf)
}

// Leaderboard an alle schicken (nach jeder Änderung von kills/deaths)
function broadcastLeaderboard() {
    const board = Object.entries(players).map(([id, p]) => ({
        id, name: p.name || id.slice(0, 6), kills: p.kills || 0, deaths: p.deaths || 0, level: p.level || 1
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    io.emit('leaderboard', board);
}

function startMapVote() {
    const others = MANIFEST.maps.filter(m => m.id !== currentMapId).map(m => m.id);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    mapVote = { options: others.slice(0, 3), votes: {}, endsAt: Date.now() + VOTE_MS };
    io.emit('mapVote', votePayload());
}
function finishMapVote() {
    const tally = {};
    for (const id of Object.values(mapVote.votes)) tally[id] = (tally[id] || 0) + 1;
    const best = Math.max(0, ...mapVote.options.map(id => tally[id] || 0));
    const top = mapVote.options.filter(id => (tally[id] || 0) === best);
    currentMapId = top[Math.floor(Math.random() * top.length)];
    mapVote = null;
    roundEndsAt = Date.now() + ROUND_MS;
    console.log('Rotation -> Karte:', currentMapId);
    io.emit('mapChanged', mapInfoPayload());
}
setInterval(() => {
    if (!rotationOn()) return;
    if (!Object.keys(players).length) { mapVote = null; roundEndsAt = Date.now() + ROUND_MS; return; }
    if (mapVote) { if (Date.now() >= mapVote.endsAt) finishMapVote(); }
    else if (Date.now() >= roundEndsAt) startMapVote();
}, 1000);

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);
    let lastResetTime = 0;

    // Spieler registrieren (Name kommt kurz danach via 'setName')
    const spawn = getRandomSpawnPoint(socket.id);
    players[socket.id] = { ...(spawn || { x: 0, y: 2, z: 0 }), health: 100, name: 'Player', kills: 0, deaths: 0, syringes: 0, level: 1, skin: 0, loadout: [0, 1] };
    resetCombatState(players[socket.id]);

    socket.emit('mapInfo', mapInfoPayload());
    if (mapVote) socket.emit('mapVote', votePayload());
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, position: players[socket.id], name: players[socket.id].name });
    broadcastLeaderboard();

    // Karte wählen: nur wenn man allein auf dem Server ist (sonst würden Spieler in verschiedenen Welten stehen)
    socket.on('selectMap', (id) => {
        const entry = MANIFEST.maps.find(m => m.id === id);
        if (!entry) return;
        if (entry.id === currentMapId) { socket.emit('mapInfo', mapInfoPayload()); return; }
        if (Object.keys(players).length > 1) { socket.emit('mapDenied', { id: currentMapId, reason: 'players' }); return; }
        currentMapId = entry.id;
        roundEndsAt = Date.now() + ROUND_MS;
        console.log('Karte gewechselt:', currentMapId);
        io.emit('mapChanged', mapInfoPayload());
    });
    socket.on('mapVoteCast', (id) => {
        if (!mapVote || !mapVote.options.includes(id)) return;
        mapVote.votes[socket.id] = id;
        io.emit('mapVoteUpdate', votePayload());
    });
    // .glb-Karten ohne feste Spawns: der erste Client meldet die automatisch gefundenen Spawnpunkte
    socket.on('mapSpawns', (d) => {
        const me = players[socket.id];
        if (!me || !rateOk(me, 'mapSpawns', 3) || !d || d.id !== currentMapId || !Array.isArray(d.spawns)) return;
        if (activeSpawnPoints()) return;
        const pts = d.spawns.slice(0, 32).map(a => ({ x: Number(a?.x), y: Number(a?.y), z: Number(a?.z) })).filter(finitePoint);
        if (pts.length) { learnedSpawns[currentMapId] = pts; console.log('Spawnpunkte für', currentMapId, 'vom Client:', pts.length); }
    });

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
        me.skin = clampInt(p?.skin, 0, MAX_SKIN_ID, 0);
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
        const clientCosm = sanitizeCosmetics(d);

        const isTest = TEST_ACCOUNTS.has(key);
        const { ok, prof } = await loadProfile(key);
        if (!players[socket.id]) return; // währenddessen getrennt
        if (!ok) { // Speicher down: nichts überschreiben (Test-Accounts bekommen trotzdem Max-Level)
            socket.emit('progressSynced', { xp: isTest ? Math.max(clientXp, TEST_XP) : clientXp, ...clientCosm, saved: false, storageWarning: isTest });
            return;
        }

        let chosen;
        if (!prof || clientXp > prof.xp) {
            chosen = { name: me.name, xp: clientXp, ...clientCosm, updated: Date.now() };
            queueSave(key, chosen);
        } else {
            chosen = { ...prof, ...sanitizeCosmetics(prof) }; // ältere Profile ohne Waffen-Skins/Loadout werden ergänzt
        }
        if (isTest && chosen.xp < TEST_XP) { // Test-Account: immer Maximal-Level
            chosen = { name: me.name, xp: TEST_XP, ...sanitizeCosmetics(chosen), updated: Date.now() };
            queueSave(key, chosen);
        }
        me.persistKey = key;
        me.progressXp = chosen.xp;
        // storageWarning: nur Test-Accounts (= du als Entwickler) sehen den Hinweis, normale Spieler nicht
        socket.emit('progressSynced', { xp: chosen.xp, ...sanitizeCosmetics(chosen), saved: true, restored: !!prof && prof.xp >= clientXp, storageWarning: isTest && !storageDurable });
    });

    // Laufende Speicherung (Client sendet gedrosselt alle paar Sekunden + bei Level-Up/Skinwechsel)
    socket.on('saveProgress', (d) => {
        const me = players[socket.id];
        if (!me || !me.persistKey) return;
        let xp = clampInt(d?.xp, 0, MAX_XP, -1);
        if (xp < 0 || xp < (me.progressXp || 0)) return;                 // XP gehen nie zurück
        xp = Math.min(xp, (me.progressXp || 0) + MAX_XP_PER_SAVE);       // und wachsen nur plausibel
        me.progressXp = xp;
        queueSave(me.persistKey, { name: me.name, xp, ...sanitizeCosmetics(d), updated: Date.now() });
    });

    socket.on('playerMove', (data) => {
        const p = players[socket.id];
        if (!p || !rateOk(p, 'move', 200)) return;
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
    // Ausrüstung (2 Waffen) melden: wird beim Spielstart und bei jedem Respawn gesendet
    socket.on('setLoadout', (pair) => {
        const me = players[socket.id];
        if (!me || !Array.isArray(pair) || pair.length !== 2) return;
        const [a, b] = pair;
        const valid = (v) => Number.isInteger(v) && v >= 0 && v < WEAPONS.length; // strikt: ungültige Werte werden abgelehnt, nicht gekürzt
        if (valid(a) && valid(b) && a !== b) me.loadout = [a, b];
    });

    // Nachladen gemeldet: erst nach Ablauf der Nachladezeit (minus kleiner Toleranz) darf wieder geschossen werden
    socket.on('reloadStarted', (d) => {
        const me = players[socket.id];
        const w = Number.isInteger(d?.w) ? d.w : -1;
        if (!me || me.dead || !WEAPONS[w] || !me.loadout.includes(w)) return;
        const mag = me.mags[w];
        if (mag.reloadUntil || mag.ammo >= WEAPONS[w].magSize) return;   // lädt schon / Magazin voll
        mag.reloadUntil = Date.now() + WEAPONS[w].reloadDuration * 0.85;
    });

    // Schuss: wird nur weitergegeben (Tracer/Sound bei den anderen), wenn der Server ihn für möglich hält
    socket.on('shoot', (shotData) => {
        const me = players[socket.id];
        if (!me || me.dead || !rateOk(me, 'shoot', 60)) return;
        const start = toVec(shotData?.start), end = toVec(shotData?.end);
        if (!start || !end) return;
        const w = Number.isInteger(shotData.w) && WEAPONS[shotData.w] ? shotData.w : -1;
        if (w < 0) return;
        const now = Date.now();
        if (!shotData.silent) {
            if (!acceptShot(me, w, start, end, now)) return;
        } else {
            // weitere Schrotkugeln desselben Schusses: nur so viele, wie die Waffe Kugeln hat
            const s = me.shot;
            if (!s || s.w !== w || now - s.t > 400 || s.tracers <= 0) return;
            s.tracers--;
            s.ends.push(end);
        }
        const c = Number.isInteger(shotData.c) && shotData.c >= 0 && shotData.c <= 0xffffff ? shotData.c : null;
        socket.broadcast.emit('playerShot', {
            id: socket.id, start, end, w, c,
            n: toVec(shotData.n), hitPlayer: !!shotData.hitPlayer,
            silent: !!shotData.silent // weitere Schrotkugeln desselben Schusses: Effekt ja, Sound nein
        });
    });

    // Treffer: der Client meldet nur WEN (und wie viele Kugeln). Schaden berechnet der Server aus der Waffe des
    // zuletzt akzeptierten Schusses; ohne passenden, frischen Schuss in Zielnähe passiert nichts.
    socket.on('hitPlayer', (data) => {
        const shooter = players[socket.id];
        if (!shooter || shooter.dead || !rateOk(shooter, 'hit', 60)) return;
        const targetId = data && typeof data === 'object' ? data.targetId : null;
        const target = players[targetId];
        if (!target || targetId === socket.id) return;
        if (target.dead || (target.protectUntil || 0) > Date.now()) return; // wartet auf Respawn / Spawn-Schutz

        const now = Date.now();
        const shot = shooter.shot;
        if (!shot || shot.credits <= 0 || now - shot.t > HIT_WINDOW_MS) return;          // kein passender Schuss
        if (!shot.ends.some(e => hitPlausible(e, target))) return;                        // Einschlag nicht beim Ziel
        const n = Math.min(Math.max(1, Math.floor(Number(data.n)) || 1), shot.credits);  // höchstens so viele Kugeln wie übrig
        shot.credits -= n;
        const damage = WEAPONS[shot.w].damage * n;                                         // Schaden kommt vom Server, nie vom Client

        target.health -= damage;
        target.lastAttacker = socket.id;   // für den Reset-Button
        target.lastDamageTime = now;

        // Schaden-Feedback an den Schützen (Treffermeldung im Client)
        socket.emit('hitConfirm', { targetId, damage, remaining: Math.max(0, target.health) });

        if (target.health <= 0) {
            killPlayer(targetId, socket.id, 'hit');
        } else {
            io.emit('playerHealthUpdate', { id: targetId, health: target.health });
        }
    });

    // Client hat die Waffen gewählt und respawnt jetzt
    socket.on('respawnReady', () => endDeadState(socket.id));

    // Reset-Button: Spieler "stirbt" freiwillig. Kill geht an den letzten Schadensverursacher
    // (innerhalb des Zeitfensters, noch verbunden), sonst an den räumlich nächsten Spieler.
    socket.on('requestReset', () => {
        const me = players[socket.id];
        if (!me || me.dead) return;

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
        if (players[socket.id]) clearTimeout(players[socket.id].deadTimer);
        delete players[socket.id];
        if (mapVote) { delete mapVote.votes[socket.id]; io.emit('mapVoteUpdate', votePayload()); }
        io.emit('playerDisconnected', socket.id);
        broadcastLeaderboard();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
