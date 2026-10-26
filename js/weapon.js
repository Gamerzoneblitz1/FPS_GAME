import { weaponSkinMaterial, shadeForColor, scrollSkinTextures } from './skintex.js';

// weapon.js — Waffen mit detaillierten Viewmodels. Jede Waffe nutzt dieselbe Klasse, die Unterschiede
// (Werte, Optik, Tracer-Farbe, Rückstoß) stehen in WEAPON_CONFIGS unten.
// Rückstoß/Nachladen laufen jetzt über update(delta) statt setTimeout -> flüssig und ohne "Drift",
// wenn man mitten im Rückstoß die Waffe wechselt. WeaponManager.update(delta) pro Frame aufrufen!

// ---------- Skin-UVs ----------
// Die eingebauten UVs der Boxen/Zylinder gehen pro Fläche von 0 bis 1 - ein Muster würde auf langen dünnen Teilen
// (Lauf) extrem gestreckt. Stattdessen projizieren wir jede Fläche entlang ihrer Hauptachse in Metern (Waffenraum).
// Dadurch ist das Muster überall gleich groß und läuft von Gehäuse zu Lauf durchgehend weiter.
const _m4 = new THREE.Matrix4();
const _n3 = new THREE.Matrix3();
const _pv = new THREE.Vector3();
const _nv = new THREE.Vector3();
function projectSkinUVs(mesh) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    if (!pos || !nor) return;
    mesh.updateMatrix();
    _m4.copy(mesh.matrix);
    _n3.getNormalMatrix(_m4);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        _pv.fromBufferAttribute(pos, i).applyMatrix4(_m4);
        _nv.fromBufferAttribute(nor, i).applyMatrix3(_n3);
        const ax = Math.abs(_nv.x), ay = Math.abs(_nv.y), az = Math.abs(_nv.z);
        let u, v;
        if (ax >= ay && ax >= az) { u = _pv.z; v = _pv.y; }       // Seitenflächen
        else if (ay >= az) { u = _pv.x; v = _pv.z; }               // Ober-/Unterseiten
        else { u = _pv.x; v = _pv.y; }                             // Vorder-/Rückseiten
        uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------- Mesh-Helfer ----------
const matCache = new Map();
function mat(color) {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshBasicMaterial({ color }));
    return matCache.get(color);
}
const edgeMatCache = new Map();
function edgeMat(color) {
    if (!edgeMatCache.has(color)) edgeMatCache.set(color, new THREE.LineBasicMaterial({ color }));
    return edgeMatCache.get(color);
}

// Box mit optionaler Rotation und hellerer Kantenlinie (gibt den ungelitteten Flächen Tiefe)
function box(g, w, h, d, color, x, y, z, { rx = 0, ry = 0, rz = 0, edge = 0x4a4a5e } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.userData.body = true;        // bekommt beim Skin das Muster
    m.userData.baseColor = color;  // Originalfarbe -> bestimmt, wie hell das Muster an diesem Teil erscheint
    if (edge !== null) {
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat(edge)));
    }
    g.add(m);
    return m;
}

// Zylinder; axis 'z' = entlang des Laufs, 'x' = quer, 'y' = senkrecht
function cyl(g, r, len, color, x, y, z, axis = 'z', { r2 = r, seg = 14 } = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat(color));
    m.userData.body = true;
    m.userData.baseColor = color;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    else if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    g.add(m);
    return m;
}

// Leuchtstreifen (Neon-Akzent, ungelittet)
// Eigenes Material + Markierung, damit Skins die Akzentfarbe später umfärben können
function markAccent(mesh, color) {
    mesh.material = new THREE.MeshBasicMaterial({ color });
    mesh.userData.accent = color;
    mesh.userData.body = false; // Leuchtteile bleiben Leuchtteile (Akzentfarbe), kein Muster
    return mesh;
}
function neon(g, w, h, d, color, x, y, z) {
    return markAccent(box(g, w, h, d, color, x, y, z, { edge: null }), color);
}

// Alle Modellfunktionen geben die Mündungsposition [x,y,z] zurück (für Mündungsfeuer + Tracer-Start).

function buildRifleModel(g) {
    const BODY = 0x23232e, DARK = 0x15151b, MID = 0x2e2e3b, CYAN = 0x00f0ff;

    // Gehäuse + Oberschiene
    box(g, 0.09, 0.12, 0.40, BODY, 0, 0.04, -0.04);
    box(g, 0.07, 0.025, 0.42, MID, 0, 0.113, -0.05);
    for (let i = 0; i < 6; i++) box(g, 0.072, 0.012, 0.012, DARK, 0, 0.128, -0.22 + i * 0.07, { edge: null }); // Picatinny-Schlitze

    // Handschutz + Neon-Seitenstreifen
    box(g, 0.075, 0.085, 0.26, 0x1c1c26, 0, 0.045, -0.35);
    neon(g, 0.004, 0.018, 0.20, CYAN, 0.039, 0.05, -0.35);
    neon(g, 0.004, 0.018, 0.20, CYAN, -0.039, 0.05, -0.35);

    // Lauf + Mündungsbremse
    cyl(g, 0.016, 0.16, DARK, 0, 0.06, -0.56);
    cyl(g, 0.026, 0.06, MID, 0, 0.06, -0.65, 'z', { r2: 0.022 });
    box(g, 0.012, 0.03, 0.012, CYAN, 0, 0.105, -0.64, { edge: null }); // Korn

    // Griff, Magazin (leicht gebogen), Abzugsbügel
    box(g, 0.06, 0.17, 0.07, DARK, 0, -0.08, 0.09, { rx: 0.3 });
    box(g, 0.052, 0.18, 0.07, DARK, 0, -0.09, -0.07, { rx: -0.12 });
    neon(g, 0.054, 0.012, 0.072, CYAN, 0, -0.178, -0.093); // Leuchtkante am Magazinfuß
    box(g, 0.012, 0.012, 0.09, DARK, 0, -0.03, 0.03, { edge: null });

    // Schulterstütze
    box(g, 0.06, 0.11, 0.22, BODY, 0, 0.02, 0.27);
    box(g, 0.065, 0.13, 0.03, DARK, 0, 0.02, 0.385);

    // Red-Dot-Visier
    box(g, 0.05, 0.02, 0.07, DARK, 0, 0.14, -0.1);
    // Visierrahmen (offen in der Mitte, damit man beim Zielen hindurchsehen kann)
    box(g, 0.008, 0.05, 0.012, DARK, 0.024, 0.17, -0.07);
    box(g, 0.008, 0.05, 0.012, DARK, -0.024, 0.17, -0.07);
    box(g, 0.056, 0.008, 0.012, DARK, 0, 0.196, -0.07);
    neon(g, 0.007, 0.007, 0.004, CYAN, 0, 0.172, -0.134); // Leuchtpunkt (liegt beim Zielen exakt in der Bildmitte)

    return [0, 0.06, -0.69];
}

function buildPistolModel(g) {
    const FRAME = 0x1d1d26, SLIDE = 0x2c2c38, DARK = 0x111116, YEL = 0xffcc00;

    // Rahmen + Schlitten
    box(g, 0.07, 0.06, 0.28, FRAME, 0, -0.01, -0.04);
    box(g, 0.076, 0.066, 0.30, SLIDE, 0, 0.048, -0.07);
    neon(g, 0.004, 0.012, 0.20, YEL, 0.039, 0.05, -0.1);
    neon(g, 0.004, 0.012, 0.20, YEL, -0.039, 0.05, -0.1);

    // Rillen am Schlittenende
    for (let i = 0; i < 4; i++) box(g, 0.079, 0.05, 0.007, DARK, 0, 0.05, 0.03 + i * 0.016, { edge: null });

    // Laufspitze
    cyl(g, 0.017, 0.04, DARK, 0, 0.045, -0.235);

    // Griff (leicht geneigt) + Griffschalen-Akzent
    box(g, 0.066, 0.16, 0.085, DARK, 0, -0.105, 0.075, { rx: 0.2 });
    neon(g, 0.004, 0.09, 0.05, YEL, 0.034, -0.1, 0.075);
    neon(g, 0.004, 0.09, 0.05, YEL, -0.034, -0.1, 0.075);

    // Abzugsbügel + Abzug
    box(g, 0.02, 0.008, 0.075, FRAME, 0, -0.056, -0.012);
    box(g, 0.02, 0.04, 0.008, FRAME, 0, -0.038, -0.05);
    box(g, 0.01, 0.03, 0.01, DARK, 0, -0.035, -0.005, { rx: 0.3, edge: null });

    // Kimme + Korn
    box(g, 0.045, 0.02, 0.012, DARK, 0, 0.092, 0.07);
    neon(g, 0.012, 0.022, 0.012, YEL, 0, 0.092, -0.2);

    return [0, 0.048, -0.26];
}

function buildSniperModel(g) {
    const BODY = 0x1a1a22, STOCK = 0x1a1512, DARK = 0x111116, MID = 0x2a2a35, MAG = 0xff2bd6;

    // Gehäuse + Schaft mit Wangenauflage
    box(g, 0.08, 0.10, 0.32, BODY, 0, 0.02, -0.05);
    box(g, 0.07, 0.12, 0.26, STOCK, 0, 0.0, 0.24);
    box(g, 0.06, 0.04, 0.15, STOCK, 0, 0.08, 0.22);
    box(g, 0.075, 0.15, 0.03, DARK, 0, 0.0, 0.385);

    // Handschutz + Neon
    box(g, 0.07, 0.08, 0.42, BODY, 0, 0.03, -0.40);
    neon(g, 0.004, 0.014, 0.34, MAG, 0.036, 0.035, -0.40);
    neon(g, 0.004, 0.014, 0.34, MAG, -0.036, 0.035, -0.40);

    // Langer Lauf + Schalldämpfer
    cyl(g, 0.016, 0.50, MID, 0, 0.05, -0.78);
    cyl(g, 0.032, 0.24, DARK, 0, 0.05, -1.0);
    markAccent(cyl(g, 0.034, 0.008, MAG, 0, 0.05, -0.90), MAG); // Leuchtring am Dämpfer

    // Zweibein (eingeklappt)
    box(g, 0.012, 0.012, 0.18, DARK, 0.035, -0.02, -0.55, { rx: 0.05, edge: null });
    box(g, 0.012, 0.012, 0.18, DARK, -0.035, -0.02, -0.55, { rx: 0.05, edge: null });

    // Magazin, Griff, Abzug
    box(g, 0.05, 0.10, 0.07, DARK, 0, -0.07, -0.02);
    box(g, 0.055, 0.14, 0.06, DARK, 0, -0.08, 0.1, { rx: 0.25 });
    box(g, 0.012, 0.03, 0.01, DARK, 0, -0.04, 0.04, { rx: 0.3, edge: null });

    // Zielfernrohr: Halterungen, Tubus, Vorder-/Okularglocke, Turm, Linse
    box(g, 0.03, 0.05, 0.04, MID, 0, 0.105, -0.2);
    box(g, 0.03, 0.05, 0.04, MID, 0, 0.105, 0.0);
    cyl(g, 0.034, 0.38, DARK, 0, 0.15, -0.1);
    cyl(g, 0.046, 0.09, DARK, 0, 0.15, -0.31, 'z', { r2: 0.05 });
    cyl(g, 0.040, 0.07, DARK, 0, 0.15, 0.115, 'z', { r2: 0.036 });
    cyl(g, 0.014, 0.04, MID, 0, 0.195, -0.1, 'y');
    cyl(g, 0.014, 0.04, MID, 0.045, 0.15, -0.1, 'x');
    markAccent(cyl(g, 0.049, 0.006, MAG, 0, 0.15, -0.36), MAG);   // Leuchtring vorn
    cyl(g, 0.044, 0.004, 0x330022, 0, 0.15, -0.355).userData.body = false; // dunkle Linse bleibt glatt

    // Verschlussgriff
    cyl(g, 0.01, 0.08, DARK, 0.07, 0.045, 0.02, 'x');
    const knob = markAccent(new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), mat(MAG)), MAG);
    knob.position.set(0.112, 0.045, 0.02);
    g.add(knob);

    return [0, 0.05, -1.13];
}


function buildSmgModel(g) {
    const BODY = 0x20242a, DARK = 0x121418, MID = 0x2d333b, GRN = 0x39ff14;

    // Kompaktes Gehäuse + Oberschiene
    box(g, 0.085, 0.11, 0.34, BODY, 0, 0.035, -0.02);
    box(g, 0.07, 0.02, 0.36, MID, 0, 0.10, -0.03);

    // Lauf-Mantel mit Lüftungsschlitzen + Neon
    box(g, 0.07, 0.08, 0.18, 0x181b20, 0, 0.04, -0.28);
    for (let i = 0; i < 4; i++) box(g, 0.072, 0.012, 0.02, DARK, 0, 0.055, -0.22 - i * 0.04, { edge: null });
    neon(g, 0.004, 0.016, 0.16, GRN, 0.037, 0.045, -0.28);
    neon(g, 0.004, 0.016, 0.16, GRN, -0.037, 0.045, -0.28);

    // Lauf + Mündung
    cyl(g, 0.014, 0.12, DARK, 0, 0.04, -0.43);
    cyl(g, 0.024, 0.05, MID, 0, 0.04, -0.52);

    // Griff + langes Magazin
    box(g, 0.058, 0.15, 0.07, DARK, 0, -0.07, 0.09, { rx: 0.28 });
    box(g, 0.05, 0.24, 0.065, DARK, 0, -0.12, -0.10, { rx: -0.1 });
    neon(g, 0.052, 0.012, 0.067, GRN, 0, -0.245, -0.112);

    // Drahtschulterstütze
    box(g, 0.012, 0.012, 0.24, MID, 0.032, 0.04, 0.22, { edge: null });
    box(g, 0.012, 0.012, 0.24, MID, -0.032, 0.04, 0.22, { edge: null });
    box(g, 0.075, 0.09, 0.02, DARK, 0, 0.04, 0.345);

    // Visier: Korn (Leuchtpunkt auf Zielhöhe y=0.16) + Kimme
    box(g, 0.012, 0.035, 0.012, DARK, 0, 0.133, -0.36, { edge: null });
    neon(g, 0.008, 0.008, 0.008, GRN, 0, 0.157, -0.36);
    box(g, 0.008, 0.045, 0.012, DARK, 0.024, 0.12, 0.02, { edge: null });
    box(g, 0.008, 0.045, 0.012, DARK, -0.024, 0.12, 0.02, { edge: null });

    return [0, 0.04, -0.55];
}

function buildShotgunModel(g) {
    const BODY = 0x1c1f24, DARK = 0x111216, MID = 0x2a2e36, WOOD = 0x2c1e14, ORG = 0xff7a00;

    // Gehäuse + Neon-Seiten
    box(g, 0.085, 0.11, 0.32, BODY, 0, 0.03, 0.0);
    neon(g, 0.004, 0.02, 0.20, ORG, 0.044, 0.04, 0.0);
    neon(g, 0.004, 0.02, 0.20, ORG, -0.044, 0.04, 0.0);

    // Lauf (dick), Magazinrohr darunter, Laufschiene
    cyl(g, 0.03, 0.78, MID, 0, 0.075, -0.53);
    cyl(g, 0.024, 0.66, DARK, 0, 0.015, -0.47);
    box(g, 0.012, 0.006, 0.74, DARK, 0, 0.112, -0.53, { edge: null });
    cyl(g, 0.036, 0.05, DARK, 0, 0.075, -0.93);   // Mündungsring

    // Pumpgriff (Vorderschaft) mit Neon-Rillen
    box(g, 0.085, 0.075, 0.22, WOOD, 0, 0.0, -0.40);
    for (let i = 0; i < 4; i++) neon(g, 0.087, 0.008, 0.01, ORG, 0, 0.0, -0.33 - i * 0.045);

    // Griff + Schaft
    box(g, 0.06, 0.14, 0.07, DARK, 0, -0.09, 0.12, { rx: 0.25 });
    box(g, 0.07, 0.13, 0.30, WOOD, 0, 0.0, 0.28, { rx: -0.05 });
    box(g, 0.075, 0.15, 0.03, DARK, 0, 0.0, 0.44);

    // Korn (Leuchtpunkt) + Kimme
    neon(g, 0.01, 0.012, 0.01, ORG, 0, 0.123, -0.90);
    box(g, 0.04, 0.012, 0.02, DARK, 0, 0.092, 0.08, { edge: null });

    return [0, 0.075, -0.97];
}

function buildRevolverModel(g) {
    const BODY = 0x23262d, DARK = 0x111216, MID = 0x32363f, WOOD = 0x2c1e14, RED = 0xff3355;

    // Rahmen + Trommel mit Neon-Ringen
    box(g, 0.075, 0.10, 0.18, BODY, 0, 0.0, 0.0);
    cyl(g, 0.042, 0.12, MID, 0, 0.01, -0.06);
    markAccent(cyl(g, 0.044, 0.008, RED, 0, 0.01, -0.115), RED);
    markAccent(cyl(g, 0.044, 0.008, RED, 0, 0.01, -0.005), RED);

    // Lauf + Unterlauf
    box(g, 0.05, 0.055, 0.38, MID, 0, 0.035, -0.28);
    box(g, 0.045, 0.04, 0.28, DARK, 0, 0.0, -0.25);
    neon(g, 0.004, 0.012, 0.30, RED, 0.027, 0.04, -0.28);
    neon(g, 0.004, 0.012, 0.30, RED, -0.027, 0.04, -0.28);

    // Hahn, Abzugsbügel, Holzgriff
    box(g, 0.016, 0.04, 0.02, DARK, 0, 0.07, 0.10, { rx: -0.5 });
    box(g, 0.02, 0.008, 0.08, BODY, 0, -0.07, 0.0);
    box(g, 0.06, 0.16, 0.09, WOOD, 0, -0.12, 0.10, { rx: 0.3 });

    // Korn (Leuchtpunkt, Zielhöhe y=0.098) + Kimme
    box(g, 0.012, 0.02, 0.012, DARK, 0, 0.083, -0.45, { edge: null });
    neon(g, 0.01, 0.01, 0.01, RED, 0, 0.093, -0.45);
    box(g, 0.05, 0.022, 0.02, DARK, 0, 0.068, 0.07, { edge: null });

    return [0, 0.035, -0.49];
}

// ---------- Waffentypen ----------
// automatic  = true: Dauerfeuer bei gehaltener Feuertaste (sonst ein Schuss pro Klick)
// infiniteAmmo = false: Magazin muss nachgeladen werden. reserveAmmo: Infinity = unbegrenzte Reserve (man kann
//   immer nachladen, aber das Magazin leert sich); eine Zahl = begrenzte Reserve. infiniteAmmo: true = nie nachladen.
// aimFov = Sichtfeld beim Zielen (Rechtsklick), aimPos = Waffenposition beim Zielen (Visier in Bildmitte),
// aimSpeed = Zielgeschwindigkeit, aimMoveFactor = Lauftempo beim Zielen, scopeOverlay = Zielfernrohr-Ansicht
// unlockLevel = ab diesem Spieler-Level nutzbar; pellets/spread = Schrot (mehrere Strahlen pro Schuss, Streuung in rad)
// drawTime = Dauer der Zieh-Animation in Sekunden (Waffe kann währenddessen nicht schießen/zielen)
// color      = Neon-Farbe für Tracer, Einschlagsfunken, Bullet Holes, Mündungsfeuer
// kick/kickRot = Rückstoß (Rückwärtsversatz / Hochschlag in rad); holeSize = Größe des Einschussloches
export const WEAPON_CONFIGS = [
    {
        name: 'Rifle', damage: 20, fireCooldown: 0.1, automatic: true,
        magSize: 30, reserveAmmo: Infinity, reloadDuration: 1700, infiniteAmmo: false,
        color: 0x00f0ff, tracerWidth: 0.03, tracerLife: 0.09, holeSize: 0.26,
        kick: 0.05, kickRot: 0.05,
        aimFov: 55, aimPos: [0, -0.172, -0.30], aimSpeed: 9, aimMoveFactor: 0.8, scopeOverlay: false, drawTime: 0.42, unlockLevel: 1,
        buildModel: buildRifleModel
    },
    {
        name: 'Pistol', damage: 15, fireCooldown: 0.18,
        magSize: 12, reserveAmmo: Infinity, reloadDuration: 1100, infiniteAmmo: false,
        color: 0xffcc00, tracerWidth: 0.024, tracerLife: 0.08, holeSize: 0.22,
        kick: 0.06, kickRot: 0.09,
        aimFov: 62, aimPos: [0, -0.108, -0.35], aimSpeed: 11, aimMoveFactor: 0.9, scopeOverlay: false, drawTime: 0.30, unlockLevel: 1,
        buildModel: buildPistolModel
    },
    {
        name: 'Sniper', damage: 75, fireCooldown: 1.2,
        magSize: 5, reserveAmmo: Infinity, reloadDuration: 2400, infiniteAmmo: false,
        color: 0xff2bd6, tracerWidth: 0.06, tracerLife: 0.28, holeSize: 0.42,
        kick: 0.14, kickRot: 0.16,
        aimFov: 18, aimPos: [0, -0.15, -0.40], aimSpeed: 7, aimMoveFactor: 0.5, scopeOverlay: true, drawTime: 0.60, unlockLevel: 4,
        buildModel: buildSniperModel
    },
    {
        name: 'SMG', damage: 11, fireCooldown: 0.055, automatic: true,
        magSize: 40, reserveAmmo: Infinity, reloadDuration: 1600, infiniteAmmo: false,
        color: 0x39ff14, tracerWidth: 0.022, tracerLife: 0.07, holeSize: 0.2,
        kick: 0.035, kickRot: 0.035,
        aimFov: 60, aimPos: [0, -0.16, -0.32], aimSpeed: 11, aimMoveFactor: 0.85, scopeOverlay: false, drawTime: 0.32, unlockLevel: 2,
        buildModel: buildSmgModel
    },
    {
        name: 'Shotgun', damage: 12, pellets: 8, spread: 0.05, fireCooldown: 0.85,
        magSize: 6, reserveAmmo: Infinity, reloadDuration: 2300, infiniteAmmo: false,
        color: 0xff7a00, tracerWidth: 0.02, tracerLife: 0.08, holeSize: 0.16,
        kick: 0.16, kickRot: 0.14,
        aimFov: 65, aimPos: [0, -0.13, -0.38], aimSpeed: 9, aimMoveFactor: 0.8, scopeOverlay: false, drawTime: 0.50, unlockLevel: 6,
        buildModel: buildShotgunModel
    },
    {
        name: 'Revolver', damage: 55, fireCooldown: 0.5,
        magSize: 6, reserveAmmo: Infinity, reloadDuration: 2100, infiniteAmmo: false,
        color: 0xff3355, tracerWidth: 0.045, tracerLife: 0.16, holeSize: 0.3,
        kick: 0.12, kickRot: 0.15,
        aimFov: 50, aimPos: [0, -0.098, -0.36], aimSpeed: 10, aimMoveFactor: 0.85, scopeOverlay: false, drawTime: 0.38, unlockLevel: 9,
        buildModel: buildRevolverModel
    }
];

// ---------- Einzelne Waffe ----------
const BASE_POS = new THREE.Vector3(0.3, -0.25, -0.5);
const _tmpColor = new THREE.Color();

export class Weapon {
    constructor(camera, scene, config, onAmmoChange = null) {
        this.camera = camera;
        this.scene = scene;
        this.onAmmoChange = onAmmoChange; // callback(this) - bei jeder Munitions-/Reload-Änderung

        this.name = config.name;
        this.damage = config.damage;
        this.color = config.color;
        this.tracerWidth = config.tracerWidth;
        this.tracerLife = config.tracerLife;
        this.holeSize = config.holeSize;
        this.kick = config.kick;
        this.kickRot = config.kickRot;
        this.fireCooldown = config.fireCooldown;
        this.lastShotTime = -Infinity;
        this.baseColor = config.color;
        this.unlockLevel = config.unlockLevel ?? 1;
        this.unlocked = this.unlockLevel <= 1;
        this.pellets = config.pellets ?? 1;
        this.spread = config.spread ?? 0;
        this.rainbow = false;
        this._hue = 0;

        // --- Munitionssystem ---
        this.magSize = config.magSize;
        this.ammoInMag = this.magSize;
        this.reserveAmmo = config.reserveAmmo;
        this.maxReserve = config.reserveAmmo;   // Startwert, für refill() beim Respawn
        this.automatic = config.automatic ?? false;
        this.lastDryTime = -Infinity;
        this._reloadTimer = null;
        this.isReloading = false;
        this.reloadDuration = config.reloadDuration;
        this.infiniteAmmo = config.infiniteAmmo ?? false;

        // --- Animationszustand (wird in update() abgebaut) ---
        this.recoil = 0;       // 0..1
        this.dryNudge = 0;     // "Klick" bei leerem Magazin
        this.reloadSink = 0;   // 0..1, Waffe wird beim Nachladen abgesenkt
        this.flashTimer = 0;

        // --- Zielen (ADS) ---
        this.aimFov = config.aimFov;
        this.aimPos = new THREE.Vector3(...config.aimPos);
        this.aimSpeed = config.aimSpeed;
        this.aimMoveFactor = config.aimMoveFactor;
        this.scopeOverlay = config.scopeOverlay;
        this.drawTime = config.drawTime ?? 0.4;
        this.drawT = 1;        // 0..1 Fortschritt der Zieh-Animation (1 = fertig gezogen)
        this.emitEvent = null; // Callback(type) für Sounds: 'shoot','dry','reloadStart','reloadMid','reloadEnd'
        this._midTimer = null;
        this.aiming = false;   // Wunsch: Rechtsklick gehalten
        this.aimT = 0;         // 0..1 linearer Fortschritt
        this.aimE = 0;         // 0..1 geglättet (für Position/FOV)
        this.active = false;   // vom WeaponManager gesetzt (aktuell ausgerüstet)

        this.weaponGroup = new THREE.Group();
        const m = config.buildModel(this.weaponGroup);
        this.weaponGroup.position.copy(BASE_POS);
        this.weaponGroup.visible = false; // WeaponManager blendet die aktive Waffe ein

        // Mündungspunkt (für Tracer-Start) + Mündungsfeuer (einmal gebaut, dann nur ein/aus)
        this.muzzle = new THREE.Object3D();
        this.muzzle.position.set(m[0], m[1], m[2]);
        this.weaponGroup.add(this.muzzle);
        this.flash = this._buildFlash(config.color);
        this.muzzle.add(this.flash);

        // Alle Akzent-Meshes einsammeln (per Skin umfärbbar)
        this.accentMeshes = [];
        this.weaponGroup.traverse((o) => { if (o.userData && o.userData.accent !== undefined) this.accentMeshes.push(o); });

        // Körperteile für Skin-Muster: Originalmaterial merken, UVs in Metern berechnen
        this.skin = null;
        this.bodyMeshes = [];
        this.weaponGroup.traverse((o) => {
            if (o.isMesh && o.userData && o.userData.body) {
                o.userData.baseMat = o.material;
                projectSkinUVs(o);
                this.bodyMeshes.push(o);
            }
        });

        this.camera.add(this.weaponGroup);
        this._notifyAmmoChange();
    }

    // Skin anwenden (Objekt aus skins.js): Muster auf der ganzen Waffe + Akzentfarbe. null/Standard = Originaldesign
    setSkin(skin) {
        this.skin = skin || null;
        this.rainbow = !!(skin && skin.rainbow);
        this._recolor(skin ? (skin.accent ?? null) : null);
        const patterned = !!(skin && skin.pattern);
        for (const m of this.bodyMeshes) {
            m.material = patterned ? weaponSkinMaterial(skin, shadeForColor(m.userData.baseColor)) : m.userData.baseMat;
        }
    }

    _recolor(hexOrNull) {
        for (const m of this.accentMeshes) m.material.color.setHex(hexOrNull ?? m.userData.accent);
        const c = hexOrNull ?? this.baseColor;
        this.color = c; // Tracer, Einschusslöcher, Funken
        for (const fm of this.flashTintMats) fm.color.setHex(c);
    }

    _buildFlash(colorHex) {
        const g = new THREE.Group();
        this.flashTintMats = [];
        const add = (geo, color, opacity, tint = false) => {
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
            }));
            if (tint) this.flashTintMats.push(m.material);
            g.add(m);
            return m;
        };
        add(new THREE.SphereGeometry(0.035, 8, 8), 0xffffff, 0.95);          // heller Kern
        add(new THREE.SphereGeometry(0.075, 8, 8), colorHex, 0.5, true);     // farbiger Glow
        const starGeo = new THREE.PlaneGeometry(0.28, 0.05);                 // Stern aus 2 gekreuzten Streifen
        const s1 = add(starGeo, colorHex, 0.85, true);
        const s2 = add(starGeo, colorHex, 0.85, true);
        s2.rotation.z = Math.PI / 2;
        const s3 = add(new THREE.PlaneGeometry(0.05, 0.4), colorHex, 0.5, true); // Strahl nach vorn
        s3.rotation.x = Math.PI / 2;
        s3.position.z = -0.18;
        g.visible = false;
        return g;
    }

    _emit(type) {
        if (this.emitEvent) this.emitEvent(type);
    }

    // Zieh-Animation neu starten (Waffenwechsel, Respawn, Spielstart)
    startDraw() {
        this.drawT = 0;
        this.recoil = 0;
        this.flash.visible = false;
    }

    _notifyAmmoChange() {
        if (this.onAmmoChange) this.onAmmoChange(this);
    }

    // Mündung in Weltkoordinaten (Matrizen vorher aktualisieren, falls nötig)
    getMuzzleWorldPosition(out) {
        this.camera.updateMatrixWorld(true);
        return this.muzzle.getWorldPosition(out);
    }

    // Gibt true zurück, wenn tatsächlich geschossen wurde (main.js nutzt das für Tracer/Netzwerk)
    shoot() {
        const now = performance.now() / 1000;
        if (this.drawT < 0.75) return false; // Waffe wird noch gezogen
        if (now - this.lastShotTime < this.fireCooldown) return false;
        if (this.isReloading) return false;

        if (!this.infiniteAmmo && this.ammoInMag <= 0) {
            // Leeres Magazin: "Klick" (max. 4x pro Sekunde, sonst zuckt die Waffe bei Dauerfeuer jeden Frame)
            // und automatisch nachladen, falls noch Reserve da ist
            if (now - this.lastDryTime > 0.25) {
                this.lastDryTime = now;
                this.dryNudge = 1;
                this._emit('dry');
            }
            this.reload();
            return false;
        }

        this.lastShotTime = now;

        if (!this.infiniteAmmo) {
            this.ammoInMag -= 1;
            this._notifyAmmoChange();
        }

        this._emit('shoot');
        this.recoil = 1;
        this.flashTimer = 0.045;
        this.flash.rotation.z = Math.random() * Math.PI * 2; // jedes Mal anders gedreht
        const s = 0.8 + Math.random() * 0.5;
        this.flash.scale.set(s, s, s);
        this.flash.visible = true;

        return true;
    }

    reload() {
        if (this.infiniteAmmo) return;
        if (this.isReloading) return;
        if (this.ammoInMag === this.magSize) return;
        if (this.reserveAmmo <= 0) return;
        if (this.drawT < 0.75) return; // erst fertig ziehen

        this.isReloading = true;
        this._notifyAmmoChange();
        this._emit('reloadStart');
        this._midTimer = setTimeout(() => { this._midTimer = null; this._emit('reloadMid'); }, this.reloadDuration * 0.55);

        this._reloadTimer = setTimeout(() => {
            this._reloadTimer = null;
            this._emit('reloadEnd');
            const needed = this.magSize - this.ammoInMag;
            const amount = Math.min(needed, this.reserveAmmo);
            this.ammoInMag += amount;
            this.reserveAmmo -= amount;
            this.isReloading = false;
            this._notifyAmmoChange();
        }, this.reloadDuration);
    }

    // Nachladen abbrechen (z.B. Waffenwechsel): die Patronen wandern erst NACH Ablauf ins Magazin,
    // ein Abbruch kostet also nichts außer der verlorenen Zeit.
    cancelReload() {
        if (!this.isReloading) return;
        clearTimeout(this._reloadTimer);
        clearTimeout(this._midTimer);
        this._reloadTimer = null;
        this._midTimer = null;
        this.isReloading = false;
        this._notifyAmmoChange();
    }

    // Volle Munition (Respawn)
    refill() {
        this.cancelReload();
        this.ammoInMag = this.magSize;
        this.reserveAmmo = this.maxReserve;
        this._notifyAmmoChange();
    }

    // Rücksetzen beim Waffenwechsel (sonst bliebe ein halber Rückstoß "stehen")
    resetAnimation() {
        this.recoil = 0; this.dryNudge = 0; this.flashTimer = 0;
        this.aiming = false; this.aimT = 0; this.aimE = 0;
        this.flash.visible = false;
        this.weaponGroup.position.copy(BASE_POS);
        this.weaponGroup.rotation.set(0, 0, 0);
    }

    update(delta) {
        if (this.active && this.skin && this.skin.scroll) scrollSkinTextures(delta);
        if (this.rainbow && this.active) {
            this._hue = (this._hue + delta * 0.35) % 1;
            _tmpColor.setHSL(this._hue, 1, 0.55);
            this._recolor(_tmpColor.getHex());
        }
        // Rückstoß klingt schnell ab (ca. 0.1 s), Nachladen senkt sanft ab/hebt an
        this.recoil = Math.max(0, this.recoil - delta * 10);
        this.dryNudge = Math.max(0, this.dryNudge - delta * 14);
        const sinkTarget = this.isReloading ? 1 : 0;
        this.reloadSink += (sinkTarget - this.reloadSink) * Math.min(1, delta * 10);

        // Zielen: beim Nachladen nicht möglich; aimT läuft linear, aimE ist die geglättete Version
        const aimTarget = (this.aiming && !this.isReloading && this.drawT >= 0.75) ? 1 : 0;
        const step = delta * this.aimSpeed;
        this.aimT += Math.sign(aimTarget - this.aimT) * Math.min(step, Math.abs(aimTarget - this.aimT));
        const e = this.aimE = this.aimT * this.aimT * (3 - 2 * this.aimT);

        // Zieh-Animation: Waffe schwingt von unten/seitlich hoch, kippt nach oben und federt leicht über
        // (easeOutBack). d = 1 am Anfang (ganz unten), 0 am Ende, kurz negativ beim Überschwingen.
        let d = 0;
        if (this.drawT < 1) {
            this.drawT = Math.min(1, this.drawT + delta / this.drawTime);
            const t = this.drawT - 1;
            d = 1 - (1 + 2.70158 * t * t * t + 1.70158 * t * t);
        }

        // Quadratisch: starker Anfangsimpuls, weicher Auslauf. Beim Zielen halber Rückstoß (Waffe bleibt im Bild).
        const k = this.recoil * this.recoil * (1 - 0.5 * e);
        this.weaponGroup.position.set(
            BASE_POS.x + (this.aimPos.x - BASE_POS.x) * e + this.dryNudge * 0.02 + d * 0.14,
            BASE_POS.y + (this.aimPos.y - BASE_POS.y) * e - this.reloadSink * 0.15 - d * 0.40,
            BASE_POS.z + (this.aimPos.z - BASE_POS.z) * e + k * this.kick + d * 0.08
        );
        this.weaponGroup.rotation.x = k * this.kickRot + this.reloadSink * 0.35 - d * 0.95;
        this.weaponGroup.rotation.z = d * 0.45;

        // Zielfernrohr-Ansicht: Waffenmodell ausblenden, sobald fast voll gezoomt (dann zeigt das Overlay das Rohr)
        if (this.active) this.weaponGroup.visible = !(this.scopeOverlay && this.aimT > 0.9);

        if (this.flashTimer > 0) {
            this.flashTimer -= delta;
            if (this.flashTimer <= 0) this.flash.visible = false;
        }
    }
}

// ---------- WeaponManager ----------
// Hält alle Waffen gleichzeitig an derselben Kamera, blendet beim Wechsel nur die aktive ein.
export class WeaponManager {
    constructor(camera, scene, onAmmoChange = null) {
        this.onAmmoChange = onAmmoChange;
        this.activeIndex = 0;
        this._ready = false; // Ammo-Callback darf während des Aufbaus (this.weapons existiert noch nicht) nicht feuern
        this.weapons = WEAPON_CONFIGS.map(
            config => new Weapon(camera, scene, config, (w) => this._handleWeaponAmmoChange(w))
        );
        this._ready = true;
        this._aimWanted = false;
        this.onEvent = null; // Callback(type, weaponIndex) für Sounds; wird von main.js gesetzt
        this.weapons.forEach((w, i) => {
            w.emitEvent = (type) => { if (w === this.current && this.onEvent) this.onEvent(type, i); };
        });
        this.weapons[this.activeIndex].startDraw();
        this.weapons[this.activeIndex].weaponGroup.visible = true;
        this.weapons[this.activeIndex].active = true;
        this._notify();
    }

    get current() { return this.weapons[this.activeIndex]; }

    // Proxy-Eigenschaften für HUD/main.js
    get name() { return this.current.name; }
    get damage() { return this.current.damage; }
    get color() { return this.current.color; }
    get tracerWidth() { return this.current.tracerWidth; }
    get tracerLife() { return this.current.tracerLife; }
    get holeSize() { return this.current.holeSize; }
    get ammoInMag() { return this.current.ammoInMag; }
    get reserveAmmo() { return this.current.reserveAmmo; }
    get magSize() { return this.current.magSize; }
    get isReloading() { return this.current.isReloading; }
    get infiniteAmmo() { return this.current.infiniteAmmo; }
    get automatic() { return this.current.automatic; }
    get pellets() { return this.current.pellets; }
    get spread() { return this.current.spread; }

    // Freischaltung nach Spieler-Level
    isUnlocked(i) { return !!(this.weapons[i] && this.weapons[i].unlocked); }
    setLevel(level) { this.weapons.forEach(w => { w.unlocked = level >= w.unlockLevel; }); }
    // Skin auf alle Waffen anwenden
    setSkin(skin) { this.weapons.forEach(w => w.setSkin(skin)); }

    // Zielen (Rechtsklick): setAiming(true/false). aimAmount = 0..1 (geglättet) für FOV-Zoom im Frame-Loop.
    setAiming(on) { this._aimWanted = !!on; this.current.aiming = this._aimWanted; }
    get aimWanted() { return this._aimWanted; }
    get aimAmount() { return this.current.aimE; }
    get aimFov() { return this.current.aimFov; }
    get aimMoveFactor() { return this.current.aimMoveFactor; }
    get scopeVisible() { return this.current.scopeOverlay && this.current.aimT > 0.9; }

    shoot() { return this.current.shoot(); }
    reload() { this.current.reload(); }
    refillAll() {
        this.weapons.forEach(w => w.refill());
        this.current.startDraw(); // nach dem Respawn: Waffe wieder ziehen
    }
    update(delta) { this.current.update(delta); }
    getMuzzleWorldPosition(out) { return this.current.getMuzzleWorldPosition(out); }

    switchTo(index) {
        if (index < 0 || index >= this.weapons.length || index === this.activeIndex) return;
        if (!this.weapons[index].unlocked) return; // noch nicht freigeschaltet
        this.current.cancelReload(); // Wechsel bricht Nachladen ab (kein Nachladen im Hintergrund)
        this.current.resetAnimation();
        this.current.active = false;
        this.current.weaponGroup.visible = false;
        this.activeIndex = index;
        this.current.active = true;
        this.current.aiming = this._aimWanted; // Rechtsklick gehalten -> neue Waffe zielt sofort wieder
        this.current.weaponGroup.visible = true;
        this.current.startDraw();
        if (this.onEvent) this.onEvent('draw', this.activeIndex);
        this._notify();
    }

    switchNext() {
        const n = this.weapons.length;
        for (let k = 1; k <= n; k++) {
            const i = (this.activeIndex + k) % n;
            if (this.weapons[i].unlocked) { this.switchTo(i); return; }
        }
    }

    _handleWeaponAmmoChange(weapon) {
        if (!this._ready) return;
        if (weapon === this.current) this._notify();
    }

    _notify() {
        if (this.onAmmoChange) {
            this.onAmmoChange(this.current.ammoInMag, this.current.reserveAmmo, this.current.isReloading, this.current.name, this.current.magSize);
        }
    }
}
