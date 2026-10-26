// skins.js — Skin-Definitionen. Ein Skin überzieht (a) die GANZE WAFFE mit einem Muster (wie bei CS2-Skins:
// Camo, Carbon, Magma ...), (b) die Rüstung deines Soldaten, so wie andere ihn sehen, und färbt
// (c) Neon-Akzente, Tracer, Einschusslöcher und Mündungsfeuer in der Akzentfarbe.
// Die Muster selbst erzeugt skintex.js im Code (keine Bilddateien).
//
// pattern:  Name des Musters (siehe skintex.js) oder null = Originaldesign
// colors:   Farbpalette des Musters
// accent:   Akzentfarbe (null = Standardfarben); rainbow = Akzent wechselt ständig die Farbe
// scroll:   [u, v] pro Sekunde - bewegtes Muster (Rainbow)
// armor/mid/dark: Basisfarben des Soldaten (ohne Muster) bzw. "dark" für Stiefel/Hände
// unlockLevel: ab diesem Level wählbar
// Die ID ist der Index im Array (SKINS[id]) und wird zum Server geschickt (muss kleiner als 16 bleiben).
// Das Menü sortiert nach unlockLevel, die Reihenfolge hier ist egal - nur ID == Index muss stimmen.

export const SKINS = [
    { id: 0, name: 'Standard',       unlockLevel: 1,  pattern: null,      accent: null,     armor: 0x23232e, mid: 0x2f2f3d, dark: 0x111118, preview: '#00f0ff' },
    { id: 1, name: 'Crimson Carbon', unlockLevel: 3,  pattern: 'carbon',  colors: ['#14070a', '#8a1428'],                         accent: 0xff3355, dark: 0x1e0a0e },
    { id: 2, name: 'Toxic Camo',     unlockLevel: 5,  pattern: 'camo',    colors: ['#0e2a12', '#1f5a24', '#39b02a', '#9aff5a'],   accent: 0x39ff14, dark: 0x0a1a0e },
    { id: 3, name: 'Void Nebula',    unlockLevel: 9,  pattern: 'nebula',  colors: ['#0a0420', '#4b1a8a', '#c04dff'],              accent: 0xb04dff, dark: 0x0d0720 },
    { id: 4, name: 'Gold Plated',    unlockLevel: 12, pattern: 'gold',    colors: ['#4a3406', '#d9a521', '#fff0a8'],              accent: 0xfff2a0, dark: 0x2b2108 },
    { id: 5, name: 'Rainbow Hyper',  unlockLevel: 18, pattern: 'hyper',   colors: [], scroll: [0.12, 0.0], rainbow: true,         accent: 0xffffff, dark: 0x0e0e14 },
    { id: 6, name: 'Circuit',        unlockLevel: 7,  pattern: 'circuit', colors: ['#031a14', '#00ffa6', '#0a6b52'],              accent: 0x00ffa6, dark: 0x021410 },
    { id: 7, name: 'Frostbite',      unlockLevel: 15, pattern: 'frost',   colors: ['#0b2a4a', '#5ec8ff', '#ffffff'],              accent: 0x9be9ff, dark: 0x0a2236 },
    { id: 8, name: 'Magma',          unlockLevel: 22, pattern: 'magma',   colors: ['#150806', '#ff4a00', '#ffd23a'],              accent: 0xff7a1a, dark: 0x120604 }
];
