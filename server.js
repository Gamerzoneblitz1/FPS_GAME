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
const rotationOn = () => ROUND_MS > 0;   // Modus wechselt immer, Karte nur bei 2+ Karten wählbar
let roundEndsAt = Date.now() + ROUND_MS;
let mapVote = null; // { options: [id], votes: { socketId: mapId }, endsAt }
function mapInfoPayload() {
    return {
        id: currentMapId, maps: MANIFEST.maps.map(m => ({ id: m.id, name: m.name })), mode: currentMode, modeName: MODE_NAMES[currentMode],
        roundLeftMs: rotationOn() && !mapVote ? Math.max(0, roundEndsAt - Date.now()) : null
    };
}
function votePayload() {
    const counts = {};
    if (mapVote) for (const id of Object.values(mapVote.votes)) counts[id] = (counts[id] || 0) + 1;
    return mapVote && {
        nextMode: mapVote.nextMode, nextModeName: MODE_NAMES[mapVote.nextMode],
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
    { name: 'Revolver', damage: 55, pellets: 1, fireCooldown: 0.5,   magSize: 6,  reloadDuration: 2100 },
    { name: 'Knife',    damage: 40, pellets: 1, fireCooldown: 0.55,  magSize: 1,  reloadDuration: 1000, infinite: true, melee: 2.7 }
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
            fireCooldown: Number(c.fireCooldown), magSize: Number(c.magSize), reloadDuration: Number(c.reloadDuration),
            infinite: !!c.infiniteAmmo, melee: Number(c.melee || 0)
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
const KNIFE = WEAPONS.length - 1;   // Messer: immer erlaubt, kein Magazin
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
    if (!cfg || !(w === KNIFE || me.loadout.includes(w))) return false;   // nur die gekauften Waffen + Messer
    const mag = me.mags[w];
    if (cfg.infinite) mag.ammo = 1, mag.reloadUntil = 0;           // Messer: unbegrenzt
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
    if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) > (cfg.melee ? cfg.melee + 1.5 : SHOT_RANGE_MAX)) return false;

    me.tokens[w] -= 1;
    if (!cfg.infinite) mag.ammo -= 1;
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
        if (otherId === id || o.isBot) continue;
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
    victim.deadTimer = setTimeout(() => endDeadState(victimId), victim.isBot ? BOT_RESPAWN_MS : DEAD_TIMEOUT_MS); // Sicherung, falls der Client nie bestätigt (Bots: feste Wartezeit)

    victim.hold = false;
    const tsp = isTeamMode() && curLayout() ? teamSpawnPos(victim) : null;
    const respawnPos = tsp ? { x: tsp.x, y: tsp.y + 2, z: tsp.z } : getRandomSpawnPoint(victimId);
    if (respawnPos) Object.assign(victim, respawnPos);
    objectiveOnKill(victim);

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
const MAX_XP = 200000000;
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
const MAX_SKIN_ID = 127, WEAPON_COUNT = 7;   // WEAPON_COUNT inkl. Messer
const intIn = (v, min, max, fallback) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
function sanitizeCosmetics(src) {
    const skin = intIn(src?.skin, 0, MAX_SKIN_ID, 0);
    const wskins = Array.from({ length: WEAPON_COUNT }, (_, i) =>
        Array.isArray(src?.wskins) ? intIn(src.wskins[i], 0, MAX_SKIN_ID, 0) : skin);
    let loadout = [0, 1];
    if (Array.isArray(src?.loadout) && src.loadout.length === 2) {
        const [a, b] = src.loadout;
        const valid = (v) => Number.isInteger(v) && v >= 0 && v < WEAPON_COUNT - 1;
        if (valid(a) && valid(b) && a !== b) loadout = [a, b];
    }
    // Besitz (Skin-IDs aus Kisten) und Anzahl geöffneter Kisten; Kisten selbst ergeben sich aus dem Level (siehe progression.js)
    const owned = Array.isArray(src?.owned) ? [...new Set(src.owned.map(v => intIn(v, 0, MAX_SKIN_ID, 0)).filter(v => v > 0))].sort((x, y) => x - y).slice(0, MAX_SKIN_ID) : [];
    const opened = intIn(src?.opened, 0, 1000000, 0);
    const extra = {};                                                       // Duplikate: Zusatzkopien je Skin-ID
    if (src?.extra && typeof src.extra === 'object') for (const k of Object.keys(src.extra).slice(0, MAX_SKIN_ID)) {
        const id = intIn(k, 0, MAX_SKIN_ID, 0), n = intIn(src.extra[k], 0, 9999, 0);
        if (id > 0 && n > 0 && owned.includes(id)) extra[id] = n;
    }
    return { skin, wskins, loadout, owned, opened, extra };
}

// Tod/Respawn: Wer stirbt, wählt seine Waffen neu und bestätigt per 'respawnReady'. Bis dahin (max. DEAD_TIMEOUT_MS)
// ist er nicht treffbar und teilt nicht aus; danach gibt es noch kurzen Spawn-Schutz.
const DEAD_TIMEOUT_MS = 15000;
const SPAWN_PROTECTION_MS = 2000;

// Test-Accounts: diese Namen bekommen beim Einloggen immer ein hohes Level (Level 100 = 99 Kisten zum Ausprobieren).
// Standard: "Tester". Ändern/erweitern per Environment-Variable TEST_ACCOUNTS (Namen mit Komma getrennt,
// Groß-/Kleinschreibung egal), z.B. TEST_ACCOUNTS=tester,nicolas. Leer lassen (TEST_ACCOUNTS=) schaltet sie ab.
// Achtung: Wer den Namen kennt, bekommt den Max-Stand - für Tests praktisch, für ein öffentliches Spiel abschalten.
const TEST_ACCOUNTS = new Set(String(process.env.TEST_ACCOUNTS ?? 'tester').split(',').map(nameKey).filter(Boolean));
const TEST_XP = 505000; // Level 100 braucht ca. 504900 XP (200 + 300 + ... , siehe progression.js)
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
    if (p.noRespawn) { io.to(id).emit('respawnBlocked'); return; }   // Bombe liegt: erst nächste Runde
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
    const all = MANIFEST.maps.map(m => m.id);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const nextMode = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length];
    mapVote = { options: all.slice(0, 2), votes: {}, endsAt: Date.now() + VOTE_MS, nextMode };   // 2 Karten zur Auswahl
    io.emit('mapVote', votePayload());
}
function finishMapVote() {
    const tally = {};
    for (const id of Object.values(mapVote.votes)) tally[id] = (tally[id] || 0) + 1;
    const best = Math.max(0, ...mapVote.options.map(id => tally[id] || 0));
    const top = mapVote.options.filter(id => (tally[id] || 0) === best);
    currentMapId = top[Math.floor(Math.random() * top.length)];
    const nextMode = mapVote.nextMode;
    mapVote = null;
    roundEndsAt = Date.now() + ROUND_MS;
    console.log('Rotation -> Karte:', currentMapId, '| Modus:', nextMode);
    resetBots();
    startMode(nextMode);
    io.emit('mapChanged', mapInfoPayload());
}
setInterval(() => {
    if (!rotationOn()) return;
    if (!humanIds().length) { mapVote = null; roundEndsAt = Date.now() + ROUND_MS; return; }
    if (mapVote) { if (Date.now() >= mapVote.endsAt) finishMapVote(); }
    else if (Date.now() >= roundEndsAt) startMapVote();
}, 1000);


// ---------- Bots ----------
// BOT_COUNT Bots (Standard 10, 0 = aus). Sie stehen wie normale Spieler in "players" (Kill-Feed, Leaderboard, Treffer laufen
// über denselben Weg). Gedacht wird im Browser des "Bot-Hosts" (der erste echte Spieler): nur dort kennt man die Wände der
// Karte. Der Host meldet Bewegung ('botMoves') und Schüsse ('botShoot'); der Server rechnet Schaden und Tod selbst.
const BOT_COUNT = Math.max(0, Math.min(20, Number.isFinite(Number(process.env.BOT_COUNT)) && process.env.BOT_COUNT !== '' && process.env.BOT_COUNT !== undefined ? Math.floor(Number(process.env.BOT_COUNT)) : 10));
const BOT_NAMES = ['Viper', 'Ghost', 'Rogue', 'Blaze', 'Nova', 'Raven', 'Kilo', 'Echo', 'Hawk', 'Zero', 'Dash', 'Onyx', 'Fang', 'Pixel', 'Storm', 'Rex', 'Jinx', 'Volt', 'Mako', 'Spike'];
const BOT_WEAPONS = [0, 1, 3, 4, 5];          // Rifle, Pistol, SMG, Shotgun, Revolver
const BOT_DAMAGE_SCALE = 0.5;                 // Bots machen halben Schaden (sonst unfair)
const BOT_RESPAWN_MS = 3000;
const BOT_CHAR_SKINS = [0, 57, 58, 59, 60, 61, 62, 63, 64];
let botHostId = null;
const isBotId = (id) => !!(players[id] && players[id].isBot);
const humanIds = () => Object.keys(players).filter(id => !players[id].isBot);
function spawnBots() {
    if (!BOT_COUNT || Object.values(players).some(p => p.isBot)) return;
    for (let i = 0; i < BOT_COUNT; i++) {
        const id = 'bot_' + (i + 1);
        const sp = getRandomSpawnPoint(id);
        players[id] = { ...(sp || { x: 0, y: 0, z: 0 }), health: 100, name: 'Bot ' + BOT_NAMES[i % BOT_NAMES.length], kills: 0, deaths: 0, syringes: 0,
            level: 5 + Math.floor(Math.random() * 60), skin: BOT_CHAR_SKINS[Math.floor(Math.random() * BOT_CHAR_SKINS.length)], loadout: [], isBot: true, lastBotShot: 0 };
    }
    console.log('Bots gestartet:', BOT_COUNT);
}
function removeBots() {
    for (const id of Object.keys(players)) if (players[id].isBot) { clearTimeout(players[id].deadTimer); delete players[id]; }
    botHostId = null;
}
function updateBotHost() {
    const h = humanIds()[0] || null;
    if (h !== botHostId) { botHostId = h; io.emit('botHost', { id: h }); }
}
// Karte gewechselt: alle Bots wieder voll am Leben (der Host setzt sie auf Spawnpunkte)
function resetBots() {
    for (const p of Object.values(players)) if (p.isBot) { p.health = 100; p.dead = false; clearTimeout(p.deadTimer); p.protectUntil = Date.now() + SPAWN_PROTECTION_MS; }
}


// ---------- Spielmodi ----------
// dm = Deathmatch (jeder gegen jeden), bomb = Bombplant (T legen die Bombe, CT entschärfen), rescue = Rettungsmission (CT bringen Geiseln zur Basis).
// Alle ROUND_MINUTES wechselt der Modus (dm -> bomb -> rescue -> ...) und die Spieler wählen dabei eine von 2 Karten.
// Die Karte kennt nur der Browser des Bot-Hosts: er legt aus dem Wegenetz T-/CT-Spawn, 2 Bombenplätze und 2 Geiseln fest ('modeLayout').
const MODES = ['dm', 'bomb', 'rescue'];
const MODE_NAMES = { dm: 'Deathmatch', bomb: 'Bombplant', rescue: 'Rettungsmission' };
const MODE_ROUND_SEC = { bomb: 120, rescue: 150 };
const PLANT_SEC = 3, DEFUSE_SEC = 5, BOMB_FUSE_SEC = 40, RESCUE_HOLD_SEC = 1.5, ROUND_END_MS = 6000, USE_RANGE = 3.2, RESCUE_ZONE = 9;
let currentMode = 'dm';
const layouts = {};                     // mapId -> { t, ct, sites:[{x,y,z,name}], hostages:[{x,y,z}] } (Füße-Höhe)
const isTeamMode = () => currentMode !== 'dm';
const obj = { phase: 'idle', roundNo: 0, scoreT: 0, scoreCT: 0, liveEnds: 0, nextAt: 0, winner: null, reason: '', noRespawn: false, waitSince: 0,
    bomb: null, hostages: [], prog: null };
const curLayout = () => layouts[currentMapId] || null;
const objectiveActive = () => isTeamMode() && !!curLayout() && obj.phase !== 'idle' && obj.phase !== 'nolayout';
const jitter = (r) => (Math.random() * 2 - 1) * r;

function assignTeams(force = false) {
    if (!isTeamMode()) { for (const p of Object.values(players)) delete p.team; io.emit('teams', {}); return; }
    const ids = Object.keys(players);
    if (!force && ids.every(id => players[id].team)) return;
    const humans = ids.filter(id => !players[id].isBot).sort(() => Math.random() - 0.5);
    const bots = ids.filter(id => players[id].isBot).sort(() => Math.random() - 0.5);
    const n = { T: 0, CT: 0 };
    const put = (id, t) => { players[id].team = t; n[t]++; };
    if (force) for (const id of ids) delete players[id].team;
    for (const id of ids) if (players[id].team) n[players[id].team]++;
    humans.filter(id => !players[id].team).forEach((id, i) => put(id, n.T <= n.CT ? 'T' : 'CT'));
    bots.filter(id => !players[id].team).forEach(id => put(id, n.T <= n.CT ? 'T' : 'CT'));
    broadcastTeams();
}
function broadcastTeams() {
    const m = {};
    for (const [id, p] of Object.entries(players)) if (p.team) m[id] = p.team;
    io.emit('teams', m);
}
function teamSpawnPos(p) {                       // Füße-Position an der Basis des Teams
    const lay = curLayout();
    if (!lay || !p || !p.team) return null;
    const b = p.team === 'T' ? lay.t : lay.ct;
    return { x: b.x + jitter(1.6), y: b.y, z: b.z + jitter(1.6) };
}
const alive = (p) => p && !p.dead;
const teamAlive = (team) => Object.values(players).filter(p => p.team === team && alive(p));
const near = (p, q, r) => Math.hypot(p.x - q.x, p.z - q.z) <= r && Math.abs(p.y - q.y) < 3;

function modeStatePayload() {
    const now = Date.now();
    const lay = curLayout();
    const p = {
        mode: currentMode, name: MODE_NAMES[currentMode], phase: obj.phase, roundNo: obj.roundNo, scoreT: obj.scoreT, scoreCT: obj.scoreCT,
        leftMs: obj.phase === 'live' ? Math.max(0, obj.liveEnds - now) : (obj.phase === 'end' ? Math.max(0, obj.nextAt - now) : 0),
        winner: obj.winner, reason: obj.reason, noRespawn: obj.noRespawn, hasLayout: !!lay
    };
    if (currentMode === 'bomb' && obj.bomb) {
        const b = obj.bomb;
        p.bomb = { state: b.state, carrier: b.carrier, x: b.x, y: b.y, z: b.z, site: b.site, fuseMs: b.state === 'planted' ? Math.max(0, b.explodeAt - now) : 0 };
    }
    if (currentMode === 'rescue') p.hostages = obj.hostages.map(h => ({ x: h.x, y: h.y, z: h.z, carrier: h.carrier, rescued: h.rescued }));
    if (obj.prog) p.prog = obj.prog;
    return p;
}
const layoutPayload = () => ({ mapId: currentMapId, layout: curLayout() });
function broadcastMode() { io.emit('modeState', modeStatePayload()); }

function resetPlayerForRound(p, pos) {
    p.health = 100; p.dead = false; p.noRespawn = false; p.hold = false; p.lastAttacker = null; p.lastDamageTime = 0;
    clearTimeout(p.deadTimer);
    p.protectUntil = Date.now() + SPAWN_PROTECTION_MS;
    resetCombatState(p);
    if (pos) { p.x = pos.x; p.y = pos.y; p.z = pos.z; }
}
function startRound() {
    const lay = curLayout();
    if (!lay) return;
    obj.roundNo++; obj.winner = null; obj.reason = ''; obj.noRespawn = false; obj.prog = null;
    obj.phase = 'live';
    obj.liveEnds = Date.now() + MODE_ROUND_SEC[currentMode] * 1000;
    const pos = {};
    for (const [id, p] of Object.entries(players)) { if (!p.team) continue; const sp = teamSpawnPos(p); resetPlayerForRound(p, sp); if (sp) pos[id] = sp; }
    if (currentMode === 'bomb') {
        const ts = Object.entries(players).filter(([, p]) => p.team === 'T');
        const humansFirst = ts.filter(([, p]) => !p.isBot);
        const pool = humansFirst.length && Math.random() < 0.6 ? humansFirst : ts;
        const carrier = pool.length ? pool[Math.floor(Math.random() * pool.length)][0] : null;
        obj.bomb = { state: carrier ? 'carried' : 'dropped', carrier, x: lay.t.x, y: lay.t.y, z: lay.t.z, site: -1, explodeAt: 0, plantP: 0, defP: 0 };
    } else if (currentMode === 'rescue') {
        obj.hostages = lay.hostages.map(h => ({ x: h.x, y: h.y, z: h.z, home: { x: h.x, y: h.y, z: h.z }, carrier: null, rescued: false, prog: 0 }));
    }
    io.emit('roundStart', { pos, state: modeStatePayload() });
    broadcastLeaderboard();
}
function endRound(winner, reason) {
    if (obj.phase !== 'live') return;
    obj.phase = 'end'; obj.winner = winner; obj.reason = reason; obj.nextAt = Date.now() + ROUND_END_MS; obj.prog = null;
    if (winner === 'T') obj.scoreT++; else obj.scoreCT++;
    for (const p of Object.values(players)) p.hold = false;
    broadcastMode();
}
function startMode(mode) {
    currentMode = mode;
    obj.phase = mode === 'dm' ? 'idle' : 'nolayout'; obj.roundNo = 0; obj.scoreT = 0; obj.scoreCT = 0; obj.winner = null; obj.noRespawn = false; obj.bomb = null; obj.hostages = []; obj.prog = null;
    obj.waitSince = Date.now();
    for (const p of Object.values(players)) { p.hold = false; p.noRespawn = false; }
    assignTeams(true);
    console.log('Modus:', mode, '| Karte:', currentMapId);
    io.emit('layout', layoutPayload());
    broadcastMode();
}
// Spieler stirbt: im Teammodus nach Platzierung der Bombe kein Respawn mehr bis zur nächsten Runde
function objectiveOnKill(victim) {
    if (!objectiveActive()) return;
    if (obj.bomb && obj.bomb.carrier && players[obj.bomb.carrier] === victim) { /* Bombe wird im Tick fallen gelassen */ }
    if (obj.noRespawn) victim.noRespawn = true;
}

function modeTick(dt) {
    if (!isTeamMode() || !humanIds().length) return;
    const now = Date.now(), lay = curLayout();
    if (!lay) {                                           // noch keine Kartenvermessung vom Host
        if (obj.phase !== 'nolayout') obj.phase = 'nolayout';
        if (now - obj.waitSince > 40000) { console.log('Kein Layout für', currentMapId, '- zurück zu Deathmatch'); io.emit('modeNotice', { text: 'Karte konnte nicht für den Modus vorbereitet werden – Deathmatch' }); startMode('dm'); }
        return;
    }
    if (obj.phase === 'nolayout' || obj.phase === 'idle') { assignTeams(); startRound(); return; }
    if (obj.phase === 'end') { if (now >= obj.nextAt) { assignTeams(); startRound(); } return; }
    if (obj.phase !== 'live') return;
    const list = Object.entries(players);
    obj.prog = null;

    if (currentMode === 'bomb') {
        const b = obj.bomb;
        if (!b) return;
        // Träger weg/tot -> Bombe fällt
        if (b.state === 'carried') {
            const c = players[b.carrier];
            if (!c || c.dead || c.team !== 'T') { b.state = 'dropped'; b.carrier = null; if (c) { b.x = c.x; b.y = c.y; b.z = c.z; } b.plantP = 0; }
            else { b.x = c.x; b.y = c.y; b.z = c.z; }
        }
        if (b.state === 'dropped') {                      // jeder lebende T in der Nähe hebt sie auf
            for (const [id, p] of list) if (p.team === 'T' && alive(p) && near(p, b, 1.8)) { b.state = 'carried'; b.carrier = id; break; }
        }
        if (b.state === 'carried') {
            const c = players[b.carrier];
            const site = lay.sites.findIndex(s => near(c, s, 3.4));
            if (c.hold && site >= 0) {
                b.plantP += dt;
                obj.prog = { kind: 'plant', owner: b.carrier, p: Math.min(1, b.plantP / PLANT_SEC) };
                if (b.plantP >= PLANT_SEC) {
                    b.state = 'planted'; b.site = site; b.x = c.x; b.y = c.y; b.z = c.z; b.explodeAt = now + BOMB_FUSE_SEC * 1000; b.defP = 0; b.carrier = null;
                    obj.noRespawn = true;
                    io.emit('modeNotice', { text: 'Die Bombe wurde bei ' + lay.sites[site].name + ' platziert!' });
                }
            } else b.plantP = 0;
        }
        if (b.state === 'planted') {
            let defuser = null;
            for (const [id, p] of list) if (p.team === 'CT' && alive(p) && p.hold && near(p, b, USE_RANGE)) { defuser = id; break; }
            if (defuser) { b.defP += dt; obj.prog = { kind: 'defuse', owner: defuser, p: Math.min(1, b.defP / DEFUSE_SEC) }; }
            else b.defP = 0;
            if (b.defP >= DEFUSE_SEC) { b.state = 'defused'; endRound('CT', 'Die Bombe wurde entschärft'); return; }
            if (now >= b.explodeAt) { b.state = 'exploded'; endRound('T', 'Die Bombe ist explodiert'); return; }
            if (!teamAlive('CT').length) { endRound('T', 'Alle Anti-Terror-Einheiten sind ausgeschaltet'); return; }
        } else if (now >= obj.liveEnds) { endRound('CT', 'Zeit abgelaufen – keine Bombe gelegt'); return; }
    } else if (currentMode === 'rescue') {
        for (const h of obj.hostages) {
            if (h.rescued) continue;
            if (h.carrier) {
                const c = players[h.carrier];
                if (!c || c.dead) { h.carrier = null; continue; }
                h.x = c.x + 0.8; h.y = c.y; h.z = c.z + 0.8;
                if (near(c, lay.ct, RESCUE_ZONE)) { h.rescued = true; h.carrier = null; io.emit('modeNotice', { text: 'Eine Geisel wurde gerettet!' }); }
                continue;
            }
            let holder = null;
            for (const [id, p] of list) if (p.team === 'CT' && alive(p) && p.hold && near(p, h, USE_RANGE) && !obj.hostages.some(o => o.carrier === id)) { holder = id; break; }
            if (holder) { h.prog += dt; obj.prog = { kind: 'rescue', owner: holder, p: Math.min(1, h.prog / RESCUE_HOLD_SEC) }; if (h.prog >= RESCUE_HOLD_SEC) { h.carrier = holder; h.prog = 0; } }
            else h.prog = 0;
        }
        if (obj.hostages.every(h => h.rescued)) { endRound('CT', 'Alle Geiseln gerettet'); return; }
        if (now >= obj.liveEnds) { endRound('T', 'Zeit abgelaufen – Geiseln nicht gerettet'); return; }
    }
}
let _lastModeTick = Date.now();
setInterval(() => {
    const now = Date.now(), dt = Math.min(0.5, (now - _lastModeTick) / 1000); _lastModeTick = now;
    try { modeTick(dt); } catch (e) { console.error('modeTick', e); }
    if (isTeamMode() && humanIds().length) broadcastMode();
}, 200);

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);
    let lastResetTime = 0;

    // Spieler registrieren (Name kommt kurz danach via 'setName')
    if (!humanIds().length) { spawnBots(); startMode(currentMode); }   // erster Spieler: Bots starten (stehen dann schon in 'currentPlayers'), Modus frisch beginnen
    const spawn = getRandomSpawnPoint(socket.id);
    players[socket.id] = { ...(spawn || { x: 0, y: 2, z: 0 }), health: 100, name: 'Player', kills: 0, deaths: 0, syringes: 0, level: 1, skin: 0, loadout: [] };   // Start nur mit Messer, Waffen per Kaufmenü (B)
    resetCombatState(players[socket.id]);
    if (isTeamMode()) {
        assignTeams();
        const sp = teamSpawnPos(players[socket.id]);
        if (sp) Object.assign(players[socket.id], { x: sp.x, y: sp.y + 2, z: sp.z });
    }

    socket.emit('mapInfo', mapInfoPayload());
    socket.emit('layout', layoutPayload());
    socket.emit('modeState', modeStatePayload());
    { const tm = {}; for (const [id, p] of Object.entries(players)) if (p.team) tm[id] = p.team; socket.emit('teams', tm); }
    if (mapVote) socket.emit('mapVote', votePayload());
    socket.emit('currentPlayers', players);
    updateBotHost();
    socket.emit('botHost', { id: botHostId });
    socket.broadcast.emit('newPlayer', { id: socket.id, position: players[socket.id], name: players[socket.id].name });
    broadcastLeaderboard();

    // Karte wählen: nur wenn man allein auf dem Server ist (sonst würden Spieler in verschiedenen Welten stehen)
    socket.on('selectMap', (id) => {
        const entry = MANIFEST.maps.find(m => m.id === id);
        if (!entry) return;
        if (entry.id === currentMapId) { socket.emit('mapInfo', mapInfoPayload()); return; }
        if (humanIds().length > 1) { socket.emit('mapDenied', { id: currentMapId, reason: 'players' }); return; }
        currentMapId = entry.id;
        roundEndsAt = Date.now() + ROUND_MS;
        console.log('Karte gewechselt:', currentMapId);
        resetBots();
        startMode(currentMode);
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
        me.level = clampInt(p?.level, 1, 9999, 1);
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
        // Besitz nie verlieren: Skins beider Seiten vereinigen, geöffnete Kisten = Maximum
        const merged = [...new Set([...(chosen.owned || []), ...clientCosm.owned])].sort((x, y) => x - y);
        const openedMax = Math.max(chosen.opened || 0, clientCosm.opened);
        const extraMax = { ...(chosen.extra || {}) };
        for (const k of Object.keys(clientCosm.extra)) extraMax[k] = Math.max(extraMax[k] || 0, clientCosm.extra[k]);
        if (merged.length !== (chosen.owned || []).length || openedMax !== (chosen.opened || 0) || JSON.stringify(extraMax) !== JSON.stringify(chosen.extra || {})) {
            chosen = { ...chosen, owned: merged, opened: openedMax, extra: extraMax, updated: Date.now() };
            queueSave(key, chosen);
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

    // ---- Ziel-Interaktion (Taste E gehalten: Bombe legen/entschärfen, Geisel befreien) ----
    socket.on('useHold', (d) => { const p = players[socket.id]; if (p) p.hold = !!(d && d.on) && !p.dead; });
    socket.on('botHold', (arr) => {
        if (socket.id !== botHostId || !Array.isArray(arr)) return;
        for (const m of arr.slice(0, 30)) { const b = players[m && m.id]; if (b && b.isBot) b.hold = !!m.on && !b.dead; }
    });
    // Der Bot-Host hat die Karte vermessen: Spawns, Bombenplätze, Geiseln
    socket.on('modeLayout', (d) => {
        if (socket.id !== botHostId || !d || d.mapId !== currentMapId || layouts[currentMapId]) return;
        const pt = (a) => finitePoint(a) ? { x: Number(a.x), y: Number(a.y), z: Number(a.z) } : null;
        const t = pt(d.t), ct = pt(d.ct);
        const sites = Array.isArray(d.sites) ? d.sites.slice(0, 2).map(pt) : [];
        const hostages = Array.isArray(d.hostages) ? d.hostages.slice(0, 2).map(pt) : [];
        if (!t || !ct || sites.length < 2 || sites.some(x => !x) || hostages.length < 1 || hostages.some(x => !x)) return;
        layouts[currentMapId] = { t, ct, sites: sites.map((s, i) => ({ ...s, name: i ? 'B' : 'A' })), hostages };
        console.log('Modus-Layout für', currentMapId, 'vom Host erhalten');
        io.emit('layout', layoutPayload());
    });

    // ---- Bot-Host meldet Bewegung und Schüsse der Bots ----
    socket.on('botMoves', (arr) => {
        if (socket.id !== botHostId || !Array.isArray(arr) || !rateOk(players[socket.id], 'botmove', 40)) return;
        const out = [];
        for (const m of arr.slice(0, 30)) {
            const b = players[m && m.id];
            if (!b || !b.isBot || b.dead) continue;
            const x = Number(m.x), y = Number(m.y), z = Number(m.z), ry = Number(m.ry);
            if (![x, y, z].every(Number.isFinite)) continue;
            b.x = x; b.y = y; b.z = z;
            out.push({ id: m.id, x, y, z, ry: Number.isFinite(ry) ? ry : 0 });
        }
        if (out.length) io.emit('botsMoved', out);
    });
    socket.on('botShoot', (d) => {
        if (socket.id !== botHostId || !d || !rateOk(players[socket.id], 'botshoot', 80)) return;
        const bot = players[d.id];
        if (!bot || !bot.isBot || bot.dead) return;
        const w = Number.isInteger(d.w) && BOT_WEAPONS.includes(d.w) && WEAPONS[d.w] ? d.w : -1;
        if (w < 0) return;
        const cfg = WEAPONS[w], now = Date.now();
        if (now - bot.lastBotShot < cfg.fireCooldown * 1000 * 0.7) return;     // Feuerrate
        bot.lastBotShot = now;
        const start = toVec(d.start), end = toVec(d.end);
        if (!start || !end) return;
        const target = d.targetId ? players[d.targetId] : null;
        const n = Math.min(cfg.pellets, Math.max(0, Math.floor(Number(d.n)) || 0));
        const hit = !!(target && n > 0 && d.targetId !== d.id && !(isTeamMode() && bot.team && bot.team === target.team));
        io.emit('playerShot', { id: d.id, start, end, w, c: null, n: null, hitPlayer: hit, silent: false });
        if (!hit || target.dead || (target.protectUntil || 0) > now) return;
        if (Math.hypot(bot.x - target.x, bot.z - target.z) > 90) return;
        target.health -= Math.max(1, Math.round(cfg.damage * n * BOT_DAMAGE_SCALE));
        target.lastAttacker = d.id;
        target.lastDamageTime = now;
        if (target.health <= 0) killPlayer(d.targetId, d.id, 'hit');
        else io.emit('playerHealthUpdate', { id: d.targetId, health: target.health });
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
    // Kaufmenü (Taste B): jederzeit möglich, solange man lebt. [] = nur Messer (Spawn ohne Kauf). Frisch gekaufte Waffen haben volle Magazine.
    socket.on('setLoadout', (pair) => {
        const me = players[socket.id];
        if (!me || !Array.isArray(pair) || !rateOk(me, 'loadout', 4)) return;
        if (pair.length === 0) { me.loadout = []; return; }
        if (pair.length !== 2) return;
        const [a, b] = pair;
        const valid = (v) => Number.isInteger(v) && v >= 0 && v < KNIFE; // strikt; das Messer ist keine Kaufwaffe
        if (valid(a) && valid(b) && a !== b) {
            for (const w of [a, b]) if (!me.loadout.includes(w)) { me.mags[w] = { ammo: WEAPONS[w].magSize, reloadUntil: 0 }; me.tokens[w] = 2; me.tokenAt[w] = Date.now(); }
            me.loadout = [a, b];
        }
    });

    // Nachladen gemeldet: erst nach Ablauf der Nachladezeit (minus kleiner Toleranz) darf wieder geschossen werden
    socket.on('reloadStarted', (d) => {
        const me = players[socket.id];
        const w = Number.isInteger(d?.w) ? d.w : -1;
        if (!me || me.dead || !WEAPONS[w] || WEAPONS[w].infinite || !me.loadout.includes(w)) return;
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
        if (isTeamMode() && shooter.team && shooter.team === target.team) return;   // kein Friendly Fire
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
        if (!humanIds().length) removeBots(); else updateBotHost();
        if (mapVote) { delete mapVote.votes[socket.id]; io.emit('mapVoteUpdate', votePayload()); }
        io.emit('playerDisconnected', socket.id);
        broadcastLeaderboard();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
