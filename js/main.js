import { fetchManifest, loadMap } from './maps.js';
import { WeaponManager, WEAPON_CONFIGS, KNIFE_INDEX, KNIFE_TYPES, setKnifeVariant, viewSettings } from './weapon.js';
import * as sfx from './audio.js';
import { initEffects, createTracer, addBulletHole, spawnImpactSpark, updateEffects } from './effects.js';
import { createPlayerMesh, updatePlayerAnimations, setPlayerFacing, applySkin } from './player.js';
import { SKINS, RARITIES, rarityOf, skinFullName, rollCrate, CRATES, CRATE_POOLS } from './skins.js';
import { createPreview, createThumbMaker } from './preview.js';
import { getSkinPreview, isPreviewCached } from './skintex.js';
import * as prog from './progression.js';
import { createBotHost } from './bots.js';
import { createModes, TEAM_COLORS } from './modes.js';
import { DEFAULTS as CONTROL_DEFAULTS, sanitizeControls, renderCrosshairSVG, wrapAngle, CROSSHAIR_STYLES, CROSSHAIR_COLORS } from './settings.js';

const socket = io("https://fps-game-e18y.onrender.com");
let playerName = ''; // wird beim ersten Spielstart abgefragt
const playerNames = {}; // id -> name, für Nametags + Kill-Feed

let camera, scene, renderer, controls;
let bloomPassRef = null; // Bloom-Pass (für den Stärke-Regler)
let fpsEl = null, fpsFrames = 0, fpsLast = 0; // FPS-Anzeige
let composer = null; // Bloom-Postprocessing (null = Fallback auf normales Rendering)

// Einstellungen: aus localStorage laden (bleiben nach Neuladen erhalten), sonst Standardwerte
const SETTINGS_KEY = 'fpsGameSettings';
const savedSettings = (() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
})();
let userPixelRatioPercent = savedSettings.pixelRatio ?? 90; // 90% Standard, im Menü 50-100% einstellbar
let showNametags = savedSettings.showNametags ?? false; // Namensschilder über Spielern: Standard AUS (unsichtbar), im Menü einschaltbar
let bloomEnabled = savedSettings.bloomEnabled ?? false; // Standard jetzt AUS (war zu hell) - im Menü weiter an-/abschaltbar
// Maus, Sichtfeld, Fadenkreuz (geprüft + mit Standardwerten ergänzt, siehe settings.js)
let userControls = sanitizeControls(savedSettings);

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ pixelRatio: userPixelRatioPercent, bloomEnabled, showNametags, ...userControls }));
    } catch (e) { /* localStorage evtl. nicht verfügbar (z.B. privates Fenster) - dann halt nicht speichern */ }
}
let weapon;
let colliders = [];
let groundMeshes = []; // begehbare Flächen (Boden, Treppen, Plattformen) für den Bodenraycast
let skyboxGroup = null; // Sternenhimmel + Planet, folgt der Kamera-Position (Skybox-Trick)
let portalRings = []; // rotierende Neon-Ringe an den Gates
let shootBlockers = []; // Wände/Türme/Kisten/Rampen -> blockieren Schüsse (Gates bewusst nicht)
const otherPlayers = {};
// ---- Bots (siehe bots.js): der Bot-Host (erster Spieler) steuert sie, alle anderen sehen sie wie normale Spieler ----
let botHost = null, botBoundsTop = 100, botBoundsH = 200;
const _botN = new THREE.Vector3();
const isBotId = (id) => typeof id === 'string' && id.startsWith('bot_');
// ---- Spielmodi (Deathmatch / Bombe / Rettung), Zustand kommt vom Server, Anzeige in modes.js ----
let modes = null, modeLayoutSent = false, respawnBlocked = false, curModeId = 'dm';
const playerTeams = {};
function ensureModes() {
    if (modes) return modes;
    modes = createModes({
        scene,
        getMe: () => ({ x: camera.position.x, z: camera.position.z }),
        getMyId: () => socket.id,
        sendHold: (on) => socket.emit('useHold', { on }),
        notice: (t) => { if (t) showNotice(t); }
    });
    return modes;
}
function startBotHost() {
    if (botHost) return;
    botHost = createBotHost({
        teamOf: (id) => playerTeams[id],
        objective: () => {
            const m = modes; if (!m || !m.active || !m.layout) return null;
            const s = m.state;
            return { mode: s.mode, phase: s.phase, layout: m.layout, bomb: s.bomb, hostages: s.hostages, noRespawn: !!s.noRespawn };
        },
        needLayout: () => !!modes && modes.state.mode !== 'dm' && !modes.layout,
        mapId: () => serverMapId,
        eye: EYE_HEIGHT_STAND,
        collidersNear: (x, z) => collidersNear(x, z),
        groundY: (x, y, z) => {
            if (!groundMeshes.length) return 0;
            groundRaycaster.set(new THREE.Vector3(x, y + (colliders.groundStepUp ?? 5), z), new THREE.Vector3(0, -1, 0));
            const h = groundRaycaster.intersectObjects(groundMeshes, false);
            return h.length ? h[0].point.y : 0;
        },
        spawns: () => colliders.spawnPoints || [],
        mapKey: () => (mapHandle && !mapLoading && groundMeshes.length ? mapHandle : null),
        bounds: () => {
            if (!groundMeshes.length) return null;
            const box = new THREE.Box3();
            for (const m of groundMeshes) box.expandByObject(m);
            if (!isFinite(box.min.x) || box.max.x - box.min.x > 3000 || box.max.z - box.min.z > 3000) return null;
            botBoundsTop = box.max.y + 2; botBoundsH = box.max.y - box.min.y + 6;
            return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
        },
        // alle begehbaren Flächen (Normale zeigt nach oben) an dieser Stelle, von oben nach unten, mind. 1 m auseinander
        floorsAt: (x, z) => {
            groundRaycaster.set(new THREE.Vector3(x, botBoundsTop, z), new THREE.Vector3(0, -1, 0));
            groundRaycaster.far = botBoundsH;
            const hits = groundRaycaster.intersectObjects(groundMeshes, false);
            groundRaycaster.far = Infinity;
            const ys = [];
            for (const h of hits) {
                if (!h.face) continue;
                _botN.copy(h.face.normal).transformDirection(h.object.matrixWorld);
                if (_botN.y < 0.75) continue;
                if (ys.length && ys[ys.length - 1] - h.point.y < 1) continue;
                ys.push(h.point.y);
            }
            return ys;
        },
        botIds: () => Object.keys(otherPlayers).filter(isBotId),
        botPos: (id) => { const m = otherPlayers[id]; return m ? { x: m.position.x, y: m.position.y, z: m.position.z, alive: m.visible, moved: !!m.userData.tp } : null; },
        targets: () => {
            const out = [];
            if (hasEntered && !isDead) out.push({ id: socket.id, x: camera.position.x, y: feetY, z: camera.position.z });
            for (const id in otherPlayers) if (!isBotId(id) && otherPlayers[id].visible) { const m = otherPlayers[id]; out.push({ id, x: m.position.x, y: m.position.y, z: m.position.z }); }
            return out;
        },
        emit: (ev, d) => socket.emit(ev, d)
    });
    botHost.sync();
}
function stopBotHost() { botHost = null; }
function applyBotMove(m) {
    const mesh = otherPlayers[m.id];
    if (!mesh) return;
    if (!mesh.visible) { setPlayerVisible(mesh, true); mesh.position.set(m.x, m.y, m.z); }
    mesh.userData.tp = { x: m.x, y: m.y, z: m.z };
    if (Math.hypot(mesh.position.x - m.x, mesh.position.z - m.z) > 6) mesh.position.set(m.x, m.y, m.z); // Respawn/Teleport: nicht gleiten
    setPlayerFacing(mesh, m.ry);
}
function smoothBots(delta) {
    const k = 1 - Math.exp(-delta * 16);
    for (const id in otherPlayers) {
        const m = otherPlayers[id], tp = m.userData.tp;
        if (!tp || !m.visible) continue;
        m.position.x += (tp.x - m.position.x) * k; m.position.y += (tp.y - m.position.y) * k; m.position.z += (tp.z - m.position.z) * k;
    }
}
const playerMeshesList = [];

const EYE_HEIGHT_STAND = 2;   // Abstand Kamera <-> Standfläche im Stehen
const EYE_HEIGHT_CROUCH = 1.1; // ... im Ducken
let currentEyeHeight = EYE_HEIGHT_STAND; // wird jeden Frame sanft Richtung Ziel interpoliert
// Fuß-Position getrennt von der Kamera getrackt: camera.position.y = feetY + currentEyeHeight.
// Grund: vorher wurde die Schwerkraft direkt auf camera.position.y addiert, wodurch Ducken in der
// Luft wirkungslos war (currentEyeHeight änderte sich zwar, beeinflusste aber nichts, solange man
// nicht gerade landete). Jetzt wirkt sich Ducken/Sliden sofort aus, auch während man in der Luft ist.
let feetY = 0;

// Krunker-artiges Movement: der Kern davon ist kaum Reibung in der Luft (Schwung bleibt erhalten)
// bei voller Beschleunigungskontrolle -> Air-Strafing/Bunny-Hopping lohnt sich, weil man in der Luft
// schneller wird als am Boden erlaubt (MAX_AIR_SPEED > MAX_GROUND_SPEED).
const GROUND_FRICTION = 10.0;
const AIR_FRICTION = 0.6;
const GROUND_ACCEL = 90.0;
const AIR_ACCEL = 70.0;
const MAX_GROUND_SPEED = 9.0;
const MAX_AIR_SPEED = 13.5;
const JUMP_VELOCITY = 13.0;
const GRAVITY = 9.8 * 3.0;
const SPRINT_MULTIPLIER = 1.4;   // Shift
const CROUCH_SPEED_MULTIPLIER = 0.5; // C / Strg (normales Ducken, langsam)

// Sliden: Ducken (C/Strg) während man schnell am Boden unterwegs ist, löst einen Slide statt eines
// normalen langsamen Duckens aus -> kurzer Geschwindigkeits-Kick, danach kaum Bremsung (Schwung bleibt
// erhalten), bis man ausrollt. Springt man währenddessen, gibt's nochmal einen Schub (Slide-Hop).
const SLIDE_MIN_SPEED_TO_START = 4.0;
const SLIDE_MAX_SPEED = 16.0;
// Geschwindigkeitskurve beim Sliden: erst exakt die Ausgangsgeschwindigkeit beibehalten, dann
// innerhalb von SLIDE_BOOST_RISE_TIME auf +5% hochrampen, das bis SLIDE_BOOST_DURATION halten
// ("für die ersten paar Meter"), danach übernimmt wieder die normale Reibung (wird langsamer).
const SLIDE_BOOST_PEAK = 1.05;
const SLIDE_BOOST_RISE_TIME = 0.1; // Sekunden bis zum Erreichen der +5%
const SLIDE_BOOST_DURATION = 0.4;  // Sekunden, die der Boost insgesamt anhält
const SLIDE_FRICTION = 1.2;
const SLIDE_END_SPEED = 2.5; // darunter rollt der Slide aus -> wird zu normalem Ducken
const SLIDE_STEER_FACTOR = 0.3; // wie viel eigene Beschleunigung während des Slides noch möglich ist
const SLIDE_JUMP_BOOST = 1.2; // zusätzlicher Schub, wenn man aus dem Slide/Ducken heraus springt

let health = 100;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let spaceHeld = false; // Leertaste gedrückt halten = automatisch springen, sobald man den Boden berührt
let crouchKeyC = false, crouchKeyCtrl = false; // beide Tasten können unabhängig gedrückt/losgelassen werden
let sprintHeld = false;
let syringes = 0;      // Anzahl Heilspritzen (Server-Wert)
let myKills = 0;       // eigene Kills (aus dem Leaderboard) für die Fortschrittsanzeige
const playerLevels = {};   // id -> Level der anderen Spieler
let lastSlotKey = '';      // verhindert unnötiges Neuzeichnen der Waffenleiste
let isDead = false;        // tot: Respawn-Panel offen, Waffenwahl möglich, keine Bewegung/Schüsse
let respawnTimerId = null;
let justLoggedIn = false;  // kurz nach dem Login darf die Waffenwahl noch sofort übernommen werden (Spielstart)
let skinTarget = 'char';   // Inventar: 'char' = Charakter, 0-5 = Waffe
let invSkin = null;        // Skin, der gerade in der 3D-Vorschau angesehen wird (null = der ausgerüstete)
let invRarity = 'all';     // Seltenheits-Filter
let previewRun = 0;
let invPreview = null;
let menuPreview = null, mmView = 'char';   // Hauptmenü-Schaufenster (muss vor init() deklariert sein)
let mapManifest = null, mapHandle = null, currentMapId = null, serverMapId = null, mapLoading = false, pendingMapId = null; // Karten (Ordner maps/)
let colliderGrid = new Map();              // räumlicher Index der Kollisionsboxen (Zellen à 8 m) -> Kollisionsprüfung bleibt auch bei Karten mit vielen Boxen schnell
let renderBlocked = false;                 // true, solange eine Vollbild-Oberfläche (Menü/Einstellungen/Inventar) das Spiel verdeckt -> Szene wird nicht gerendert
const RESPAWN_AUTO_SECONDS = 12;
let progressSaveTimer = null;
let progressSynced = false; // true, sobald der Server den Spielstand abgeglichen hat
let levelBannerTimer = null;
let stepTimer = 0;         // Schritt-Sound-Takt
let wasSlidingSfx = false;
let healHeld = false;  // verhindert Dauer-Auslösen durch Tastenwiederholung
const SYRINGE_KILL_INTERVAL = 5;
const _faceDir = new THREE.Vector3();
const DESIGN_FOV = 75; // Sichtfeld, für das die Zoomwerte der Waffen (aimFov) entworfen wurden
let lookScale = 1; // Maus-/Touch-Empfindlichkeit relativ zum Zoom (beim Zielen langsamer)
let aimBlend = 0;  // 0 = Hüfte, 1 = voll gezoomt (für die Zielen-Empfindlichkeit)
let fireHeld = false; // Feuertaste gehalten (Maus links / Touch-Fire) -> Dauerfeuer bei automatischen Waffen
let hasEntered = false; // true, sobald man das Login einmal bestätigt hat -> danach zeigt ESC das Pause-Menü statt des Logins
// Reset-Button (K halten): verhindert versehentliches Auslösen
const RESET_HOLD_MS = 1000;
let resetHeld = false;
let resetLatch = false;      // true nach Auslösung, bis die Taste losgelassen wurde (Key-Repeat ignorieren)
let resetHoldStart = null;
let sliding = false;
let wasCrouching = false; // um den Übergang "gerade erst gedrückt" zu erkennen (Slide-Start)
let slideTimer = 0;       // Sekunden seit Slide-Start -> steuert die Geschwindigkeitskurve
let slideBaseSpeed = 0;   // exakt die Geschwindigkeit beim Slide-Start (Referenz für die Kurve)
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundRaycaster = new THREE.Raycaster();

// --- Touch-Steuerung (iPad/Handy) ---
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
let touchActive = false; // Ersatz für controls.isLocked auf Touch-Geräten

let joystickTouchId = null;
let joystickCenter = { x: 0, y: 0 };
const JOYSTICK_MAX_RADIUS = 55;

let lookTouchId = null;
let lookLastX = 0, lookLastY = 0;
const TOUCH_LOOK_SENSITIVITY = 0.0035;
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// Start: steht ganz am Dateiende (init() nutzt Konstanten, die weiter unten im Modul deklariert werden).

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb0e0e6); // wird von setupMap() überschrieben (Neon-Hintergrund)

    camera = new THREE.PerspectiveCamera(userControls.fov, window.innerWidth / window.innerHeight, 0.1, 6000); // far erhöht für den Sternenhimmel/Planet-Backdrop
    camera.position.set(-177, 2, 0); // Sicherer Startwert (C-Zone), wird gleich durch einen zufälligen Map-Spawn / den Server-Spawn ersetzt
    scene.add(camera);
    initEffects(scene); // Tracer-/Bullet-Hole-/Funken-Pools

    renderer = new THREE.WebGLRenderer({ antialias: true });
    // PC-Fenster haben oft deutlich mehr Pixel als ein Handy-Display (z.B. 1920x1080 vs. 400x850
    // CSS-Pixel, ~6x Unterschied) — die GPU-Last skaliert direkt mit der Pixelzahl. Deshalb hier
    // die interne Render-Auflösung am PC bewusst absenken (Browser skaliert per CSS wieder hoch);
    // am Handy, das schon flüssig läuft, nichts ändern. Wert kommt aus den gespeicherten
    // Einstellungen (Standard 90%) und lässt sich im Einstellungsmenü live nachjustieren.
    renderer.setPixelRatio(isTouchDevice ? 1 : userPixelRatioPercent / 100);
    renderer.setSize(window.innerWidth, window.innerHeight);
    // shadowMap bewusst deaktiviert: kein Licht im Spiel wirft aktuell Schatten (castShadow nirgends
    // gesetzt), die Shadow-Map-Infrastruktur würde also nur unnötig Overhead kosten.
    document.body.appendChild(renderer.domElement);

    initComposer();
    setupSettingsPanel();

    controls = new THREE.PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    let showLockProblem = () => {}; // wird weiter unten (Desktop-Zweig) gesetzt
    // Name abfragen bevor man das Spiel betritt
    function enterGame() {
        if (mapLoading) return; // Karte lädt noch
        const input = document.getElementById('name-input');
        const name = input ? input.value.trim().slice(0, 20) : '';
        playerName = name || 'Player' + Math.floor(Math.random() * 1000);
        socket.emit('setName', playerName);
        // Mit eigenem Namen wird der Fortschritt gespeichert (lokal + Server); ohne Namen (Gast) nicht
        prog.setActiveName(name);
        refreshProgressUI();
        progressSynced = false;
        if (name) socket.emit('syncProgress', prog.getState());
        sendProfile();
        justLoggedIn = true;                 // Server-Abgleich (Level) kann noch eintreffen -> Auswahl danach erneut übernehmen
        setTimeout(() => { justLoggedIn = false; }, 10000);
        applyLoadout();                      // Spielstart: gewählte 2 Waffen
        document.getElementById('own-name-display').textContent = playerName;
        hasEntered = true;

        if (isTouchDevice) {
            touchActive = true;
            instructions.style.display = 'none';
        } else {
            controls.lock(); // Overlay verschwindet erst im 'lock'-Event (siehe unten), sonst hängt man bei abgelehntem Lock fest
            // Sicherheitsnetz: kommt nach 1.2 s keine Maussperre an (Browser lehnt still ab / meldet nichts),
            // das halbdunkle Login-Overlay nicht ewig über der Map stehen lassen, sondern Menü mit Hinweis zeigen
            setTimeout(() => { if (hasEntered && !controls.isLocked) showLockProblem(); }, 1200);
        }
    }

    const enterBtn = document.getElementById('enter-btn');
    if (enterBtn) enterBtn.addEventListener('click', enterGame);

    const nameInput = document.getElementById('name-input');
    if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterGame(); });

    if (isTouchDevice) {
        const hint = document.getElementById('controls-hint');
        if (hint) hint.innerText = 'Linker Stick = Bewegen | Rechte Bildschirmhälfte ziehen = Umsehen | 🔫 = Schießen | 1/2/3 = Waffe wechseln | Tippen zum Starten';
        document.getElementById('touch-controls').style.display = 'block';
        setupTouchControls();
    } else {
        const pauseMenu = document.getElementById('pause-menu');
        const settingsPanel = document.getElementById('settings-panel');
        controls.addEventListener('lock', () => {
            instructions.style.display = 'none';
            pauseMenu.style.display = 'none';
            settingsPanel.style.display = 'none';
            const lp = document.getElementById('loadout-panel');
            if (lp) lp.style.display = 'none';
        });
        // ESC (bzw. jedes Ende der Maussperre): vor dem ersten Start Login, danach Pause-Menü
        controls.addEventListener('unlock', () => {
            fireHeld = false;
            if (weapon) weapon.setAiming(false);
            closeBuyMenu();
            if (isDead) return; // beim Tod zeigt das Respawn-Panel die Waffenwahl
            if (hasEntered) pauseMenu.style.display = 'flex';
            else instructions.style.display = 'flex';
        });
        // Browser lehnt die Maussperre ab (z.B. Safari bei Start per Enter-Taste statt Mausklick):
        // Menü mit Hinweis zeigen, ein Klick auf WEITER sperrt die Maus dann zuverlässig.
        const lockError = document.getElementById('lock-error');
        const onLockError = () => {
            console.warn('Pointer Lock wurde vom Browser abgelehnt.');
            instructions.style.display = 'none';
            pauseMenu.style.display = 'flex';
            if (lockError) lockError.style.display = 'block';
        };
        showLockProblem = onLockError;

        // Safari meldet Änderungen der Maussperre teils nur mit webkit-Prefix -> PointerLockControls (hört nur
        // auf 'pointerlockchange') würde dann nie "gesperrt" melden: Maus tot, Login-Overlay bleibt über der Map.
        // Diese Synchronisierung läuft NACH dem Handler von PointerLockControls und greift nur bei Abweichung,
        // in Chrome/Firefox ist sie also ein No-Op.
        const syncLock = () => {
            const el = document.pointerLockElement || document.webkitPointerLockElement || null;
            const locked = el === document.body;
            if (locked !== controls.isLocked) {
                controls.isLocked = locked;
                controls.dispatchEvent({ type: locked ? 'lock' : 'unlock' });
            }
        };
        document.addEventListener('pointerlockchange', syncLock);
        document.addEventListener('webkitpointerlockchange', syncLock);

        document.addEventListener('pointerlockerror', onLockError);
        document.addEventListener('webkitpointerlockerror', onLockError);
        controls.addEventListener('lock', () => { if (lockError) lockError.style.display = 'none'; });

        document.getElementById('pause-resume').addEventListener('click', () => controls.lock());
        document.getElementById('pause-loadout').addEventListener('click', () => openInventory());
        // Zurück zum Hauptmenü: Spielstand sichern, Verbindung trennen (andere Spieler sehen dich verschwinden) und Seite neu laden -> Hauptmenü
        document.getElementById('pause-menu-btn').addEventListener('click', () => {
            flushProgress();
            const btn = document.getElementById('pause-menu-btn');
            btn.disabled = true; btn.textContent = 'LÄDT …';
            setTimeout(() => { try { socket.disconnect(); } catch (e) { /* ignorieren */ } location.reload(); }, 250);
        });
        document.getElementById('pause-reset').addEventListener('click', () => {
            socket.emit('requestReset');
            pauseMenu.style.display = 'none';
            // Kein Lock: der Server antwortet mit playerKilled -> Respawn-Panel (hier kann man die Waffen neu wählen).
            // Bei Reset-Cooldown zeigt 'resetDenied' das Menü wieder.
        });
        document.getElementById('pause-settings').addEventListener('click', () => {
            settingsPanel.style.display = (settingsPanel.style.display === 'block') ? 'none' : 'block';
        });
    }

    // Die Karte wird nach dem Start asynchron aus dem Ordner maps/ geladen (siehe initMaps() unten).
    // Zuletzt benutzten Namen vorbelegen und dessen lokalen Spielstand laden (Level/Skin sofort sichtbar)
    const lastName = prog.getLastName();
    const savedNameField = document.getElementById('name-input');
    if (lastName && savedNameField && !savedNameField.value) {
        savedNameField.value = lastName;
        prog.setActiveName(lastName);
    }
    setKnifeVariant(prog.getKnifeType()); // Messertyp vor dem Bauen der Waffen setzen
    weapon = new WeaponManager(camera, scene, updateAmmoUI);
    weapon.onEvent = handleWeaponEvent;
    weapon.setLevel(prog.getProgress().level); // Waffen nach gespeichertem Level freischalten
    applyOwnSkin();
    updateXpUI();
    wireLoadoutUi(); // Loadout-Tabs, Respawn-Button, Login-Auswahl
    setupRenderGate(); // Menüs verdecken das Spiel komplett -> Szene und unsichtbare 3D-Vorschauen anhalten (spart viel FPS)
    sfx.initAudio(); // Audio-Kontext startet beim ersten Klick/Tastendruck

    document.addEventListener('keydown', (e) => onKeyChange(e.keyCode, true));
    document.addEventListener('keyup', (e) => onKeyChange(e.keyCode, false));
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked && !touchActive) return; // Klicks auf Menü-Buttons zählen nicht
        if (e.button === 0) {
            fireHeld = true;
            handleShooting(); // sofortiger erster Schuss (reicht bei halbautomatischen Waffen)
        } else if (e.button === 2) {
            // Rechtsklick halten = Zielen / Zielfernrohr (oder umschalten, wenn in den Einstellungen gewählt)
            weapon.setAiming(userControls.aimToggle ? !weapon.aimWanted : true);
        }
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) fireHeld = false;
        else if (e.button === 2 && !userControls.aimToggle) weapon.setAiming(false);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault()); // kein Browser-Menü bei Rechtsklick
    window.addEventListener('blur', () => { fireHeld = false; if (weapon) weapon.setAiming(false); });
    // Tab verlassen / Seite schließen: Spielstand noch schnell an den Server schicken
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushProgress(); });
    window.addEventListener('pagehide', flushProgress);

    // Socket Events

    // Nach Verbindungsabbruch/Server-Neustart: Name, Spielstand und Profil erneut anmelden
    socket.on('connect', () => {
        if (!hasEntered) return;
        socket.emit('setName', playerName);
        progressSynced = false;
        if (prog.isPersistent()) socket.emit('syncProgress', prog.getState());
        sendProfile();
        if (weapon) socket.emit('setLoadout', weapon.armed ? weapon.loadout : []); // neuer Server-Spieler kennt die Ausrüstung noch nicht
    });

    // Karte: der Server bestimmt die aktive Karte (alle Spieler spielen dieselbe)
    socket.on('mapInfo', (d) => {
        if (!d || typeof d.id !== 'string') return;
        serverMapId = d.id;
        setRoundLeft(d.roundLeftMs);
        if (!mapManifest) return;                                   // initMaps() nimmt serverMapId später
        if (!mapHandle || mapHandle.entry.id !== d.id) switchMap(d.id); else reportMapSpawns();
    });
    socket.on('mapChanged', (d) => {
        if (!d || typeof d.id !== 'string') return;
        setRoundLeft(d.roundLeftMs);
        hideVote();
        serverMapId = d.id;
        curModeId = d.mode || 'dm';
        ensureModes().setLayout(null);
        modeLayoutSent = false; respawnBlocked = false;
        if (d.modeName) showNotice('Modus: ' + d.modeName);
        if (botHost) botHost.resetAll();
        switchMap(d.id);
    });
    socket.on('layout', (p) => { ensureModes().setLayout(p && p.layout ? p : null); });
    socket.on('teams', (m) => {
        const old = Object.assign({}, playerTeams);
        for (const k in playerTeams) delete playerTeams[k];
        Object.assign(playerTeams, m || {});
        ensureModes().setTeams(playerTeams);
        for (const id in otherPlayers) if (old[id] !== playerTeams[id]) updateNameTag(id, playerNames[id] || id.slice(0, 6));
    });
    socket.on('modeState', (s) => {
        ensureModes().setState(s);
        curModeId = s && s.mode || 'dm';
        if (s && s.phase !== 'live' && s.phase !== 'end') respawnBlocked = false;
    });
    socket.on('respawnBlocked', () => { respawnBlocked = true; showNotice('Bombe liegt – du spielst ab der nächsten Runde wieder mit'); });
    socket.on('modeNotice', (d) => { if (d && d.text) showNotice(d.text); });
    socket.on('roundStart', (d) => {
        if (!d) return;
        respawnBlocked = false;
        ensureModes().setState(d.state);
        const pos = d.pos || {};
        if (botHost) botHost.placeAll(pos);
        for (const id in otherPlayers) {
            if (isBotId(id) || !pos[id]) continue;
            otherPlayers[id].position.set(pos[id].x, pos[id].y, pos[id].z);
            setPlayerVisible(otherPlayers[id], true);
        }
        const me = pos[socket.id];
        if (me) {
            currentEyeHeight = EYE_HEIGHT_STAND;
            camera.position.set(me.x, me.y + EYE_HEIGHT_STAND, me.z);
            feetY = me.y;
            velocity.set(0, 0, 0);
            canJump = true;
            health = 100; updateHealthUI();
            if (isDead) doRespawn();
        }
    });
    socket.on('mapVote', (v) => showVote(v));
    socket.on('mapVoteUpdate', (v) => showVote(v));
    socket.on('mapDenied', () => {
        showNotice('Kartenwechsel nur möglich, wenn du allein auf dem Server bist');
        syncMapSelect();
    });

    // Server hat Spielstand abgeglichen (Maximum aus Server und lokalem Backup) -> übernehmen
    socket.on('progressSynced', (d) => {
        const before = prog.getProgress().level;
        prog.applyServer(d);
        progressSynced = !!d.saved;
        refreshProgressUI();
        sendProfile();
        renderAllPickers();
        if (justLoggedIn) { applyLoadout(); justLoggedIn = false; } // Spielstart: Level (z.B. Tester) ist jetzt bekannt
        const lvl = prog.getProgress().level;
        if (d.restored && lvl > 1) showNotice(`💾 Spielstand geladen: Level ${lvl}`);
        else if (d.saved === false) showNotice('⚠ Server-Speicher nicht erreichbar – Spielstand nur lokal');
        if (d.storageWarning) showNotice('⚠ Server-Speicher NICHT dauerhaft – bei Neustart gehen Spielstände verloren (Upstash einrichten)');
        if (lvl !== before) lastSlotKey = '';
    });

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) addOtherPlayer(id, players[id], players[id].name);
        });

        // Eigenen Spawnpunkt vom Server übernehmen (der wählt zufällig, weit weg von anderen Spielern)
        const me = players[socket.id];
        if (me) {
            camera.position.set(me.x, me.y, me.z);
            feetY = me.y - currentEyeHeight;
            velocity.set(0, 0, 0);
        }
    });

    socket.on('newPlayer', (data) => addOtherPlayer(data.id, data.position, data.name));
    socket.on('botHost', (d) => { if (d && d.id === socket.id) startBotHost(); else stopBotHost(); });
    socket.on('botsMoved', (arr) => { if (Array.isArray(arr)) arr.forEach(applyBotMove); });

    // Profil-Update (Skin/Level) eines Spielers
    socket.on('playerProfile', (data) => {
        playerLevels[data.id] = data.level;
        if (data.id !== socket.id && otherPlayers[data.id]) applySkin(otherPlayers[data.id], data.skin);
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
            if (!otherPlayers[data.id].visible) setPlayerVisible(otherPlayers[data.id], true); // nach dem Respawn wieder sichtbar
            setPlayerFacing(otherPlayers[data.id], data.position.ry); // Blickrichtung des Skins
        }
    });

    socket.on('playerShot', (data) => {
        if (botHost && !isBotId(data.id) && data.start) botHost.hear(data.id, data.start.x, data.start.z);
        playShotEffects(data.start, data.end, data.w, data.n, data.hitPlayer, data.c);
        if (!data.silent) sfx.playShotRemote(data.w, data.start, camera); // Schuss anderer Spieler: nach Entfernung/Richtung
    });

    socket.on('playerHealthUpdate', (data) => {
        if (botHost && isBotId(data.id)) botHost.onHealth(data.id, data.health);
        if (data.id === socket.id) {
            if (data.health < health) sfx.playHurt(); // Schaden bekommen
            health = data.health;
            updateHealthUI();
        }
    });

    socket.on('playerKilled', (data) => {
        // Kill-Feed anzeigen (für alle)
        addKillFeedEntry(data.killerName, data.victimName, data.killerId === socket.id, data.victimId === socket.id);
        if (botHost && isBotId(data.victimId)) botHost.onKilled(data.victimId, data.respawnPos);
        if (data.killerId === socket.id && data.victimId !== socket.id) { sfx.playKill(); awardXp(isBotId(data.victimId) ? Math.round(prog.XP_PER_KILL * 0.3) : prog.XP_PER_KILL, true); }
        if (data.victimId === socket.id) sfx.playDeath();

        if (data.victimId === socket.id) {
            // Ich wurde getötet
            health = 100;
            updateHealthUI();
            currentEyeHeight = EYE_HEIGHT_STAND;
            if (modes) modes.setHold(false);
            const teamSpawn = !!(modes && modes.active && modes.layout);   // Teambasis kommt vom Server (auch auf .glb-Karten, Layout ist in Client-Koordinaten)
            if (data.respawnPos && (teamSpawn || !(mapHandle && mapHandle.entry.type === 'glb'))) {
                camera.position.set(data.respawnPos.x, data.respawnPos.y, data.respawnPos.z);
                feetY = data.respawnPos.y - currentEyeHeight;
                velocity.set(0, 0, 0);
                canJump = true;
            } else {
                teleportToRandomSpawn(); // .glb-Karten: Spawns kennt der Client (passt zur eingestellten Skalierung)
            }
            enterDeadState(data.killerName); // Waffenwahl + Respawn-Button
        } else if (otherPlayers[data.victimId]) {
            if (data.respawnPos) otherPlayers[data.victimId].position.set(data.respawnPos.x, data.respawnPos.y, data.respawnPos.z);
            setPlayerVisible(otherPlayers[data.victimId], false); // wartet noch auf den Respawn (unsichtbar, nicht treffbar)
        }
    });

    // Treffer-Bestätigung (nur für den Schützen: rotes Fadenkreuz-Flash)
    socket.on('hitConfirm', (d) => {
        flashCrosshair();
        if (userControls.hitSound) sfx.playHitMarker();
        awardXp(Math.floor((d?.damage || 0) * prog.XP_PER_DAMAGE)); // kleine XP pro Schaden
    });

    socket.on('syringeUpdate', (d) => {
        syringes = d.count || 0;
        updateSyringeUI();
        if (d.awarded) showNotice('💉 Heilspritze erhalten! (H drücken)');
        else if (d.used) { showNotice('💉 Voll geheilt!'); sfx.playHeal(); }
        else if (d.denied === 'full') showNotice('Leben ist bereits voll');
        else if (d.denied === 'none') showNotice(`Keine Heilspritze – alle ${SYRINGE_KILL_INTERVAL} Kills gibt es eine`);
    });

    // Eigene Kills aus dem Leaderboard lesen (Fortschritt bis zur nächsten Spritze)
    socket.on('leaderboard', (board) => {
        const me = board.find(e => e.id === socket.id);
        if (me) { myKills = me.kills || 0; updateSyringeUI(); }
        setMenuStatus('ok', '● ONLINE · ' + board.length + ' SPIELER');
    });
    socket.on('connect_error', () => setMenuStatus('bad', '✖ SERVER NICHT ERREICHBAR – NEUER VERSUCH …'));
    socket.on('disconnect', () => setMenuStatus('bad', '✖ VERBINDUNG VERLOREN'));

    socket.on('resetDenied', (data) => {
        showNotice(`Reset in ${Math.ceil(data.remainingMs / 1000)}s wieder möglich`);
        if (!isDead && hasEntered && !controls.isLocked && !touchActive) document.getElementById('pause-menu').style.display = 'flex';
    });

    // Nametag-Update wenn ein Spieler seinen Namen ändert
    socket.on('playerNameUpdate', (data) => updateNameTag(data.id, data.name));

    // Leaderboard aktualisieren
    socket.on('leaderboard', (board) => updateLeaderboard(board));

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            const index = playerMeshesList.indexOf(otherPlayers[id]);
            if (index > -1) playerMeshesList.splice(index, 1);
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    window.addEventListener('resize', onWindowResize);
}

const _pRight = new THREE.Vector3();
const _pUp = new THREE.Vector3();
function handleShooting() {
    if (isDead) return;
    if (!controls.isLocked && !touchActive) return;

    const fired = weapon.shoot();
    if (!fired) return; // Magazin leer, wird gerade nachgeladen oder gezogen -> kein Schuss

    camera.updateMatrixWorld(true);
    // Tracer startet an der Mündung der Waffe (sieht man in der Ego-Ansicht als Linie zum Zielpunkt)
    const reach = weapon.current.melee || 0;                         // Messer: kurze Reichweite, kein Tracer
    const startPos = reach ? camera.position.clone() : weapon.getMuzzleWorldPosition(new THREE.Vector3());
    const baseDir = camera.getWorldDirection(new THREE.Vector3());

    const pellets = weapon.pellets;                                  // 1 bei normalen Waffen, 8 bei der Shotgun
    const spread = weapon.spread * (1 - 0.45 * weapon.aimAmount);   // Zielen verengt die Streuung
    const weaponIndex = weapon.activeIndex;
    const color = weapon.color;                                      // Skin-Farbe
    const hitsByTarget = {};                                         // Schrot: Anzahl getroffener Kugeln pro Ziel (den Schaden berechnet der Server)

    for (let p = 0; p < pellets; p++) {
        const dir = baseDir.clone();
        if (spread > 0) {
            // zufälliger Punkt im Streukegel
            _pRight.crossVectors(dir, camera.up).normalize();
            _pUp.crossVectors(_pRight, dir).normalize();
            const ang = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * spread;
            dir.addScaledVector(_pRight, Math.cos(ang) * rad).addScaledVector(_pUp, Math.sin(ang) * rad).normalize();
        }

        raycaster.set(camera.position, dir);
        raycaster.far = reach || Infinity;
        const playerHits = raycaster.intersectObjects(playerMeshesList, true);
        // Wände/Türme/Kisten/Rampen blockieren Schüsse (Gates bewusst ausgenommen - Portale bleiben durchlässig)
        const wallHits = shootBlockers.length ? raycaster.intersectObjects(shootBlockers, false) : [];

        let endPos = camera.position.clone().add(dir.clone().multiplyScalar(reach || 100));
        const nearestPlayerHit = playerHits.length > 0 ? playerHits[0] : null;
        const nearestWallHit = wallHits.length > 0 ? wallHits[0] : null;

        let wallNormal = null;
        let hitPlayer = false;

        // Näherer Treffer gewinnt: steht eine Wand/Rampenwand im Weg, zählt kein Spielertreffer dahinter
        if (nearestPlayerHit && (!nearestWallHit || nearestPlayerHit.distance <= nearestWallHit.distance)) {
            endPos = nearestPlayerHit.point;
            hitPlayer = true;
            let hitGroup = nearestPlayerHit.object;
            while (hitGroup.parent && !hitGroup.userData.id) hitGroup = hitGroup.parent;
            if (hitGroup.userData.id) {
                hitsByTarget[hitGroup.userData.id] = (hitsByTarget[hitGroup.userData.id] || 0) + 1;
            }
        } else if (nearestWallHit) {
            endPos = nearestWallHit.point;
            wallNormal = getHitWorldNormal(nearestWallHit, dir);
        }

        playShotEffects(startPos, endPos, weaponIndex, wallNormal, hitPlayer, color);
        socket.emit('shoot', {
            start: { x: startPos.x, y: startPos.y, z: startPos.z },
            end: { x: endPos.x, y: endPos.y, z: endPos.z },
            w: weaponIndex,
            c: color,
            n: wallNormal ? { x: wallNormal.x, y: wallNormal.y, z: wallNormal.z } : null,
            hitPlayer,
            silent: p > 0 // nur die erste Kugel macht Sound bei den anderen
        });
    }

    raycaster.far = Infinity;
    for (const [targetId, n] of Object.entries(hitsByTarget)) {
        socket.emit('hitPlayer', { targetId, w: weaponIndex, n }); // nur WEN und wie viele Kugeln - kein Schaden
    }
}

// Weltnormale der getroffenen Fläche. Bei InstancedMeshes (Wände, Türme, Rampen...) muss die Matrix der
// einzelnen Instanz mit einbezogen werden; die Normalenmatrix (invers-transponiert) sorgt dafür, dass
// auch schräge Flächen (Rampen mit ungleichmäßiger Skalierung) korrekt ausgerichtet sind.
const _hitMat = new THREE.Matrix4();
const _instMat = new THREE.Matrix4();
const _normalMat = new THREE.Matrix3();
function getHitWorldNormal(hit, rayDir) {
    if (!hit.face) return null;
    hit.object.updateMatrixWorld();
    _hitMat.copy(hit.object.matrixWorld);
    if (hit.object.isInstancedMesh && hit.instanceId !== undefined) {
        hit.object.getMatrixAt(hit.instanceId, _instMat);
        _hitMat.multiply(_instMat);
    }
    _normalMat.getNormalMatrix(_hitMat);
    const n = hit.face.normal.clone().applyMatrix3(_normalMat).normalize();
    if (n.dot(rayDir) > 0) n.negate(); // Normale muss zum Schützen zeigen (Rampen-Winding ist nicht garantiert)
    return n;
}

// Gemeinsamer Effekt-Pfad für eigene UND fremde Schüsse: Neon-Tracer in Waffenfarbe, bei Wandtreffer
// Bullet Hole + Funke, bei Spielertreffer nur Funke.
function playShotEffects(start, end, weaponIndex, normal, hitPlayer, color) {
    const cfg = WEAPON_CONFIGS[weaponIndex] || WEAPON_CONFIGS[0];
    const col = color ?? cfg.color; // Skin-Farbe des Schützen, sonst Waffenfarbe
    if (cfg.melee) {                // Messerhieb: nur ein kleiner Funke am Treffer
        if (hitPlayer) spawnImpactSpark(end, 0xff3355, 0.9);
        else if (normal) spawnImpactSpark(end, 0xffffff, 0.45);
        return;
    }
    createTracer(start, end, col, cfg.tracerWidth, cfg.tracerLife);
    if (normal) {
        addBulletHole(end, normal, col, cfg.holeSize);
        spawnImpactSpark(end, col, cfg.holeSize * 2);
    } else if (hitPlayer) {
        spawnImpactSpark(end, 0xffffff, 0.7);
    }
}

function addOtherPlayer(id, position, name = '') {
    playerNames[id] = name || id.slice(0, 6);
    const pMesh = createPlayerMesh(id, position.skin || 0);
    playerLevels[id] = position.level || 1;
    pMesh.position.set(position.x || 0, position.y || 2, position.z || 0);

    // Nametag als Sprite über dem Spieler
    const tag = makeNameSprite(playerNames[id], TEAM_COLORS[playerTeams[id]] || '#00f0ff');
    tag.position.set(0, 3.2, 0); // über dem Kopf (relativ zur Gruppe)
    tag.name = 'nametag';
    pMesh.add(tag);

    otherPlayers[id] = pMesh;
    playerMeshesList.push(pMesh);
    scene.add(pMesh);
    if (isBotId(id)) setPlayerVisible(pMesh, false);   // Bots erscheinen erst, wenn der Host sie platziert hat (nicht am Server-Spawn)
}

// Unsichtbar = nicht gerendert UND auf Layer 1 (der Raycast für Treffer prüft nur Layer 0, ein verstecktes
// Schild kann also auch keine Schüsse mehr "auffangen")
function setNametagVisible(tag, on) {
    tag.visible = on;
    tag.layers.set(on ? 0 : 1);
}

function makeNameSprite(name, color = '#00f0ff') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.roundRect(4, 4, 248, 56, 10); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(name.slice(0, 16), 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.8, 0.7, 1);
    setNametagVisible(sprite, showNametags);
    return sprite;
}

function updateNameTag(id, name) {
    playerNames[id] = name;
    const mesh = otherPlayers[id];
    if (!mesh) return;
    const old = mesh.getObjectByName('nametag');
    if (old) { old.material.map.dispose(); old.material.dispose(); mesh.remove(old); }
    const tag = makeNameSprite(name, TEAM_COLORS[playerTeams[id]] || '#00f0ff');
    tag.position.set(0, 3.2, 0); tag.name = 'nametag';
    if (!mesh.visible) setNametagVisible(tag, false);
    mesh.add(tag);
}

function updateSyringeUI() {
    const val = document.getElementById('syringe-val');
    const prog = document.getElementById('syringe-progress');
    const row = document.getElementById('syringe-row');
    if (val) {
        val.innerText = 'x' + syringes;
        val.style.color = syringes > 0 ? '#00ff99' : '#ccc';
    }
    if (prog) prog.innerText = `${myKills % SYRINGE_KILL_INTERVAL}/${SYRINGE_KILL_INTERVAL} Kills`;
    if (row) row.style.opacity = syringes > 0 ? '1' : '0.55';
}

function updateHealthUI() {
    const healthVal = document.getElementById('health-val');
    const healthBar = document.getElementById('health-bar-fill');
    if (healthVal) {
        healthVal.innerText = health;
        healthVal.style.color = health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000';
    }
    if (healthBar) healthBar.style.width = Math.max(0, Math.min(100, health)) + '%';
}

function updateAmmoUI(ammoInMag, reserveAmmo, isReloading, weaponName, magSize) {
    renderWeaponSlots();
    const ammoVal = document.getElementById('ammo-val');
    const ammoBar = document.getElementById('ammo-bar-fill');
    const weaponNameEl = document.getElementById('weapon-name');
    if (weaponNameEl && weaponName) weaponNameEl.innerText = weaponName.toUpperCase();
    if (!ammoVal) return;

    if (isReloading) {
        ammoVal.innerText = 'Nachladen…';
        ammoVal.style.color = '#ffff00';
        if (ammoBar) ammoBar.style.width = '100%';
        return;
    }

    if (weapon && weapon.infiniteAmmo) {
        ammoVal.innerText = '∞';
        ammoVal.style.color = '#00f0ff';
        if (ammoBar) ammoBar.style.width = '100%';
        return;
    }

    ammoVal.innerText = `${ammoInMag} / ${Number.isFinite(reserveAmmo) ? reserveAmmo : '∞'}`;
    ammoVal.style.color = ammoInMag === 0 ? '#ff0000' : ammoInMag <= Math.ceil(magSize * 0.3) ? '#ffff00' : '#00f0ff';
    if (ammoBar) ammoBar.style.width = (ammoInMag / magSize) * 100 + '%';
}

// Entfernung zum nächstgelegenen anderen Spieler (unten rechts im HUD, wie im Referenzbild)
function updateNearestEnemyUI() {
    const distVal = document.getElementById('distance-val');
    if (!distVal) return;

    let nearestDist = null;
    for (const id in otherPlayers) {
        const d = camera.position.distanceTo(otherPlayers[id].position);
        if (nearestDist === null || d < nearestDist) nearestDist = d;
    }

    distVal.innerText = nearestDist !== null ? `${Math.round(nearestDist)}m` : '--';
}

const PLAYER_RADIUS = 0.5; // etwas schmaler als vorher (0.6) -> mehr Spielraum in 1-Tile-Korridoren

function isColliding() {
    // Box skaliert mit der aktuellen Augenhöhe -> beim Ducken automatisch niedrigere Kollisionsbox
    // (gleiches Verhältnis wie vorher: 0.75 unterhalb / 0.25 oberhalb der Kamera)
    const below = currentEyeHeight * 0.75;
    const above = currentEyeHeight * 0.25;
    const playerBox = new THREE.Box3();
    playerBox.min.set(camera.position.x - PLAYER_RADIUS, camera.position.y - below, camera.position.z - PLAYER_RADIUS);
    playerBox.max.set(camera.position.x + PLAYER_RADIUS, camera.position.y + above, camera.position.z + PLAYER_RADIUS);

    const near = collidersNear(camera.position.x, camera.position.z);
    for (let i = 0; i < near.length; i++) {
        if (playerBox.intersectsBox(near[i])) return true;
    }
    return false;
}

function checkCollisions(oldPosition) {
    if (!isColliding()) return; // keine Überschneidung -> nichts zu tun

    const newX = camera.position.x;
    const newZ = camera.position.z;

    // Achsen-getrenntes Sliding: zuerst versuchen, nur X zu behalten (Z zurücksetzen)
    camera.position.z = oldPosition.z;
    if (!isColliding()) return; // Bewegung entlang X war ok -> Spieler gleitet an der Wand entlang

    // sonst versuchen, nur Z zu behalten (X zurücksetzen)
    camera.position.x = oldPosition.x;
    camera.position.z = newZ;
    if (!isColliding()) return; // Bewegung entlang Z war ok -> Spieler gleitet an der Wand entlang

    // beide Achsen blockiert -> komplett zurücksetzen
    camera.position.x = oldPosition.x;
    camera.position.z = oldPosition.z;
}

// ================= Vertikale Kollision =================
// Ursache des "Stuck"-Bugs: checkCollisions() prüft nur die X/Z-Bewegung. Wer von oben (Turm, Rampe, Sprung) auf eine
// Wand fiel, sank ungebremst in den Block hinein - und weil dann auch die alte Position im Block lag, schlug jede
// weitere Bewegung fehl. Jetzt: (1) Landung auf Kollisionsboxen von oben, (2) Notausstieg, falls man trotzdem drinsteckt.

// true  = man landet auf Wand-/Säulen-Oberkanten und kann darauf stehen und laufen
// false = man wird von der Oberkante seitlich heruntergeschoben (Wände bleiben unbetretbar)
const COLLIDER_TOPS_WALKABLE = true;
const _stuckBox = new THREE.Box3();

// Sinkflug: wurde in diesem Frame die Oberkante einer Box von oben durchquert (und die Füße sind darüber)? -> darauf landen
function landOnColliderTops(prevFeetY) {
    if (!COLLIDER_TOPS_WALKABLE || velocity.y > 0 || colliders.length === 0) return;
    const px = camera.position.x, pz = camera.position.z;
    let top = -Infinity;
    const near = collidersNear(px, pz);
    for (let i = 0; i < near.length; i++) {
        const c = near[i];
        // nicht unter den Füßen (Spielerradius berücksichtigt)
        if (c.max.x <= px - PLAYER_RADIUS || c.min.x >= px + PLAYER_RADIUS || c.max.z <= pz - PLAYER_RADIUS || c.min.z >= pz + PLAYER_RADIUS) continue;
        if (c.max.y <= prevFeetY + 0.05 && c.max.y > feetY && c.max.y > top) top = c.max.y;
    }
    if (top > -Infinity) {
        feetY = top;
        velocity.y = 0;
        canJump = true;
    }
}

// Notausstieg: steckt die Spielermitte mitten in einer Box (z.B. nach Teleport/Respawn/sehr schnellem Fall), auf dem
// kürzesten Weg herausschieben (zur Seite oder hinauf auf die Oberkante). Greift bewusst nur bei "Mitte im Block" -
// normales Anstoßen an Wänden (Spielerradius) bleibt Sache von checkCollisions() und löst dies nie aus.

// Box, in der die Spielermitte (x,z) auf der Höhe von "feet" steckt - oder null
function colliderAroundCenter(px, pz, feet) {
    const lowY = feet + currentEyeHeight * 0.25;   // Unterkante der Kollisionsbox
    const highY = feet + currentEyeHeight * 1.25;  // Oberkante
    const near = collidersNear(px, pz);
    for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (px > c.min.x && px < c.max.x && pz > c.min.z && pz < c.max.z && lowY < c.max.y && highY > c.min.y) return c;
    }
    return null;
}

// Wäre die komplette Spielerbox (mit Radius) an dieser Stelle frei?
function spotIsFree(px, pz, feet) {
    const cy = feet + currentEyeHeight;
    _stuckBox.min.set(px - PLAYER_RADIUS, cy - currentEyeHeight * 0.75, pz - PLAYER_RADIUS);
    _stuckBox.max.set(px + PLAYER_RADIUS, cy + currentEyeHeight * 0.25, pz + PLAYER_RADIUS);
    const near = collidersNear(px, pz);
    for (let i = 0; i < near.length; i++) {
        if (_stuckBox.intersectsBox(near[i])) return false;
    }
    return true;
}

function unstickFromColliders() {
    const R = PLAYER_RADIUS, eps = 0.03;
    const hit = colliderAroundCenter(camera.position.x, camera.position.z, feetY);
    if (!hit) return; // Normalfall: nichts zu tun

    const px = camera.position.x, pz = camera.position.z;
    // Kandidaten: raus nach +X/-X/+Z/-Z oder hinauf auf die Oberkante. Nur Ziele nehmen, an denen die ganze Box frei
    // ist - sonst schiebt man den Spieler nur in den Nachbarblock (dicke Wände bestehen aus vielen aneinanderliegenden Boxen).
    const candidates = [
        { cost: Math.abs(hit.max.x + R + eps - px), x: hit.max.x + R + eps, z: pz, f: feetY },
        { cost: Math.abs(px - (hit.min.x - R - eps)), x: hit.min.x - R - eps, z: pz, f: feetY },
        { cost: Math.abs(hit.max.z + R + eps - pz), x: px, z: hit.max.z + R + eps, f: feetY },
        { cost: Math.abs(pz - (hit.min.z - R - eps)), x: px, z: hit.min.z - R - eps, f: feetY }
    ];
    if (COLLIDER_TOPS_WALKABLE && hit.max.y < 40) { // die 60 m hohe Außengrenze ist nie ein Ausstieg nach oben
        candidates.push({ cost: Math.max(0, hit.max.y - feetY) * 0.9, x: px, z: pz, f: hit.max.y, up: true });
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const best = candidates.find(c => spotIsFree(c.x, c.z, c.f));

    if (best) {
        camera.position.x = best.x;
        camera.position.z = best.z;
        feetY = best.f;
        if (best.up) { velocity.y = 0; canJump = true; }
        return;
    }

    // Kein freier Ausgang in direkter Nähe (z.B. eingeschlossen zwischen mehreren Blöcken): sicher zurück zum Spawn
    const sp = colliders.spawnPoints && colliders.spawnPoints.length
        ? colliders.spawnPoints[Math.floor(Math.random() * colliders.spawnPoints.length)] : null;
    if (sp) {
        camera.position.x = sp.x;
        camera.position.z = sp.z;
        feetY = sp.y - currentEyeHeight;
        velocity.set(0, 0, 0);
        canJump = true;
        showNotice('Eingeklemmt – zurückgesetzt');
    }
}

function onKeyChange(keyCode, isPressed) {
    switch (keyCode) {
        case 38: case 87: moveForward = isPressed; break;
        case 37: case 65: moveLeft = isPressed; break;
        case 40: case 83: moveBackward = isPressed; break;
        case 39: case 68: moveRight = isPressed; break;
        case 32: // Leertaste gehalten -> springt automatisch im Animate-Loop, sobald man landet (Bhop)
            spaceHeld = isPressed;
            break;
        case 67: // C
            crouchKeyC = isPressed;
            break;
        case 17: // Strg (links & rechts liefern beide keyCode 17)
            crouchKeyCtrl = isPressed;
            break;
        case 16: // Shift (links & rechts liefern beide keyCode 16)
            sprintHeld = isPressed;
            break;
        case 75: // K halten = Reset
            if (!isPressed) { resetHeld = false; resetLatch = false; resetHoldStart = null; }
            else if (!resetLatch) resetHeld = true;
            break;
        case 72: // H = Heilspritze benutzen
            if (!isPressed) healHeld = false;
            else if (!healHeld) { healHeld = true; socket.emit('useSyringe'); }
            break;
        case 82: // R
            if (isPressed) weapon.reload();
            break;
        case 69: // E halten = Bombe legen/entschärfen, Geisel befreien (Server prüft Nähe + Team)
            if (modes && modes.active && hasEntered && !isDead) modes.setHold(isPressed);
            else if (modes && !isPressed) modes.setHold(false);
            break;
        case 70: // F = Waffe ansehen (Inspect)
            if (isPressed && !isDead && hasEntered && (controls.isLocked || touchActive) && !buyOpen) weapon.inspect();
            break;
        case 49: case 50: case 51: case 52: case 53: case 54: // 1-6
            if (!isPressed || isDead) break;
            if (buyOpen) buyPick(keyCode - 49);                       // Kaufmenü offen: Taste = Waffe wählen
            else if (keyCode === 49) weapon.switchToSlot(0);          // 1 = Primärwaffe
            else if (keyCode === 50) weapon.switchToSlot(1);          // 2 = Sekundärwaffe
            else if (keyCode === 51) weapon.switchToSlot(2);          // 3 = Messer
            break;
        case 66: // B = Kaufmenü (Waffen wählen)
            if (isPressed && !isDead && hasEntered && (controls.isLocked || touchActive)) { if (buyOpen) closeBuyMenu(); else openBuyMenu(); }
            break;
    }
}

function setupTouchControls() {
    const joystickZone = document.getElementById('joystick-zone');
    const joystickKnob = document.getElementById('joystick-knob');
    const lookZone = document.getElementById('look-zone');
    const btnJump = document.getElementById('btn-jump');
    const btnFire = document.getElementById('btn-fire');
    const btnReload = document.getElementById('btn-reload');
    const btnReset = document.getElementById('btn-reset');
    const btnScope = document.getElementById('btn-scope');
    const btnHeal = document.getElementById('btn-heal');

    // --- Joystick: steuert dieselben move-Flags wie WASD ---
    joystickZone.addEventListener('touchstart', (e) => {
        if (joystickTouchId !== null) return;
        const t = e.changedTouches[0];
        joystickTouchId = t.identifier;
        const rect = joystickZone.getBoundingClientRect();
        joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        e.preventDefault();
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== joystickTouchId) continue;

            const dx = t.clientX - joystickCenter.x;
            const dy = t.clientY - joystickCenter.y;
            const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_MAX_RADIUS);
            const angle = Math.atan2(dy, dx);
            const knobX = Math.cos(angle) * dist;
            const knobY = Math.sin(angle) * dist;
            joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

            const nx = knobX / JOYSTICK_MAX_RADIUS;
            const ny = knobY / JOYSTICK_MAX_RADIUS;

            moveForward = ny < -0.3;
            moveBackward = ny > 0.3;
            moveLeft = nx < -0.3;
            moveRight = nx > 0.3;
        }
        e.preventDefault();
    }, { passive: false });

    function resetJoystick() {
        joystickTouchId = null;
        joystickKnob.style.transform = 'translate(-50%, -50%)';
        moveForward = moveBackward = moveLeft = moveRight = false;
    }

    joystickZone.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === joystickTouchId) resetJoystick();
        }
    });
    joystickZone.addEventListener('touchcancel', resetJoystick);

    // --- Look: rechte Bildschirmhälfte ziehen dreht die Kamera (Ersatz für Pointer Lock) ---
    lookZone.addEventListener('touchstart', (e) => {
        if (lookTouchId !== null) return;
        const t = e.changedTouches[0];
        lookTouchId = t.identifier;
        lookLastX = t.clientX;
        lookLastY = t.clientY;
        e.preventDefault();
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== lookTouchId) continue;

            const dx = t.clientX - lookLastX;
            const dy = t.clientY - lookLastY;
            lookLastX = t.clientX;
            lookLastY = t.clientY;

            lookEuler.setFromQuaternion(camera.quaternion);
            lookEuler.y -= dx * TOUCH_LOOK_SENSITIVITY * lookScale * userControls.sens * (1 + (userControls.adsSens - 1) * aimBlend);
            lookEuler.x -= dy * TOUCH_LOOK_SENSITIVITY * lookScale * userControls.sens * (1 + (userControls.adsSens - 1) * aimBlend) * (userControls.invertY ? -1 : 1);
            lookEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lookEuler.x));
            camera.quaternion.setFromEuler(lookEuler);
        }
        e.preventDefault();
    }, { passive: false });

    lookZone.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === lookTouchId) lookTouchId = null;
        }
    });
    lookZone.addEventListener('touchcancel', () => { lookTouchId = null; });

    // --- Buttons ---
    btnJump.addEventListener('touchstart', (e) => {
        onKeyChange(32, true); // gehalten halten = automatisch weiterspringen, wie bei der Leertaste
        e.preventDefault();
    }, { passive: false });
    btnJump.addEventListener('touchend', (e) => {
        onKeyChange(32, false);
        e.preventDefault();
    }, { passive: false });
    btnJump.addEventListener('touchcancel', () => onKeyChange(32, false));

    btnFire.addEventListener('touchstart', (e) => {
        fireHeld = true;
        handleShooting();
        e.preventDefault();
    }, { passive: false });
    btnFire.addEventListener('touchend', (e) => { fireHeld = false; e.preventDefault(); }, { passive: false });
    btnFire.addEventListener('touchcancel', () => { fireHeld = false; });

    btnReload.addEventListener('touchstart', (e) => {
        weapon.reload();
        e.preventDefault();
    }, { passive: false });

    if (btnHeal) {
        btnHeal.addEventListener('touchstart', (e) => { socket.emit('useSyringe'); e.preventDefault(); }, { passive: false });
    }

    if (btnScope) {
        // Touch hat keine rechte Maustaste -> Zielen per Antippen ein/aus
        btnScope.addEventListener('touchstart', (e) => {
            weapon.setAiming(!weapon.aimWanted);
            btnScope.style.background = weapon.aimWanted ? 'rgba(0,240,255,0.35)' : '';
            e.preventDefault();
        }, { passive: false });
    }

    if (btnReset) {
        btnReset.addEventListener('touchstart', (e) => { onKeyChange(75, true); e.preventDefault(); }, { passive: false });
        btnReset.addEventListener('touchend', (e) => { onKeyChange(75, false); e.preventDefault(); }, { passive: false });
        btnReset.addEventListener('touchcancel', () => onKeyChange(75, false));
    }

    const btnBuy = document.getElementById('btn-buy');
    if (btnBuy) btnBuy.addEventListener('touchstart', (e) => { if (buyOpen) closeBuyMenu(); else openBuyMenu(); e.preventDefault(); }, { passive: false });
    const btnSwitch = document.getElementById('btn-switch-weapon');
    if (btnSwitch) {
        btnSwitch.addEventListener('touchstart', (e) => {
            weapon.switchNext(); // Touch hat keine Zahlentasten -> zyklisch durchwechseln
            e.preventDefault();
        }, { passive: false });
    }
}

// --- Kill Feed ---
const KILL_FEED_MAX = 6;
const KILL_FEED_DURATION = 4000; // ms

function addKillFeedEntry(killer, victim, iMadeKill, iDied) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const el = document.createElement('div');
    el.className = 'kf-entry' + (iMadeKill ? ' kf-me-kill' : '') + (iDied ? ' kf-me-died' : '');
    el.innerHTML = `<span class="kf-killer">${esc(killer)}</span><span class="kf-verb"> ⬡ </span><span class="kf-victim">${esc(victim)}</span>`;
    feed.prepend(el);
    while (feed.children.length > KILL_FEED_MAX) feed.lastChild.remove();
    setTimeout(() => el.remove(), KILL_FEED_DURATION);
}

// Waffen-Ereignisse -> Sounds (die Waffen selbst wissen nichts von Audio)
function handleWeaponEvent(type, idx) {
    switch (type) {
        case 'shoot': sfx.playShot(idx); break;
        case 'dry': sfx.playDry(); break;
        case 'reloadStart': sfx.playReload('out', idx); socket.emit('reloadStarted', { w: idx }); break; // Server führt das Magazin mit
        case 'reloadMid': sfx.playReload('in', idx); break;
        case 'reloadEnd': sfx.playReload('bolt', idx); break;
        case 'draw': sfx.playDraw(idx); break;
    }
}

// ================= Level / XP / Skins =================


// Nach Wechsel des Spielstands (Login, Server-Abgleich): Waffen, Skin und HUD neu setzen
function refreshProgressUI() {
    weapon.setLevel(prog.getProgress().level);
    lastSlotKey = '';
    applyOwnSkin();
    updateXpUI();
    renderWeaponSlots();
}

// Speichern an den Server: gedrosselt (max. alle 4 s), sofort bei Level-Up/Skinwechsel/Seite verlassen
function queueProgressSave() {
    if (!prog.isPersistent() || progressSaveTimer) return;
    progressSaveTimer = setTimeout(flushProgress, 4000);
}
function flushProgress() {
    if (progressSaveTimer) { clearTimeout(progressSaveTimer); progressSaveTimer = null; }
    if (prog.isPersistent() && progressSynced) socket.emit('saveProgress', prog.getState());
}

function applyOwnSkin() {
    if (setKnifeVariant(prog.getKnifeType())) weapon.rebuildKnife(); // anderer Messertyp gewählt (z. B. nach Namenswechsel)
    // Jede Waffe trägt ihren eigenen Skin (Muster auf der ganzen Waffe + Akzentfarbe)
    weapon.setSkins(WEAPON_CONFIGS.map((_, i) => SKINS[prog.getWeaponSkin(i)] || SKINS[0]));
}

function sendProfile() {
    socket.emit('setProfile', { level: prog.getProgress().level, skin: prog.getSkinId() });
}

function updateXpUI() {
    const p = prog.getProgress();
    const lv = document.getElementById('xp-level');
    const tx = document.getElementById('xp-text');
    const fill = document.getElementById('xp-fill');
    if (lv) lv.textContent = 'LV ' + p.level;
    if (tx) tx.textContent = p.max ? 'MAX' : `${p.xpInLevel} / ${p.need} XP`;
    if (fill) fill.style.width = (p.max ? 100 : (p.xpInLevel / p.need) * 100) + '%';
    // Hauptmenü: gleiche Anzeige
    const mlv = document.getElementById('mm-level'), mtx = document.getElementById('mm-xptext'), mf = document.getElementById('mm-xpfill');
    if (mlv) mlv.textContent = 'LV ' + p.level;
    if (mtx) mtx.textContent = p.max ? 'MAX' : `${p.xpInLevel} / ${p.need} XP`;
    if (mf) mf.style.width = (p.max ? 100 : (p.xpInLevel / p.need) * 100) + '%';
}

// ---- Hauptmenü: 3D-Schaufenster (Soldat / Primär- / Sekundärwaffe mit dem gewählten Skin) ----
function refreshMenu() {
    setKnifeVariant(prog.getKnifeType());
    const wrap = document.getElementById('mm-views');
    if (!wrap || hasEntered) return;
    const lo = prog.getLoadout();
    const views = [['char', 'SOLDAT'], ['w0', WEAPON_CONFIGS[lo[0]].name.toUpperCase()], ['w1', WEAPON_CONFIGS[lo[1]].name.toUpperCase()], ['k', 'MESSER']];
    wrap.innerHTML = views.map(([k, t]) => `<button class="mm-view${k === mmView ? ' active' : ''}" data-v="${k}">${esc(t)}</button>`).join('');
    wrap.querySelectorAll('.mm-view').forEach(b => b.addEventListener('click', () => { mmView = b.dataset.v; refreshMenu(); }));

    const target = mmView === 'char' ? 'char' : mmView === 'k' ? WEAPON_CONFIGS.length - 1 : lo[mmView === 'w0' ? 0 : 1];
    const skinId = target === 'char' ? prog.getSkinId() : prog.getWeaponSkin(target);
    const sk = SKINS[skinId], r = rarityOf(sk);
    document.getElementById('mm-stage-info').innerHTML =
        `<div class="i-weapon">${target === 'char' ? 'NEON-SOLDAT' : esc(WEAPON_CONFIGS[target].name.toUpperCase())}</div>` +
        `<div class="i-skin" style="color:${r.color}">${esc(skinId === 0 ? 'Standard' : sk.name)}</div><div class="i-rarity" style="color:${r.color}">${r.name.toUpperCase()}</div>`;
    if (!menuPreview) { menuPreview = createPreview(document.getElementById('mm-canvas')); menuPreview.start(); }
    menuPreview.show(target, skinId);
}

function popXp(text) {
    const el = document.getElementById('xp-pop');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // Animation neu starten
    el.classList.add('show');
}

function awardXp(amount, isKill = false) {
    if (!(amount > 0)) return;
    const r = prog.addXp(amount);
    if (isKill) popXp(`KILL +${amount} XP`);
    updateXpUI();
    queueProgressSave();
    if (r.levelUp) onLevelUp(r.from, r.to);
}

function onLevelUp(from, to) {
    weapon.setLevel(to);
    lastSlotKey = '';
    renderWeaponSlots();
    sendProfile();
    flushProgress(); // Level-Up sofort sichern
    sfx.playLevelUp();

    const lines = [];
    const got = to - from;
    lines.push(`🎁 ${got > 1 ? got + ' neue Kisten' : 'Neue Kiste'}! (${prog.getCrates()} im Inventar)`);

    const banner = document.getElementById('levelup-banner');
    if (!banner) return;
    banner.querySelector('.lu-level').textContent = `Level ${to}`;
    banner.querySelector('.lu-unlocks').innerHTML = lines.map(esc).join('<br>');
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    if (levelBannerTimer) clearTimeout(levelBannerTimer);
    levelBannerTimer = setTimeout(() => banner.classList.remove('show'), 4200);
}

// Waffenleiste unten: die zwei ausgerüsteten Waffen, die aktive hervorgehoben
function renderWeaponSlots() {
    const el = document.getElementById('weapon-slots');
    if (!el || !weapon) return;
    const key = weapon.activeIndex + '|' + weapon.loadout.join(',') + '|' + weapon.armed;
    if (key === lastSlotKey) return;
    lastSlotKey = key;
    const slot = (n, wi, label) => `<div class="wslot${wi === weapon.activeIndex ? ' active' : ''}${label === null ? ' empty' : ''}"><b>${n}</b>${label === null ? '—' : esc(label)}</div>`;
    el.innerHTML = slot(1, weapon.loadout[0], weapon.armed ? WEAPON_CONFIGS[weapon.loadout[0]].name : null) +
        slot(2, weapon.loadout[1], weapon.armed ? WEAPON_CONFIGS[weapon.loadout[1]].name : null) +
        slot(3, WEAPON_CONFIGS.length - 1, 'Messer') + (weapon.armed ? '' : '<div class="wslot buyhint"><b>B</b>WAFFEN</div>');
}

// ================= Waffen: Kaufmenü (Taste B) wie im CS-Deathmatch, ohne Geld =================
// Man startet nur mit dem Messer. B öffnet das Menü: erst Primär-, dann Sekundärwaffe wählen (Maus oder Tasten 1-6).
// Nach dem Tod bekommt man die zuletzt gewählten Waffen wieder (wie im Deathmatch); mit B kann man jederzeit neu wählen.
const BUY_WEAPONS = [0, 1, 2, 3, 4, 5];
let buyChosen = false;     // in dieser Sitzung schon gekauft?
let buyOpen = false, buyFirst = null;

function applyLoadout() {
    if (!(buyChosen && weapon.setLoadout(prog.getLoadout()))) weapon.disarm();
    lastSlotKey = '';
    renderWeaponSlots();
    socket.emit('setLoadout', weapon.armed ? weapon.loadout : []); // Server erlaubt Schüsse nur mit gekauften Waffen + Messer
}
const renderAllPickers = () => refreshMenu(); // Hauptmenü-Schaufenster

// ---- Vorschaubilder: Waffe MIT Skin als Bild (wie in CS2), lazy und nacheinander erzeugt ----
let thumbMaker = null; const thumbQueue = []; let thumbBusy = false;
function applyThumb(el, url) { el.style.backgroundImage = `url(${url})`; el.dataset.done = '1'; }
function queueThumbs(root) {
    if (!root) return;
    if (!thumbMaker) thumbMaker = createThumbMaker();
    root.querySelectorAll('[data-t]:not([data-done])').forEach(el => {
        const [t, id] = el.dataset.t.split(':');
        const target = t === 'char' ? 'char' : parseInt(t, 10), sid = parseInt(id, 10);
        if (thumbMaker.has(target, sid)) applyThumb(el, thumbMaker.make(target, sid));
        else thumbQueue.push({ el, target, sid });
    });
    pumpThumbs();
}
function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    const step = () => {
        const j = thumbQueue.shift();
        if (!j) { thumbBusy = false; return; }
        if (j.el.isConnected && !j.el.dataset.done) {
            let url = null;
            try { url = thumbMaker.make(j.target, j.sid); } catch (e) { url = null; }
            if (url) applyThumb(j.el, url);
            else { j.el.dataset.done = '1'; const s = SKINS[j.sid]; if (s && s.pattern && j.target === 'char') j.el.style.background = `${getSkinPreview(s)} center / cover`; }
        }
        setTimeout(step, 0);
    };
    step();
}

function renderBuyMenu() {
    const el = document.getElementById('buy-menu');
    if (!el) return;
    el.querySelector('.buy-title').textContent = buyFirst === null ? 'PRIMÄRWAFFE WÄHLEN' : 'SEKUNDÄRWAFFE WÄHLEN';
    el.querySelector('.buy-sub').textContent = weapon.armed
        ? `Aktuell: ${WEAPON_CONFIGS[weapon.loadout[0]].name} + ${WEAPON_CONFIGS[weapon.loadout[1]].name}`
        : 'Aktuell: nur Messer';
    el.querySelector('.buy-list').innerHTML = BUY_WEAPONS.map(i => {
        const c = WEAPON_CONFIGS[i], sk = SKINS[prog.getWeaponSkin(i)], r = rarityOf(sk);
        const dmg = c.damage * (c.pellets || 1), rpm = Math.round(60 / c.fireCooldown);
        return `<div class="buy-card${buyFirst === i ? ' picked' : ''}" data-w="${i}" style="--rc:${r.color}">
            <span class="buy-key">${i + 1}</span><div class="buy-img" data-t="${i}:${sk.id}"></div>
            <div class="buy-name">${esc(c.name)}</div><small>${esc(sk.name)}</small>
            <div class="buy-stat">${c.pellets > 1 ? c.damage + '×' + c.pellets : dmg} Schaden · ${rpm}/min · ${c.magSize} Schuss</div>
            ${buyFirst === i ? '<div class="buy-tag">PRIMÄR</div>' : ''}</div>`;
    }).join('');
    el.querySelectorAll('.buy-card').forEach(c => c.addEventListener('click', () => buyPick(parseInt(c.dataset.w, 10))));
    queueThumbs(el);
}
function openBuyMenu() {
    if (buyOpen || isDead || !hasEntered || !weapon) return;
    buyOpen = true; buyFirst = null;
    document.getElementById('buy-menu').style.display = 'flex';
    renderBuyMenu();
}
function closeBuyMenu() {
    buyOpen = false; buyFirst = null;
    const el = document.getElementById('buy-menu');
    if (el) el.style.display = 'none';
}
function buyPick(i) {
    if (!buyOpen || !BUY_WEAPONS.includes(i)) return;
    if (buyFirst === null) { buyFirst = i; renderBuyMenu(); return; }
    if (i === buyFirst) return;
    prog.setLoadout([buyFirst, i]);
    buyChosen = true;
    flushProgress();
    applyLoadout();
    closeBuyMenu();
}

// ---- Tod / Respawn ----
function enterDeadState(killerName) {
    closeBuyMenu();
    isDead = true;
    fireHeld = false;
    resetHeld = false;
    weapon.setAiming(false);
    document.getElementById('respawn-killer').textContent = killerName;
    ['pause-menu', 'settings-panel', 'loadout-panel'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    document.getElementById('respawn-panel').style.display = 'flex';
    renderAllPickers();

    let left = RESPAWN_AUTO_SECONDS;
    const countEl = document.getElementById('respawn-count');
    countEl.textContent = left;
    clearInterval(respawnTimerId);
    respawnTimerId = setInterval(() => {
        left--;
        countEl.textContent = Math.max(0, left);
        if (left <= 0) doRespawn(); // Sicherung: nach ein paar Sekunden automatisch weiter
    }, 1000);
    if (controls.isLocked) controls.unlock(); // Maus frei für die Waffenwahl
}

const respawnLocked = () => respawnBlocked || !!(modes && modes.active && modes.state.noRespawn && modes.state.phase === 'live');
function doRespawn() {
    if (!isDead) return;
    if (respawnLocked()) {                // Bombenmodus: nach dem Legen gibt es bis zur nächsten Runde keinen Respawn
        const c = document.getElementById('respawn-count');
        if (c) c.textContent = '–';
        clearInterval(respawnTimerId);
        respawnTimerId = setInterval(() => { if (!respawnLocked()) doRespawn(); }, 500);
        return;
    }
    clearInterval(respawnTimerId);
    respawnTimerId = null;
    isDead = false;
    document.getElementById('respawn-panel').style.display = 'none';
    applyLoadout();                       // die gewählten 2 Waffen gelten ab jetzt
    weapon.refillAll();                   // volle Magazine
    weapon.setAiming(false);
    socket.emit('respawnReady');          // Server: ab jetzt wieder treffbar (nach kurzem Spawn-Schutz)
    if (!isTouchDevice) controls.lock();  // Klick auf den Button = Nutzeraktion, Maus wird wieder gefangen
}

// andere Spieler: unsichtbar + nicht treffbar, solange sie auf den Respawn warten (Layer 1 wird vom Schuss-Raycast ignoriert)
function setPlayerVisible(mesh, on) {
    mesh.visible = on;
    mesh.layers.set(on ? 0 : 1);
    mesh.traverse((o) => {
        if (o === mesh) return;
        if (o.name === 'nametag') setNametagVisible(o, on && showNametags);
        else o.layers.set(on ? 0 : 1);
    });
}

// ---- Inventar (CS2-Stil): Waffen/Soldat als Karten, 3D-Vorschau, unten alle eigenen Skins (Bild = Waffe MIT Skin) ----
// Skins werden per Drag & Drop auf die passende Waffe gezogen (oder: Karte anklicken + AUSRÜSTEN). Skins gibt es aus Kisten.
const INV_TARGETS = ['char', 0, 1, 2, 3, 4, 5, 6];
const TARGET_DE = (t) => t === 'char' ? 'Soldat' : t === WEAPON_CONFIGS.length - 1 ? 'Messer' : WEAPON_CONFIGS[t].name;
let invOnly = true;       // nur Skins der gewählten Waffe zeigen (Standard; per Knopf auf alle umschaltbar)
const STAT_MAX = {
    dmg: Math.max(...WEAPON_CONFIGS.map(c => c.damage * (c.pellets || 1))),
    rpm: Math.max(...WEAPON_CONFIGS.map(c => 60 / c.fireCooldown)),
    mag: Math.max(...WEAPON_CONFIGS.filter(c => !c.melee).map(c => c.magSize))
};

function openInventory(fromLogin = false) {
    skinTarget = 'char';
    invSkin = null;
    invRarity = 'all';
    document.getElementById('loadout-panel').style.display = 'block';
    renderLoadout();
    if (invPreview) invPreview.start();
}
function closeInventory() {
    closeCrateOverlay();
    document.getElementById('loadout-panel').style.display = 'none';
    if (invPreview) invPreview.stop();
    refreshMenu();
}

const equippedSkinFor = (t) => t === 'char' ? prog.getSkinId() : prog.getWeaponSkin(t);

function renderLoadout() {
    setKnifeVariant(prog.getKnifeType());
    const p = prog.getProgress();
    const lvl = document.getElementById('loadout-level');
    if (lvl) lvl.innerHTML = `Level ${p.level} — ${p.xpInLevel} / ${p.need} XP · 🎁 ${prog.getCrates()} Kisten · ${prog.getOwned().length} Skins`;
    renderInvSide(p);
    renderInvSkins(p);
    renderInvStage(p);
}

function renderInvSide() {
    const html = INV_TARGETS.map(t => {
        const sk = SKINS[equippedSkinFor(t)], r = rarityOf(sk);
        return `<div class="inv-row${String(t) === String(skinTarget) ? ' active' : ''}" data-target="${t}" style="--rc:${r.color}">
            <div class="inv-thumb" data-t="${t}:${sk.id}"></div>
            <div class="r-name">${esc(TARGET_DE(t))}<small>${esc(sk.name)}</small></div></div>`;
    }).join('');
    const side = document.getElementById('inv-side');
    const scroll = side.scrollTop;
    side.innerHTML = `<div class="inv-cat">AUSGERÜSTET · SKIN AUF EINE KARTE ZIEHEN</div>` + html;
    side.scrollTop = scroll;
    side.querySelectorAll('.inv-row').forEach(r => r.addEventListener('click', () => {
        skinTarget = r.dataset.target === 'char' ? 'char' : parseInt(r.dataset.target, 10);
        invSkin = null;
        renderLoadout();
    }));
    queueThumbs(side);
}

// 3D-Vorschau, Name/Seltenheit, Werte und Aktionsknöpfe für das gewählte Ziel + den angesehenen Skin
function renderInvStage(p) {
    const viewId = invSkin ?? equippedSkinFor(skinTarget);
    const sk = SKINS[viewId], r = rarityOf(sk);
    const isChar = skinTarget === 'char';
    const cfg = isChar ? null : WEAPON_CONFIGS[skinTarget];

    if (!invPreview) {
        invPreview = createPreview(document.getElementById('inv-canvas'));
        invPreview.start();
    }
    const ok = invPreview.show(skinTarget, viewId);
    document.getElementById('inv-fail').style.display = ok ? 'none' : 'flex';

    document.getElementById('inv-info').innerHTML =
        `<div class="i-weapon">${esc(TARGET_DE(skinTarget).toUpperCase())}</div>` +
        `<div class="i-skin" style="color:${r.color}">${esc(viewId === 0 ? 'Standard' : sk.name)}</div>` +
        `<div class="i-rarity" style="color:${r.color}">${r.name.toUpperCase()}${sk.pattern ? '' : ' · Original'}</div>`;

    const stats = document.getElementById('inv-stats');
    if (isChar) stats.innerHTML = '';
    else {
        const dmg = cfg.damage * (cfg.pellets || 1), rpm = Math.round(60 / cfg.fireCooldown);
        const bar = (label, val, max, txt) => `<div class="inv-stat"><span>${label}</span><i><b style="width:${Math.max(4, Math.round(100 * val / max))}%"></b></i><em>${txt}</em></div>`;
        stats.innerHTML = bar('SCHADEN', dmg, STAT_MAX.dmg, cfg.pellets > 1 ? `${cfg.damage}×${cfg.pellets}` : dmg) +
            bar('FEUERRATE', rpm, STAT_MAX.rpm, rpm) + (cfg.melee ? '' : bar('MAGAZIN', cfg.magSize, STAT_MAX.mag, cfg.magSize));
    }

    const equippedId = equippedSkinFor(skinTarget);
    const equipped = viewId === equippedId;
    const crates = prog.getCrates();
    document.getElementById('inv-actions').innerHTML =
        `<button class="inv-btn primary" id="inv-equip"${equipped ? ' disabled' : ''}>${equipped ? 'AUSGERÜSTET ✔' : 'SKIN AUSRÜSTEN'}</button>` +
        `<button class="inv-btn" id="inv-default"${equippedId === 0 ? ' disabled' : ''}>STANDARD</button><span class="inv-sep"></span>` +
        `<button class="inv-btn warn" id="inv-crate"${crates > 0 ? '' : ' disabled'}>🎁 KISTE ÖFFNEN (${crates})</button>` +
        `<button class="inv-btn" id="inv-trade">🔁 TRADE-UP</button>` +
        `<div id="loadout-note">${crates > 0 ? 'Du hast ungeöffnete Kisten!' : 'Pro Level-Aufstieg gibt es eine Kiste. Waffen wählst du im Spiel mit B.'}</div>` +
        (skinTarget === KNIFE_INDEX ? `<div class="knife-types"><span class="kt-h">MESSERTYP</span>${KNIFE_TYPES.map((k, i) => `<button class="inv-btn${prog.getKnifeType() === i ? ' on' : ''}" data-kt="${i}">${esc(k.name)}</button>`).join('')}</div>` : '');
    document.getElementById('inv-equip').addEventListener('click', () => equipSkinTo(skinTarget, viewId));
    document.getElementById('inv-default').addEventListener('click', () => equipSkinTo(skinTarget, 0));
    document.getElementById('inv-crate').addEventListener('click', openCrateOverlay);
    document.getElementById('inv-trade').addEventListener('click', openTradeUp);
    document.querySelectorAll('#inv-actions [data-kt]').forEach(b => b.addEventListener('click', () => {
        if (prog.setKnifeType(parseInt(b.dataset.kt, 10))) { setKnifeVariant(prog.getKnifeType()); if (weapon) weapon.rebuildKnife(); flushProgress(); applyOwnSkin(); renderLoadout(); refreshMenu(); }
    }));
}

function equipSkinTo(target, id) {
    if (!SKINS[id]) return;
    if (!prog.hasSkin(id)) { showNotice('Diesen Skin besitzt du nicht'); return; }
    if (id !== 0 && SKINS[id].target !== target) { showNotice(`Dieser Skin passt nicht auf: ${TARGET_DE(target)}`); return; }
    let ok;
    if (target === 'char') { ok = prog.setSkinId(id); if (ok) sendProfile(); }
    else { ok = prog.setWeaponSkin(target, id); if (ok) applyOwnSkin(); }
    if (ok) { flushProgress(); skinTarget = target; invSkin = null; renderLoadout(); }
}

function renderInvSkins(p) {
    const filter = document.getElementById('inv-filter');
    filter.innerHTML = `<button class="inv-chip${invRarity === 'all' ? ' active' : ''}" data-r="all">ALLE</button>` +
        RARITIES.filter(r => r.odds).map(r => `<button class="inv-chip${invRarity === r.key ? ' active' : ''}" data-r="${r.key}" style="--rc:${r.color}">${r.name}</button>`).join('') +
        `<span class="inv-sep"></span><button class="inv-chip${invOnly ? ' active' : ''}" data-only="1">NUR ${esc(TARGET_DE(skinTarget).toUpperCase())}</button>` +
        `<button class="inv-chip${invOnly ? '' : ' active'}" data-only="0">ALLE SKINS</button>`;
    filter.querySelectorAll('.inv-chip[data-r]').forEach(c => c.addEventListener('click', () => { invRarity = c.dataset.r; renderInvSkins(prog.getProgress()); }));
    filter.querySelectorAll('[data-only]').forEach(b => b.addEventListener('click', () => { invOnly = b.dataset.only === '1'; renderInvSkins(prog.getProgress()); }));

    const viewing = invSkin ?? equippedSkinFor(skinTarget);
    const rank = Object.fromEntries(RARITIES.map((r, i) => [r.key, i]));
    const list = prog.getOwned().map(id => SKINS[id]).filter(s => s &&
        (invRarity === 'all' || s.rarity === invRarity) && (!invOnly || s.target === skinTarget))
        .sort((a, b) => (a.target === 'char' ? 99 : a.target) - (b.target === 'char' ? 99 : b.target) || rank[b.rarity] - rank[a.rarity] || a.id - b.id);
    const grid = document.getElementById('skin-grid');
    const keepScroll = grid.scrollTop;
    grid.innerHTML = list.length ? list.map(s => {
        const r = rarityOf(s);
        return `<div class="skin-card${s.id === viewing ? ' viewing' : ''}${s.id === equippedSkinFor(s.target) ? ' equipped' : ''}" data-skin="${s.id}" draggable="true" style="--rc:${r.color}">
            ${prog.getCount(s.id) > 1 ? `<span class="sc-cnt">×${prog.getCount(s.id)}</span>` : ''}<div class="skin-img" data-t="${s.target}:${s.id}"></div><div class="sc-name">${esc(skinFullName(s))}</div><small style="color:${r.color}">${r.name}</small></div>`;
    }).join('') : `<div class="skin-empty">${prog.getOwned().length ? 'Keine Skins in diesem Filter.' : 'Noch keine Skins. Öffne Kisten – du bekommst eine pro Level-Aufstieg!'}</div>`;
    grid.scrollTop = keepScroll;
    grid.querySelectorAll('.skin-card').forEach(card => {
        card.addEventListener('click', () => {            // ansehen: wechselt zur passenden Waffe und zeigt den Skin
            const s = SKINS[parseInt(card.dataset.skin, 10)];
            skinTarget = s.target; invSkin = s.id;
            renderLoadout();
        });
        card.addEventListener('dblclick', () => equipSkinTo(SKINS[parseInt(card.dataset.skin, 10)].target, parseInt(card.dataset.skin, 10)));
    });
    queueThumbs(grid);
}

// ---- Drag & Drop (nur Skins): Skin-Karte -> Waffenkarte (oder 3D-Vorschau) = ausrüsten ----
let dragData = null;
function wireInventoryDnd(panel) {
    const dropEl = (e) => e.target.closest('.inv-row, .inv-stage');
    panel.addEventListener('dragstart', (e) => {
        const k = e.target.closest('.skin-card');
        if (!k) { e.preventDefault(); return; }
        dragData = { id: parseInt(k.dataset.skin, 10) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData)); // Firefox startet das Ziehen nur mit gesetzten Daten
        panel.classList.add('dragging-s');
    });
    panel.addEventListener('dragend', () => {
        dragData = null;
        panel.classList.remove('dragging-s');
        panel.querySelectorAll('.drop-ok, .drop-bad').forEach(x => x.classList.remove('drop-ok', 'drop-bad'));
    });
    const fits = (el) => {
        if (!dragData) return null;
        if (el.classList.contains('inv-row')) { const t = el.dataset.target === 'char' ? 'char' : parseInt(el.dataset.target, 10); return SKINS[dragData.id].target === t; }
        return true;                                                          // Vorschau: Skin geht auf seine eigene Waffe
    };
    panel.addEventListener('dragover', (e) => {
        const el = dropEl(e);
        panel.querySelectorAll('.drop-ok, .drop-bad').forEach(x => { if (x !== el) x.classList.remove('drop-ok', 'drop-bad'); });
        if (!el || !dragData) return;
        e.preventDefault();
        const ok = fits(el);
        e.dataTransfer.dropEffect = ok ? 'move' : 'none';
        el.classList.toggle('drop-ok', !!ok); el.classList.toggle('drop-bad', !ok);
    });
    panel.addEventListener('drop', (e) => {
        const el = dropEl(e);
        if (!el || !dragData) return;
        e.preventDefault();
        const d = dragData; dragData = null;
        panel.classList.remove('dragging-s');
        el.classList.remove('drop-ok', 'drop-bad');
        const target = el.classList.contains('inv-row') ? (el.dataset.target === 'char' ? 'char' : parseInt(el.dataset.target, 10)) : SKINS[d.id].target;
        equipSkinTo(target, d.id);
    });
}

// ---- Kisten öffnen (wie CS2): Streifen läuft durch, bleibt beim Gewinn stehen ----
// ---- Trade-up-Vertrag: 10 Skins gleicher Seltenheit -> 1 Skin der nächsten Stufe ----
let tuRarity = 'm', tuPick = [], tuResult = null;
const TU_KEYS = ['m', 'r', 'c', 'v'];
function openTradeUp() {
    tuPick = []; tuResult = null;
    document.getElementById('tu-overlay').style.display = 'flex';
    renderTradeUp();
}
function closeTradeUp() {
    document.getElementById('tu-overlay').style.display = 'none';
    if (document.getElementById('loadout-panel').style.display === 'block') { renderInvSide(); renderInvSkins(prog.getProgress()); renderInvStage(prog.getProgress()); renderLoadout(); }
}
const tuUsed = (id) => tuPick.filter(x => x === id).length;
function renderTradeUp() {
    const ov = document.getElementById('tu-overlay');
    ov.querySelector('#tu-info').textContent = `${tuPick.length} / ${prog.TRADE_COUNT} gewählt`;
    const next = prog.NEXT_RARITY[tuRarity], nr = RARITIES.find(r => r.key === next);
    ov.querySelector('#tu-tabs').innerHTML = TU_KEYS.map(k => { const r = RARITIES.find(x => x.key === k); return `<button data-r="${k}" class="${k === tuRarity ? 'sel' : ''}" style="--rc:${r.color}">${r.name}</button>`; }).join('');
    ov.querySelectorAll('#tu-tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.r !== tuRarity) { tuRarity = b.dataset.r; tuPick = []; tuResult = null; } renderTradeUp(); }));
    const owned = prog.getOwned().map(id => SKINS[id]).filter(s => s && s.rarity === tuRarity).sort((a, b) => (a.target === 'char' ? 99 : a.target) - (b.target === 'char' ? 99 : b.target) || a.id - b.id);
    const list = ov.querySelector('#tu-list');
    list.innerHTML = owned.length ? owned.map(s => {
        const left = prog.getCount(s.id) - tuUsed(s.id), r = rarityOf(s);
        return `<div class="tu-card${left <= 0 ? ' none' : ''}" data-id="${s.id}" style="--rc:${r.color}"><span class="tu-n">×${left}</span><div class="skin-img" data-t="${s.target}:${s.id}"></div>${esc(skinFullName(s))}</div>`;
    }).join('') : `<div class="tu-empty">Du hast keine ${esc(RARITIES.find(r => r.key === tuRarity).name)}-Skins.</div>`;
    list.querySelectorAll('.tu-card').forEach(c => c.addEventListener('click', () => {
        const id = parseInt(c.dataset.id, 10);
        if (tuPick.length >= prog.TRADE_COUNT || prog.getCount(id) - tuUsed(id) <= 0) return;
        tuPick.push(id); tuResult = null; renderTradeUp();
    }));
    queueThumbs(list);
    const slots = ov.querySelector('#tu-slots');
    slots.innerHTML = Array.from({ length: prog.TRADE_COUNT }, (_, i) => `<div class="tu-slot" data-i="${i}" ${tuPick[i] ? `data-t="${SKINS[tuPick[i]].target}:${tuPick[i]}" style="--rc:${rarityOf(SKINS[tuPick[i]]).color}"` : ''}></div>`).join('');
    slots.querySelectorAll('.tu-slot').forEach(sl => sl.addEventListener('click', () => { const i = parseInt(sl.dataset.i, 10); if (tuPick[i]) { tuPick.splice(i, 1); renderTradeUp(); } }));
    queueThumbs(slots);
    const out = ov.querySelector('#tu-out');
    if (tuResult) {
        const s = tuResult.skin, r = rarityOf(s);
        out.innerHTML = `<div class="cr-big" data-t="${s.target}:${s.id}"></div><b style="color:${r.color}">${r.name.toUpperCase()}</b><div style="color:#fff">${esc(skinFullName(s))}</div><div>${tuResult.dupe ? `Du hattest ihn schon – jetzt ×${prog.getCount(s.id)}` : 'Neu in deinem Inventar!'}</div>`;
        queueThumbs(out);
    } else out.innerHTML = `Ergebnis: 1 Skin <b style="color:${nr.color}">${nr.name}</b><br>aus der Sammlung eines der gewählten Skins`;
    ov.querySelector('#tu-go').disabled = tuPick.length !== prog.TRADE_COUNT;
}
function runTradeUp() {
    if (tuPick.length !== prog.TRADE_COUNT) return;
    const res = prog.tradeUp(tuPick.slice());
    if (!res) { showNotice('Vertrag ungültig'); return; }
    tuPick = []; tuResult = res;
    flushProgress(); applyOwnSkin();
    if (['c', 'v', 'g'].includes(res.skin.rarity)) sfx.playLevelUp();
    renderTradeUp();
}

let crateBusy = false;
let selCrate = 'neon';   // gewählte Kistenart
function openCrateOverlay() {
    const ov = document.getElementById('crate-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    renderCrateOverlay(null);
}
function closeCrateOverlay() {
    const ov = document.getElementById('crate-overlay');
    if (ov && !crateBusy) ov.style.display = 'none';
}
function renderCrateOverlay(result) {
    const ov = document.getElementById('crate-overlay');
    const crates = prog.getCrates();
    const ct = CRATES[selCrate];
    const pk = ov.querySelector('.cr-pick');
    if (pk) {
        pk.innerHTML = Object.values(CRATES).map(c => { const n = Object.values(CRATE_POOLS[c.key]).reduce((a, l) => a + l.length, 0); return `<button class="cr-type${c.key === selCrate ? ' sel' : ''}" data-ck="${c.key}" style="--cc:${c.color}" ${crateBusy ? 'disabled' : ''}><b>${c.name}</b><small>${n} Skins</small></button>`; }).join('');
        pk.querySelectorAll('.cr-type').forEach(b => b.addEventListener('click', () => { if (crateBusy) return; selCrate = b.dataset.ck; renderCrateOverlay(null); }));
    }
    ov.querySelector('.cr-count').textContent = `🎁 ${crates} ${crates === 1 ? 'Kiste' : 'Kisten'}`;
    const hd = ov.querySelector('.cr-head h3');
    if (hd) { hd.textContent = ct.name.toUpperCase(); hd.style.color = ct.color; }
    ov.querySelector('.cr-odds').innerHTML = `<span style="color:${ct.color}">${ct.desc}</span><br>` + RARITIES.filter(r => r.odds).map(r => `<span style="color:${r.color}">${r.name} ${String(r.odds).replace('.', ',')}%</span>`).join(' · ');
    const res = ov.querySelector('.cr-result');
    if (result) {
        const s = result.skin, r = rarityOf(s);
        res.style.display = 'flex';
        res.style.setProperty('--rc', r.color);
        res.innerHTML = `<div class="cr-big" data-t="${s.target}:${s.id}"></div><div class="cr-info"><div class="cr-rar" style="color:${r.color}">${r.name.toUpperCase()}</div>
            <div class="cr-name">${esc(skinFullName(s))}</div><div class="cr-dupe">${result.dupe ? `Du hattest ihn schon – jetzt ×${prog.getCount(s.id)} (für Trade-up)` : 'Neu in deinem Inventar!'}</div>
            <div class="cr-btns"><button class="inv-btn primary" id="cr-equip">AUSRÜSTEN</button></div></div>`;
        queueThumbs(res);
        document.getElementById('cr-equip').addEventListener('click', () => { equipSkinTo(s.target, s.id); });
    } else res.style.display = 'none';
    const open = ov.querySelector('#cr-open');
    open.disabled = crates <= 0 || crateBusy;
    open.textContent = crates > 0 ? (result ? 'NOCH EINE ÖFFNEN' : 'KISTE ÖFFNEN') : 'KEINE KISTEN';
    ov.querySelector('#cr-close').disabled = crateBusy;
}
function runCrate() {
    if (crateBusy || prog.getCrates() <= 0) return;
    const out = prog.openCrate(selCrate);
    if (!out) return;
    flushProgress();
    crateBusy = true;
    const ov = document.getElementById('crate-overlay');
    ov.querySelector('.cr-result').style.display = 'none';
    const strip = ov.querySelector('.cr-strip'), win = ov.querySelector('.cr-window');
    const WIN_IDX = 38, ITEM_W = 160, N = 46;
    const items = [];
    for (let i = 0; i < N; i++) items.push(i === WIN_IDX ? out.skin : rollCrate(Math.random, selCrate));
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0)';
    strip.innerHTML = items.map(s => { const r = rarityOf(s); return `<div class="cr-item" style="--rc:${r.color}"><div class="cr-th" data-t="${s.target}:${s.id}"></div><small>${esc(TARGET_DE(s.target))}</small><b>${esc(s.name)}</b></div>`; }).join('');
    queueThumbs(strip);
    const winEl = strip.children[WIN_IDX]?.querySelector('.cr-th');   // Gewinn-Bild zuerst erzeugen
    for (let i = thumbQueue.length - 1; i >= 0; i--) if (thumbQueue[i].el === winEl) thumbQueue.unshift(thumbQueue.splice(i, 1)[0]);
    void strip.offsetWidth;
    const x = WIN_IDX * ITEM_W + ITEM_W / 2 - win.clientWidth / 2 + (Math.random() - 0.5) * ITEM_W * 0.6;
    strip.style.transition = 'transform 6.4s cubic-bezier(0.07, 0.6, 0.08, 1)';
    strip.style.transform = `translateX(${-x}px)`;
    renderCrateOverlay(null);
    setTimeout(() => {
        crateBusy = false;
        if (['c', 'v', 'g'].includes(out.skin.rarity)) sfx.playLevelUp();
        renderCrateOverlay(out);
        if (document.getElementById('loadout-panel').style.display === 'block') { renderInvSide(); renderInvSkins(prog.getProgress()); renderInvStage(prog.getProgress()); document.getElementById('loadout-level').innerHTML = `Level ${prog.getProgress().level} — 🎁 ${prog.getCrates()} Kisten · ${prog.getOwned().length} Skins`; }
    }, 6700);
}

function wireLoadoutUi() {
    const panel = document.getElementById('loadout-panel');
    document.getElementById('loadout-close').addEventListener('click', closeInventory);
    wireInventoryDnd(panel);
    document.getElementById('respawn-btn').addEventListener('click', doRespawn);
    document.getElementById('cr-open').addEventListener('click', runCrate);
    document.getElementById('cr-close').addEventListener('click', closeCrateOverlay);
    document.getElementById('tu-close').addEventListener('click', closeTradeUp);
    document.getElementById('tu-clear').addEventListener('click', () => { tuPick = []; tuResult = null; renderTradeUp(); });
    document.getElementById('tu-go').addEventListener('click', runTradeUp);
    document.getElementById('buy-close').addEventListener('click', closeBuyMenu);

    // Startbildschirm: Skins & Waffen schon vor dem Spielstart ansehen/wählen
    const nameField = document.getElementById('name-input');
    nameField.addEventListener('input', () => {
        prog.setActiveName(nameField.value, false); // nur ansehen: Level/Auswahl dieses Namens zeigen, nichts anlegen
        renderAllPickers();
        updateXpUI();
    });
    document.getElementById('login-loadout-btn').addEventListener('click', () => {
        prog.setActiveName(nameField.value, false);
        openInventory(true);
    });
    renderAllPickers();
}

// Zielen: FOV gleitend zur Zoomstufe der Waffe, Empfindlichkeit passend zum Zoom (sonst wirkt die
// Maus im Zielfernrohr viel zu schnell), Zielfernrohr-Overlay bei Sniper, Fadenkreuz dabei ausblenden.
const _scopeEl = () => document.getElementById('scope-overlay');
let _scopeShown = false;
function updateAimView() {
    const e = Number.isFinite(weapon.aimAmount) ? weapon.aimAmount : 0;
    const base = userControls.fov;
    // Zoom bleibt bei jedem eingestellten Sichtfeld gleich stark (Vergrößerungsfaktor aus dem Entwurfs-FOV, auf das eigene FOV übertragen)
    const designZoom = Number.isFinite(weapon.aimFov) ? weapon.aimFov : DESIGN_FOV;
    const ratio = Math.tan(designZoom * Math.PI / 360) / Math.tan(DESIGN_FOV * Math.PI / 360);
    const zoomFov = 2 * Math.atan(ratio * Math.tan(base * Math.PI / 360)) * 180 / Math.PI;
    const fov = base + (zoomFov - base) * e;
    if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    // Empfindlichkeit passend zum Zoom (sonst wirkt die Maus im Zielfernrohr viel zu schnell); wird in applyMouseSensitivity() benutzt
    lookScale = Math.tan(fov * Math.PI / 360) / Math.tan(base * Math.PI / 360);
    aimBlend = e;

    const scoped = weapon.scopeVisible;
    if (scoped !== _scopeShown) {
        _scopeShown = scoped;
        const el = _scopeEl();
        if (el) el.style.display = scoped ? 'block' : 'none';
        const ch = document.getElementById('crosshair');
        if (ch) ch.style.visibility = scoped ? 'hidden' : 'visible';
    }
}

// Kurze Systemmeldung im Kill-Feed-Bereich (z.B. Reset-Cooldown)
function showNotice(text) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const el = document.createElement('div');
    el.className = 'kf-entry';
    el.textContent = text;
    feed.prepend(el);
    while (feed.children.length > KILL_FEED_MAX) feed.lastChild.remove();
    setTimeout(() => el.remove(), KILL_FEED_DURATION);
}

// Reset-Button: K gedrückt halten, Fortschrittsbalken unter dem Fadenkreuz, dann Request an den Server
function updateResetHold(now) {
    const wrap = document.getElementById('reset-hold');
    const fill = document.getElementById('reset-hold-fill');
    const active = resetHeld && (controls.isLocked || touchActive) && !isDead;

    if (!active) {
        resetHoldStart = null;
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (resetHoldStart === null) resetHoldStart = now;

    const p = Math.min(1, (now - resetHoldStart) / RESET_HOLD_MS);
    if (wrap) wrap.style.display = 'block';
    if (fill) fill.style.width = (p * 100) + '%';

    if (p >= 1) {
        socket.emit('requestReset');
        resetHeld = false;
        resetLatch = true;
        resetHoldStart = null;
        if (wrap) wrap.style.display = 'none';
    }
}

// ================= Kartenrotation: Countdown + Abstimmung =================
let roundEndAt = null, voteState = null, roundUi = null;
function ensureRoundUi() {
    if (roundUi) return roundUi;
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:44px;left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;font:12px monospace;letter-spacing:2px;color:#7fe;opacity:.8;display:none;text-shadow:0 0 6px #0ff';
    const v = document.createElement('div');
    v.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);z-index:5;display:none;min-width:300px;padding:14px 18px;background:rgba(5,8,22,.92);border:1px solid rgba(0,240,255,.5);border-radius:10px;font:14px monospace;color:#fff;box-shadow:0 0 24px rgba(0,240,255,.25)';
    document.body.appendChild(t); document.body.appendChild(v);
    roundUi = { t, v };
    setInterval(updateRoundUi, 500);
    return roundUi;
}
function setRoundLeft(ms) { roundEndAt = (typeof ms === 'number') ? performance.now() + ms : null; updateRoundUi(); }
function updateRoundUi() {
    const u = ensureRoundUi();
    if (voteState) {
        const left = Math.max(0, Math.ceil((voteState.endAt - performance.now()) / 1000));
        const head = u.v.querySelector('.vh'); if (head) head.textContent = (voteState.modeName ? 'NÄCHSTER MODUS: ' + voteState.modeName.toUpperCase() + ' · ' : '') + 'KARTE WÄHLEN · ' + left + 's';
    }
    if (roundEndAt === null || voteState) { u.t.style.display = 'none'; return; }
    const s = Math.max(0, Math.ceil((roundEndAt - performance.now()) / 1000));
    u.t.textContent = 'KARTENWECHSEL IN ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    u.t.style.display = hasEntered ? 'block' : 'none';
}
function showVote(v) {
    if (!v || !Array.isArray(v.options)) return;
    const u = ensureRoundUi();
    const keep = voteState && voteState.myVote;
    voteState = { endAt: performance.now() + (v.leftMs || 0), options: v.options, myVote: keep, modeName: v.nextModeName || '' };
    u.v.style.display = 'block';
    u.v.innerHTML = '<div class="vh" style="color:#0ff;margin-bottom:8px;font-weight:bold"></div>' + v.options.map((o, i) =>
        '<div data-id="' + esc(o.id) + '" style="padding:6px 8px;margin:4px 0;border-radius:6px;cursor:pointer;background:' + (voteState.myVote === o.id ? 'rgba(0,255,153,.25)' : 'rgba(255,255,255,.07)') + '">' +
        '[' + (7 + i) + '] ' + esc(o.name) + ' <span style="float:right;color:#7fe">' + ((v.counts && v.counts[o.id]) || 0) + '</span></div>').join('');
    u.v.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => castVote(el.dataset.id)));
    updateRoundUi();
}
function hideVote() { voteState = null; if (roundUi) roundUi.v.style.display = 'none'; }
function castVote(id) {
    if (!voteState || !voteState.options.some(o => o.id === id)) return;
    voteState.myVote = id;
    socket.emit('mapVoteCast', id);
}
// Abstimmen per Taste 7/8/9 (während des Spiels, ohne Maus)
window.addEventListener('keydown', (e) => {
    if (!voteState || e.repeat) return;
    const i = { Digit7: 0, Digit8: 1, Digit9: 2 }[e.code];
    if (i !== undefined && voteState.options[i]) castVote(voteState.options[i].id);
});

// ================= Karten (Ordner maps/) =================
const _noColliders = [];
const CGRID = 8;
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
function buildColliderGrid() {
    colliderGrid = new Map();
    for (const c of colliders) {
        const x0 = Math.floor((c.min.x - 1) / CGRID), x1 = Math.floor((c.max.x + 1) / CGRID);
        const z0 = Math.floor((c.min.z - 1) / CGRID), z1 = Math.floor((c.max.z + 1) / CGRID);
        for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
            const k = cellKey(ix, iz);
            let l = colliderGrid.get(k);
            if (!l) { l = []; colliderGrid.set(k, l); }
            l.push(c);
        }
    }
}
// Alle Boxen, die einen Spieler an dieser Stelle berühren können (Spielerradius < 1 m, siehe buildColliderGrid)
function collidersNear(x, z) {
    return colliderGrid.get(cellKey(Math.floor(x / CGRID), Math.floor(z / CGRID))) || _noColliders;
}

function teleportToRandomSpawn() {
    const sp = colliders.spawnPoints;
    if (!sp || !sp.length) return false;
    const p = sp[Math.floor(Math.random() * sp.length)];
    camera.position.set(p.x, p.y, p.z);
    feetY = p.y - currentEyeHeight;
    velocity.set(0, 0, 0);
    canJump = true;
    return true;
}

function setMapStatus(text) {
    const el = document.getElementById('mm-map-status');
    if (el) el.textContent = text || '';
}
function setPlayEnabled(on) {
    const b = document.getElementById('enter-btn');
    if (!b) return;
    b.disabled = !on;
    b.textContent = on ? '▶ SPIELEN' : 'KARTE LÄDT …';
}
function syncMapSelect() {
    const sel = document.getElementById('map-select');
    if (sel && currentMapId) sel.value = currentMapId;
}
function reportMapSpawns() {
    // .glb-Karten ohne feste Spawns: dem Server die automatisch gefundenen Spawnpunkte mitteilen (für Respawns)
    if (!mapHandle || !socket.connected) return;
    const e = mapHandle.entry;
    if (e.type === 'glb' && !Array.isArray(e.spawns)) socket.emit('mapSpawns', { id: e.id, spawns: (colliders.spawnPoints || []).slice(0, 32) });
}

async function initMaps() {
    mapManifest = await fetchManifest();
    const sel = document.getElementById('map-select');
    if (sel) {
        sel.innerHTML = mapManifest.maps.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
        sel.addEventListener('change', () => {
            // Mit Server: er entscheidet (nur allein möglich) und meldet 'mapChanged'/'mapDenied'. Ohne Server: lokal wechseln.
            if (socket.connected) socket.emit('selectMap', sel.value); else switchMap(sel.value);
        });
    }
    let id = serverMapId;
    if (!id) { try { id = localStorage.getItem('nv_map'); } catch (e) { /* ignorieren */ } }
    if (!mapManifest.maps.some(e => e.id === id)) id = mapManifest.default;
    await switchMap(id);
}

async function switchMap(id) {
    if (!mapManifest) { serverMapId = id; return; }
    if (mapLoading) { pendingMapId = id; return; }
    const entry = mapManifest.maps.find(e => e.id === id) || mapManifest.maps[0];
    if (mapHandle && currentMapId === entry.id) { syncMapSelect(); return; }

    mapLoading = true;
    setPlayEnabled(false);
    setMapStatus(`Lade ${entry.name} …`);
    // alte Karte entfernen (Speicher freigeben); bis die neue steht, gibt es keine Kollision
    if (mapHandle) { mapHandle.dispose(); mapHandle = null; }
    colliders = []; groundMeshes = []; shootBlockers = []; skyboxGroup = null; portalRings = [];
    buildColliderGrid();

    let handle = null;
    try {
        handle = await loadMap(scene, entry, (p) => setMapStatus(`Lade ${entry.name} … ${Math.round(p * 100)}%`));
    } catch (err) {
        console.error('Karte konnte nicht geladen werden:', entry.id, err);
        showNotice('Karte „' + entry.name + '“ konnte nicht geladen werden: ' + (err && err.message ? err.message : err));
        const fallback = mapManifest.maps.find(e => e.type === 'grid' && e.id !== entry.id);
        if (fallback) { try { handle = await loadMap(scene, fallback); } catch (e2) { console.error(e2); } }
    }
    if (handle) {
        mapHandle = handle;
        currentMapId = handle.entry.id;
        colliders = handle.colliders;
        groundMeshes = colliders.groundMeshes || [];
        shootBlockers = colliders.shootBlockers || [];
        skyboxGroup = colliders.skyboxGroup || null;
        portalRings = colliders.portalRings || [];
        buildColliderGrid();
        try { localStorage.setItem('nv_map', currentMapId); } catch (e) { /* ignorieren */ }
        teleportToRandomSpawn();
        const title = document.getElementById('map-title');
        if (title) title.textContent = handle.entry.name.toUpperCase();
        if (colliders.info) {
            const i = colliders.info;
            setMapStatus(`${i.size.map(v => Math.round(v)).join(' × ')} m · ${i.colliders} Kollisionsboxen · Skalierung ${i.scale} · Spawns: ${i.spawns} (${i.spawnSource})`);
        } else setMapStatus('');
        reportMapSpawns();
    }
    syncMapSelect();
    mapLoading = false;
    setPlayEnabled(true);
    if (pendingMapId && pendingMapId !== currentMapId) { const n = pendingMapId; pendingMapId = null; switchMap(n); }
    pendingMapId = null;
}

// ---- Performance: hinter Vollbild-Menüs nichts rendern ----
// Menü, Pause, Einstellungen und Inventar sind (fast) undurchsichtig. Die 3D-Szene (inkl. Bloom) dahinter weiter zu zeichnen kostet
// nur FPS beim Bedienen der Menüs. Das letzte Bild bleibt stehen, die Spiellogik läuft weiter. Die Vorschau-Canvas laufen nur,
// solange sie wirklich sichtbar sind.
function setupRenderGate() {
    const ids = ['instructions', 'pause-menu', 'settings-panel', 'loadout-panel'];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    const shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
    const recompute = () => {
        renderBlocked = els.some(e => getComputedStyle(e).display !== 'none');
        const ins = shown('instructions'), inv = shown('loadout-panel'), set = shown('settings-panel');
        if (menuPreview) { if (ins && !inv && !set) menuPreview.start(); else menuPreview.stop(); }
        if (invPreview) { if (inv && !set) invPreview.start(); else invPreview.stop(); }
    };
    const obs = new MutationObserver(recompute);
    els.forEach(e => obs.observe(e, { attributes: true, attributeFilter: ['style'] }));
    recompute();
}

function setMenuStatus(kind, text) {
    const el = document.getElementById('mm-status');
    if (!el) return;
    el.className = kind;
    el.textContent = text;
}

function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Leaderboard ---
function updateLeaderboard(board) {
    const el = document.getElementById('leaderboard-body');
    if (!el) return;
    el.innerHTML = board.map((p, i) => {
        const isMe = p.id === socket.id;
        const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
        return `<tr class="${isMe ? 'lb-me' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.level || 1}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${kd}</td></tr>`;
    }).join('');
}

// --- Death Overlay ---
let deathTimeout = null;
function showDeathOverlay(killerName) {
    const el = document.getElementById('death-overlay');
    if (!el) return;
    document.getElementById('death-killer').textContent = killerName;
    el.style.display = 'flex';
    if (deathTimeout) clearTimeout(deathTimeout);
    deathTimeout = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

// --- Crosshair-Flash (Treffer-Confirm) ---
// Fadenkreuz aus den Einstellungen neu zeichnen (SVG in #crosshair; die Vorschau im Menü benutzt dieselbe Funktion)
function applyCrosshair() {
    const ch = document.getElementById('crosshair');
    if (ch) ch.innerHTML = renderCrosshairSVG(userControls.crosshair);
    const pv = document.getElementById('ch-preview-center');
    if (pv) pv.innerHTML = renderCrosshairSVG(userControls.crosshair);
}

function flashCrosshair() {
    const ch = document.getElementById('crosshair');
    if (!ch) return;
    ch.classList.add('hit');
    setTimeout(() => ch.classList.remove('hit'), 120);
}

// Bloom-Postprocessing für den Neon-Glow-Look.// Bloom-Postprocessing für den Neon-Glow-Look. Absichtlich mit try/catch + Feature-Check: falls die
// Postprocessing-Scripts (CDN) nicht laden, rendert das Spiel einfach normal weiter, statt komplett
// zu crashen. Eigene Funktion, damit das Bloom-Toggle im Einstellungsmenü sie erneut aufrufen kann.
function initComposer() {
    if (!bloomEnabled) { composer = null; return; }
    try {
        if (typeof THREE.EffectComposer === 'function' && typeof THREE.UnrealBloomPass === 'function') {
            composer = new THREE.EffectComposer(renderer);
            composer.addPass(new THREE.RenderPass(scene, camera));

            // Bloom bewusst in halber Auflösung: die internen Blur-Passes sind der teuerste Teil,
            // halbe Auflösung senkt deren Kosten um ca. das Vierfache bei kaum sichtbarem Unterschied.
            const bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
                1.2,  // strength
                0.4,  // radius
                0.15  // threshold
            );
            bloomPass.strength = userControls.bloomStrength;
            bloomPassRef = bloomPass;
            composer.addPass(bloomPass);
        } else {
            console.warn('Bloom-Postprocessing nicht verfügbar (Scripts nicht geladen) — normales Rendering wird genutzt.');
            composer = null;
        }
    } catch (err) {
        console.error('Fehler beim Initialisieren des Bloom-Postprocessing, normales Rendering wird genutzt:', err);
        composer = null;
    }
}

// Einstellungsmenü (Zahnrad-Button oben rechts): Render-Auflösung + Bloom an/aus, live anwendbar
// Maus-, Sicht- und Fadenkreuz-Einstellungen im Menü: Regler -> userControls -> speichern. Alles wirkt sofort.
function setupControlSettings() {
    const $ = (id) => document.getElementById(id);
    const c = () => userControls.crosshair;
    const bind = (sliderId, valId, read, write, fmt) => {
        const sl = $(sliderId), val = $(valId);
        if (!sl) return () => {};
        const show = () => { sl.value = read(); if (val) val.textContent = fmt(read()); };
        sl.addEventListener('input', () => { write(parseFloat(sl.value)); if (val) val.textContent = fmt(read()); saveSettings(); });
        return show;
    };
    const redraw = () => { applyCrosshair(); saveSettings(); };

    const refreshers = [
        bind('sens-slider', 'sens-val', () => userControls.sens, v => { userControls.sens = v; }, v => v.toFixed(2) + 'x'),
        bind('ads-slider', 'ads-val', () => userControls.adsSens, v => { userControls.adsSens = v; }, v => v.toFixed(2) + 'x'),
        bind('fov-slider', 'fov-val', () => userControls.fov, v => { userControls.fov = Math.round(v); }, v => v + '°'),
        bind('ch-size', 'ch-size-val', () => c().size, v => { c().size = Math.round(v); applyCrosshair(); }, v => v),
        bind('ch-thick', 'ch-thick-val', () => c().thickness, v => { c().thickness = Math.round(v); applyCrosshair(); }, v => v),
        bind('ch-gap', 'ch-gap-val', () => c().gap, v => { c().gap = Math.round(v); applyCrosshair(); }, v => v),
        bind('ch-opacity', 'ch-opacity-val', () => c().opacity, v => { c().opacity = Math.round(v); applyCrosshair(); }, v => v + '%')
    ];

    const invert = $('invert-toggle');
    if (invert) invert.addEventListener('change', () => { userControls.invertY = invert.checked; saveSettings(); });

    // --- weitere Einstellungen: Schalter und Regler, alles wirkt sofort ---
    const applyExtras = () => {
        viewSettings.visible = userControls.weaponVisible;
        viewSettings.left = userControls.leftHanded;
        viewSettings.x = userControls.weaponX; viewSettings.y = userControls.weaponY; viewSettings.z = userControls.weaponZ;
        viewSettings.scale = userControls.weaponScale;
        const tv = $('distance-val'), tl = $('distance-label'), kf = $('kill-feed');
        if (tv) tv.style.display = userControls.showTargetInfo ? '' : 'none';
        if (tl) tl.style.display = userControls.showTargetInfo ? '' : 'none';
        if (kf) kf.style.display = userControls.showKillFeed ? '' : 'none';
        if (userControls.showFps && !fpsEl) {
            fpsEl = document.createElement('div');
            fpsEl.style.cssText = 'position:fixed;left:12px;top:10px;z-index:4;font:12px monospace;color:#9fe;background:rgba(0,0,0,.45);padding:2px 7px;border-radius:3px;pointer-events:none';
            document.body.appendChild(fpsEl); fpsLast = performance.now(); fpsFrames = 0;
        }
        if (fpsEl) fpsEl.style.display = userControls.showFps ? 'block' : 'none';
        if (bloomPassRef) bloomPassRef.strength = userControls.bloomStrength;
    };
    const checks = [['aim-toggle', 'aimToggle'], ['fps-toggle', 'showFps'], ['target-toggle', 'showTargetInfo'], ['killfeed-toggle', 'showKillFeed'],
        ['weapon-visible', 'weaponVisible'], ['left-handed', 'leftHanded'], ['hitsound-toggle', 'hitSound'], ['steps-toggle', 'footsteps']];
    checks.forEach(([id, key]) => {
        const el = $(id);
        if (el) el.addEventListener('change', () => { userControls[key] = el.checked; applyExtras(); saveSettings(); });
    });
    refreshers.push(
        bind('wx-slider', 'wx-val', () => userControls.weaponX, v => { userControls.weaponX = v; applyExtras(); }, v => v.toFixed(2)),
        bind('wy-slider', 'wy-val', () => userControls.weaponY, v => { userControls.weaponY = v; applyExtras(); }, v => v.toFixed(2)),
        bind('wz-slider', 'wz-val', () => userControls.weaponZ, v => { userControls.weaponZ = v; applyExtras(); }, v => v.toFixed(2)),
        bind('wscale-slider', 'wscale-val', () => userControls.weaponScale, v => { userControls.weaponScale = v; applyExtras(); }, v => Math.round(v * 100) + '%'),
        bind('bloomstr-slider', 'bloomstr-val', () => userControls.bloomStrength, v => { userControls.bloomStrength = v; applyExtras(); }, v => v.toFixed(1))
    );
    const outline = $('ch-outline');
    if (outline) outline.addEventListener('change', () => { c().outline = outline.checked; redraw(); });

    const style = $('ch-style');
    if (style) {
        style.innerHTML = CROSSHAIR_STYLES.map(([k, name]) => `<option value="${k}">${name}</option>`).join('');
        style.addEventListener('change', () => { c().style = style.value; redraw(); });
    }

    // Farbe: Schnellwahl-Punkte + freie Farbe
    const sw = $('ch-swatches');
    const syncSwatches = () => {
        if (!sw) return;
        sw.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.color === c().color));
        const picker = sw.querySelector('input[type="color"]');
        if (picker) picker.value = c().color;
    };
    if (sw) {
        sw.innerHTML = CROSSHAIR_COLORS.map(col => `<button type="button" data-color="${col}" style="background:${col}" title="${col}"></button>`).join('') +
            `<input type="color" value="${c().color}" title="eigene Farbe">`;
        sw.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { c().color = b.dataset.color; syncSwatches(); redraw(); }));
        sw.querySelector('input[type="color"]').addEventListener('input', (e) => { c().color = e.target.value.toLowerCase(); syncSwatches(); redraw(); });
    }

    // Alles aus userControls in die Bedienelemente schreiben (beim Start und nach "Zurücksetzen")
    const refreshAll = () => {
        refreshers.forEach(f => f());
        if (invert) invert.checked = userControls.invertY;
        checks.forEach(([id, key]) => { const el = $(id); if (el) el.checked = !!userControls[key]; });
        applyExtras();
        if (outline) outline.checked = c().outline;
        if (style) style.value = c().style;
        syncSwatches();
        applyCrosshair();
    };
    const reset = $('settings-reset');
    if (reset) reset.addEventListener('click', () => {
        userControls = sanitizeControls(CONTROL_DEFAULTS);
        refreshAll();
        saveSettings();
    });
    refreshAll();
}

function setupSettingsPanel() {
    const btn = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    const resSlider = document.getElementById('res-slider');
    const resVal = document.getElementById('res-val');
    const bloomToggle = document.getElementById('bloom-toggle');
    const closeBtn = document.getElementById('settings-close');
    if (!btn || !panel) return; // Panel nicht im HTML vorhanden -> überspringen statt zu crashen

    resSlider.value = userPixelRatioPercent;
    resVal.textContent = userPixelRatioPercent + '%';
    bloomToggle.checked = bloomEnabled;

    btn.addEventListener('click', () => {
        panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
    });
    if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
    // ESC schließt die Einstellungsseite (die Maus ist hier ohnehin frei, ESC kommt als normales Tastenereignis an)
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && panel.style.display === 'block') { panel.style.display = 'none'; e.preventDefault(); }
    });
    // Tabs
    const tabs = panel.querySelectorAll('.st-tab'), panes = panel.querySelectorAll('.st-pane');
    let lastTab = 'mouse';
    try { lastTab = localStorage.getItem('nv_settings_tab') || 'mouse'; } catch (e) { /* ignorieren */ }
    const showTab = (name) => {
        if (![...panes].some(p => p.dataset.pane === name)) name = 'mouse';
        tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === name));
        panes.forEach(p => p.classList.toggle('active', p.dataset.pane === name));
        try { localStorage.setItem('nv_settings_tab', name); } catch (e) { /* ignorieren */ }
    };
    tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.pane)));
    showTab(lastTab);

    resSlider.addEventListener('input', () => {
        userPixelRatioPercent = parseInt(resSlider.value, 10);
        resVal.textContent = userPixelRatioPercent + '%';
        if (!isTouchDevice) {
            renderer.setPixelRatio(userPixelRatioPercent / 100);
            renderer.setSize(window.innerWidth, window.innerHeight);
            if (composer) composer.setSize(window.innerWidth, window.innerHeight);
        }
        saveSettings();
    });

    bloomToggle.addEventListener('change', () => {
        bloomEnabled = bloomToggle.checked;
        if (!bloomEnabled) {
            composer = null;
        } else {
            initComposer();
        }
        saveSettings();
    });

    // Namensschilder ein-/ausblenden
    const nametagToggle = document.getElementById('nametag-toggle');
    if (nametagToggle) {
        nametagToggle.checked = showNametags;
        nametagToggle.addEventListener('change', () => {
            showNametags = nametagToggle.checked;
            playerMeshesList.forEach(m => {
                const t = m.getObjectByName('nametag');
                if (t) setNametagVisible(t, showNametags);
            });
            saveSettings();
        });
    }

    setupControlSettings(); // Maus, Sichtfeld, Fadenkreuz

    // Sound: Lautstärke + Stumm (speichert audio.js selbst)
    const volSlider = document.getElementById('vol-slider');
    const volVal = document.getElementById('vol-val');
    const muteToggle = document.getElementById('mute-toggle');
    if (volSlider && volVal && muteToggle) {
        volSlider.value = Math.round(sfx.getVolume() * 100);
        volVal.textContent = volSlider.value + '%';
        muteToggle.checked = sfx.isMuted();
        volSlider.addEventListener('input', () => {
            sfx.setVolume(parseInt(volSlider.value, 10) / 100);
            volVal.textContent = volSlider.value + '%';
            sfx.playHitMarker(); // kurzer Hörtest
        });
        muteToggle.addEventListener('change', () => sfx.setMuted(muteToggle.checked));
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

// Mausempfindlichkeit + Y-Invertierung. PointerLockControls dreht die Kamera mit fester Empfindlichkeit; wir vergleichen pro Frame
// die Blickrichtung mit der vom letzten Frame (nach unserer eigenen Korrektur) und skalieren genau diese Drehung nach.
// Das ist unabhängig von der three.js-Version (kein pointerSpeed nötig) und für Maus-Bewegungen über mehrere Events pro Frame exakt.
const _lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let _lookPrev = null;
function applyMouseSensitivity() {
    _lookEuler.setFromQuaternion(camera.quaternion);
    if (_lookPrev && controls.isLocked) {
        const dy = wrapAngle(_lookEuler.y - _lookPrev.y);
        const dx = _lookEuler.x - _lookPrev.x;
        // Gesamtfaktor = eigene Empfindlichkeit x Zoom-Anpassung x (beim Zielen) Zielen-Faktor
        const mult = userControls.sens * lookScale * (1 + (userControls.adsSens - 1) * aimBlend);
        const multX = userControls.invertY ? -mult : mult;
        if (mult !== 1 || userControls.invertY) {
            const HALF_PI = Math.PI / 2 - 0.0001;
            _lookEuler.y = _lookPrev.y + dy * mult;
            _lookEuler.x = Math.max(-HALF_PI, Math.min(HALF_PI, _lookPrev.x + dx * multX));
            camera.quaternion.setFromEuler(_lookEuler);
        }
    }
    _lookPrev = { y: _lookEuler.y, x: _lookEuler.x };
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    if (fpsEl) { fpsFrames++; if (time - fpsLast >= 500) { fpsEl.textContent = Math.round(fpsFrames * 1000 / (time - fpsLast)) + ' FPS'; fpsFrames = 0; fpsLast = time; } }
    const delta = (time - prevTime) / 1000;

    applyMouseSensitivity(); // vor der Bewegung, damit die Laufrichtung zur korrigierten Blickrichtung passt
    smoothBots(delta);
    if (modes) { try { modes.update(delta); } catch (e) { if (!window.__modeErr) { window.__modeErr = 1; console.error('Modus-Fehler', e); } } }
    if (botHost) { try { botHost.update(delta); } catch (e) { console.error('Bot-Fehler', e); } }
    updatePlayerAnimations(playerMeshesList, delta);
    updateResetHold(time);
    // In try/catch: ein Fehler in Waffen-/Effekt-Code darf nie dazu führen, dass der Frame nicht mehr
    // gerendert wird (= schwarzer Bildschirm). Der Fehler wird einmal in der Konsole gemeldet.
    try {
        if (weapon) {
            weapon.update(delta);
            // Automatische Waffe: solange die Feuertaste gehalten wird, feuert sie im Rhythmus ihres Cooldowns
            if (fireHeld && weapon.automatic) handleShooting();
            updateAimView();
        }
        updateEffects(delta);
    } catch (err) {
        if (!window.__frameErrLogged) { window.__frameErrLogged = true; console.error('Fehler im Frame-Update (Waffen/Effekte):', err); }
    }

    // Skybox folgt nur der Position der Kamera (nicht der Rotation) -> wirkt unendlich weit entfernt,
    // dreht sich aber nicht mit, wenn man sich umschaut
    if (skyboxGroup) skyboxGroup.position.copy(camera.position);

    // Portal-Ringe an den Gates langsam rotieren lassen
    for (let i = 0; i < portalRings.length; i++) {
        // userData.spin: Drehrichtung/-tempo je Ring (Außenring statisch = 0, Innenring dreht)
        portalRings[i].rotation.z += delta * (portalRings[i].userData.spin ?? 0.6);
    }

    if ((controls.isLocked || touchActive) && !isDead) {
        // canJump ist nur true, während der Spieler tatsächlich auf dem Boden steht (siehe
        // Bodenerkennung weiter unten) -> zuverlässiger "isGrounded"-Wert für die Physik.
        const isGrounded = canJump;

        const crouchInput = crouchKeyC || crouchKeyCtrl;
        const speedBeforeJump = Math.hypot(velocity.x, velocity.z);

        // Leertaste gehalten -> automatisch springen, sobald man den Boden berührt (Bunny-Hop).
        // Springt man aus einem Slide/Ducken heraus, gibt's zusätzlich einen Geschwindigkeitsschub
        // (Slide-Hop) -> genau das macht "schneller werden, wenn man crouched und dann springt".
        if (spaceHeld && isGrounded) {
            velocity.y += JUMP_VELOCITY;
            canJump = false;
            sfx.playJump();
            if ((sliding || crouchInput) && speedBeforeJump > 0.5) {
                velocity.x *= SLIDE_JUMP_BOOST;
                velocity.z *= SLIDE_JUMP_BOOST;
            }
            sliding = false; // Sprung beendet den Slide immer
        }

        // Slide starten: Ducken-Taste wird gerade erst gedrückt, während man am Boden schnell
        // unterwegs ist (typischerweise nach Sprint). Geschwindigkeit wird HIER frisch nachgemessen
        // (nicht die speedBeforeJump vom Frame-Anfang verwendet) -> falls im selben Frame kurz zuvor
        // schon ein Sprung-Boost die Velocity verändert hat, zählt der tatsächliche aktuelle Wert als
        // Start-Crouch-Speed, nicht ein veralteter. Diese Geschwindigkeit bleibt beim Start exakt
        // erhalten (kein zusätzlicher Sprung) -> die Kurve (Rise/Hold/Ausrollen) übernimmt ab jetzt.
        if (crouchInput && !wasCrouching && isGrounded) {
            const speedAtCrouchStart = Math.hypot(velocity.x, velocity.z);
            if (speedAtCrouchStart > SLIDE_MIN_SPEED_TO_START) {
                sliding = true;
                slideTimer = 0;
                slideBaseSpeed = speedAtCrouchStart;
            }
        }
        // Slide beenden: Taste losgelassen, zu langsam geworden, oder nicht mehr am Boden
        if (sliding && (!crouchInput || !isGrounded || speedBeforeJump < SLIDE_END_SPEED)) {
            sliding = false;
        }
        wasCrouching = crouchInput;
        if (sliding) slideTimer += delta;

        // In welcher Phase der Kurve stecken wir gerade: hochrampen (0 -> +5%), halten (+5%),
        // oder vorbei (danach übernimmt ganz normal SLIDE_FRICTION den Ausroll-Effekt)
        const slideBoostActive = sliding && slideTimer <= SLIDE_BOOST_DURATION;

        // Augenhöhe sanft interpolieren (Ducken UND Sliden -> geduckte Höhe), Kollisionsbox
        // skaliert automatisch mit (siehe isColliding())
        const crouching = crouchInput || sliding;
        const targetEyeHeight = crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
        currentEyeHeight += (targetEyeHeight - currentEyeHeight) * Math.min(1, 12 * delta);
        viewSettings.crouch = Math.min(1, Math.max(0, (EYE_HEIGHT_STAND - currentEyeHeight) / (EYE_HEIGHT_STAND - EYE_HEIGHT_CROUCH))); // für die Waffen-Animation
        viewSettings.slide = sliding ? 1 : 0;

        // Sprint/Ducken/Sliden beeinflussen Beschleunigung & Reibung. Beim Sliden kaum Bremsung
        // (Schwung bleibt erhalten) und kaum eigene Beschleunigung (man gleitet, statt zu laufen).
        let speedMultiplier, friction;
        if (sliding) {
            speedMultiplier = SLIDE_STEER_FACTOR;
            // Während der Boost-Phase (Rise+Hold) keine Reibung -> das Tempo wird gleich unten exakt
            // über die Kurve gesetzt. Danach normale Slide-Reibung -> man rollt spürbar aus.
            friction = slideBoostActive ? 0 : SLIDE_FRICTION;
        } else if (crouching) {
            speedMultiplier = CROUCH_SPEED_MULTIPLIER;
            friction = GROUND_FRICTION;
        } else {
            speedMultiplier = sprintHeld ? SPRINT_MULTIPLIER : 1.0;
            friction = isGrounded ? GROUND_FRICTION : AIR_FRICTION;
        }
        if (weapon && !sliding) {
            // Beim Zielen langsamer laufen (Sniper am stärksten)
            speedMultiplier *= 1 - (1 - weapon.aimMoveFactor) * weapon.aimAmount;
        }
        const accel = (isGrounded ? GROUND_ACCEL : AIR_ACCEL) * speedMultiplier;

        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;
        velocity.y -= GRAVITY * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * accel * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * accel * delta;

        // Während der Boost-Phase: Tempo exakt auf die Kurve setzen (0 -> SLIDE_BOOST_RISE_TIME:
        // linear von 100% auf 105% hochrampen, danach bis SLIDE_BOOST_DURATION bei 105% halten).
        // Die Richtung (inkl. leichtem Steering durch accel oben) bleibt dabei erhalten, nur das
        // Tempo wird überschrieben.
        if (slideBoostActive) {
            const rampT = Math.min(1, slideTimer / SLIDE_BOOST_RISE_TIME);
            const targetMultiplier = 1 + (SLIDE_BOOST_PEAK - 1) * rampT;
            const targetSpeed = Math.min(slideBaseSpeed * targetMultiplier, SLIDE_MAX_SPEED);
            const curSpeed = Math.hypot(velocity.x, velocity.z);
            if (curSpeed > 0.01) {
                const scale = targetSpeed / curSpeed;
                velocity.x *= scale;
                velocity.z *= scale;
            }
        }

        // Geschwindigkeit deckeln (beim Sliden am höchsten erlaubt, sonst in der Luft etwas höher
        // als am Boden -> Air-Strafing/Bunny-Hopping lohnt sich, klassisches Krunker-Feeling)
        const maxSpeed = sliding ? SLIDE_MAX_SPEED : (isGrounded ? MAX_GROUND_SPEED : MAX_AIR_SPEED) * speedMultiplier;
        const horizSpeed = Math.hypot(velocity.x, velocity.z);
        if (horizSpeed > maxSpeed) {
            const scale = maxSpeed / horizSpeed;
            velocity.x *= scale;
            velocity.z *= scale;
        }

        // Alte Position sichern
        const oldPosition = camera.position.clone();

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Prüfen, ob neue Position in Wand/Kiste liegt (harte Deckung, blockiert X/Z)
        checkCollisions(oldPosition);

        const prevFeetY = feetY;
        feetY += velocity.y * delta;
        landOnColliderTops(prevFeetY); // von oben auf Wände/Säulen landen statt hineinzusinken
        unstickFromColliders();         // Notausstieg, falls man trotzdem in einem Block steckt

        // Bodenerkennung: Raycast senkrecht nach unten findet Boden, Treppenstufe oder Plattform.
        // Dadurch kann der Spieler Treppen/Rampen aus map.js hochlaufen, statt bei y=2 hart zu kleben.
        // Startpunkt: knapp über den Füßen (bei .glb-Karten 0.6 m, sonst würde man in Gebäuden auf das Dach "hochgezogen"),
        // bei schnellem Fall von der Höhe des Vorframes aus, damit man nicht durch den Boden fällt.
        groundRaycaster.set(
            new THREE.Vector3(camera.position.x, Math.max(prevFeetY, feetY) + (colliders.groundStepUp ?? 5), camera.position.z),
            new THREE.Vector3(0, -1, 0)
        );
        const groundHits = groundMeshes.length ? groundRaycaster.intersectObjects(groundMeshes, false) : [];
        const groundY = groundHits.length > 0 ? groundHits[0].point.y : 0;

        if (feetY <= groundY) {
            if (!canJump && velocity.y < -6) sfx.playLand(Math.min(1, -velocity.y / 22)); // Aufprall-Geräusch
            velocity.y = 0;
            feetY = groundY;
            canJump = true;
        }

        // Kamera-Höhe = Fuß-Position + aktuelle Augenhöhe -> Ducken/Sliden wirkt sich SOFORT aus,
        // unabhängig davon ob man gerade am Boden steht oder in der Luft ist.
        camera.position.y = feetY + currentEyeHeight;
        if (colliders.killY !== undefined && feetY < colliders.killY) { teleportToRandomSpawn(); showNotice('Aus der Karte gefallen – zurückgesetzt'); }

        // --- Sounds: Schritte (zeitgesteuert, schneller beim Sprinten, leise beim Ducken) und Rutschen ---
        const hSpeed = Math.hypot(velocity.x, velocity.z);
        if (canJump && !sliding && hSpeed > 1.5) {
            stepTimer += delta;
            const interval = sprintHeld ? 0.30 : (crouchInput ? 0.52 : 0.38);
            if (stepTimer >= interval) {
                stepTimer = 0;
                if (userControls.footsteps) sfx.playFootstep(crouchInput ? 0.35 : (sprintHeld ? 1 : 0.7));
            }
        } else if (!canJump) {
            stepTimer = 0.2; // nach der Landung bald ein Schritt
        }
        if (sliding && !wasSlidingSfx) sfx.playSlide();
        wasSlidingSfx = sliding;

        const pos = camera.position;
        camera.getWorldDirection(_faceDir);
        const ry = Math.atan2(-_faceDir.x, -_faceDir.z); // Yaw: 0 = Blick nach -Z
        socket.emit('playerMove', { x: pos.x, y: pos.y - 1.5, z: pos.z, ry });
    }

    updateNearestEnemyUI();

    prevTime = time;
    if (renderBlocked) return; // Vollbild-Menü offen: nichts zu sehen, nicht rendern
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

// ---- Start (muss NACH allen top-level let/const des Moduls stehen, sonst "can't access lexical declaration ... before initialization") ----
init();
initMaps();
requestAnimationFrame(animate);
    
