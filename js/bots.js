// bots.js — KI der Bots. Läuft NUR im Browser des "Bot-Hosts" (siehe server.js): nur dort sind die Wände der Karte bekannt.
// Der Host bewegt die Bots, lässt sie schießen und meldet alles dem Server ('botMoves' / 'botShoot'); der Server rechnet
// Schaden und Tod. Alle anderen Spieler sehen die Bots wie normale Spieler.
//
// api (von main.js):
//   collidersNear(x, z)      -> Boxen {min:{x,y,z}, max:{x,y,z}} in der Nähe
//   groundY(x, y, z)         -> Bodenhöhe unter dem Punkt (y = Startpunkt des Strahls)
//   spawns()                 -> [{x, y, z}] Spawnpunkte (y = Augenhöhe) oder []
//   eye                      -> Abstand Kamera <-> Boden (Stehen)
//   targets()                -> [{ id, x, y, z, bot }] lebende Ziele (y = Füße), ohne den Bot selbst
//   emit(event, data)        -> an den Server
//   botIds()                 -> IDs der Bots (aus 'currentPlayers')
//   botPos(id)               -> {x,y,z,alive} letzte bekannte Position aus der Welt (für den Host-Wechsel)

const RADIUS = 0.45;
const TICK = 1 / 15;           // KI-/Bewegungstakt (15 Hz)
const SPEED = 4.6;
const TURN = 7;                // rad/s
const SIGHT = 60;
const BOT_GUNS = [
    { w: 0, cd: 0.14, range: 55, pellets: 1, acc: 0.62 },   // Rifle
    { w: 1, cd: 0.28, range: 35, pellets: 1, acc: 0.6 },    // Pistol
    { w: 3, cd: 0.09, range: 35, pellets: 1, acc: 0.5 },    // SMG
    { w: 4, cd: 0.9,  range: 18, pellets: 8, acc: 0.55 },   // Shotgun
    { w: 5, cd: 0.6,  range: 40, pellets: 1, acc: 0.6 }     // Revolver
];

const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export function createBotHost(api) {
    const bots = new Map();
    let acc = 0, sendAcc = 0;

    function spawnPoint() {
        const sp = api.spawns();
        if (!sp.length) return null;
        const p = sp[Math.floor(Math.random() * sp.length)];
        return { x: p.x, y: p.y - api.eye, z: p.z };
    }

    function make(id) {
        const gun = BOT_GUNS[Math.floor(Math.random() * BOT_GUNS.length)];
        const known = api.botPos(id);
        const b = { id, gun, x: 0, y: 0, z: 0, ry: rnd(-3, 3), alive: false, respawnAt: 0, target: null, seenAt: 0, nextShot: 0,
            wp: null, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, stuckT: 0, lx: 0, lz: 0, losAt: 0, losOk: false, aim: 0 };
        if (known && known.alive) { b.x = known.x; b.y = known.y; b.z = known.z; b.alive = true; b.lx = b.x; b.lz = b.z; }
        else b.respawnAt = performance.now() + rnd(300, 1500);
        return b;
    }

    function respawn(b, pos) {
        let p = pos || spawnPoint();
        if (!p) { const k = api.botPos(b.id); if (k && Number.isFinite(k.x)) p = { x: k.x, y: k.y, z: k.z }; }
        if (!p) { b.respawnAt = performance.now() + 1000; return; }
        b.x = p.x; b.y = p.y; b.z = p.z; b.lx = b.x; b.lz = b.z;
        b.alive = true; b.target = null; b.wp = null; b.stuckT = 0;
    }

    function blockedAt(x, y, z) {
        const near = api.collidersNear(x, z);
        const lo = y + 0.35, hi = y + 1.7;
        for (let i = 0; i < near.length; i++) {
            const c = near[i];
            if (x + RADIUS > c.min.x && x - RADIUS < c.max.x && z + RADIUS > c.min.z && z - RADIUS < c.max.z && lo < c.max.y && hi > c.min.y) return true;
        }
        return false;
    }

    // Sichtlinie von Augen (Bot) zur Brust (Ziel): Punkte entlang der Linie dürfen nicht in einer Box liegen
    function hasLos(b, t) {
        const sx = b.x, sy = b.y + 1.5, sz = b.z, ex = t.x, ey = t.y + 1.1, ez = t.z;
        const dx = ex - sx, dy = ey - sy, dz = ez - sz;
        const len = Math.hypot(dx, dy, dz);
        const steps = Math.max(2, Math.ceil(len / 0.6));
        for (let i = 1; i < steps; i++) {
            const k = i / steps, x = sx + dx * k, y = sy + dy * k, z = sz + dz * k;
            const near = api.collidersNear(x, z);
            for (let j = 0; j < near.length; j++) {
                const c = near[j];
                if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && y > c.min.y && y < c.max.y) return false;
            }
        }
        return true;
    }

    function moveBot(b, dirX, dirZ, speed, dt) {
        const len = Math.hypot(dirX, dirZ);
        if (len < 1e-4) return;
        dirX /= len; dirZ /= len;
        const sub = 2, step = speed * dt / sub;
        for (let i = 0; i < sub; i++) {
            let nx = b.x + dirX * step, nz = b.z + dirZ * step;
            if (!blockedAt(nx, b.y, nz)) { b.x = nx; b.z = nz; continue; }
            if (!blockedAt(nx, b.y, b.z)) { b.x = nx; continue; }          // an der Wand entlanggleiten
            if (!blockedAt(b.x, b.y, nz)) { b.z = nz; continue; }
            return false;
        }
        return true;
    }

    function settleGround(b, dt) {
        const g = api.groundY(b.x, b.y, b.z);
        if (g > b.y - 0.01) b.y = g;                       // Treppe/Rampe hoch: sofort
        else b.y = Math.max(g, b.y - 16 * dt);             // Gefälle/Fall: begrenzt
    }

    function pickTarget(b, now, list) {
        let best = null, bestScore = Infinity;
        for (const t of list) {
            if (t.id === b.id) continue;
            const d = Math.hypot(t.x - b.x, t.z - b.z);
            if (d > SIGHT) continue;
            const score = d * (t.bot ? 1.6 : 1);           // echte Spieler bevorzugen
            if (score < bestScore) { bestScore = score; best = { t, d }; }
        }
        if (!best) return null;
        if (!b.target || b.target.id !== best.t.id || now - b.losAt > 250) {
            b.losOk = hasLos(b, best.t);
            b.losAt = now;
            if (b.losOk && (!b.target || b.target.id !== best.t.id)) b.seenAt = now;
        }
        return b.losOk ? best : null;
    }

    function think(b, now, dt, list) {
        const found = pickTarget(b, now, list);
        let dirX = 0, dirZ = 0, speed = SPEED;
        if (found) {
            const { t, d } = found;
            b.target = t;
            const want = Math.atan2(-(t.x - b.x), -(t.z - b.z));     // Yaw: 0 = Blick nach -Z (wie der Client)
            const diff = angDiff(b.ry, want);
            b.ry += Math.max(-TURN * dt, Math.min(TURN * dt, diff));
            b.aim = Math.abs(angDiff(b.ry, want));
            const toX = (t.x - b.x) / (d || 1), toZ = (t.z - b.z) / (d || 1);
            b.strafeT -= dt;
            if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeT = rnd(0.8, 2.2); }
            if (d > b.gun.range * 0.7) { dirX = toX; dirZ = toZ; }                       // näher ran
            else if (d < 6) { dirX = -toX; dirZ = -toZ; speed *= 0.8; }                  // zu nah: zurück
            else { dirX = -toZ * b.strafe; dirZ = toX * b.strafe; speed *= 0.6; }         // seitlich ausweichen
            // Schießen: nach Reaktionszeit, wenn zielend und in Reichweite
            if (d <= b.gun.range && b.aim < 0.18 && now - b.seenAt > 450 && now >= b.nextShot) {
                b.nextShot = now + b.gun.cd * 1000 * rnd(1.0, 1.7) + (b.gun.pellets === 1 && b.gun.cd < 0.2 ? rnd(0, 250) : 0);
                fire(b, t, d);
            }
        } else {
            b.target = null;
            if (!b.wp || Math.hypot(b.wp.x - b.x, b.wp.z - b.z) < 2.5) {
                const p = spawnPoint();
                b.wp = p ? { x: p.x, z: p.z } : { x: b.x + rnd(-30, 30), z: b.z + rnd(-30, 30) };
            }
            const want = Math.atan2(-(b.wp.x - b.x), -(b.wp.z - b.z));
            const diff = angDiff(b.ry, want);
            b.ry += Math.max(-TURN * 0.6 * dt, Math.min(TURN * 0.6 * dt, diff));
            if (Math.abs(diff) < 1.2) { dirX = -Math.sin(b.ry); dirZ = -Math.cos(b.ry); }
        }
        const moved = (dirX || dirZ) ? moveBot(b, dirX, dirZ, speed, dt) : true;
        settleGround(b, dt);
        // Festgefahren? (Ziel nicht erreicht, kaum bewegt) -> neuen Weg wählen
        b.stuckT += dt;
        if (b.stuckT > 1.2) {
            const moved2 = Math.hypot(b.x - b.lx, b.z - b.lz);
            if ((dirX || dirZ) && moved2 < 0.5) { b.wp = null; b.strafe = -b.strafe; b.ry += rnd(1, 2.2) * (Math.random() < 0.5 ? 1 : -1); }
            b.lx = b.x; b.lz = b.z; b.stuckT = 0;
        }
        return moved;
    }

    function fire(b, t, d) {
        const sx = b.x - Math.sin(b.ry) * 0.6, sy = b.y + 1.45, sz = b.z - Math.cos(b.ry) * 0.6;
        const base = b.gun.acc * Math.max(0.15, 1 - d / (b.gun.range * 1.4));
        let n = 0;
        if (b.gun.pellets > 1) { for (let i = 0; i < b.gun.pellets; i++) if (Math.random() < base * (d < 12 ? 0.9 : 0.35)) n++; }
        else if (Math.random() < base) n = 1;
        const ex = t.x + (n ? rnd(-0.25, 0.25) : rnd(-2.2, 2.2)), ey = t.y + (n ? rnd(0.6, 1.5) : rnd(0.2, 2)), ez = t.z + (n ? rnd(-0.25, 0.25) : rnd(-2.2, 2.2));
        api.emit('botShoot', { id: b.id, w: b.gun.w, start: { x: sx, y: sy, z: sz }, end: { x: ex, y: ey, z: ez }, targetId: n ? t.id : null, n });
    }

    return {
        // Alle Bots (neu) übernehmen; ids = Bot-IDs
        sync() {
            const ids = api.botIds();
            for (const id of ids) if (!bots.has(id)) bots.set(id, make(id));
            for (const id of [...bots.keys()]) if (!ids.includes(id)) bots.delete(id);
        },
        // Ein Bot wurde getötet (Server: 'playerKilled'): nach kurzer Wartezeit neu starten
        onKilled(id, respawnPos) {
            const b = bots.get(id);
            if (!b) return;
            b.alive = false;
            b.respawnAt = performance.now() + 3300;
            b.pendingSpawn = respawnPos && Number.isFinite(respawnPos.x) ? { x: respawnPos.x, y: respawnPos.y - api.eye, z: respawnPos.z } : null;
        },
        // Kartenwechsel: alle Bots neu verteilen
        resetAll() {
            for (const b of bots.values()) { b.alive = false; b.pendingSpawn = null; b.respawnAt = performance.now() + rnd(500, 2500); }
        },
        update(dt) {
            if (!bots.size) return;
            const now = performance.now();
            acc += dt; sendAcc += dt;
            if (acc < TICK) return;
            const step = Math.min(acc, 0.1); acc = 0;
            const list = api.targets().concat([...bots.values()].filter(o => o.alive).map(o => ({ id: o.id, x: o.x, y: o.y, z: o.z, bot: true })));
            for (const b of bots.values()) {
                if (!b.alive) {
                    if (now >= b.respawnAt) { respawn(b, api.spawns().length ? null : b.pendingSpawn); b.pendingSpawn = null; }
                    continue;
                }
                think(b, now, step, list);
            }
            // Positionen aller Bots (auch die Live-Ziele für andere Bots) an den Server
            const live = [];
            for (const b of bots.values()) if (b.alive) live.push({ id: b.id, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), ry: +b.ry.toFixed(2) });
            if (live.length) api.emit('botMoves', live);
        },
        positions() { return [...bots.values()].filter(b => b.alive).map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z })); },
        isAlive(id) { const b = bots.get(id); return !!(b && b.alive); }
    };
}
