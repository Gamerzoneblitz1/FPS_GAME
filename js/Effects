// effects.js — Schuss-Effekte: Neon-Tracer, Einschlags-Decals (Bullet Holes) und Funken.
// Alles ist GEPOOLT (feste Anzahl vorab erzeugter Objekte, Ringpuffer) -> pro Schuss entstehen keine
// neuen Geometrien/Materialien, das vermeidet Ruckler und Speicherlecks. Benötigt THREE global (r128).

const MAX_TRACERS = 32;
const MAX_HOLES = 180;
const MAX_SPARKS = 24;

let scene = null;
let initialized = false;

// --- Tracer ---
const tracers = [];
let tracerIdx = 0;

// --- Bullet Holes (ein InstancedMesh = ein Draw-Call für alle Löcher) ---
let holes = null;
let holeIdx = 0;

// --- Einschlagsfunken ---
const sparks = [];
let sparkIdx = 0;

// Wiederverwendete Hilfsobjekte (keine Allokation pro Schuss)
const _Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _n = new THREE.Vector3();
const _color = new THREE.Color();
const _white = new THREE.Color(0xffffff);

// Textur für Bullet Hole: schwarzer Kern (bleibt beim Einfärben schwarz) + heller Ring (wird zur
// Waffenfarbe) + weicher Glow nach außen. Instanzfarbe multipliziert sich mit der Textur.
function makeHoleTexture() {
    const s = 128, c = s / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');

    const glow = g.createRadialGradient(c, c, s * 0.14, c, c, s * 0.5);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)');
    glow.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);

    // dunkler Kern = das eigentliche Loch
    const core = g.createRadialGradient(c, c, 0, c, c, s * 0.16);
    core.addColorStop(0, 'rgba(0,0,0,1)');
    core.addColorStop(0.75, 'rgba(0,0,0,0.95)');
    core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);

    // ein paar kurze Risse/Splitter, damit es nicht wie ein perfekter Kreis aussieht
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + (i % 2) * 0.3;
        const r0 = s * 0.17, r1 = s * (0.26 + (i % 3) * 0.04);
        g.beginPath();
        g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
        g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
        g.stroke();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
}

function makeSparkTexture() {
    const s = 64, c = s / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
}

export function initEffects(sceneRef) {
    if (initialized) return;
    scene = sceneRef;
    initialized = true;

    // Tracer: Kern (dünn, fast weiß) + Glow (dicker, Waffenfarbe), beide additiv geblendet.
    // Beide Boxen sind entlang +Z lang; group.lookAt(ende) richtet sie aus.
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
        const group = new THREE.Group();
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
        const core = new THREE.Mesh(boxGeo, coreMat);
        const glow = new THREE.Mesh(boxGeo, glowMat);
        core.frustumCulled = glow.frustumCulled = false;
        group.add(core, glow);
        group.visible = false;
        scene.add(group);
        tracers.push({ group, core, glow, coreMat, glowMat, age: 0, life: 0.1, width: 0.03, active: false });
    }

    // Bullet Holes
    const holeMat = new THREE.MeshBasicMaterial({
        map: makeHoleTexture(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide
    });
    holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, MAX_HOLES);
    holes.frustumCulled = false;
    _scale.set(0, 0, 0);
    for (let i = 0; i < MAX_HOLES; i++) {
        _m.compose(_pos.set(0, -9999, 0), _q.identity(), _scale);
        holes.setMatrixAt(i, _m);
        holes.setColorAt(i, _white); // instanceColor muss VOR dem ersten Render existieren
    }
    holes.instanceMatrix.needsUpdate = true;
    holes.instanceColor.needsUpdate = true;
    scene.add(holes);

    // Funken (Sprites sind immer zur Kamera gedreht)
    const sparkTex = makeSparkTexture();
    for (let i = 0; i < MAX_SPARKS; i++) {
        const mat = new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const sprite = new THREE.Sprite(mat);
        sprite.visible = false;
        scene.add(sprite);
        sparks.push({ sprite, mat, age: 0, life: 0.14, size: 0.5, active: false });
    }
}

// Tracer von start nach end. width/life pro Waffe (Sniper: dicker + länger sichtbar).
export function createTracer(startPos, endPos, colorHex = 0xffcc00, width = 0.03, life = 0.1) {
    if (!initialized) return;
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % MAX_TRACERS;

    _dir.set(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
    const len = _dir.length();
    if (len < 0.01) return;

    _mid.set(startPos.x, startPos.y, startPos.z).addScaledVector(_dir, 0.5);
    t.group.position.copy(_mid);
    t.group.lookAt(endPos.x, endPos.y, endPos.z);
    t.len = len;
    t.width = width;
    t.life = life;
    t.age = 0;
    t.active = true;

    _color.setHex(colorHex);
    t.glowMat.color.copy(_color);
    t.coreMat.color.copy(_color).lerp(_white, 0.7);
    t.group.visible = true;
    _applyTracerLook(t, 0);
}

function _applyTracerLook(t, k) {
    // k = 0..1 (Lebensfortschritt): Linie wird dünner und blasser
    const fade = 1 - k;
    const w = t.width * (0.35 + 0.65 * fade);
    t.core.scale.set(w * 0.45, w * 0.45, t.len);
    t.glow.scale.set(w * 2.2, w * 2.2, t.len);
    t.coreMat.opacity = fade;
    t.glowMat.opacity = 0.55 * fade;
}

// Funke an einem Einschlagspunkt (Wand ODER Spieler)
export function spawnImpactSpark(point, colorHex = 0xffffff, size = 0.5) {
    if (!initialized) return;
    const s = sparks[sparkIdx];
    sparkIdx = (sparkIdx + 1) % MAX_SPARKS;
    s.sprite.position.set(point.x, point.y, point.z);
    s.mat.color.setHex(colorHex);
    s.size = size;
    s.age = 0;
    s.active = true;
    s.sprite.visible = true;
    s.sprite.scale.setScalar(size * 0.3);
    s.mat.opacity = 1;
}

// Bullet Hole: Plane an Einschlagspunkt, entlang der Flächennormale ausgerichtet (leicht davor, gegen
// Z-Fighting), zufällig gedreht und in der Waffenfarbe. Ringpuffer: das älteste Loch wird überschrieben.
export function addBulletHole(point, normal, colorHex = 0x00f0ff, size = 0.3) {
    if (!initialized || !normal) return;
    _n.set(normal.x, normal.y, normal.z);
    if (_n.lengthSq() < 1e-6) return;
    _n.normalize();

    _pos.set(point.x, point.y, point.z).addScaledVector(_n, 0.03);
    _q.setFromUnitVectors(_Z, _n);
    _roll.setFromAxisAngle(_Z, Math.random() * Math.PI * 2);
    _q.multiply(_roll);
    const s = size * (0.8 + Math.random() * 0.4);
    _scale.set(s, s, s);
    _m.compose(_pos, _q, _scale);

    holes.setMatrixAt(holeIdx, _m);
    holes.setColorAt(holeIdx, _color.setHex(colorHex));
    holes.instanceMatrix.needsUpdate = true;
    holes.instanceColor.needsUpdate = true;
    holeIdx = (holeIdx + 1) % MAX_HOLES;
}

// Pro Frame aufrufen (delta in Sekunden)
export function updateEffects(delta) {
    if (!initialized) return;

    for (let i = 0; i < tracers.length; i++) {
        const t = tracers[i];
        if (!t.active) continue;
        t.age += delta;
        const k = t.age / t.life;
        if (k >= 1) { t.active = false; t.group.visible = false; continue; }
        _applyTracerLook(t, k);
    }

    for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];
        if (!s.active) continue;
        s.age += delta;
        const k = s.age / s.life;
        if (k >= 1) { s.active = false; s.sprite.visible = false; continue; }
        s.sprite.scale.setScalar(s.size * (0.3 + 0.9 * k)); // expandiert
        s.mat.opacity = 1 - k;                              // und verblasst
    }
}
