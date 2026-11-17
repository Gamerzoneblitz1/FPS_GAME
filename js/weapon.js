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

// Ring (Torus), z. B. Fingerloch am Messer, Ringe am Dämpfer
function torus(g, R, r, color, x, y, z, { rx = 0, ry = 0, rz = 0, seg = 16 } = {}) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, seg), mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.userData.body = true;
    m.userData.baseColor = color;
    g.add(m);
    return m;
}
// n gleiche Teile in einer Reihe (Rillen, Schlitze, Zähne): fn(i) gibt die Position, step = Abstand
function row(n, fn) { for (let i = 0; i < n; i++) fn(i); }

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

    // --- Details (alles seitlich/unterhalb der Visierlinie) ---
    const SIDE = [1, -1];
    for (const sx of SIDE) {
        box(g, 0.004, 0.03, 0.07, DARK, sx * 0.046, 0.065, -0.02, { edge: null });          // Auswurffenster
        box(g, 0.006, 0.014, 0.03, MID, sx * 0.047, 0.0, 0.07);                              // Sicherung/Schalter
        row(5, (i) => box(g, 0.004, 0.012, 0.03, DARK, sx * 0.0385, 0.0, -0.27 - i * 0.045, { edge: null })); // M-LOK-Schlitze
        box(g, 0.006, 0.02, 0.04, MID, sx * 0.047, 0.03, -0.12);                              // Magazinhalter/Verschlussfang
    }
    box(g, 0.012, 0.012, 0.05, MID, 0.056, 0.09, 0.1);                                        // Spannhebel (seitlich)
    box(g, 0.02, 0.016, 0.02, DARK, 0.062, 0.09, 0.125);
    box(g, 0.035, 0.04, 0.04, MID, 0, 0.083, -0.50);                                          // Gasblock
    cyl(g, 0.006, 0.2, DARK, 0, 0.098, -0.40);                                                // Gasrohr
    row(4, (i) => { const a = i * Math.PI / 2; box(g, 0.008, 0.008, 0.045, DARK, Math.cos(a) * 0.022, 0.06 + Math.sin(a) * 0.022, -0.685, { edge: null }); }); // Mündungsfeuerdämpfer
    box(g, 0.03, 0.09, 0.035, DARK, 0, -0.04, -0.40, { rx: 0.35 });                           // Vordergriff
    row(4, (i) => box(g, 0.056, 0.006, 0.074, MID, 0, -0.045 - i * 0.032, -0.083 - i * 0.004, { rx: -0.12, edge: null })); // Magazinrippen
    row(4, (i) => box(g, 0.062, 0.006, 0.072, MID, 0, -0.035 - i * 0.026, 0.075 + i * 0.008, { rx: 0.3, edge: null }));   // Griffrillen
    box(g, 0.05, 0.03, 0.12, MID, 0, 0.085, 0.28);                                            // Wangenauflage
    row(3, (i) => box(g, 0.066, 0.006, 0.02, DARK, 0, 0.0 - i * 0.03, 0.39, { edge: null })); // Schaftkappe
    torus(g, 0.012, 0.003, MID, 0.034, 0.0, 0.18, { ry: Math.PI / 2 });                       // Riemenöse

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

    // --- Details ---
    row(4, (i) => box(g, 0.079, 0.05, 0.007, DARK, 0, 0.05, -0.17 - i * 0.016, { edge: null }));      // Frontrillen
    for (const sx of [1, -1]) {
        box(g, 0.004, 0.03, 0.06, DARK, sx * 0.039, 0.058, -0.05, { edge: null });                    // Auswurffenster
        box(g, 0.006, 0.012, 0.045, SLIDE, sx * 0.037, 0.0, -0.01);                                     // Schlittenfang
        row(4, (i) => box(g, 0.004, 0.012, 0.05, SLIDE, sx * 0.035, -0.07 - i * 0.022, 0.075 + i * 0.005, { rx: 0.2, edge: null })); // Griffrillen
    }
    box(g, 0.03, 0.012, 0.1, FRAME, 0, -0.045, -0.13);                                            // Zubehörschiene
    box(g, 0.075, 0.012, 0.09, SLIDE, 0, -0.19, 0.105, { rx: 0.2 });                                // Magazinboden
    box(g, 0.012, 0.012, 0.02, DARK, 0, 0.085, 0.14, { edge: null });                             // Hahn (niedrig, stört das Visier nicht)
    cyl(g, 0.02, 0.03, SLIDE, 0, 0.045, -0.255);                                                 // Laufbuchse

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

    // --- Details ---
    box(g, 0.03, 0.01, 0.34, MID, 0, 0.077, -0.05);                                              // Montageschiene
    row(5, (i) => torus(g, 0.034, 0.004, MID, 0, 0.05, -0.93 - i * 0.04, { seg: 14 }));          // Dämpferringe
    for (const sx of [1, -1]) {
        row(5, (i) => box(g, 0.004, 0.02, 0.035, DARK, sx * 0.0355, 0.03, -0.25 - i * 0.07, { edge: null })); // Handschutz-Schlitze
        box(g, 0.02, 0.006, 0.03, DARK, sx * 0.035, -0.027, -0.64, { edge: null });               // Zweibeinfüße
        box(g, 0.006, 0.03, 0.05, MID, sx * 0.046, 0.025, 0.05);                                  // Verschlussfang
    }
    row(3, (i) => box(g, 0.072, 0.006, 0.12, MID, 0, 0.03 - i * 0.03, 0.30, { edge: null }));    // Schaftrippen
    row(3, (i) => box(g, 0.052, 0.006, 0.07, MID, 0, -0.045 - i * 0.025, -0.02, { edge: null })); // Magazinrippen
    box(g, 0.082, 0.12, 0.016, 0x0a0a0c, 0, 0.0, 0.405);                                         // Schaftkappe
    torus(g, 0.014, 0.003, MID, 0.04, -0.03, 0.28, { ry: Math.PI / 2 });                          // Riemenöse
    box(g, 0.02, 0.02, 0.02, MID, 0.034, 0.15, -0.1);                                             // Kappe am Seitenturm

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

    // --- Details ---
    row(6, (i) => box(g, 0.072, 0.008, 0.01, DARK, 0, 0.113, -0.17 + i * 0.05, { edge: null })); // Schienenzähne (unterhalb der Visierlinie)
    for (const sx of [1, -1]) {
        box(g, 0.004, 0.028, 0.06, DARK, sx * 0.0435, 0.05, -0.04, { edge: null });               // Auswurffenster
        box(g, 0.006, 0.014, 0.03, MID, sx * 0.045, 0.0, 0.07);                                    // Sicherung
        row(3, (i) => box(g, 0.004, 0.02, 0.014, DARK, sx * 0.036, 0.04, -0.33 + i * 0.03, { edge: null })); // Mantel-Lüftung
    }
    box(g, 0.012, 0.012, 0.05, MID, 0.052, 0.09, 0.0);                                             // Spannhebel
    box(g, 0.03, 0.09, 0.035, DARK, 0, -0.045, -0.30, { rx: 0.2 });                                // Vordergriff
    box(g, 0.06, 0.03, 0.08, MID, 0, -0.03, -0.10);                                                // Magazinschacht
    row(5, (i) => box(g, 0.052, 0.006, 0.067, MID, 0, -0.06 - i * 0.04, -0.108 - i * 0.006, { rx: -0.1, edge: null })); // Magazinrippen
    row(4, (i) => box(g, 0.06, 0.006, 0.07, MID, 0, -0.03 - i * 0.026, 0.085 + i * 0.01, { rx: 0.28, edge: null }));    // Griffrillen
    box(g, 0.034, 0.04, 0.03, MID, 0.032, 0.04, 0.10);                                              // Klappgelenk der Stütze
    cyl(g, 0.02, 0.04, MID, 0, 0.04, -0.57);                                                        // Gewindekappe

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

    // --- Details ---
    row(4, (i) => cyl(g, 0.011, 0.034, 0xb02020, -0.043, 0.07 - i * 0.026, 0.20, 'x'));         // Patronenhalter an der Schaftseite
    row(4, (i) => cyl(g, 0.011, 0.008, 0xd9a521, -0.06, 0.07 - i * 0.026, 0.20, 'x'));          // Messingböden
    box(g, 0.004, 0.035, 0.08, DARK, 0.0435, 0.04, 0.03, { edge: null });                       // Auswurffenster
    box(g, 0.07, 0.12, 0.02, DARK, 0, 0.045, -0.72);                                            // Laufschelle hinten
    box(g, 0.07, 0.12, 0.02, DARK, 0, 0.045, -0.88);                                            // Laufschelle vorn
    box(g, 0.02, 0.008, 0.08, BODY, 0, -0.045, 0.06);                                           // Abzugsbügel
    box(g, 0.02, 0.04, 0.008, BODY, 0, -0.03, 0.02);
    box(g, 0.01, 0.03, 0.01, DARK, 0, -0.03, 0.06, { rx: 0.3, edge: null });                    // Abzug
    box(g, 0.01, 0.025, 0.04, MID, -0.044, 0.0, 0.06);                                           // Sicherung
    row(6, (i) => box(g, 0.087, 0.004, 0.012, DARK, 0, 0.034, -0.34 - i * 0.03, { edge: null })); // Griffrillen
    torus(g, 0.012, 0.003, MID, 0.04, -0.04, 0.34, { ry: Math.PI / 2 });                         // Riemenöse
    box(g, 0.076, 0.14, 0.02, 0x0a0a0a, 0, 0.0, 0.455);                                         // Gummi-Schaftkappe

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

    // --- Details ---
    row(6, (i) => { const a = i * Math.PI / 3; cyl(g, 0.0085, 0.01, DARK, Math.cos(a) * 0.026, 0.01 + Math.sin(a) * 0.026, -0.117, 'z', { seg: 10 }); }); // Kammern
    cyl(g, 0.007, 0.22, MID, 0.0, -0.036, -0.27);                                                // Ausstoßerstange
    cyl(g, 0.012, 0.02, DARK, 0.0, -0.036, -0.385);                                              // Stangenkopf
    box(g, 0.004, 0.045, 0.05, DARK, 0.0385, 0.0, 0.035, { edge: null });                        // Ladeklappe
    box(g, 0.01, 0.035, 0.01, DARK, 0, -0.05, 0.02, { rx: 0.3, edge: null });                    // Abzug
    markAccent(cyl(g, 0.014, 0.004, RED, 0.032, -0.11, 0.105, 'x'), RED);                        // Griff-Medaillon
    markAccent(cyl(g, 0.014, 0.004, RED, -0.032, -0.11, 0.105, 'x'), RED);
    row(3, (i) => box(g, 0.062, 0.004, 0.09, DARK, 0, -0.07 - i * 0.04, 0.10 + i * 0.012, { rx: 0.3, edge: null })); // Griffrillen
    box(g, 0.03, 0.02, 0.05, MID, 0, -0.07, 0.04);                                               // Rahmen unter dem Abzug

    return [0, 0.035, -0.49];
}

// ---------- Messer: 6 Typen (Auswahl im Inventar). Spitze zeigt nach vorn (-z), Griff liegt um z = 0 ----------
// Klingen sind jetzt echte Profile (THREE.Shape -> ExtrudeGeometry) statt Boxen: so gibt es echte Krümmung, Bauch, Spitzen und Löcher.
// Profil-Koordinaten: x = Länge nach vorn, y = oben. Mit ry = +PI/2 wird x zu -z (nach vorn), die Dicke läuft entlang x.
function extrudeShape(g, shape, depth, color, x, y, z, { ry = Math.PI / 2, rx = 0, rz = 0, bevel = 0.0012, edge = 0xdde3ee, accent = false } = {}) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 20 });
    geo.translate(0, 0, -depth / 2);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.userData.body = true;
    m.userData.baseColor = color;
    if (edge !== null) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 32), edgeMat(edge)));
    g.add(m);
    return accent ? markAccent(m, color) : m;
}
// Punkt auf einer kubischen Bézierkurve (für Zähne/Kerben entlang einer Klingenkante)
function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
function bezTan(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
            3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1])];
}

function knifeCombat(g) {
    const STEEL = 0xb9c0cc, DARK = 0x15151b, MID = 0x2e2e3b, CYAN = 0x00f0ff;
    const s = new THREE.Shape();                                              // Drop-Point: gerader Rücken, runder Bauch
    s.moveTo(0, 0.032); s.lineTo(0.27, 0.032);
    s.bezierCurveTo(0.34, 0.032, 0.39, 0.016, 0.415, -0.006);
    s.bezierCurveTo(0.37, -0.034, 0.30, -0.036, 0.2, -0.032);
    s.lineTo(0, -0.03); s.closePath();
    extrudeShape(g, s, 0.011, STEEL, 0, 0.0, -0.095);
    const f = new THREE.Shape();                                              // Hohlschliff (Neon-Einlage)
    f.moveTo(0.03, 0.012); f.bezierCurveTo(0.14, 0.014, 0.26, 0.012, 0.34, 0.0); f.bezierCurveTo(0.24, -0.012, 0.12, -0.014, 0.03, -0.012); f.closePath();
    extrudeShape(g, f, 0.0135, CYAN, 0, 0.0, -0.095, { edge: null, bevel: 0, accent: true });
    box(g, 0.016, 0.012, 0.25, MID, 0, 0.036, -0.225, { edge: null });        // Rücken
    row(7, (i) => box(g, 0.018, 0.008, 0.012, DARK, 0, 0.0405, -0.14 - i * 0.03, { edge: null })); // Rückenzähne
    box(g, 0.05, 0.03, 0.016, DARK, 0, 0.0, -0.095, { edge: 0x4a4a5e });
    box(g, 0.03, 0.044, 0.15, DARK, 0, -0.004, -0.005, { edge: 0x4a4a5e });
    row(4, (i) => box(g, 0.032, 0.006, 0.01, MID, 0, -0.03, -0.06 + i * 0.035, { edge: null })); // Fingerrillen
    box(g, 0.034, 0.048, 0.02, MID, 0, -0.004, 0.08, { edge: null });
    return [0, 0, -0.5];
}

function knifeBayonet(g) {
    const STEEL = 0xc4cbd6, DARK = 0x15151b, MID = 0x2e2e3b, ORG = 0xff7a00;
    const s = new THREE.Shape();                                              // Clip-Point mit abfallender Spitze
    s.moveTo(0, 0.036); s.lineTo(0.27, 0.036);
    s.bezierCurveTo(0.35, 0.036, 0.41, 0.02, 0.45, -0.012);
    s.bezierCurveTo(0.39, -0.034, 0.30, -0.038, 0.2, -0.036);
    s.lineTo(0, -0.034); s.closePath();
    extrudeShape(g, s, 0.012, STEEL, 0, 0.0, -0.095);
    const f = new THREE.Shape();
    f.moveTo(0.03, 0.006); f.bezierCurveTo(0.14, 0.01, 0.26, 0.008, 0.36, -0.01); f.bezierCurveTo(0.26, -0.016, 0.14, -0.014, 0.03, -0.01); f.closePath();
    extrudeShape(g, f, 0.0145, ORG, 0, 0.0, -0.095, { edge: null, bevel: 0, accent: true });
    box(g, 0.014, 0.022, 0.14, MID, 0, 0.044, -0.36, { edge: null });
    row(8, (i) => box(g, 0.016, 0.014, 0.012, DARK, 0, 0.05, -0.12 - i * 0.025, { edge: null })); // Sägezähne
    box(g, 0.05, 0.03, 0.016, DARK, 0, 0.0, -0.095);
    torus(g, 0.016, 0.004, MID, 0, -0.025, -0.095, { seg: 14 });                                // Öse
    box(g, 0.032, 0.046, 0.15, DARK, 0, -0.004, -0.005);
    row(5, (i) => box(g, 0.034, 0.048, 0.008, MID, 0, -0.004, -0.06 + i * 0.027, { edge: null }));
    cyl(g, 0.026, 0.03, MID, 0, -0.004, 0.09, 'z');
    return [0, 0, -0.545];
}

// Karambit: echte Sichelklinge (Rücken außen, Schneide innen), Fingerring, Wicklung. Der ganze Körper hängt an einem Drehpunkt
// im Fingerring (userData.spin) - die Inspect-Animation wirbelt das Messer um den Ring.
function knifeKarambit(g) {
    const STEEL = 0xbfc6d2, DARK = 0x15151b, MID = 0x2e2e3b, MAG = 0xff2bd6;
    const RING = [0, -0.014, 0.12];
    const spin = new THREE.Group(); spin.position.set(RING[0], RING[1], RING[2]); spin.userData.spin = true;
    const h = new THREE.Group(); h.position.set(-RING[0], -RING[1], -RING[2]); spin.add(h); g.add(spin);

    // Klinge: P0 -> Spitze entlang des Rückens, zurück entlang der Schneide
    const S0 = [0, 0.03], S1 = [0.10, 0.034], S2 = [0.22, -0.02], S3 = [0.22, -0.17];
    const s = new THREE.Shape();
    s.moveTo(S0[0], S0[1]);
    s.bezierCurveTo(S1[0], S1[1], S2[0], S2[1], S3[0], S3[1]);
    s.lineTo(0.175, -0.245);                                                         // nadelfeine Spitze, nach hinten gebogen
    s.bezierCurveTo(0.17, -0.13, 0.11, -0.01, 0.0, -0.014);
    s.closePath();
    extrudeShape(h, s, 0.011, STEEL, 0, 0, -0.065, { bevel: 0.0013 });
    const f = new THREE.Shape();                                                      // Einlage entlang der Krümmung
    f.moveTo(0.02, 0.018); f.bezierCurveTo(0.10, 0.022, 0.205, -0.02, 0.205, -0.15);
    f.bezierCurveTo(0.185, -0.05, 0.10, 0.0, 0.02, 0.004); f.closePath();
    extrudeShape(h, f, 0.0135, MAG, 0, 0, -0.065, { edge: null, bevel: 0, accent: true });
    // Kerben auf dem Rücken
    row(5, (i) => {
        const t = 0.12 + i * 0.1, p = bez(S0, S1, S2, S3, t), tg = bezTan(S0, S1, S2, S3, t);
        box(h, 0.014, 0.01, 0.012, DARK, 0, p[1] + 0.003, -0.065 - p[0], { rx: Math.atan2(tg[1], tg[0]), edge: null });
    });
    // Griff (leicht gekrümmt nach hinten-unten) + Wicklung + Ring
    box(h, 0.028, 0.052, 0.13, DARK, 0, -0.002, 0.0);
    box(h, 0.026, 0.05, 0.05, DARK, 0, -0.012, 0.085, { rx: -0.35 });
    row(5, (i) => box(h, 0.03, 0.054, 0.007, MID, 0, -0.002, -0.045 + i * 0.026, { edge: null }));
    box(h, 0.034, 0.06, 0.016, MID, 0, 0.0, -0.062);                                // Zwinge
    torus(h, 0.036, 0.0075, MID, 0, -0.014, 0.12, { ry: Math.PI / 2, seg: 24 });      // Fingerring
    torus(h, 0.036, 0.0035, 0xbfc6d2, 0, -0.014, 0.12, { ry: Math.PI / 2, seg: 24 });
    neon(h, 0.004, 0.012, 0.09, MAG, 0.0145, 0.0, 0.0);
    neon(h, 0.004, 0.012, 0.09, MAG, -0.0145, 0.0, 0.0);
    return [0, -0.245, -0.24];
}

// Butterfly (Balisong): Klinge + zwei Griffhälften mit Lochung, die sich um den Drehpunkt klappen lassen.
// Die Griffhälften sind eigene Gruppen (userData.flip = 'A' / 'B'), die Inspect-Animation klappt sie auf.
function knifeButterfly(g) {
    const STEEL = 0xc4cbd6, DARK = 0x15151b, MID = 0x2e2e3b, YEL = 0xffcc00;
    const PZ = -0.05;                                                                // Drehpunkt (z)
    // Klinge (steht fest): Clip-Point mit Bauch, Daumenloch und Einlage
    const b = new THREE.Shape();
    b.moveTo(0, 0.02); b.lineTo(0.07, 0.027);
    b.bezierCurveTo(0.2, 0.036, 0.3, 0.022, 0.345, -0.014);
    b.bezierCurveTo(0.29, -0.034, 0.2, -0.032, 0.07, -0.027);
    b.lineTo(0, -0.02); b.closePath();
    const hole = new THREE.Path(); hole.absarc(0.085, 0.0, 0.0075, 0, Math.PI * 2, true); b.holes.push(hole);
    extrudeShape(g, b, 0.0095, STEEL, 0, 0, PZ, { bevel: 0.0011 });
    const f = new THREE.Shape();
    f.moveTo(0.12, 0.005); f.bezierCurveTo(0.2, 0.012, 0.28, 0.004, 0.32, -0.012); f.bezierCurveTo(0.26, -0.014, 0.19, -0.012, 0.12, -0.004); f.closePath();
    extrudeShape(g, f, 0.0118, YEL, 0, 0, PZ, { edge: null, bevel: 0, accent: true });
    box(g, 0.012, 0.014, 0.1, MID, 0, 0.03, PZ - 0.12, { edge: null });              // Rücken-Verstärkung
    cyl(g, 0.0065, 0.075, MID, 0, 0.0, PZ, 'x');                                     // Drehpunkt-Bolzen
    cyl(g, 0.0045, 0.082, 0xd8dee8, 0, 0.0, PZ, 'x');
    // Griffhälften
    for (const side of [1, -1]) {
        const grp = new THREE.Group(); grp.position.set(0, 0, PZ); grp.userData.flip = side > 0 ? 'A' : 'B'; g.add(grp);
        const p = new THREE.Shape();                                                 // Länge 0.215, abgerundete Enden, leicht taillierte Form
        p.moveTo(0.0, 0.016); p.lineTo(0.01, 0.0215);
        p.bezierCurveTo(0.08, 0.026, 0.15, 0.022, 0.2, 0.02);
        p.quadraticCurveTo(0.222, 0.018, 0.222, 0.0); p.quadraticCurveTo(0.222, -0.018, 0.2, -0.02);
        p.bezierCurveTo(0.15, -0.022, 0.08, -0.026, 0.01, -0.0215); p.lineTo(0.0, -0.016); p.closePath();
        for (const cx of [0.05, 0.1, 0.15]) {                                        // Lochung (Skeletonized)
            const o = new THREE.Path();
            o.absellipse(cx, 0, 0.0185, 0.0085, 0, Math.PI * 2, true); p.holes.push(o);
        }
        extrudeShape(grp, p, 0.0105, 0x20202a, side * 0.0165, 0, 0, { ry: -Math.PI / 2, bevel: 0.001, edge: 0x4a4a5e });
        neon(grp, 0.004, 0.005, 0.2, YEL, side * 0.0225, 0.0215, 0.11);
        row(4, (i) => box(grp, 0.014, 0.034, 0.006, MID, side * 0.0165, 0.0, 0.17 + i * 0.012, { edge: null }));
        box(grp, 0.012, 0.03, 0.016, MID, side * 0.0165, 0.0, 0.01);                // Verschluss am Drehpunkt
        cyl(grp, 0.0055, 0.014, 0xd8dee8, side * 0.0165, 0.0, 0.215, 'x');          // Endbolzen
    }
    return [0, 0, PZ - 0.345];
}

function knifeDagger(g) {
    const STEEL = 0xd0d6e0, DARK = 0x15151b, MID = 0x2e2e3b, GOLD = 0xd9a521, RED = 0xff3355;
    const s = new THREE.Shape();                                              // beidseitig geschliffen, schlanke Spitze
    s.moveTo(0, 0.027);
    s.bezierCurveTo(0.12, 0.027, 0.27, 0.017, 0.41, 0.0);
    s.bezierCurveTo(0.27, -0.017, 0.12, -0.027, 0, -0.027); s.closePath();
    extrudeShape(g, s, 0.011, STEEL, 0, 0, -0.105);
    box(g, 0.0135, 0.008, 0.34, 0xa8b0bd, 0, 0.0, -0.275, { edge: null });     // Mittelgrat
    markAccent(box(g, 0.004, 0.006, 0.2, RED, 0.007, 0.011, -0.25, { edge: null }), RED);
    markAccent(box(g, 0.004, 0.006, 0.2, RED, -0.007, 0.011, -0.25, { edge: null }), RED);
    markAccent(box(g, 0.004, 0.006, 0.2, RED, 0.007, -0.011, -0.25, { edge: null }), RED);
    markAccent(box(g, 0.004, 0.006, 0.2, RED, -0.007, -0.011, -0.25, { edge: null }), RED);
    box(g, 0.1, 0.022, 0.016, GOLD, 0, 0.0, -0.105);                                              // Parierstange
    box(g, 0.014, 0.034, 0.02, GOLD, 0.056, 0.0, -0.105);
    box(g, 0.014, 0.034, 0.02, GOLD, -0.056, 0.0, -0.105);
    box(g, 0.026, 0.034, 0.16, DARK, 0, 0.0, -0.015);
    row(8, (i) => box(g, 0.028, 0.036, 0.007, MID, 0, 0.0, -0.08 + i * 0.019, { edge: null }));   // Wicklung
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), mat(GOLD));
    knob.position.set(0, 0, 0.09); knob.userData.body = true; knob.userData.baseColor = GOLD; g.add(knob);
    return [0, 0, -0.515];
}

function knifeMachete(g) {
    const STEEL = 0xaab2bf, DARK = 0x15151b, MID = 0x2e2e3b, GRN = 0x39ff14;
    const s = new THREE.Shape();                                              // breite Klinge mit Bauch und abfallender Spitze
    s.moveTo(0, 0.045); s.lineTo(0.4, 0.045);
    s.bezierCurveTo(0.54, 0.05, 0.645, 0.024, 0.695, -0.038);
    s.bezierCurveTo(0.6, -0.086, 0.5, -0.07, 0.4, -0.06);
    s.lineTo(0, -0.055); s.closePath();
    extrudeShape(g, s, 0.012, STEEL, 0, 0.0, -0.115);
    const f = new THREE.Shape();
    f.moveTo(0.04, 0.012); f.lineTo(0.42, 0.012); f.bezierCurveTo(0.52, 0.012, 0.58, -0.004, 0.62, -0.03); f.bezierCurveTo(0.5, -0.03, 0.42, -0.026, 0.04, -0.024); f.closePath();
    extrudeShape(g, f, 0.0145, GRN, 0, 0.0, -0.115, { edge: null, bevel: 0, accent: true });
    box(g, 0.02, 0.016, 0.45, MID, 0, 0.05, -0.34, { edge: null });                               // dicker Rücken
    box(g, 0.06, 0.05, 0.016, DARK, 0, -0.01, -0.115);
    box(g, 0.034, 0.05, 0.19, DARK, 0, -0.005, -0.01);
    row(3, (i) => markAccent(cyl(g, 0.007, 0.04, GRN, 0, -0.005, -0.06 + i * 0.06, 'x'), GRN));    // Nieten
    box(g, 0.038, 0.058, 0.02, MID, 0, -0.005, 0.1);
    torus(g, 0.016, 0.003, MID, 0, -0.005, 0.12, { seg: 12 });
    return [0, -0.03, -0.81];
}

export const KNIFE_TYPES = [
    { id: 'combat',    name: 'Kampfmesser', build: knifeCombat },
    { id: 'bayonet',   name: 'Bajonett',    build: knifeBayonet },
    { id: 'karambit',  name: 'Karambit',    build: knifeKarambit },
    { id: 'butterfly', name: 'Butterfly',   build: knifeButterfly },
    { id: 'dagger',    name: 'Dolch',       build: knifeDagger },
    { id: 'machete',   name: 'Machete',     build: knifeMachete }
];
let knifeVariant = 0;
export const getKnifeVariant = () => knifeVariant;
// Setzt den Messertyp (für neu gebaute Modelle). Gibt true zurück, wenn er sich geändert hat.
export function setKnifeVariant(i) {
    const v = Number.isInteger(i) && i >= 0 && i < KNIFE_TYPES.length ? i : 0;
    if (v === knifeVariant) return false;
    knifeVariant = v;
    return true;
}
function buildKnifeModel(g) { return KNIFE_TYPES[knifeVariant].build(g); }

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
        aimFov: 18, aimPos: [0, -0.15, -0.40], aimSpeed: 7, aimMoveFactor: 0.5, scopeOverlay: true, drawTime: 0.60, unlockLevel: 1,
        buildModel: buildSniperModel
    },
    {
        name: 'SMG', damage: 11, fireCooldown: 0.055, automatic: true,
        magSize: 40, reserveAmmo: Infinity, reloadDuration: 1600, infiniteAmmo: false,
        color: 0x39ff14, tracerWidth: 0.022, tracerLife: 0.07, holeSize: 0.2,
        kick: 0.035, kickRot: 0.035,
        aimFov: 60, aimPos: [0, -0.16, -0.32], aimSpeed: 11, aimMoveFactor: 0.85, scopeOverlay: false, drawTime: 0.32, unlockLevel: 1,
        buildModel: buildSmgModel
    },
    {
        name: 'Shotgun', damage: 12, pellets: 8, spread: 0.05, fireCooldown: 0.85,
        magSize: 6, reserveAmmo: Infinity, reloadDuration: 2300, infiniteAmmo: false,
        color: 0xff7a00, tracerWidth: 0.02, tracerLife: 0.08, holeSize: 0.16,
        kick: 0.16, kickRot: 0.14,
        aimFov: 65, aimPos: [0, -0.13, -0.38], aimSpeed: 9, aimMoveFactor: 0.8, scopeOverlay: false, drawTime: 0.50, unlockLevel: 1,
        buildModel: buildShotgunModel
    },
    {
        name: 'Revolver', damage: 55, fireCooldown: 0.5,
        magSize: 6, reserveAmmo: Infinity, reloadDuration: 2100, infiniteAmmo: false,
        color: 0xff3355, tracerWidth: 0.045, tracerLife: 0.16, holeSize: 0.3,
        kick: 0.12, kickRot: 0.15,
        aimFov: 50, aimPos: [0, -0.098, -0.36], aimSpeed: 10, aimMoveFactor: 0.85, scopeOverlay: false, drawTime: 0.38, unlockLevel: 1,
        buildModel: buildRevolverModel
    },
    {
        // Nahkampf: man startet jede Runde nur damit (Slot 3). melee = Reichweite in Metern, kein Magazin, kein Zielen
        name: 'Knife', damage: 40, fireCooldown: 0.55, melee: 2.7,
        magSize: 1, reserveAmmo: Infinity, reloadDuration: 1000, infiniteAmmo: true,
        color: 0xffffff, tracerWidth: 0.01, tracerLife: 0.05, holeSize: 0.1,
        kick: -0.22, kickRot: -0.95, recoilDecay: 5.5,
        aimFov: 75, aimPos: [0.12, -0.2, -0.45], aimSpeed: 12, aimMoveFactor: 1, scopeOverlay: false, drawTime: 0.28, unlockLevel: 1,
        buildModel: buildKnifeModel
    }
];
export const KNIFE_INDEX = WEAPON_CONFIGS.length - 1;

// ---------- Einzelne Waffe ----------
const BASE_POS = new THREE.Vector3(0.3, -0.25, -0.5);
// Einstellungen für die Ego-Waffe (aus dem Einstellungsmenü): sichtbar, Linkshänder, Verschiebung, Größe
export const viewSettings = { visible: true, left: false, x: 0, y: 0, z: 0, scale: 1,
    crouch: 0, slide: 0 }; // crouch 0..1 (Duck-Fortschritt) und slide 0/1 kommen jeden Frame aus main.js
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const bump = (p, c, w) => Math.exp(-(((p - c) / w) ** 2)); // glockenförmiger Impuls um c
const _tmpColor = new THREE.Color();
// Posen-Folge auswerten: keys = [[p, x, y, z, rx, ry, rz], ...], dazwischen weich (smoothstep) -> Pose wird "gehalten", dann schwungvoll gewechselt
function sampleKeys(keys, p) {
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    const t = smooth01((p - a[0]) / (b[0] - a[0]));
    return [1, 2, 3, 4, 5, 6].map((j) => a[j] + (b[j] - a[j]) * t);
}

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
        this.melee = config.melee ?? 0;               // >0: Nahkampf (Reichweite in m)
        this.recoilDecay = config.recoilDecay ?? 10;
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
        this._inspectT = -1; this._inspectDur = 3; this._spinNode = null; this._flipA = null; this._flipB = null;
        this._reloadStart = 0; this._crouchPrev = 0; this._crouchVel = 0; this._slideBlend = 0;
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

        this.buildModel = config.buildModel;
        this.weaponGroup = new THREE.Group();
        const m = config.buildModel(this.weaponGroup);
        this._modelParts = this.weaponGroup.children.slice();
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

    // Modell neu bauen (Messertyp gewechselt): alte Teile entfernen, neues Modell + Mündungspunkt, Skin neu anwenden
    rebuildModel() {
        for (const o of this._modelParts) this.weaponGroup.remove(o);
        const tmp = new THREE.Group();
        const m = this.buildModel(tmp);
        this._modelParts = tmp.children.slice();
        for (const o of this._modelParts) this.weaponGroup.add(o);
        this.muzzle.position.set(m[0], m[1], m[2]);
        this.accentMeshes = [];
        this.weaponGroup.traverse((o) => { if (o.userData && o.userData.accent !== undefined) this.accentMeshes.push(o); });
        this.bodyMeshes = [];
        for (const part of this._modelParts) part.traverse((o) => {
            if (o.isMesh && o.userData && o.userData.body) {
                o.userData.baseMat = o.material;
                projectSkinUVs(o);
                this.bodyMeshes.push(o);
            }
        });
        this.setSkin(this.skin);
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
    // Waffe in Ruhe betrachten (Taste F): nicht beim Zielen, Nachladen, Ziehen oder direkt nach einem Schuss
    inspect() {
        if (this._inspectT >= 0 || this.isReloading || this.aimT > 0.05 || this.drawT < 1 || this.recoil > 0.05) return false;
        this._spinNode = this._flipA = this._flipB = null;
        this.weaponGroup.traverse((o) => {
            if (!o.userData) return;
            if (o.userData.spin) this._spinNode = o;
            if (o.userData.flip === 'A') this._flipA = o;
            if (o.userData.flip === 'B') this._flipB = o;
        });
        const id = this.melee ? KNIFE_TYPES[knifeVariant].id : '';
        this._inspectDur = id === 'butterfly' ? 4.8 : id === 'karambit' ? 4.4 : this.melee ? 4.0 : 3.8;
        this._inspectT = 0;
        return true;
    }
    startDraw() {
        this._inspectT = -1;
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
        this.flashTimer = this.melee ? 0 : 0.045;
        this.flash.rotation.z = Math.random() * Math.PI * 2; // jedes Mal anders gedreht
        const s = 0.8 + Math.random() * 0.5;
        this.flash.scale.set(s, s, s);
        this.flash.visible = !this.melee;

        return true;
    }

    reload() {
        if (this.infiniteAmmo) return;
        if (this.isReloading) return;
        if (this.ammoInMag === this.magSize) return;
        if (this.reserveAmmo <= 0) return;
        if (this.drawT < 0.75) return; // erst fertig ziehen

        this.isReloading = true;
        this._reloadStart = performance.now();
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
        this.recoil = Math.max(0, this.recoil - delta * this.recoilDecay);
        this.dryNudge = Math.max(0, this.dryNudge - delta * 14);
        const sinkTarget = this.isReloading ? 1 : 0;
        this.reloadSink += (sinkTarget - this.reloadSink) * Math.min(1, delta * 10);

        // Zielen: beim Nachladen nicht möglich; aimT läuft linear, aimE ist die geglättete Version
        const aimTarget = (this.aiming && !this.melee && !this.isReloading && this.drawT >= 0.75) ? 1 : 0;
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
        // Verschiebung/Spiegelung aus den Einstellungen; beim Zielen (e) zählt nur die Skalierung nicht mehr, damit das Visier mittig bleibt
        const vs = viewSettings, side = vs.left ? -1 : 1, off = 1 - e;

        // --- Nachlade-Animation (Fortschritt p 0..1): Waffe kippt zur Seite und nach unten, Magazin wird "gewechselt"
        // (Ruck bei 35 % = Magazin raus, Ruck bei 72 % = Magazin rein), danach zurück in Anschlag. Beim Zielen schwächer.
        let rY = 0, rX = 0, rZ = 0, rRX = 0, rRY = 0, rRZ = 0;
        if (this.isReloading && !this.melee) {
            const p = Math.min(1, (performance.now() - this._reloadStart) / this.reloadDuration);
            const env = smooth01(p / 0.22) * (1 - smooth01((p - 0.82) / 0.18));   // runter/kippen -> zurück
            const a = env * (1 - 0.6 * e);
            const out = bump(p, 0.36, 0.05), inn = bump(p, 0.72, 0.045);
            rY = -0.13 * a - 0.035 * out + 0.03 * inn;
            rX = -0.07 * a * side;
            rZ = 0.05 * inn + 0.02 * out;
            rRX = 0.32 * a - 0.18 * out + 0.22 * inn;
            rRY = 0.38 * a * side + 0.06 * Math.sin(p * 18) * a;
            rRZ = 0.5 * a * side + 0.08 * (out - inn) * side;
        }
        // --- Duck-/Slide-Animation: Waffe sinkt ab und rückt nach innen, hinkt beim Hinhocken/Aufstehen kurz hinterher;
        // beim Sliden kippt sie seitlich weg. Beim Zielen nur schwach (Visier bleibt nutzbar).
        const cr = vs.crouch, cvRaw = (cr - this._crouchPrev) / Math.max(delta, 0.001);
        this._crouchPrev = cr;
        this._crouchVel += (cvRaw - this._crouchVel) * Math.min(1, delta * 14);
        this._slideBlend += (vs.slide - this._slideBlend) * Math.min(1, delta * 9);
        const cw = 1 - 0.7 * e, sl = this._slideBlend * cw;
        const cY = -0.035 * cr * cw + this._crouchVel * 0.012 * cw - 0.02 * sl;
        const cX = -0.025 * cr * cw * side - 0.05 * sl * side;
        const cRX = this._crouchVel * 0.03 * cw + 0.05 * cr * cw;
        const cRZ = 0.1 * cr * cw * side + 0.42 * sl * side;
        const cRY = -0.25 * sl * side;

        // --- Inspect-Animation (Taste F): Waffe wird zur Mitte gehoben und von allen Seiten gezeigt. Abbruch bei Schuss/Zielen/Nachladen.
        let iX = 0, iY = 0, iZ = 0, iRX = 0, iRY = 0, iRZ = 0, spinA = 0, flipA = 0, flipB = 0;
        if (this._inspectT >= 0) {
            if (this.isReloading || this.aimT > 0.05 || this.drawT < 1 || this.recoil > 0.05) this._inspectT = -1;
            else {
                this._inspectT += delta / this._inspectDur;
                if (this._inspectT >= 1) this._inspectT = -1;
            }
        }
        if (this._inspectT >= 0) {
            // CS-Stil: Waffe wird zur Bildmitte gehoben und in Posen gezeigt (Pose halten, weich zur nächsten schwingen), dann zurück.
            // Jede Pose: [p, x, y, z, rx, ry, rz] - x/ry/rz werden für Linkshänder gespiegelt.
            const p = this._inspectT;
            const id = this.melee ? KNIFE_TYPES[knifeVariant].id : '';
            const sw = (a, b) => smooth01((p - a) / (b - a));
            const hover = Math.sin(p * 31) * 0.006 * Math.min(1, p * 8) * Math.min(1, (1 - p) * 8); // leichtes Zittern der Hand
            let k;
            if (id === 'karambit') {
                k = sampleKeys([[0, 0, 0, 0, 0, 0, 0], [0.14, -0.13, 0.07, 0.12, -0.2, -0.45, 0.35], [0.3, -0.13, 0.07, 0.14, -0.3, -0.35, 0.2],
                    [0.7, -0.13, 0.08, 0.14, -0.3, -0.35, 0.2], [0.82, -0.12, 0.06, 0.12, -0.15, -0.8, 0.5], [0.92, -0.08, 0.04, 0.06, 0.05, -0.55, 0.3], [1, 0, 0, 0, 0, 0, 0]], p);
                spinA = -Math.PI * 4 * sw(0.28, 0.66);                         // zwei Umdrehungen um den Fingerring
            } else if (id === 'butterfly') {
                k = sampleKeys([[0, 0, 0, 0, 0, 0, 0], [0.12, -0.1, 0.07, 0.1, -0.3, -0.5, 0.3], [0.2, -0.1, 0.07, 0.1, -0.3, -0.5, 0.3],
                    [0.76, -0.11, 0.08, 0.12, -0.35, -0.4, 0.25], [0.88, -0.1, 0.07, 0.1, -0.2, -0.9, 0.6], [0.95, -0.05, 0.03, 0.05, 0, -0.5, 0.3], [1, 0, 0, 0, 0, 0, 0]], p);
                flipA = Math.PI * 2 * sw(0.2, 0.42) + Math.PI * 2 * sw(0.52, 0.72);       // Griffhälften klappen auf und zu
                flipB = -Math.PI * 2 * sw(0.28, 0.5) - Math.PI * 2 * sw(0.52, 0.72);
            } else if (this.melee) {
                k = sampleKeys([[0, 0, 0, 0, 0, 0, 0], [0.14, -0.1, 0.06, 0.1, 0.4, -0.75, 0.8], [0.36, -0.12, 0.07, 0.12, 0.45, -0.95, 0.8],
                    [0.62, -0.1, 0.06, 0.1, 0.35, -0.7, 0.8 + Math.PI], [0.82, -0.12, 0.07, 0.12, 0.4, -0.95, 0.8 + Math.PI], [1, 0, 0, 0, 0, 0, Math.PI * 2]], p);
            } else if (this.name === 'Pistol' || this.name === 'Revolver') {
                k = sampleKeys([[0, 0, 0, 0, 0, 0, 0], [0.15, -0.12, 0.08, 0.1, 0.3, -0.7, 0.55], [0.4, -0.13, 0.09, 0.12, 0.35, -1.05, 0.9],
                    [0.58, -0.1, 0.08, 0.1, 0.2, 0.45, -0.55], [0.8, -0.11, 0.09, 0.11, 0.3, 0.9, -0.8], [1, 0, 0, 0, 0, 0, 0]], p);
            } else {
                const big = this.name === 'Sniper' || this.name === 'Shotgun' ? 0.85 : 1;                    // lange Waffen: etwas weniger Ausschlag
                k = sampleKeys([[0, 0, 0, 0, 0, 0, 0], [0.16, -0.1, 0.05, 0.07, 0.2, -0.6, 0.45], [0.42, -0.12, 0.07, 0.09, 0.28, -1.0 * big, 0.3],
                    [0.58, -0.09, 0.05, 0.06, 0.15, 0.5, -0.45], [0.8, -0.1, 0.06, 0.08, 0.3, 0.85 * big, -0.3], [1, 0, 0, 0, 0, 0, 0]], p);
            }
            iX = k[0] * 2.5 * side; iY = k[1] * 1.7 + hover; iZ = k[2] * 1.2;   // Waffe liegt rechts im Bild: hier in die Bildmitte holen iRX = k[3] + hover * 2; iRY = k[4] * side; iRZ = k[5] * side;
        }
        if (this._spinNode) this._spinNode.rotation.x = spinA;
        if (this._flipA) this._flipA.rotation.x = flipA;
        if (this._flipB) this._flipB.rotation.x = flipB;

        this.weaponGroup.position.set(
            side * (BASE_POS.x + (this.aimPos.x - BASE_POS.x) * e) + vs.x * off + this.dryNudge * 0.02 + d * 0.14 * side + rX + cX + iX,
            BASE_POS.y + (this.aimPos.y - BASE_POS.y) * e + vs.y * off + rY + cY + iY - d * 0.40,
            BASE_POS.z + (this.aimPos.z - BASE_POS.z) * e + vs.z * off + k * this.kick + d * 0.08 + rZ + iZ
        );
        const sc = 1 + (vs.scale - 1) * off;
        this.weaponGroup.scale.set(sc * side, sc, sc);
        this.weaponGroup.rotation.x = k * this.kickRot + rRX + cRX + iRX - d * 0.95;
        this.weaponGroup.rotation.y = rRY + cRY + iRY;
        this.weaponGroup.rotation.z = d * 0.45 * side + rRZ + cRZ + iRZ;

        // Zielfernrohr-Ansicht: Waffenmodell ausblenden, sobald fast voll gezoomt (dann zeigt das Overlay das Rohr)
        if (this.active) this.weaponGroup.visible = viewSettings.visible && !(this.scopeOverlay && this.aimT > 0.9);

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
        this.activeIndex = KNIFE_INDEX;
        this.loadout = [0, 1]; // Indizes der zwei gewählten Waffen (Tasten 1 und 2), gilt erst wenn armed (Kaufmenü, Taste B)
        this.armed = false;    // false = nur das Messer
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
    rebuildKnife() { this.weapons[KNIFE_INDEX].rebuildModel(); }
    // Eigener Skin pro Waffe: Array mit einem Skin-Objekt pro Waffenindex
    setSkins(skinList) { this.weapons.forEach((w, i) => w.setSkin(skinList[i] || null)); }

    // ---- Loadout: nur 2 Waffen gleichzeitig ----
    isEquipped(i) { return i === KNIFE_INDEX || (this.armed && this.loadout.includes(i)); }
    get slot() { return this.activeIndex === KNIFE_INDEX ? 2 : Math.max(0, this.loadout.indexOf(this.activeIndex)); }
    // Nur Messer (Spawn ohne Kauf)
    disarm() {
        this.armed = false;
        this.switchTo(KNIFE_INDEX, true);
        this._notify();
    }

    // Neue Auswahl übernehmen (der Aufrufer ruft das nur beim Spawn auf). Gibt false zurück, wenn die Auswahl ungültig ist
    // (gleiche Waffe zweimal, außerhalb des Bereichs oder noch nicht freigeschaltet) - dann bleibt alles wie es war.
    setLoadout(pair) {
        if (!Array.isArray(pair) || pair.length !== 2) return false;
        const [a, b] = pair;
        const ok = (i) => Number.isInteger(i) && i >= 0 && i < this.weapons.length && this.weapons[i].unlocked;
        if (a === b || !ok(a) || !ok(b)) return false;
        this.loadout = [a, b];
        this.armed = true;
        this.weapons[a].refill(); this.weapons[b].refill();   // frisch gekauft: volle Magazine
        this.switchTo(a, true);                              // Primärwaffe ziehen
        this._notify();
        return true;
    }

    // Taste 1/2: Slot wählen
    switchToSlot(slot) {
        if (slot === 2) { this.switchTo(KNIFE_INDEX, true); return; }
        if (!this.armed) return;
        const i = this.loadout[slot];
        if (i !== undefined) this.switchTo(i);
    }

    // Zielen (Rechtsklick): setAiming(true/false). aimAmount = 0..1 (geglättet) für FOV-Zoom im Frame-Loop.
    setAiming(on) { this._aimWanted = !!on; this.current.aiming = this._aimWanted; }
    get aimWanted() { return this._aimWanted; }
    get aimAmount() { return this.current.aimE; }
    get aimFov() { return this.current.aimFov; }
    get aimMoveFactor() { return this.current.aimMoveFactor; }
    get scopeVisible() { return this.current.scopeOverlay && this.current.aimT > 0.9; }

    shoot() { return this.current.shoot(); }
    reload() { this.current.reload(); }
    inspect() { return this.current.inspect(); }
    refillAll() {
        this.weapons.forEach(w => w.refill());
        this.current.startDraw(); // nach dem Respawn: Waffe wieder ziehen
    }
    update(delta) { this.current.update(delta); }
    getMuzzleWorldPosition(out) { return this.current.getMuzzleWorldPosition(out); }

    switchTo(index, force = false) {
        if (index < 0 || index >= this.weapons.length || index === this.activeIndex) return;
        if (!this.weapons[index].unlocked) return; // noch nicht freigeschaltet
        if (!force && index !== KNIFE_INDEX && !(this.armed && this.loadout.includes(index))) return; // nur gekaufte Waffen + Messer
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
        if (!this.armed) return;
        this.switchToSlot(this.activeIndex === this.loadout[0] ? 1 : 0); // Touch/Zyklus: wechselt zwischen den beiden gekauften Waffen
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

// ---------- Vorschau-Modell fürs Inventar ----------
// Baut ein eigenständiges Waffenmodell (ohne Kamera/Munition) und kann einen Skin darauf anwenden - genau wie Weapon.setSkin.
export function buildPreviewWeapon(index) {
    const cfg = WEAPON_CONFIGS[index];
    const group = new THREE.Group();
    cfg.buildModel(group);
    const accentMeshes = [], bodyMeshes = [];
    group.traverse((o) => { if (o.userData && o.userData.accent !== undefined) accentMeshes.push(o); });
    group.traverse((o) => {
        if (o.isMesh && o.userData && o.userData.body) {
            o.userData.baseMat = o.material;
            projectSkinUVs(o);
            bodyMeshes.push(o);
        }
    });
    const recolor = (hexOrNull) => { for (const m of accentMeshes) m.material.color.setHex(hexOrNull ?? m.userData.accent); };
    return {
        group,
        rainbow: false,
        setSkin(skin) {
            this.rainbow = !!(skin && skin.rainbow);
            recolor(skin ? (skin.accent ?? null) : null);
            const patterned = !!(skin && skin.pattern);
            for (const m of bodyMeshes) m.material = patterned ? weaponSkinMaterial(skin, shadeForColor(m.userData.baseColor)) : m.userData.baseMat;
        },
        setAccent: recolor
    };
}
