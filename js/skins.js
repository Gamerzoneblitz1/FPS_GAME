// skins.js — Skin-Definitionen. Ein Skin überzieht die GANZE WAFFE bzw. die Rüstung des Soldaten mit einem Muster
// (wie bei CS2-Skins) und färbt Neon-Akzente, Tracer, Einschusslöcher und Mündungsfeuer in der Akzentfarbe.
// Die Muster erzeugt skintex.js im Code (keine Bilddateien).
//
// Jede Waffe hat ihren eigenen Skin; zusätzlich gibt es einen Charakter-Skin (sieht man bei anderen Spielern).
//
// pattern:  Name des Musters (siehe skintex.js PATTERNS) oder null = Originaldesign
// colors:   Farbpalette des Musters
// accent:   Akzentfarbe (null = Standardfarben); rainbow = Akzent wechselt ständig die Farbe
// scroll:   [u, v] pro Sekunde - bewegtes Muster
// unlockLevel: ab diesem Level wählbar (höchstens 30 = Maximal-Level; der Tester-Account hat alles)
//
// WICHTIG: Die ID ist der Index im Array (SKINS[id]) und wird gespeichert/zum Server geschickt.
// Neue Skins immer HINTEN anhängen, nie umsortieren oder löschen, sonst ändern sich gespeicherte Auswahlen.
// (Das Menü sortiert nach unlockLevel, die Reihenfolge hier ist egal.) Maximal 64 Skins.

// name, Level, Muster, Farben, Akzent, Extras
const DEFS = [
    // --- IDs 0-8: die ersten Skins (unverändert) ---
    ['Standard',       1,  null,       null,                                                  null],
    ['Crimson Carbon', 3,  'carbon',   ['#14070a', '#8a1428'],                                0xff3355],
    ['Toxic Camo',     5,  'camo',     ['#0e2a12', '#1f5a24', '#39b02a', '#9aff5a'],          0x39ff14],
    ['Void Nebula',    9,  'nebula',   ['#0a0420', '#4b1a8a', '#c04dff'],                     0xb04dff],
    ['Gold Plated',    12, 'gold',     ['#4a3406', '#d9a521', '#fff0a8'],                     0xfff2a0],
    ['Rainbow Hyper',  18, 'hyper',    [],                                                    0xffffff, { rainbow: true, scroll: [0.12, 0] }],
    ['Circuit',        7,  'circuit',  ['#031a14', '#00ffa6', '#0a6b52'],                     0x00ffa6],
    ['Frostbite',      15, 'frost',    ['#0b2a4a', '#5ec8ff', '#ffffff'],                     0x9be9ff],
    ['Magma',          22, 'magma',    ['#150806', '#ff4a00', '#ffd23a'],                     0xff7a1a],

    // --- ab ID 9: neue Skins ---
    ['Neon Hex',       2,  'hex',       ['#05060f', '#00f0ff', '#0b2a3a'],                    0x00f0ff],
    ['Magenta Hex',    4,  'hex',       ['#12040e', '#ff2bd6', '#3a0a2c'],                    0xff2bd6],
    ['Hazard',         3,  'hazard',    ['#f5c400', '#111111'],                               0xffd000],
    ['Radiation',      11, 'hazard',    ['#39ff14', '#0a1a0a'],                               0x39ff14],
    ['Tiger',          6,  'tiger',     ['#d97a1a', '#1a0c04', '#ffb347'],                    0xff9a2a],
    ['Snow Tiger',     14, 'tiger',     ['#e8f1f8', '#2a3a4a', '#ffffff'],                    0x9be9ff],
    ['Dragon Scales',  8,  'scales',    ['#0a2a10', '#1f8a3a', '#9affb0'],                    0x5aff8a],
    ['Obsidian Scales',16, 'scales',    ['#0b0b12', '#3b2a6a', '#b08aff'],                    0xb08aff],
    ['Plasma',         10, 'plasma',    ['#10002a', '#7a00ff', '#00f0ff', '#ff2bd6'],         0x00f0ff, { scroll: [0.03, 0.02] }],
    ['Toxic Plasma',   19, 'plasma',    ['#021a05', '#0aaa30', '#b8ff3a', '#00ffa6'],         0xb8ff3a, { scroll: [0.03, 0.02] }],
    ['Marble',         5,  'marble',    ['#e9e9ef', '#1a1a24', '#8a8aa0'],                    0xffffff],
    ['Black Marble',   17, 'marble',    ['#0e0e14', '#c9a227', '#4a4a5a'],                    0xc9a227],
    ['Racer',          7,  'checker',   ['#f2f2f2', '#141414', '#888888'],                    0xff3355],
    ['Topo',           9,  'topo',      ['#07140f', '#2aff8a', '#ffffff'],                    0x2aff8a],
    ['Synthwave',      13, 'sunset',    ['#12002e', '#ff2bd6', '#ffb000'],                    0xff2bd6],
    ['Paint Splash',   12, 'splatter',  ['#101018', '#ff3355', '#00f0ff', '#ffe14d'],         0xffe14d],
    ['Pop Art',        15, 'halftone',  ['#ffe14d', '#d4145a', '#2a2a8a'],                    0xd4145a],
    ['Storm',          18, 'lightning', ['#050816', '#3a7bff', '#e8f4ff'],                    0x6fb0ff],
    ['Glitch',         20, 'glitch',    ['#06060c', '#00f0ff', '#ff2bd6', '#ffe14d'],         0xff2bd6],
    ['Woodland',       4,  'woodland',  ['#2a3a1a', '#4a5e2a', '#7a8a3a', '#1a2410'],         0x8aa83a],
    ['Desert',         7,  'woodland',  ['#c9a66b', '#a98a50', '#7a6338', '#e6cf9a'],         0xe6cf9a],
    ['Arctic Camo',    11, 'woodland',  ['#e8eef2', '#b9c6d0', '#8798a6', '#d4dde4'],         0xffffff],
    ['Sunset Fade',    10, 'fade',      ['#ff3355', '#ff9a2a', '#ffe14d', '#ff3355'],         0xff9a2a],
    ['Ocean Fade',     14, 'fade',      ['#0a2a8a', '#00c8ff', '#7affd4', '#0a2a8a'],         0x00c8ff],
    ['Aurora',         21, 'fade',      ['#00ffa6', '#3a7bff', '#b04dff', '#00ffa6'],         0x7affd4, { scroll: [0.05, 0] }],
    ['Walnut',         3,  'wood',      ['#6b4226', '#2e1a0e', '#8a5a34'],                    0xffb066],
    ['Maple',          8,  'wood',      ['#e0b878', '#9a6a34', '#f2d49a'],                    0xffe0a0],
    ['Gunmetal',       2,  'steel',     ['#1a1c22', '#4a4e5a', '#a0a6b4'],                    0xa0a6b4],
    ['Titanium Blue',  12, 'steel',     ['#0e1a2a', '#2f5a8a', '#9ac8ff'],                    0x6fb0ff],
    ['Rose Gold',      16, 'steel',     ['#6a3a3a', '#d79a8a', '#ffe0d6'],                    0xffc0b0],
    ['Ice Carbon',     9,  'carbon',    ['#050a14', '#3aa0ff'],                               0x3aa0ff],
    ['Gold Carbon',    19, 'carbon',    ['#0a0804', '#c9a227'],                               0xffd24a],
    ['Cryo Magma',     24, 'magma',     ['#04101a', '#00a0ff', '#a0f0ff'],                    0x40c0ff],
    ['Royal Nebula',   22, 'nebula',    ['#1a0a00', '#8a3a00', '#ffb347'],                    0xffb347],
    ['Emerald Nebula', 25, 'nebula',    ['#00140a', '#0a6a3a', '#5affb0'],                    0x5affb0],
    ['Blood Marble',   23, 'marble',    ['#1a0508', '#ff2030', '#5a1020'],                    0xff2030],
    ['Voltage',        26, 'lightning', ['#1a1400', '#ffcc00', '#ffffff'],                    0xffe14d],
    ['Matrix',         27, 'circuit',   ['#000a02', '#00ff41', '#055a1a'],                    0x00ff41],
    ['Inferno',        28, 'magma',     ['#1a0000', '#ff0000', '#ffaa00'],                    0xff3a00],
    ['Amethyst',       29, 'frost',     ['#1a1030', '#9a7aff', '#ffffff'],                    0xc9a3ff],
    ['Prisma',         30, 'plasma',    ['#ff0040', '#ffd000', '#00ff80', '#0080ff', '#c000ff'], 0xffffff, { rainbow: true, scroll: [0.04, 0.025] }]
];

// dunkle Variante der ersten Palettenfarbe (Stiefel/Hände des Soldaten)
function darkOf(css) {
    if (!css) return 0x111118;
    const r = Math.floor(parseInt(css.slice(1, 3), 16) * 0.55), g = Math.floor(parseInt(css.slice(3, 5), 16) * 0.55), b = Math.floor(parseInt(css.slice(5, 7), 16) * 0.55);
    return (r << 16) | (g << 8) | b;
}

export const SKINS = DEFS.map(([name, unlockLevel, pattern, colors, accent, extra = {}], id) => ({
    id, name, unlockLevel, pattern,
    colors: colors || [],
    accent,
    dark: darkOf(colors && colors[0]),
    // Standard-Skin (ohne Muster): einfache Farben für den Soldaten
    ...(pattern ? {} : { armor: 0x23232e, mid: 0x2f2f3d, preview: '#00f0ff' }),
    ...extra
}));

export const MAX_SKINS = 64;
