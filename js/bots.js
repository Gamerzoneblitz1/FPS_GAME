// bots.js — KI der Bots. Läuft NUR im Browser des "Bot-Hosts" (siehe server.js): nur dort sind die Wände der Karte bekannt.
// Der Host bewegt die Bots, lässt sie schießen und meldet alles dem Server ('botMoves' / 'botShoot'); der Server rechnet
// Schaden und Tod. Alle anderen Spieler sehen die Bots wie normale Spieler.
//
// Was die Bots können:
//  - Navigation: Beim Kartenstart wird (in kleinen Häppchen, ohne das Spiel zu bremsen) ein Wegenetz über die ganze Karte
//    gelegt. Bots finden damit per A* Wege um Wände und durch Gebäude, statt stur gegen Wände zu laufen.
//  - Verteilung: Bots spawnen und patrouillieren überall auf der Karte, bevorzugt weit weg von anderen Bots und Spielern.
//  - Kampf: Sichtlinie, Reaktionszeit, Vorhalten, Ausweichschritte, Rückzug bei wenig Leben, Jagd auf die zuletzt gesehene
//    Position, Reaktion auf Schüsse in der Nähe. Jeder Bot hat ein eigenes Können (skill) und eine Waffe.
//
// api (von main.js):
//   collidersNear(x, z)  groundY(x, y, z)  floorsAt(x, z) -> [y, ...] (begehbare Flächen von oben nach unten)
//   bounds() -> {minX,maxX,minZ,maxZ} | null      mapKey() -> Objekt, das sich bei jeder neuen Karte ändert (null = lädt noch)
//   spawns() -> [{x,y,z}] (y = Augenhöhe)         eye -> Augenhöhe über dem Boden
//   targets() -> [{id,x,y,z}] lebende Ziele (ohne Bots)       botIds()      botPos(id)      emit(event, data)

const RADIUS = 0.45;
const TICK = 1 / 15;           // KI-/Bewegungstakt (15 Hz)
const SPEED = 4.6;
const SIGHT = 70;
const CELL = 6;                // Rasterabstand des Wegenetzes (Meter)
const NAV_BUDGET_MS = 5;       // so viel Rechenzeit pro Frame darf der Netzaufbau verbrauchen
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
    let acc = 0;
    let pathBudget = 0;
    const tprev = new Map();   // Ziel-ID -> letzte Position (für Vorhalten)

    // ---------- Kollision ----------
    function blockedAt(x, y, z) {
        const near = api.collidersNear(x, z);
        const lo = y + 0.35, hi = y + 1.7;
        for (let i = 0; i < near.length; i++) {
            const c = near[i];
            if (x + RADIUS > c.min.x && x - RADIUS < c.max.x && z + RADIUS > c.min.z && z - RADIUS < c.max.z && lo < c.max.y && hi > c.min.y) return true;
        }
        return false;
    }
    // Läuft man geradeaus von a nach b, ohne in eine Box zu geraten? (y wird linear angenähert)
    function segClear(ax, ay, az, bx, by, bz) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 0.8));
        for (let i = 1; i <= n; i++) {
            const k = i / n;
            if (blockedAt(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k)) return false;
        }
        return true;
    }
    // Sichtlinie (Augen -> Brust): Punkte entlang der Linie dürfen in keiner Box liegen
    function hasLos(b, t) {
        const sx = b.x, sy = b.y + 1.5, sz = b.z, ex = t.x, ey = t.y + 1.1, ez = t.z;
        const dx = ex - sx, dy = ey - sy, dz = ez - sz;
        const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.6));
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

    // ---------- Wegenetz ----------
    const nav = { key: null, nodes: [], grid: new Map(), phase: 'idle', ix: 0, iz: 0, b: null, ready: false, raw: [], ni: 0 };
    const cellKey = (ix, iz) => ix * 100003 + iz;

    function navReset(key) {
        nav.key = key; nav.nodes = []; nav.grid = new Map(); nav.raw = []; nav.ready = false; nav.phase = 'idle'; nav.b = null;
    }
    function navStep() {
        const key = api.mapKey();
        if (key !== nav.key) { navReset(key); if (!key) return; }
        if (!key || nav.ready) return;
        const t0 = performance.now();
        if (nav.phase === 'idle') {
            const b = api.bounds();
            if (!b) return;
            nav.b = b; nav.ix = Math.floor(b.minX / CELL); nav.iz = Math.floor(b.minZ / CELL);
            nav.ixMax = Math.ceil(b.maxX / CELL); nav.izMax = Math.ceil(b.maxZ / CELL);
            nav.phase = 'sample';
        }
        if (nav.phase === 'sample') {
            while (performance.now() - t0 < NAV_BUDGET_MS) {
                if (nav.ix > nav.ixMax) { nav.phase = 'link'; nav.ni = 0; break; }
                const cx = (nav.ix + 0.5) * CELL + rnd(-1, 1), cz = (nav.iz + 0.5) * CELL + rnd(-1, 1);
                for (const y of api.floorsAt(cx, cz)) {
                    if (blockedAt(cx, y, cz)) continue;
                    const node = { x: cx, y, z: cz, n: [], comp: -1, cx: nav.ix, cz: nav.iz };
                    nav.raw.push(node);
                    const k = cellKey(nav.ix, nav.iz);
                    (nav.grid.get(k) || nav.grid.set(k, []).get(k)).push(node);
                }
                if (++nav.iz > nav.izMax) { nav.iz = Math.floor(nav.b.minZ / CELL); nav.ix++; }
            }
        }
        if (nav.phase === 'link') {
            while (performance.now() - t0 < NAV_BUDGET_MS) {
                if (nav.ni >= nav.raw.length) { navFinish(); break; }
                const a = nav.raw[nav.ni++];
                for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                    if (!dx && !dz) continue;
                    const list = nav.grid.get(cellKey(a.cx + dx, a.cz + dz));
                    if (!list) continue;
                    for (const c of list) {
                        if (c === a || Math.abs(c.y - a.y) > 1.1 || a.n.includes(c)) continue;
                        if (segClear(a.x, a.y, a.z, c.x, c.y, c.z)) { a.n.push(c); c.n.push(a); }
                    }
                }
            }
        }
    }
    // Nur die größte zusammenhängende Fläche behalten (Dächer/Inseln, die man nicht erreicht, fliegen raus)
    function navFinish() {
        let best = [], comp = 0;
        for (const s of nav.raw) {
            if (s.comp >= 0) continue;
            const stack = [s], list = [];
            s.comp = comp;
            while (stack.length) { const a = stack.pop(); list.push(a); for (const c of a.n) if (c.comp < 0) { c.comp = comp; stack.push(c); } }
            if (list.length > best.length) best = list;
            comp++;
        }
        nav.nodes = best;
        nav.grid = new Map();
        for (const n of best) { n.cx = Math.floor(n.x / CELL); n.cz = Math.floor(n.z / CELL); const k = cellKey(n.cx, n.cz); (nav.grid.get(k) || nav.grid.set(k, []).get(k)).push(n); n.g = 0; n.f = 0; n.from = null; n.mark = 0; }
        nav.raw = [];
        nav.ready = nav.nodes.length >= 8;
        nav.phase = 'done';
        console.log('Bot-Wegenetz:', nav.nodes.length, 'Punkte');
    }
    function nearestNode(x, y, z) {
        let best = null, bd = Infinity;
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
        for (let r = 0; r <= 3 && !best; r++) {
            for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const list = nav.grid.get(cellKey(cx + dx, cz + dz));
                if (!list) continue;
                for (const n of list) {
                    const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 2;
                    if (d < bd) { bd = d; best = n; }
                }
            }
        }
        return best;
    }
    let markId = 0;
    function findPath(from, to) {
        if (!from || !to) return null;
        if (from === to) return [to];
        markId++;
        const open = [from];
        from.g = 0; from.from = null; from.mark = markId; from.f = Math.hypot(to.x - from.x, to.z - from.z);
        const closed = new Set();
        let guard = 0;
        while (open.length && guard++ < 8000) {
            let bi = 0;
            for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
            const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
            if (cur === to) { const path = []; for (let n = cur; n; n = n.from) path.push(n); return path.reverse(); }
            closed.add(cur);
            for (const nb of cur.n) {
                if (closed.has(nb)) continue;
                const g = cur.g + Math.hypot(nb.x - cur.x, nb.z - cur.z) + Math.abs(nb.y - cur.y) * 0.5;
                if (nb.mark !== markId) { nb.mark = markId; nb.g = g; nb.from = cur; nb.f = g + Math.hypot(to.x - nb.x, to.z - nb.z); open.push(nb); }
                else if (g < nb.g) { nb.g = g; nb.from = cur; nb.f = g + Math.hypot(to.x - nb.x, to.z - nb.z); if (!open.includes(nb)) open.push(nb); }
            }
        }
        return null;
    }
    function randomNode() { return nav.nodes[Math.floor(Math.random() * nav.nodes.length)]; }

    // Punkt, der weit weg von allen anderen (Bots, Spieler) liegt: Bestes aus mehreren Zufallskandidaten
    function spreadNode(selfId, list, tries = 10, minHuman = 0) {
        let best = null, bs = -1;
        for (let i = 0; i < tries; i++) {
            const n = randomNode();
            if (!n) return null;
            let d = Infinity, dh = Infinity;
            for (const t of list) { if (t.id === selfId) continue; const dd = Math.hypot(t.x - n.x, t.z - n.z); d = Math.min(d, dd); if (!t.bot) dh = Math.min(dh, dd); }
            for (const o of bots.values()) {
                if (o.id === selfId) continue;
                if (o.alive) d = Math.min(d, Math.hypot(o.x - n.x, o.z - n.z));
                if (o.dest) d = Math.min(d, Math.hypot(o.dest.x - n.x, o.dest.z - n.z) * 1.2);   // auch Ziele anderer Bots meiden
            }
            if (dh < minHuman) d *= 0.2;
            if (d > bs) { bs = d; best = n; }
        }
        return best;
    }

    // ---------- Bots ----------
    function make(id) {
        const gun = BOT_GUNS[Math.floor(Math.random() * BOT_GUNS.length)];
        const known = api.botPos(id);
        const b = { id, gun, skill: rnd(0.75, 1.25), x: 0, y: 0, z: 0, ry: rnd(-3, 3), alive: false, respawnAt: 0, hp: 100, target: null, seenAt: 0, nextShot: 0,
            path: null, pi: 0, dest: null, repathAt: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, stuckT: 0, lx: 0, lz: 0, losAt: 0, losOk: false, aim: 0,
            mode: 'patrol', modeUntil: 0, hunt: null, hold: 0 };
        if (known && known.alive && known.moved) { b.x = known.x; b.y = known.y; b.z = known.z; b.alive = true; b.lx = b.x; b.lz = b.z; }
        else b.respawnAt = performance.now() + rnd(300, 2500);
        return b;
    }

    function respawn(b, list) {
        let p = null;
        if (nav.ready) {
            const n = spreadNode(b.id, list, 14, 35);
            if (n) p = { x: n.x, y: n.y, z: n.z };
        }
        if (!p) {
            if (!api.mapKey()) { b.respawnAt = performance.now() + 500; return; }
            if (nav.phase !== 'done') { b.respawnAt = performance.now() + 400; return; }        // Netz noch nicht fertig: kurz warten
            const sp = api.spawns();                                                              // Notlösung ohne Netz: Spawnpunkte
            if (!sp.length) { b.respawnAt = performance.now() + 1000; return; }
            const s = sp[Math.floor(Math.random() * sp.length)];
            p = { x: s.x, y: s.y - api.eye, z: s.z };
        }
        b.x = p.x; b.y = p.y; b.z = p.z; b.lx = b.x; b.lz = b.z;
        b.alive = true; b.hp = 100; b.target = null; b.path = null; b.dest = null; b.mode = 'patrol'; b.hunt = null; b.stuckT = 0;
        b.ry = rnd(-Math.PI, Math.PI);
    }

    function moveBot(b, dirX, dirZ, speed, dt) {
        const len = Math.hypot(dirX, dirZ);
        if (len < 1e-4) return true;
        dirX /= len; dirZ /= len;
        const sub = 2, step = speed * dt / sub;
        for (let i = 0; i < sub; i++) {
            const nx = b.x + dirX * step, nz = b.z + dirZ * step;
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

    // Weg zu einem Punkt setzen (A*), höchstens ein paar Mal pro Tick
    function goTo(b, x, y, z, now) {
        if (!nav.ready || pathBudget <= 0) return false;
        pathBudget--;
        const a = nearestNode(b.x, b.y, b.z), t = nearestNode(x, y, z);
        const path = findPath(a, t);
        b.repathAt = now + rnd(1200, 2200);
        if (!path) { b.path = null; return false; }
        b.path = path; b.pi = 0; b.dest = { x: t.x, z: t.z };
        return true;
    }
    // Entlang des Weges laufen: gibt die Richtung zurück oder null, wenn der Weg zu Ende ist
    function followPath(b) {
        if (!b.path) return null;
        while (b.pi < b.path.length) {
            const n = b.path[b.pi];
            if (Math.hypot(n.x - b.x, n.z - b.z) < 1.6 && Math.abs(n.y - b.y) < 2) { b.pi++; continue; }
            // Abkürzung: übernächster Punkt direkt erreichbar?
            const nn = b.path[b.pi + 1];
            if (nn && Math.hypot(nn.x - b.x, nn.z - b.z) < 14 && Math.abs(nn.y - b.y) < 1 && segClear(b.x, b.y, b.z, nn.x, nn.y, nn.z)) { b.pi++; continue; }
            return { x: n.x - b.x, z: n.z - b.z };
        }
        b.path = null;
        return null;
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
        if (!best) { b.losOk = false; return null; }
        if (!b.target || b.target.id !== best.t.id || now - b.losAt > 250) {
            const prevId = b.target && b.target.id;
            b.losOk = hasLos(b, best.t);
            b.losAt = now;
            if (b.losOk && prevId !== best.t.id && !(b.mode === 'fight')) b.seenAt = now;
        }
        return b.losOk ? best : null;
    }

    function think(b, now, dt, list) {
        const found = pickTarget(b, now, list);
        let dirX = 0, dirZ = 0, speed = SPEED, turn = 7 * b.skill;
        if (found) {
            const { t, d } = found;
            if (b.mode !== 'fight') { b.seenAt = now; b.mode = 'fight'; b.path = null; }
            b.target = t; b.hunt = { x: t.x, y: t.y, z: t.z, until: now + 9000 };
            // Zielposition mit Vorhalten (Bewegung des Ziels seit dem letzten Tick)
            const pv = tprev.get(t.id);
            const vx = pv ? (t.x - pv.x) / Math.max(dt, 0.01) : 0, vz = pv ? (t.z - pv.z) / Math.max(dt, 0.01) : 0;
            const lead = Math.min(0.35, d / 90) * 0.7 * Math.min(1, b.skill);
            const aimX = t.x + vx * lead, aimZ = t.z + vz * lead;
            const want = Math.atan2(-(aimX - b.x), -(aimZ - b.z));     // Yaw: 0 = Blick nach -Z (wie der Client)
            b.ry += Math.max(-turn * dt, Math.min(turn * dt, angDiff(b.ry, want)));
            b.aim = Math.abs(angDiff(b.ry, want));
            const toX = (t.x - b.x) / (d || 1), toZ = (t.z - b.z) / (d || 1);
            b.strafeT -= dt;
            if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeT = rnd(0.7, 2); }
            if (b.hp < 35 && d < b.gun.range) {                                           // wenig Leben: Rückzug (seitlich-weg)
                dirX = -toX * 0.8 - toZ * b.strafe * 0.5; dirZ = -toZ * 0.8 + toX * b.strafe * 0.5; speed *= 1.1;
            } else if (d > b.gun.range * 0.75) { dirX = toX; dirZ = toZ; }                // näher ran
            else if (d < 6) { dirX = -toX; dirZ = -toZ; speed *= 0.8; }                    // zu nah: zurück
            else { dirX = -toZ * b.strafe; dirZ = toX * b.strafe; speed *= 0.6; }           // Ausweichschritte
            // Schießen: nach Reaktionszeit, wenn gezielt und in Reichweite
            const react = 450 / b.skill;
            if (d <= b.gun.range && b.aim < 0.16 && now - b.seenAt > react && now >= b.nextShot) {
                b.nextShot = now + b.gun.cd * 1000 * rnd(1.0, 1.7) / Math.min(1.2, b.skill) + (b.gun.cd < 0.2 ? rnd(0, 250) : 0);
                fire(b, t, d);
            }
        } else {
            // Kein Ziel in Sicht
            if (b.mode === 'fight') { b.mode = b.hunt && b.hunt.until > now ? 'hunt' : 'patrol'; b.path = null; b.repathAt = 0; }
            b.target = null;
            if (b.mode === 'hunt') {
                if (!b.hunt || b.hunt.until < now || (Math.hypot(b.hunt.x - b.x, b.hunt.z - b.z) < 3 && !b.path)) { b.mode = 'patrol'; b.path = null; }
                else if ((!b.path || now > b.repathAt)) goTo(b, b.hunt.x, b.hunt.y, b.hunt.z, now);
            }
            if (b.mode === 'patrol') {
                if (!b.path || now > b.repathAt + 8000) {
                    const n = spreadNode(b.id, list, 8, 0);
                    if (n) goTo(b, n.x, n.y, n.z, now);
                    else if (!nav.ready) {                                            // Notlösung ohne Netz: ziellos laufen
                        if (!b.wp || Math.hypot(b.wp.x - b.x, b.wp.z - b.z) < 2.5) b.wp = { x: b.x + rnd(-30, 30), z: b.z + rnd(-30, 30) };
                        const dxw = b.wp.x - b.x, dzw = b.wp.z - b.z;
                        b.ry += Math.max(-3 * dt, Math.min(3 * dt, angDiff(b.ry, Math.atan2(-dxw, -dzw))));
                    }
                }
            }
            const dir = followPath(b);
            if (dir) {
                dirX = dir.x; dirZ = dir.z;
                const want = Math.atan2(-dir.x, -dir.z);
                b.ry += Math.max(-turn * 0.9 * dt, Math.min(turn * 0.9 * dt, angDiff(b.ry, want)));
                if (Math.abs(angDiff(b.ry, want)) > 1.4) { dirX *= 0.2; dirZ *= 0.2; }          // erst drehen, dann laufen
            } else if (!nav.ready) { dirX = -Math.sin(b.ry); dirZ = -Math.cos(b.ry); }
            else if (b.mode === 'patrol') b.path = null;
        }
        if (found) tprev.set(found.t.id, { x: found.t.x, z: found.t.z });
        if (dirX || dirZ) moveBot(b, dirX, dirZ, speed, dt);
        settleGround(b, dt);
        // Festgefahren? -> neuen Weg
        b.stuckT += dt;
        if (b.stuckT > 1.3) {
            const moved = Math.hypot(b.x - b.lx, b.z - b.lz);
            if ((dirX || dirZ) && moved < 0.5) { b.path = null; b.repathAt = 0; b.strafe = -b.strafe; if (!nav.ready) b.ry += rnd(1, 2.2) * (Math.random() < 0.5 ? 1 : -1); }
            b.lx = b.x; b.lz = b.z; b.stuckT = 0;
        }
    }

    function fire(b, t, d) {
        const sx = b.x - Math.sin(b.ry) * 0.6, sy = b.y + 1.45, sz = b.z - Math.cos(b.ry) * 0.6;
        const base = b.gun.acc * Math.min(1.15, b.skill) * Math.max(0.15, 1 - d / (b.gun.range * 1.4));
        const pv = tprev.get(t.id), moving = pv ? Math.hypot(t.x - pv.x, t.z - pv.z) > 0.15 : false;
        const p = base * (moving ? 0.8 : 1.1);
        let n = 0;
        if (b.gun.pellets > 1) { for (let i = 0; i < b.gun.pellets; i++) if (Math.random() < p * (d < 12 ? 0.9 : 0.35)) n++; }
        else if (Math.random() < p) n = 1;
        const ex = t.x + (n ? rnd(-0.25, 0.25) : rnd(-2.2, 2.2)), ey = t.y + (n ? rnd(0.6, 1.5) : rnd(0.2, 2)), ez = t.z + (n ? rnd(-0.25, 0.25) : rnd(-2.2, 2.2));
        api.emit('botShoot', { id: b.id, w: b.gun.w, start: { x: sx, y: sy, z: sz }, end: { x: ex, y: ey, z: ez }, targetId: n ? t.id : null, n });
    }

    return {
        sync() {
            const ids = api.botIds();
            for (const id of ids) if (!bots.has(id)) bots.set(id, make(id));
            for (const id of [...bots.keys()]) if (!ids.includes(id)) bots.delete(id);
        },
        onKilled(id, respawnPos) {
            const b = bots.get(id);
            if (!b) return;
            b.alive = false; b.path = null;
            b.respawnAt = performance.now() + 3300;
        },
        onHealth(id, hp) { const b = bots.get(id); if (b) b.hp = hp; },
        // Schuss gehört (Position der Mündung): freie Bots in der Nähe schauen nach
        hear(shooterId, x, z) {
            const now = performance.now();
            for (const b of bots.values()) {
                if (!b.alive || b.id === shooterId || b.mode === 'fight') continue;
                if (Math.hypot(b.x - x, b.z - z) < 55 && Math.random() < 0.6) { b.mode = 'hunt'; b.hunt = { x, y: b.y, z, until: now + 8000 }; b.path = null; b.repathAt = 0; }
            }
        },
        resetAll() {
            for (const b of bots.values()) { b.alive = false; b.path = null; b.respawnAt = performance.now() + rnd(500, 3000); }
            navReset(null);
        },
        update(dt) {
            navStep();
            if (!bots.size) return;
            const now = performance.now();
            acc += dt;
            if (acc < TICK) return;
            const step = Math.min(acc, 0.1); acc = 0;
            pathBudget = 3;
            const list = api.targets().concat([...bots.values()].filter(o => o.alive).map(o => ({ id: o.id, x: o.x, y: o.y, z: o.z, bot: true })));
            for (const b of bots.values()) {
                if (!b.alive) {
                    if (now >= b.respawnAt) respawn(b, list);
                    continue;
                }
                think(b, now, step, list);
            }
            const live = [];
            for (const b of bots.values()) if (b.alive) live.push({ id: b.id, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), ry: +b.ry.toFixed(2) });
            if (live.length) api.emit('botMoves', live);
        },
        positions() { return [...bots.values()].filter(b => b.alive).map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z })); },
        navReady() { return nav.ready; }
    };
}
