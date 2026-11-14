// skins.js — Skin-Katalog. JEDER Skin gehört zu GENAU EINER Waffe (oder zum Soldaten), wie bei CS2 ("Rifle | Redline").
// Ein Skin überzieht die ganze Waffe bzw. die Rüstung des Soldaten mit einem Muster und färbt Neon-Akzente, Tracer,
// Einschusslöcher und Mündungsfeuer in der Akzentfarbe. Die Muster erzeugt skintex.js im Code (keine Bilddateien).
//
// Skins bekommt man NICHT mehr durch Level, sondern aus Kisten (pro Level-Aufstieg eine Kiste, siehe progression.js).
// Die Seltenheit steht direkt im Eintrag und bestimmt die Droprate (RARITIES unten).
//
// Ziele (target): 0..6 = Waffenindex (WEAPON_CONFIGS in weapon.js: 0 Rifle, 1 Pistol, 2 Sniper, 3 SMG, 4 Shotgun,
// 5 Revolver, 6 Knife) und 'char' = Soldat. ID 0 ist der Standard-Skin (gehört allen, immer vorhanden).
//
// WICHTIG: Die ID ist der Index im Array und wird gespeichert/zum Server geschickt. Neue Skins immer HINTEN anhängen
// (Reihenfolge nie ändern). Maximal MAX_SKINS (Server: MAX_SKIN_ID).

export const TARGET_CHAR = 'char';
export const TARGET_NAMES = ['Rifle', 'Pistol', 'Sniper', 'SMG', 'Shotgun', 'Revolver', 'Knife'];

// target, Name, Seltenheit (m = Mil-Spec, r = Restricted, c = Classified, v = Covert, g = Gold), Muster, Farben, Akzent, Extras
const DEFS = [
    // ---- Rifle ----
    [0, 'Slate',            'm', 'tiger',     ['#e6e6e6', '#0c0c0c', '#ffffff'],                    0xdddddd],
    [0, 'Jungle Spray',     'm', 'woodland',  ['#2a3a1a', '#4a5e2a', '#7a8a3a', '#1a2410'],         0x8aa83a],
    [0, 'Redline',          'm', 'carbon',    ['#14070a', '#8a1428'],                               0xff3355],
    [0, 'Vulcan',           'r', 'magma',     ['#150806', '#ff4a00', '#ffd23a'],                    0xff7a1a],
    [0, 'Neon Revolution',  'r', 'plasma',    ['#10002a', '#7a00ff', '#00f0ff', '#ff2bd6'],         0x00f0ff, { scroll: [0.03, 0.02] }],
    [0, 'Fire Serpent',     'c', 'scales',    ['#2a0a05', '#c0391a', '#ffd23a'],                    0xff7a1a],
    [0, 'Hyper Beast',      'v', 'hyper',     [],                                                   0xffffff, { rainbow: true, scroll: [0.12, 0] }],
    [0, 'Gold Arabesque',   'g', 'gold',      ['#4a3406', '#d9a521', '#fff0a8'],                    0xfff2a0],
    // ---- Pistol ----
    [1, 'Gunmetal',         'm', 'steel',     ['#1a1c22', '#4a4e5a', '#a0a6b4'],                    0xa0a6b4],
    [1, 'Hazard',           'm', 'hazard',    ['#f5c400', '#111111'],                               0xffd000],
    [1, 'Racer',            'm', 'checker',   ['#f2f2f2', '#141414', '#888888'],                    0xff3355],
    [1, 'Neon Hex',         'r', 'hex',       ['#05060f', '#00f0ff', '#0b2a3a'],                    0x00f0ff],
    [1, 'Sunset Fade',      'r', 'fade',      ['#ff3355', '#ff9a2a', '#ffe14d', '#ff3355'],         0xff9a2a],
    [1, 'Pop Art',          'c', 'halftone',  ['#ffe14d', '#d4145a', '#2a2a8a'],                    0xd4145a],
    [1, 'Glitch',           'v', 'glitch',    ['#06060c', '#00f0ff', '#ff2bd6', '#ffe14d'],         0xff2bd6],
    [1, 'Rose Gold',        'g', 'steel',     ['#6a3a3a', '#d79a8a', '#ffe0d6'],                    0xffc0b0],
    // ---- Sniper ----
    [2, 'Arctic Camo',      'm', 'woodland',  ['#e8eef2', '#b9c6d0', '#8798a6', '#d4dde4'],         0xffffff],
    [2, 'Desert',           'm', 'woodland',  ['#c9a66b', '#a98a50', '#7a6338', '#e6cf9a'],         0xe6cf9a],
    [2, 'Topo',             'm', 'topo',      ['#07140f', '#2aff8a', '#ffffff'],                    0x2aff8a],
    [2, 'Frostbite',        'r', 'frost',     ['#0b2a4a', '#5ec8ff', '#ffffff'],                    0x9be9ff],
    [2, 'Marble',           'r', 'marble',    ['#e9e9ef', '#1a1a24', '#8a8aa0'],                    0xffffff],
    [2, 'Storm',            'c', 'lightning', ['#050816', '#3a7bff', '#e8f4ff'],                    0x6fb0ff],
    [2, 'Dragon Lore',      'v', 'scales',    ['#0a2a10', '#1f8a3a', '#9affb0'],                    0x5aff8a],
    [2, 'Black Marble Gold','g', 'marble',    ['#0e0e14', '#c9a227', '#4a4a5a'],                    0xc9a227],
    // ---- SMG ----
    [3, 'Walnut',           'm', 'wood',      ['#6b4226', '#2e1a0e', '#8a5a34'],                    0xffb066],
    [3, 'Circuit',          'm', 'circuit',   ['#031a14', '#00ffa6', '#0a6b52'],                    0x00ffa6],
    [3, 'Snow Tiger',       'm', 'tiger',     ['#e8f1f8', '#2a3a4a', '#ffffff'],                    0x9be9ff],
    [3, 'Toxic Camo',       'r', 'camo',      ['#0e2a12', '#1f5a24', '#39b02a', '#9aff5a'],         0x39ff14],
    [3, 'Synthwave',        'r', 'sunset',    ['#12002e', '#ff2bd6', '#ffb000'],                    0xff2bd6],
    [3, 'Paint Splash',     'c', 'splatter',  ['#101018', '#ff3355', '#00f0ff', '#ffe14d'],         0xffe14d],
    [3, 'Matrix',           'v', 'circuit',   ['#000a02', '#00ff41', '#055a1a'],                    0x00ff41],
    [3, 'Prisma',           'g', 'plasma',    ['#ff0040', '#ffd000', '#00ff80', '#0080ff', '#c000ff'], 0xffffff, { rainbow: true, scroll: [0.04, 0.025] }],
    // ---- Shotgun ----
    [4, 'Maple',            'm', 'wood',      ['#e0b878', '#9a6a34', '#f2d49a'],                    0xffe0a0],
    [4, 'Ocean Fade',       'm', 'fade',      ['#0a2a8a', '#00c8ff', '#7affd4', '#0a2a8a'],         0x00c8ff],
    [4, 'Radiation',        'm', 'hazard',    ['#39ff14', '#0a1a0a'],                               0x39ff14],
    [4, 'Obsidian Scales',  'r', 'scales',    ['#0b0b12', '#3b2a6a', '#b08aff'],                    0xb08aff],
    [4, 'Titanium Blue',    'r', 'steel',     ['#0e1a2a', '#2f5a8a', '#9ac8ff'],                    0x6fb0ff],
    [4, 'Inferno',          'c', 'magma',     ['#1a0000', '#ff0000', '#ffaa00'],                    0xff3a00],
    [4, 'Voltage',          'v', 'lightning', ['#1a1400', '#ffcc00', '#ffffff'],                    0xffe14d],
    [4, 'Gold Carbon',      'g', 'carbon',    ['#0a0804', '#c9a227'],                               0xffd24a],
    // ---- Revolver ----
    [5, 'Ice Carbon',       'm', 'carbon',    ['#050a14', '#3aa0ff'],                               0x3aa0ff],
    [5, 'Magenta Hex',      'm', 'hex',       ['#12040e', '#ff2bd6', '#3a0a2c'],                    0xff2bd6],
    [5, 'Dragon Scales',    'm', 'scales',    ['#0a2a10', '#1f8a3a', '#9affb0'],                    0x5aff8a],
    [5, 'Cryo Magma',       'r', 'magma',     ['#04101a', '#00a0ff', '#a0f0ff'],                    0x40c0ff],
    [5, 'Amethyst',         'r', 'frost',     ['#1a1030', '#9a7aff', '#ffffff'],                    0xc9a3ff],
    [5, 'Blood Marble',     'c', 'marble',    ['#1a0508', '#ff2030', '#5a1020'],                    0xff2030],
    [5, 'Toxic Plasma',     'v', 'plasma',    ['#021a05', '#0aaa30', '#b8ff3a', '#00ffa6'],         0xb8ff3a, { scroll: [0.03, 0.02] }],
    [5, 'Aurora',           'g', 'fade',      ['#00ffa6', '#3a7bff', '#b04dff', '#00ffa6'],         0x7affd4, { scroll: [0.05, 0] }],
    // ---- Knife ----
    [6, 'Forest DDPAT',     'm', 'woodland',  ['#2a3a1a', '#4a5e2a', '#7a8a3a', '#1a2410'],         0x8aa83a],
    [6, 'Stained',          'm', 'steel',     ['#1a1c22', '#4a4e5a', '#a0a6b4'],                    0xa0a6b4],
    [6, 'Night',            'm', 'carbon',    ['#050508', '#2a2a3a'],                               0x8a8aff],
    [6, 'Crimson Web',      'r', 'hex',       ['#12040a', '#ff2030', '#3a0a14'],                    0xff2030],
    [6, 'Slaughter',        'r', 'fade',      ['#6a0010', '#ff3355', '#ff9a8a', '#6a0010'],         0xff3355],
    [6, 'Marble Fade',      'c', 'fade',      ['#ff3355', '#ffe14d', '#3a7bff', '#ff3355'],         0xffe14d],
    [6, 'Doppler',          'v', 'plasma',    ['#10002a', '#7a00ff', '#00f0ff', '#ff2bd6'],         0xff2bd6, { scroll: [0.02, 0.01] }],
    [6, 'Gold Fade',        'g', 'gold',      ['#4a3406', '#ffd24a', '#fff6c8'],                    0xffe08a],
    // ---- Soldat (Charakter-Skins, sieht man bei anderen Spielern) ----
    ['char', 'Gunmetal Armor', 'm', 'steel',   ['#1a1c22', '#4a4e5a', '#a0a6b4'],                   0xa0a6b4],
    ['char', 'Woodland Armor', 'm', 'woodland',['#2a3a1a', '#4a5e2a', '#7a8a3a', '#1a2410'],        0x8aa83a],
    ['char', 'Carbon Armor',   'm', 'carbon',  ['#14070a', '#8a1428'],                              0xff3355],
    ['char', 'Frost Armor',    'r', 'frost',   ['#0b2a4a', '#5ec8ff', '#ffffff'],                   0x9be9ff],
    ['char', 'Circuit Armor',  'r', 'circuit', ['#031a14', '#00ffa6', '#0a6b52'],                   0x00ffa6],
    ['char', 'Nebula Armor',   'c', 'nebula',  ['#0a0420', '#4b1a8a', '#c04dff'],                   0xb04dff],
    ['char', 'Magma Armor',    'v', 'magma',   ['#150806', '#ff4a00', '#ffd23a'],                   0xff7a1a],
    ['char', 'Golden Armor',   'g', 'gold',    ['#4a3406', '#d9a521', '#fff0a8'],                   0xfff2a0]
];

// dunkle Variante der ersten Palettenfarbe (Stiefel/Hände des Soldaten)
function darkOf(css) {
    if (!css) return 0x111118;
    const r = Math.floor(parseInt(css.slice(1, 3), 16) * 0.55), g = Math.floor(parseInt(css.slice(3, 5), 16) * 0.55), b = Math.floor(parseInt(css.slice(5, 7), 16) * 0.55);
    return (r << 16) | (g << 8) | b;
}

// ---------- Seltenheit (CS2-Stil) + Kisten-Droprate in Prozent ----------
export const RARITIES = [
    { key: 'consumer',   name: 'Standard',   color: '#b0c3d9', odds: 0 },
    { key: 'm',          name: 'Mil-Spec',   color: '#4b69ff', odds: 79.92 },
    { key: 'r',          name: 'Restricted', color: '#8847ff', odds: 15.98 },
    { key: 'c',          name: 'Classified', color: '#d32ce6', odds: 3.2 },
    { key: 'v',          name: 'Covert',     color: '#eb4b4b', odds: 0.64 },
    { key: 'g',          name: 'Rare Special', color: '#e4ae39', odds: 0.26 }
];
const RARITY_BY_KEY = Object.fromEntries(RARITIES.map(r => [r.key, r]));
export function rarityOf(skin) { return RARITY_BY_KEY[skin ? skin.rarity : 'consumer'] || RARITIES[0]; }

export const SKINS = [
    // ID 0: Standard (Originaldesign, für jede Waffe und den Soldaten)
    { id: 0, name: 'Standard', target: null, rarity: 'consumer', pattern: null, colors: [], accent: null, dark: 0x111118, armor: 0x23232e, mid: 0x2f2f3d, preview: '#00f0ff' },
    ...DEFS.map(([target, name, rarity, pattern, colors, accent, extra = {}], i) => ({
        id: i + 1, name, target, rarity, pattern,
        colors: colors || [],
        accent,
        dark: darkOf(colors && colors[0]),
        ...extra
    }))
];
export const MAX_SKINS = 127;

// Anzeigename "Rifle | Redline" (Standard: nur "Standard")
export function skinFullName(skin, target = null) {
    if (!skin) return 'Standard';
    const t = skin.target ?? target;
    if (skin.id === 0) return t === null || t === undefined ? 'Standard' : (t === TARGET_CHAR ? 'Soldat | Standard' : TARGET_NAMES[t] + ' | Standard');
    return (skin.target === TARGET_CHAR ? 'Soldat' : TARGET_NAMES[skin.target]) + ' | ' + skin.name;
}
// Passt der Skin auf dieses Ziel? (Standard passt überall)
export const skinFits = (skin, target) => !!skin && (skin.id === 0 || skin.target === target);

// Skins nach Seltenheit (für die Kisten)
export const SKINS_BY_RARITY = {};
for (const s of SKINS) if (s.id !== 0) (SKINS_BY_RARITY[s.rarity] = SKINS_BY_RARITY[s.rarity] || []).push(s);

// Kiste öffnen: erst Seltenheit nach den Quoten, dann ein zufälliger Skin dieser Stufe (alle Waffen + Soldat)
export function rollCrate(rng = Math.random) {
    let r = rng() * 100, tier = 'm';
    for (const t of RARITIES) {
        if (!t.odds) continue;
        if (r < t.odds) { tier = t.key; break; }
        r -= t.odds;
    }
    const list = SKINS_BY_RARITY[tier] || SKINS_BY_RARITY.m;
    return list[Math.floor(rng() * list.length)];
}
