// player.js — eigener Spieler-Skin, komplett aus Code gebaut (kein FBX-Modell, keine externen Bibliotheken).
// "Neon-Soldat": Helm mit Visier, Rüstung, Rucksack, Gewehr in den Händen, Neon-Akzente.
// Jeder Spieler bekommt anhand seiner ID eine feste Akzentfarbe. Lauf-Animation (Beine/Arme/Wippen)
// läuft automatisch, sobald sich die Position ändert. Blickrichtung kommt vom Server (setPlayerFacing).
//
// Maße: Der Gruppen-Ursprung liegt 0.5 über dem Boden (main.js sendet pos.y - 1.5, Augenhöhe = 2.0 über
// dem Boden). Die Füße liegen deshalb bei y = -0.5, die Augen bei y = +1.5.

import { SKINS } from './skins.js';

const FOOT_Y = -0.5;
const PALETTE = [0x00f0ff, 0xff2bd6, 0xffaa00, 0x39ff14, 0x9d00ff, 0xff3355, 0xffee00, 0x3d7bff];

const EDGE = 0x4a4a5e;

// Geometrien/Materialien werden geteilt -> kaum Speicher pro Spieler
const geoCache = new Map();
function boxGeo(w, h, d) {
    const key = w + '_' + h + '_' + d;
    if (!geoCache.has(key)) {
        const g = new THREE.BoxGeometry(w, h, d);
        g.userData = { edges: new THREE.EdgesGeometry(g) };
        geoCache.set(key, g);
    }
    return geoCache.get(key);
}
const matCache = new Map();
function mat(color) {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshBasicMaterial({ color }));
    return matCache.get(color);
}
const edgeMat = new THREE.LineBasicMaterial({ color: EDGE });

// Ein Körperteil: Box, optional mit heller Kantenlinie (gibt der ungelitteten Fläche Kontur)
function part(parent, w, h, d, color, x, y, z, edge = true) {
    const geo = boxGeo(w, h, d);
    const m = new THREE.Mesh(geo, typeof color === 'object' ? color : mat(color)); // Zahl = geteiltes Material, Objekt = eigenes Material
    m.position.set(x, y, z);
    if (edge) {
        const lines = new THREE.LineSegments(geo.userData.edges, edgeMat);
        lines.raycast = () => {}; // Kantenlinien dürfen nicht an der Trefferprüfung teilnehmen (Line-Raycasts haben 1 m Toleranz!)
        m.add(lines);
    }
    parent.add(m);
    return m;
}

function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Baut den Körper (Rüstung, Kopf, Arme, Gewehr ...) passend zum Skin in "group" und gibt die animierten Teile zurück
function buildBody(group, id, skinId) {
    const skin = SKINS[skinId] || SKINS[0];
    const ARMOR = skin.armor, ARMOR_MID = skin.mid, DARK = skin.dark;

    // Akzentfarbe: Standard = pro Spieler (nach ID), sonst vom Skin. Regenbogen = eigenes Material, das jedes Frame umgefärbt wird.
    let rainbowMat = null;
    let accent;
    if (skin.rainbow) {
        rainbowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        accent = rainbowMat;
    } else {
        accent = skin.accent ?? PALETTE[hashId(String(id)) % PALETTE.length];
    }

    // "body" wird für die Blickrichtung gedreht; Nametag-Sprite hängt an "group" und bleibt unberührt
    const body = new THREE.Group();
    group.add(body);

    const hipY = FOOT_Y + 0.95; // 0.45

    // --- Beine (Pivot an der Hüfte, damit sie von dort aus schwingen) ---
    const legs = [];
    for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.16, hipY, 0);
        part(pivot, 0.23, 0.95, 0.25, ARMOR, 0, -0.475, 0);
        part(pivot, 0.236, 0.05, 0.256, accent, 0, -0.25, 0, false);  // Neon-Band am Knie
        part(pivot, 0.25, 0.16, 0.34, DARK, 0, -0.87, -0.04);         // Stiefel
        body.add(pivot);
        legs.push(pivot);
    }

    // --- Oberkörper ---
    part(body, 0.64, 0.08, 0.40, DARK, 0, hipY + 0.06, 0);            // Gürtel
    part(body, 0.62, 0.72, 0.36, ARMOR, 0, 0.88, 0);                  // Brust/Bauch
    part(body, 0.34, 0.05, 0.02, accent, 0, 1.03, -0.19, false);      // Brustleuchte (Querbalken)
    part(body, 0.05, 0.30, 0.02, accent, 0, 0.90, -0.19, false);      // Brustleuchte (Längsbalken)
    part(body, 0.44, 0.52, 0.16, ARMOR_MID, 0, 0.92, 0.26);           // Rucksack
    part(body, 0.30, 0.04, 0.17, accent, 0, 1.0, 0.26, false);        // Rucksack-Streifen
    part(body, 0.26, 0.14, 0.30, ARMOR_MID, -0.43, 1.2, 0);           // Schulterpolster links
    part(body, 0.26, 0.14, 0.30, ARMOR_MID, 0.43, 1.2, 0);            // Schulterpolster rechts
    part(body, 0.18, 0.08, 0.18, DARK, 0, 1.27, 0);                   // Hals

    // --- Kopf mit Visier (Augen bei y = 1.5 = Kamerahöhe) ---
    part(body, 0.42, 0.40, 0.42, ARMOR, 0, 1.5, 0);
    part(body, 0.36, 0.15, 0.05, 0x05050a, 0, 1.52, -0.22);           // Visier
    part(body, 0.30, 0.05, 0.055, accent, 0, 1.52, -0.22, false);     // Visier-Leuchtstreifen
    part(body, 0.10, 0.08, 0.34, ARMOR_MID, 0, 1.73, 0);              // Helmkamm
    part(body, 0.03, 0.22, 0.03, accent, 0.18, 1.78, 0.12, false);    // Antenne

    // --- Arme: nach vorn gehoben, halten das Gewehr (Euler-Reihenfolge YXZ: erst nach vorn, dann nach innen) ---
    const arms = [];
    for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.38, 1.12, -0.02);
        pivot.rotation.order = 'YXZ';
        pivot.rotation.x = 1.25 + (side < 0 ? 0.12 : 0);
        pivot.rotation.y = side * 0.42;
        part(pivot, 0.16, 0.34, 0.16, ARMOR, 0, -0.17, 0);            // Oberarm
        part(pivot, 0.15, 0.30, 0.15, ARMOR_MID, 0, -0.49, 0);        // Unterarm
        part(pivot, 0.15, 0.15, 0.15, DARK, 0, -0.69, 0);             // Hand
        body.add(pivot);
        arms.push(pivot);
    }

    // --- Gewehr vor der Brust ---
    const rifle = new THREE.Group();
    rifle.position.set(0, 0.96, -0.55);
    part(rifle, 0.12, 0.16, 0.62, 0x1a1a24, 0, 0, 0);                 // Gehäuse
    part(rifle, 0.05, 0.05, 0.40, 0x0c0c12, 0, 0.02, -0.5);           // Lauf
    part(rifle, 0.125, 0.025, 0.34, accent, 0, 0.09, -0.04, false);   // Neon-Schiene
    part(rifle, 0.08, 0.20, 0.09, DARK, 0, -0.16, 0.04);              // Magazin
    part(rifle, 0.09, 0.10, 0.16, DARK, 0, -0.01, 0.37);              // Schulterstütze
    body.add(rifle);

    return { body, legs, arms, rifle, rainbowMat };
}

export function createPlayerMesh(id, skinId = 0) {
    const group = new THREE.Group();
    group.userData.id = id; // Wichtig für Raycasting-Treffererkennung (main.js sucht userData.id nach oben)

    const parts = buildBody(group, id, skinId);
    group.userData.parts = parts;
    group.userData.skinId = skinId;
    group.userData.rainbowMat = parts.rainbowMat;
    group.userData.phase = Math.random() * Math.PI * 2;
    group.userData.blend = 0;       // 0 = steht, 1 = läuft (weich übergeblendet)
    group.userData.lastMove = 0;
    group.userData.yaw = 0;         // aktuell dargestellte Blickrichtung
    group.userData.targetYaw = 0;   // Zielrichtung (vom Server oder aus der Laufrichtung)
    group.userData.hasNetYaw = false;

    return group;
}

// Skin eines vorhandenen Spielers wechseln (Körper neu aufbauen; Nametag und Animationszustand bleiben erhalten)
export function applySkin(mesh, skinId) {
    if (!mesh || !mesh.userData.parts || mesh.userData.skinId === skinId) return;
    mesh.remove(mesh.userData.parts.body);
    const parts = buildBody(mesh, mesh.userData.id, skinId);
    mesh.userData.parts = parts;
    mesh.userData.skinId = skinId;
    mesh.userData.rainbowMat = parts.rainbowMat;
}

// Blickrichtung (Yaw in Radiant, 0 = nach -Z) setzen — kommt von main.js aus dem 'playerMoved'-Event
export function setPlayerFacing(mesh, yaw) {
    if (!mesh || !Number.isFinite(yaw)) return;
    mesh.userData.targetYaw = yaw;
    mesh.userData.hasNetYaw = true;
}

function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// Pro Frame aufrufen (mit delta in Sekunden): Lauf-Animation + Blickrichtung aller Spieler-Meshes
export function updatePlayerAnimations(playerMeshesList, delta) {
    const now = performance.now();
    const smooth = Math.min(1, delta * 10);

    for (const mesh of playerMeshesList) {
        const u = mesh.userData;
        if (!u.parts) continue;

        // Bewegung erkennen: Positionen kommen nur mit Netzwerk-Takt, deshalb gilt "läuft" noch kurz nach der letzten Änderung
        const p = mesh.position;
        if (u.lx === undefined) { u.lx = p.x; u.lz = p.z; }
        const dx = p.x - u.lx, dz = p.z - u.lz;
        if (dx * dx + dz * dz > 1e-5) {
            u.lastMove = now;
            // Ohne Blickrichtung vom Server: in Laufrichtung schauen
            if (!u.hasNetYaw && dx * dx + dz * dz > 1e-3) u.targetYaw = Math.atan2(-dx, -dz);
            u.lx = p.x; u.lz = p.z;
        }
        const moving = now - u.lastMove < 250;
        u.blend += ((moving ? 1 : 0) - u.blend) * smooth;
        u.phase += delta * 10 * u.blend;

        // Blickrichtung weich nachführen (kürzester Weg)
        u.yaw -= angleDiff(u.yaw, u.targetYaw) * smooth;
        if (u.rainbowMat) u.rainbowMat.color.setHSL((now / 2500) % 1, 1, 0.55); // Regenbogen-Skin
        const { body, legs, arms, rifle } = u.parts;
        body.rotation.y = u.yaw;

        // Beine gegengleich schwingen, Körper wippt leicht
        const s = Math.sin(u.phase);
        legs[0].rotation.x = s * 0.75 * u.blend;
        legs[1].rotation.x = -s * 0.75 * u.blend;
        body.position.y = Math.abs(Math.cos(u.phase)) * 0.05 * u.blend;

        // Arme + Gewehr bleiben vorn, wippen nur leicht mit
        const sway = Math.sin(u.phase * 2) * 0.04 * u.blend;
        arms[0].rotation.x = 1.25 + sway + 0.12;
        arms[1].rotation.x = 1.25 + sway;
        rifle.position.y = 0.96 + sway * 0.4;
    }
}
