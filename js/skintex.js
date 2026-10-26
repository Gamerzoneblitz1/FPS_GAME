// skintex.js — erzeugt die Muster für Waffen- und Charakter-Skins komplett im Code (keine Bilddateien).
// Jedes Muster ist 256x256 Pixel groß und NAHTLOS kachelbar (Rauschen und Linien laufen an den Rändern
// um), damit es sich über die ganze Waffe wiederholen kann wie bei CS2-Skins.
//
// generatePixels() ist reine Mathematik (ohne THREE/DOM) und dadurch testbar; die Funktionen darunter
// machen daraus Canvas-Texturen und Materialien (benötigen THREE global, r128).

const S = 256;
const WEAPON_TILE = 0.30; // Meter: nach so viel Waffenlänge wiederholt sich das Muster

// ---------- Mathe-Helfer ----------
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Farbverlauf über mehrere Stützfarben (t = 0..1)
function ramp(stops, t) {
    t = clamp01(t);
    const n = stops.length - 1;
    const f = t * n;
    const i = Math.min(n - 1, Math.floor(f));
    return mix(stops[i], stops[i + 1], f - i);
}

// Kachelbares Value-Noise: x,y in [0,1), "cells" Gitterzellen pro Kachel (Index läuft um)
function makeNoise(rand, cells) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return (x, y) => {
        const fx = x * cells, fy = y * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const x0 = ((ix % cells) + cells) % cells, x1 = (x0 + 1) % cells;
        const y0 = ((iy % cells) + cells) % cells, y1 = (y0 + 1) % cells;
        const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
}
// Mehrere Oktaven übereinander (fein + grob)
function fbm(rand, baseCells, octaves) {
    const ns = [];
    for (let o = 0; o < octaves; o++) ns.push(makeNoise(rand, baseCells * (1 << o)));
    return (x, y) => {
        let amp = 0.5, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) { sum += amp * ns[o](x, y); norm += amp; amp *= 0.5; }
        return sum / norm;
    };
}

// Kleine Pixel-Fläche mit Umlauf an den Rändern (für Linien/Punkte, die über die Kante laufen dürfen)
class Raster {
    constructor() { this.d = new Uint8ClampedArray(S * S * 4); }
    set(x, y, c) {
        const i = (y * S + x) * 4;
        this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
    }
    blend(x, y, c, a) {
        x = ((Math.round(x) % S) + S) % S; y = ((Math.round(y) % S) + S) % S;
        const i = (y * S + x) * 4;
        this.d[i] += (c[0] - this.d[i]) * a;
        this.d[i + 1] += (c[1] - this.d[i + 1]) * a;
        this.d[i + 2] += (c[2] - this.d[i + 2]) * a;
        this.d[i + 3] = 255;
    }
    disk(cx, cy, r, c, a = 1) {
        const R = Math.ceil(r);
        for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
            const dd = Math.sqrt(x * x + y * y);
            if (dd <= r) this.blend(cx + x, cy + y, c, a * (r - dd < 1 ? r - dd : 1));
        }
    }
    line(x0, y0, x1, y1, w, c, a = 1) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(len * 1.5));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            this.disk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
        }
    }
}

// ---------- Muster ----------

// Carbon: Köperbindung (abwechselnd waagerecht/senkrecht glänzende Fasern)
function carbon(colors) {
    const dark = hex(colors[0]), light = hex(colors[1]);
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (x >> 4), j = (y >> 4);
        const u = (x & 15) / 16, v = (y & 15) / 16;
        const horiz = ((i + j) & 1) === 0;
        let t = Math.sin(Math.PI * (horiz ? u : v));
        t *= 0.72 + 0.28 * (((x + y) & 3) < 2 ? 1 : 0.6); // feine Faserstruktur
        if (u < 0.07 || v < 0.07) t *= 0.25;               // dunkle Fugen zwischen den Fasern
        r.set(x, y, mix(dark, light, t * 0.9));
    }
    return r.d;
}

// Digitales Camouflage: grob gepixelte Flecken in 4 Farben
function camo(colors, rand) {
    const cs = colors.map(hex);
    const n = fbm(rand, 5, 3);
    const r = new Raster();
    const cell = 8;
    for (let cy = 0; cy < S / cell; cy++) for (let cx = 0; cx < S / cell; cx++) {
        const v = n((cx + 0.5) / (S / cell), (cy + 0.5) / (S / cell)) + (rand() - 0.5) * 0.07;
        const idx = Math.min(cs.length - 1, Math.floor(clamp01((v - 0.28) / 0.44) * cs.length));
        for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) r.set(cx * cell + x, cy * cell + y, cs[idx]);
    }
    return r.d;
}

// Nebel/Galaxie mit Sternen
function nebula(colors, rand) {
    const cs = colors.map(hex);
    const n1 = fbm(rand, 3, 4), n2 = fbm(rand, 4, 4);
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n1(u, v);
        let c = ramp(cs, clamp01((a - 0.25) / 0.5));
        const w = Math.max(0, n2(u, v) - 0.52) * 2.4;       // helle Schleier
        c = mix(c, cs[cs.length - 1], clamp01(w));
        r.set(x, y, c);
    }
    for (let i = 0; i < 110; i++) {                        // Sterne
        const x = rand() * S, y = rand() * S, big = rand() > 0.92;
        r.disk(x, y, big ? 1.6 : 0.8, [255, 255, 255], big ? 1 : 0.8);
        if (big) r.disk(x, y, 4.5, cs[cs.length - 1], 0.28);
    }
    return r.d;
}

// Gold: gebürstetes Metall mit weichen Glanzbändern
function gold(colors, rand) {
    const cs = colors.map(hex);
    const rowNoise = new Float32Array(S);
    for (let y = 0; y < S; y++) rowNoise[y] = rand();
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let v = 0.58
            + 0.17 * Math.sin(2 * Math.PI * (3 * y) / S)
            + 0.10 * Math.sin(2 * Math.PI * (7 * y) / S + 1.3)
            + 0.09 * Math.sin(2 * Math.PI * (x + 2 * y) / S)           // diagonaler Glanz
            + (rowNoise[y] - 0.5) * 0.16;                               // Bürstenstreifen
        r.set(x, y, ramp(cs, v));
    }
    return r.d;
}

// Hyper: diagonale Regenbogenbänder (wird in der Waffe langsam verschoben)
function hyper() {
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const t = (x + y) / S * 2 + 0.08 * Math.sin(2 * Math.PI * 2 * y / S);
        const h = (((t % 1) + 1) % 1);
        const l = 0.52 + 0.1 * Math.sin(2 * Math.PI * 8 * (x - y) / S);
        // HSL -> RGB (Sättigung 1)
        const a = Math.min(l, 1 - l);
        const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        r.set(x, y, [f(0) * 255, f(8) * 255, f(4) * 255]);
    }
    return r.d;
}

// Platine mit leuchtenden Leiterbahnen
function circuit(colors, rand) {
    const cs = colors.map(hex);
    const r = new Raster();
    r.d.fill(255);
    for (let i = 0; i < S * S; i++) { const c = cs[0]; r.d[i * 4] = c[0]; r.d[i * 4 + 1] = c[1]; r.d[i * 4 + 2] = c[2]; }
    const GRID = 16;
    const path = (col, w, count, a) => {
        for (let p = 0; p < count; p++) {
            let x = Math.floor(rand() * (S / GRID)) * GRID, y = Math.floor(rand() * (S / GRID)) * GRID;
            let dir = rand() > 0.5 ? 0 : 1, segs = 2 + Math.floor(rand() * 4);
            for (let s = 0; s < segs; s++) {
                const len = (2 + Math.floor(rand() * 4)) * GRID;
                const dx = dir === 0 ? len : 0, dy = dir === 1 ? len : 0;
                r.line(x, y, x + dx, y + dy, w + 3, col, a * 0.18);   // Schimmer um die Bahn
                r.line(x, y, x + dx, y + dy, w, col, a);
                x += dx; y += dy;
                if (rand() > 0.55) {                                    // 45°-Knick
                    const k = GRID * (1 + Math.floor(rand() * 2)), sx = rand() > 0.5 ? 1 : -1;
                    r.line(x, y, x + sx * k, y + k, w, col, a);
                    x += sx * k; y += k;
                }
                dir = 1 - dir;
            }
            r.disk(x, y, 4.5, col, a);                                  // Lötpunkt
            r.disk(x, y, 2, cs[0], 1);
        }
    };
    path(cs[2], 2, 26, 0.75);  // dunkle, breite Nebenbahnen
    path(cs[1], 2, 16, 1);     // helle Hauptbahnen
    for (let i = 0; i < 24; i++) {                                      // kleine Chips
        const x = Math.floor(rand() * (S / GRID)) * GRID, y = Math.floor(rand() * (S / GRID)) * GRID;
        for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 14; xx++) r.blend(x + xx, y + yy, cs[2], 0.9);
        for (let q = 0; q < 4; q++) r.blend(x + 2 + q * 3, y - 1, cs[1], 1);
    }
    return r.d;
}

// Frost: Eis mit weißen Rissen und Reif
function frost(colors, rand) {
    const cs = colors.map(hex);
    const n = fbm(rand, 4, 4), n2 = fbm(rand, 8, 3);
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        let c = ramp(cs, clamp01((n(u, v) - 0.12) / 0.6));
        const rime = smooth(0.62, 0.8, n2(u, v));                     // weißer Reif
        c = mix(c, cs[cs.length - 1], rime * 0.7);
        r.set(x, y, c);
    }
    for (let i = 0; i < 18; i++) {                                     // Risse
        let x = rand() * S, y = rand() * S, a = rand() * Math.PI * 2;
        for (let s = 0; s < 6; s++) {
            const l = 10 + rand() * 18;
            const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
            r.line(x, y, nx, ny, 1.2, [255, 255, 255], 0.8);
            if (rand() > 0.6) r.line(x, y, x + Math.cos(a + 1) * l * 0.6, y + Math.sin(a + 1) * l * 0.6, 0.9, [255, 255, 255], 0.6);
            x = nx; y = ny; a += (rand() - 0.5) * 0.9;
        }
    }
    for (let i = 0; i < 160; i++) r.disk(rand() * S, rand() * S, 0.7, [255, 255, 255], 0.8); // Glitzer
    return r.d;
}

// Magma: dunkles Gestein mit glühenden Rissen
function magma(colors, rand) {
    const cs = colors.map(hex); // [Gestein, Glut, heiß]
    const n = fbm(rand, 4, 4), n2 = fbm(rand, 6, 3);
    const r = new Raster();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const ridge = 1 - Math.abs(2 * n(u, v) - 1);                 // Maximum dort, wo das Rauschen 0.5 kreuzt = Rissverlauf
        const core = smooth(0.90, 0.985, ridge);                      // heißer Kern
        const glow = smooth(0.74, 0.93, ridge);                       // Glut drumherum
        const rock = mix([cs[0][0] * 0.6, cs[0][1] * 0.6, cs[0][2] * 0.6], mix(cs[0], cs[1], 0.12), n2(u, v));
        let c = mix(rock, cs[1], glow * 0.85);
        c = mix(c, cs[2], core);
        r.set(x, y, c);
    }
    return r.d;
}

const PATTERNS = { carbon, camo, nebula, gold, hyper, circuit, frost, magma };

// Reine Pixel-Erzeugung: gibt S*S*4 RGBA-Bytes zurück
export function generatePixels(pattern, colors, seed) {
    const fn = PATTERNS[pattern];
    if (!fn) return null;
    return fn(colors || [], mulberry32(seed || 1));
}
export const TEXTURE_SIZE = S;

// ---------- Canvas / THREE ----------
const canvasCache = new Map();
function getCanvas(skin) {
    if (canvasCache.has(skin.id)) return canvasCache.get(skin.id);
    const px = generatePixels(skin.pattern, skin.colors, skin.id * 7919 + 13);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    cv.getContext('2d').putImageData(new ImageData(px, S, S), 0, 0);
    canvasCache.set(skin.id, cv);
    return cv;
}

const texCache = new Map(); // "id|kind" -> { tex, skin }
function getTexture(skin, kind) {
    const key = skin.id + '|' + kind;
    if (texCache.has(key)) return texCache.get(key).tex;
    const tex = new THREE.CanvasTexture(getCanvas(skin));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    if (kind === 'weapon') tex.repeat.set(1 / WEAPON_TILE, 1 / WEAPON_TILE); // UVs der Waffe sind in Metern
    texCache.set(key, { tex, skin });
    return tex;
}

// Wie hell ein Teil im Skin erscheint: dunkle Originalteile (Lauf) bleiben dunkler als helle (Gehäuse),
// so behält die Waffe Tiefe. shade 0..1 -> bucketed.
export function shadeForColor(color) {
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return Math.round(Math.min(1, Math.max(0.6, 0.6 + lum * 2.2)) * 10) / 10;
}

const matCache = new Map();
function skinMaterial(skin, kind, shade) {
    const key = skin.id + '|' + kind + '|' + shade;
    if (!matCache.has(key)) {
        matCache.set(key, new THREE.MeshBasicMaterial({ map: getTexture(skin, kind), color: new THREE.Color(shade, shade, shade) }));
    }
    return matCache.get(key);
}
export const weaponSkinMaterial = (skin, shade) => skinMaterial(skin, 'weapon', shade);
export const playerSkinMaterial = (skin, shade) => skinMaterial(skin, 'player', shade);

// Vorschaubild fürs Menü (CSS-URL)
const previewCache = new Map();
export function getSkinPreview(skin) {
    if (!skin.pattern) return null;
    if (previewCache.has(skin.id)) return previewCache.get(skin.id);
    const cv = document.createElement('canvas');
    cv.width = 120; cv.height = 44;
    const g = cv.getContext('2d');
    const src = getCanvas(skin);
    for (let x = 0; x < 120; x += 60) g.drawImage(src, 0, 0, 128, 44, x, 0, 60, 44);
    const url = `url(${cv.toDataURL()})`;
    previewCache.set(skin.id, url);
    return url;
}

// Pro Frame: bewegte Muster (Rainbow) verschieben. Wird von der aktiven Waffe aufgerufen.
export function scrollSkinTextures(delta) {
    for (const { tex, skin } of texCache.values()) {
        if (!skin.scroll) continue;
        tex.offset.x = (tex.offset.x + delta * skin.scroll[0]) % 1;
        tex.offset.y = (tex.offset.y + delta * skin.scroll[1]) % 1;
    }
}
