// audio.js — alle Sounds werden live per Web Audio API synthetisiert (keine Audiodateien nötig,
// nichts zum Hochladen/Laden). Browser erlauben Audio erst nach einer Nutzeraktion: der Kontext
// wird deshalb beim ersten Klick/Tastendruck erzeugt bzw. fortgesetzt (initAudio()).
//
// Lautstärke + Stumm werden in localStorage gespeichert ('nv_audio').

const STORE_KEY = 'nv_audio';

let ctx = null;
let master = null;
let noiseBuf = null;
let volume = 0.7;
let muted = false;

try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) {
        if (Number.isFinite(saved.volume)) volume = Math.min(1, Math.max(0, saved.volume));
        muted = !!saved.muted;
    }
} catch (e) { /* kein localStorage -> Standardwerte */ }

function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ volume, muted })); } catch (e) { /* ignorieren */ }
}

export function getVolume() { return volume; }
export function isMuted() { return muted; }
export function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    if (master) master.gain.value = muted ? 0 : volume;
    save();
}
export function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : volume;
    save();
}

// Audio-Kontext beim ersten Nutzer-Input erzeugen/fortsetzen (Autoplay-Regeln von Chrome/Safari/Firefox)
export function initAudio() {
    const unlock = () => {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : volume;
            // Kompressor verhindert Übersteuern, wenn viele Sounds gleichzeitig laufen (Dauerfeuer + Treffer ...)
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14;
            comp.ratio.value = 6;
            master.connect(comp);
            comp.connect(ctx.destination);

            // 1 Sekunde weißes Rauschen, wird für alle Rausch-Sounds wiederverwendet
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    };
    ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, unlock, { passive: true }));
}

function ready() { return ctx && ctx.state === 'running'; }
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Bausteine ----------

// Hüllkurve: schneller Anstieg, dann exponentieller Abfall auf Stille
function envelope(g, t, attack, dur, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

// Ton mit Frequenzverlauf f0 -> f1
function tone(out, t0, { type = 'sine', f0, f1 = f0, dur = 0.1, gain = 0.3, attack = 0.002 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    envelope(g, t0, attack, dur, gain);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
}

// Rauschstoß durch Filter (bandpass/lowpass/highpass), optional mit Frequenzverlauf
function noise(out, t0, { filter = 'bandpass', f0 = 1500, f1 = f0, q = 1, dur = 0.1, gain = 0.4, attack = 0.001 }) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    envelope(g, t0, attack, dur, gain);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
}

// Ziel für entfernte Geräusche: Lautstärke, Stereo-Position und Dumpfheit nach Entfernung
function spatialOut(gain, pan, lowpassHz) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpassHz;
    const g = ctx.createGain();
    g.gain.value = gain;
    lp.connect(g);
    if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p); p.connect(master);
    } else {
        g.connect(master);
    }
    return lp;
}

// ---------- Waffen ----------

function shotSound(out, t, weaponIndex) {
    const v = rnd(0.94, 1.06); // leichte Variation, damit Dauerfeuer nicht "Maschinen-gleich" klingt
    if (weaponIndex === 1) {            // Pistole: kurz, hell, knackig
        noise(out, t, { f0: 3200 * v, q: 0.9, dur: 0.07, gain: 0.7 });
        tone(out, t, { type: 'square', f0: 1900 * v, f1: 320, dur: 0.06, gain: 0.16 });
        tone(out, t, { f0: 230, f1: 70, dur: 0.09, gain: 0.55 });
    } else if (weaponIndex === 2) {     // Sniper: tiefer Knall, scharfer Knack, langes Echo
        noise(out, t, { filter: 'lowpass', f0: 1100, f1: 300, dur: 0.55, gain: 1.0 });
        noise(out, t, { filter: 'highpass', f0: 3000, dur: 0.07, gain: 0.8 });
        tone(out, t, { f0: 115 * v, f1: 28, dur: 0.6, gain: 1.1 });
        tone(out, t, { type: 'sawtooth', f0: 760 * v, f1: 60, dur: 0.35, gain: 0.28 });
        noise(out, t + 0.14, { filter: 'lowpass', f0: 600, f1: 200, dur: 0.7, gain: 0.3 }); // Hall
    } else {                            // Rifle: Neon-Laser-Knall
        noise(out, t, { f0: 2200 * v, q: 0.8, dur: 0.09, gain: 0.85 });
        tone(out, t, { type: 'sawtooth', f0: 1500 * v, f1: 190, dur: 0.09, gain: 0.3 });
        tone(out, t, { f0: 165 * v, f1: 45, dur: 0.12, gain: 0.8 });
    }
}

export function playShot(weaponIndex) {
    if (!ready()) return;
    shotSound(master, ctx.currentTime, weaponIndex);
}

// Fremder Schuss: leiser/dumpfer mit Entfernung und links/rechts nach Richtung.
// pos = {x,y,z} Mündung des Schützen, camera = Kamera des Hörers
export function playShotRemote(weaponIndex, pos, camera) {
    if (!ready() || !pos || !camera) return;
    const rx = pos.x - camera.position.x, ry = pos.y - camera.position.y, rz = pos.z - camera.position.z;
    const dist = Math.hypot(rx, ry, rz);
    if (dist > 260) return; // zu weit: unhörbar
    const e = camera.matrixWorld.elements; // erste Spalte = Rechts-Vektor der Kamera
    const pan = dist > 0.01 ? Math.max(-0.9, Math.min(0.9, (rx * e[0] + ry * e[1] + rz * e[2]) / dist)) : 0;
    const gain = (weaponIndex === 2 ? 1.5 : 1) / (1 + Math.pow(dist / 20, 1.5));
    const lp = Math.max(700, 16000 / (1 + dist / 18));
    shotSound(spatialOut(gain, pan, lp), ctx.currentTime, weaponIndex);
}

export function playDry() {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(master, t, { filter: 'highpass', f0: 4000, dur: 0.025, gain: 0.35 });
    tone(master, t, { type: 'square', f0: 900, f1: 600, dur: 0.025, gain: 0.12 });
}

// stage: 'out' (Magazin raus), 'in' (Magazin rein), 'bolt' (durchladen)
export function playReload(stage, weaponIndex = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const heavy = weaponIndex === 2 ? 0.75 : 1; // Sniper tiefer/dumpfer
    if (stage === 'out') {
        noise(master, t, { f0: 2500 * heavy, q: 1.2, dur: 0.035, gain: 0.5 });
        tone(master, t, { type: 'square', f0: 320 * heavy, f1: 150, dur: 0.05, gain: 0.15 });
        noise(master, t + 0.05, { f0: 1200 * heavy, f1: 700, q: 0.8, dur: 0.1, gain: 0.25 }); // Magazin gleitet raus
    } else if (stage === 'in') {
        tone(master, t, { f0: 190 * heavy, f1: 85, dur: 0.09, gain: 0.7 });
        noise(master, t, { f0: 1800 * heavy, q: 1, dur: 0.05, gain: 0.5 });
    } else {
        noise(master, t, { f0: 3000 * heavy, q: 1.5, dur: 0.025, gain: 0.5 });
        tone(master, t, { type: 'square', f0: 700 * heavy, f1: 400, dur: 0.03, gain: 0.12 });
        noise(master, t + 0.08, { f0: 2200 * heavy, q: 1.5, dur: 0.03, gain: 0.55 });
        tone(master, t + 0.08, { type: 'square', f0: 480 * heavy, f1: 300, dur: 0.04, gain: 0.14 });
    }
}

// Waffe ziehen: Luftzug + metallisches Einrasten
export function playDraw(weaponIndex = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const dur = weaponIndex === 2 ? 0.26 : weaponIndex === 1 ? 0.15 : 0.2;
    noise(master, t, { f0: 400, f1: 1900, q: 0.7, dur, gain: 0.22, attack: 0.05 });
    const tc = t + dur * 0.85;
    noise(master, tc, { f0: weaponIndex === 2 ? 1800 : 2800, q: 1.4, dur: 0.03, gain: 0.5 });
    tone(master, tc, { type: 'square', f0: 520, f1: 300, dur: 0.04, gain: 0.12 });
}

// ---------- Feedback ----------

export function playHitMarker() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { type: 'triangle', f0: 1800, f1: 2500, dur: 0.06, gain: 0.35 });
}

export function playKill() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { type: 'sine', f0: 880, dur: 0.14, gain: 0.4 });
    tone(master, t + 0.09, { type: 'sine', f0: 1320, dur: 0.22, gain: 0.4 });
    tone(master, t + 0.09, { type: 'triangle', f0: 2640, dur: 0.18, gain: 0.12 });
}

export function playHurt() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { f0: 125, f1: 50, dur: 0.16, gain: 0.75 });
    noise(master, t, { filter: 'lowpass', f0: 700, f1: 250, dur: 0.14, gain: 0.5 });
}

export function playDeath() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { type: 'sawtooth', f0: 420, f1: 55, dur: 0.85, gain: 0.35 });
    noise(master, t, { filter: 'lowpass', f0: 900, f1: 150, dur: 0.7, gain: 0.5 });
}

// Heilspritze: Klick, dann aufsteigende Töne
export function playHeal() {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(master, t, { f0: 3500, q: 1.5, dur: 0.03, gain: 0.45 });
    [520, 660, 880, 1320].forEach((f, i) => {
        tone(master, t + 0.08 + i * 0.07, { type: 'sine', f0: f, dur: 0.22, gain: 0.26 });
    });
}

// ---------- Bewegung ----------

export function playFootstep(strength = 0.7) {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(master, t, { filter: 'lowpass', f0: rnd(380, 640), q: 0.7, dur: 0.07, gain: 0.3 * strength });
    tone(master, t, { f0: rnd(85, 110), f1: 55, dur: 0.06, gain: 0.3 * strength });
}

export function playSlide() {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(master, t, { f0: 1000, f1: 280, q: 0.8, dur: 0.5, gain: 0.3, attack: 0.04 });
}

export function playJump() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { f0: 200, f1: 420, dur: 0.12, gain: 0.12 });
    noise(master, t, { filter: 'highpass', f0: 2500, dur: 0.05, gain: 0.12 });
}

export function playLand(strength = 0.6) {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(master, t, { f0: 105, f1: 40, dur: 0.15, gain: 0.55 * strength });
    noise(master, t, { filter: 'lowpass', f0: 600, dur: 0.1, gain: 0.35 * strength });
}
