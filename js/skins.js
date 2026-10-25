// skins.js — Skin-Definitionen. Ein Skin färbt (a) deinen Soldaten, so wie ihn andere sehen, und
// (b) die Neon-Akzente deiner Waffen sowie Tracer/Einschusslöcher/Mündungsfeuer, so wie du sie siehst.
//
// accent: null = Standard (Akzentfarbe pro Spieler bzw. die Originalfarbe der jeweiligen Waffe)
// rainbow: true = Akzent wechselt ständig die Farbe
// armor/mid/dark: Rüstungsfarben des Soldaten
// unlockLevel: ab diesem Level wählbar
// Die ID ist der Index im Array und wird zum Server geschickt (muss kleiner als 16 bleiben).

export const SKINS = [
    { id: 0, name: 'Standard', unlockLevel: 1,  accent: null,     armor: 0x23232e, mid: 0x2f2f3d, dark: 0x111118, preview: '#00f0ff' },
    { id: 1, name: 'Crimson',  unlockLevel: 3,  accent: 0xff3355, armor: 0x4a1620, mid: 0x631d2a, dark: 0x1e0a0e, preview: '#ff3355' },
    { id: 2, name: 'Toxic',    unlockLevel: 5,  accent: 0x39ff14, armor: 0x17361f, mid: 0x214a2b, dark: 0x0a1a0e, preview: '#39ff14' },
    { id: 3, name: 'Void',     unlockLevel: 8,  accent: 0xb04dff, armor: 0x24164a, mid: 0x33205f, dark: 0x0d0720, preview: '#b04dff' },
    { id: 4, name: 'Gold',     unlockLevel: 12, accent: 0xfff2a0, armor: 0xa8841a, mid: 0xd4a91f, dark: 0x4a3a0c, preview: '#ffd700' },
    { id: 5, name: 'Rainbow',  unlockLevel: 16, accent: 0xffffff, armor: 0x1c1c24, mid: 0x2a2a36, dark: 0x0e0e14, rainbow: true, preview: 'linear-gradient(90deg,#ff3355,#ffaa00,#39ff14,#00f0ff,#b04dff)' }
];
