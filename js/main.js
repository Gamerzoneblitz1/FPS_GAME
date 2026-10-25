import { setupMap } from './map.js';
import { WeaponManager, WEAPON_CONFIGS } from './weapon.js';
import * as sfx from './audio.js';
import { initEffects, createTracer, addBulletHole, spawnImpactSpark, updateEffects } from './effects.js';
import { createPlayerMesh, updatePlayerAnimations, setPlayerFacing, applySkin } from './player.js';
import { SKINS } from './skins.js';
import * as prog from './progression.js';

const socket = io("https://fps-game-e18y.onrender.com");
let playerName = ''; // wird beim ersten Spielstart abgefragt
const playerNames = {}; // id -> name, für Nametags + Kill-Feed

let camera, scene, renderer, controls;
let composer = null; // Bloom-Postprocessing (null = Fallback auf normales Rendering)

// Einstellungen: aus localStorage laden (bleiben nach Neuladen erhalten), sonst Standardwerte
const SETTINGS_KEY = 'fpsGameSettings';
const savedSettings = (() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
})();
let userPixelRatioPercent = savedSettings.pixelRatio ?? 90; // 90% Standard, im Menü 50-100% einstellbar
let showNametags = savedSettings.showNametags ?? false; // Namensschilder über Spielern: Standard AUS (unsichtbar), im Menü einschaltbar
let bloomEnabled = savedSettings.bloomEnabled ?? false; // Standard jetzt AUS (war zu hell) - im Menü weiter an-/abschaltbar

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ pixelRatio: userPixelRatioPercent, bloomEnabled, showNametags }));
    } catch (e) { /* localStorage evtl. nicht verfügbar (z.B. privates Fenster) - dann halt nicht speichern */ }
}
let weapon;
let colliders = [];
let groundMeshes = []; // begehbare Flächen (Boden, Treppen, Plattformen) für den Bodenraycast
let skyboxGroup = null; // Sternenhimmel + Planet, folgt der Kamera-Position (Skybox-Trick)
let portalRings = []; // rotierende Neon-Ringe an den Gates
let shootBlockers = []; // Wände/Türme/Kisten/Rampen -> blockieren Schüsse (Gates bewusst nicht)
const otherPlayers = {};
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
let progressSaveTimer = null;
let progressSynced = false; // true, sobald der Server den Spielstand abgeglichen hat
let levelBannerTimer = null;
let stepTimer = 0;         // Schritt-Sound-Takt
let wasSlidingSfx = false;
let healHeld = false;  // verhindert Dauer-Auslösen durch Tastenwiederholung
const SYRINGE_KILL_INTERVAL = 5;
const _faceDir = new THREE.Vector3();
const BASE_FOV = 75;
let lookScale = 1; // Maus-/Touch-Empfindlichkeit relativ zum Zoom (beim Zielen langsamer)
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

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb0e0e6); // wird von setupMap() überschrieben (Neon-Hintergrund)

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 6000); // far erhöht für den Sternenhimmel/Planet-Backdrop
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
        const hint = instructions.querySelector('p');
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
        document.getElementById('pause-loadout').addEventListener('click', () => {
            document.getElementById('loadout-panel').style.display = 'block';
            renderLoadout();
        });
        document.getElementById('loadout-close').addEventListener('click', () => {
            document.getElementById('loadout-panel').style.display = 'none';
        });
        document.getElementById('pause-reset').addEventListener('click', () => {
            socket.emit('requestReset');
            controls.lock();
        });
        document.getElementById('pause-settings').addEventListener('click', () => {
            settingsPanel.style.display = (settingsPanel.style.display === 'block') ? 'none' : 'block';
        });
    }

    // Map laden & Kollisions-/Boden-Objekte speichern. Abgesichert: falls setupMap() aus
    // irgendeinem Grund crasht, läuft das Spiel mit leerer Map weiter statt komplett
    // einzufrieren (init() bricht sonst ab und animate() wird nie aufgerufen).
    try {
        colliders = setupMap(scene);
    } catch (err) {
        console.error('Fehler beim Aufbau der Map (setupMap) — Spiel läuft mit leerer Map weiter:', err);
        colliders = [];
    }
    groundMeshes = colliders.groundMeshes || [];

    // Zufälliger Start-Spawn direkt aus den C-Feldern der Map (Fallback, falls der Server noch nicht geantwortet hat)
    if (colliders.spawnPoints && colliders.spawnPoints.length > 0) {
        const sp = colliders.spawnPoints[Math.floor(Math.random() * colliders.spawnPoints.length)];
        camera.position.set(sp.x, sp.y, sp.z);
        feetY = sp.y - currentEyeHeight;
    }
    skyboxGroup = colliders.skyboxGroup || null;
    portalRings = colliders.portalRings || [];
    shootBlockers = colliders.shootBlockers || [];
    weapon = new WeaponManager(camera, scene, updateAmmoUI);
    weapon.onEvent = handleWeaponEvent;
    // Zuletzt benutzten Namen vorbelegen und dessen lokalen Spielstand laden (Level/Skin sofort sichtbar)
    const lastName = prog.getLastName();
    const savedNameField = document.getElementById('name-input');
    if (lastName && savedNameField && !savedNameField.value) {
        savedNameField.value = lastName;
        prog.setActiveName(lastName);
    }
    weapon.setLevel(prog.getProgress().level); // Waffen nach gespeichertem Level freischalten
    applyOwnSkin();
    updateXpUI();
    sfx.initAudio(); // Audio-Kontext startet beim ersten Klick/Tastendruck

    document.addEventListener('keydown', (e) => onKeyChange(e.keyCode, true));
    document.addEventListener('keyup', (e) => onKeyChange(e.keyCode, false));
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked && !touchActive) return; // Klicks auf Menü-Buttons zählen nicht
        if (e.button === 0) {
            fireHeld = true;
            handleShooting(); // sofortiger erster Schuss (reicht bei halbautomatischen Waffen)
        } else if (e.button === 2) {
            weapon.setAiming(true); // Rechtsklick halten = Zielen / Zielfernrohr
        }
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) fireHeld = false;
        else if (e.button === 2) weapon.setAiming(false);
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
    });

    // Server hat Spielstand abgeglichen (Maximum aus Server und lokalem Backup) -> übernehmen
    socket.on('progressSynced', (d) => {
        const before = prog.getProgress().level;
        prog.applyServer(d);
        progressSynced = !!d.saved;
        refreshProgressUI();
        sendProfile();
        const lvl = prog.getProgress().level;
        if (d.restored && lvl > 1) showNotice(`💾 Spielstand geladen: Level ${lvl}`);
        else if (d.saved === false) showNotice('⚠ Server-Speicher nicht erreichbar – Spielstand nur lokal');
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

    // Profil-Update (Skin/Level) eines Spielers
    socket.on('playerProfile', (data) => {
        playerLevels[data.id] = data.level;
        if (data.id !== socket.id && otherPlayers[data.id]) applySkin(otherPlayers[data.id], data.skin);
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
            setPlayerFacing(otherPlayers[data.id], data.position.ry); // Blickrichtung des Skins
        }
    });

    socket.on('playerShot', (data) => {
        playShotEffects(data.start, data.end, data.w, data.n, data.hitPlayer, data.c);
        if (!data.silent) sfx.playShotRemote(data.w, data.start, camera); // Schuss anderer Spieler: nach Entfernung/Richtung
    });

    socket.on('playerHealthUpdate', (data) => {
        if (data.id === socket.id) {
            if (data.health < health) sfx.playHurt(); // Schaden bekommen
            health = data.health;
            updateHealthUI();
        }
    });

    socket.on('playerKilled', (data) => {
        // Kill-Feed anzeigen (für alle)
        addKillFeedEntry(data.killerName, data.victimName, data.killerId === socket.id, data.victimId === socket.id);
        if (data.killerId === socket.id && data.victimId !== socket.id) { sfx.playKill(); awardXp(prog.XP_PER_KILL, true); }
        if (data.victimId === socket.id) sfx.playDeath();

        if (data.victimId === socket.id) {
            // Ich wurde getötet
            health = 100;
            updateHealthUI();
            currentEyeHeight = EYE_HEIGHT_STAND;
            camera.position.set(data.respawnPos.x, data.respawnPos.y, data.respawnPos.z);
            feetY = data.respawnPos.y - currentEyeHeight;
            velocity.set(0, 0, 0);
            canJump = true;
            if (weapon) { weapon.refillAll(); weapon.setAiming(false); } // nach dem Respawn volle Magazine, nicht mehr gezoomt
            showDeathOverlay(data.killerName);
        } else if (otherPlayers[data.victimId]) {
            otherPlayers[data.victimId].position.set(data.respawnPos.x, data.respawnPos.y, data.respawnPos.z);
        }
    });

    // Treffer-Bestätigung (nur für den Schützen: rotes Fadenkreuz-Flash)
    socket.on('hitConfirm', (d) => {
        flashCrosshair();
        sfx.playHitMarker();
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
    });

    socket.on('resetDenied', (data) => {
        showNotice(`Reset in ${Math.ceil(data.remainingMs / 1000)}s wieder möglich`);
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
    if (!controls.isLocked && !touchActive) return;

    const fired = weapon.shoot();
    if (!fired) return; // Magazin leer, wird gerade nachgeladen oder gezogen -> kein Schuss

    camera.updateMatrixWorld(true);
    // Tracer startet an der Mündung der Waffe (sieht man in der Ego-Ansicht als Linie zum Zielpunkt)
    const startPos = weapon.getMuzzleWorldPosition(new THREE.Vector3());
    const baseDir = camera.getWorldDirection(new THREE.Vector3());

    const pellets = weapon.pellets;                                  // 1 bei normalen Waffen, 8 bei der Shotgun
    const spread = weapon.spread * (1 - 0.45 * weapon.aimAmount);   // Zielen verengt die Streuung
    const weaponIndex = weapon.activeIndex;
    const color = weapon.color;                                      // Skin-Farbe
    const damageByTarget = {};                                       // Schrot: Schaden aller Kugeln pro Ziel summieren

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
        const playerHits = raycaster.intersectObjects(playerMeshesList, true);
        // Wände/Türme/Kisten/Rampen blockieren Schüsse (Gates bewusst ausgenommen - Portale bleiben durchlässig)
        const wallHits = shootBlockers.length ? raycaster.intersectObjects(shootBlockers, false) : [];

        let endPos = camera.position.clone().add(dir.clone().multiplyScalar(100));
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
                damageByTarget[hitGroup.userData.id] = (damageByTarget[hitGroup.userData.id] || 0) + weapon.damage;
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

    for (const [targetId, dmg] of Object.entries(damageByTarget)) {
        socket.emit('hitPlayer', { targetId, damage: Math.min(dmg, 100) });
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
    const tag = makeNameSprite(playerNames[id]);
    tag.position.set(0, 3.2, 0); // über dem Kopf (relativ zur Gruppe)
    tag.name = 'nametag';
    pMesh.add(tag);

    otherPlayers[id] = pMesh;
    playerMeshesList.push(pMesh);
    scene.add(pMesh);
}

// Unsichtbar = nicht gerendert UND auf Layer 1 (der Raycast für Treffer prüft nur Layer 0, ein verstecktes
// Schild kann also auch keine Schüsse mehr "auffangen")
function setNametagVisible(tag, on) {
    tag.visible = on;
    tag.layers.set(on ? 0 : 1);
}

function makeNameSprite(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.roundRect(4, 4, 248, 56, 10); ctx.fill();
    ctx.fillStyle = '#00f0ff';
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
    const tag = makeNameSprite(name);
    tag.position.set(0, 3.2, 0); tag.name = 'nametag';
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

    for (let i = 0; i < colliders.length; i++) {
        if (playerBox.intersectsBox(colliders[i])) return true;
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
        case 49: // 1
            if (isPressed) trySwitch(0);
            break;
        case 50: // 2
            if (isPressed) trySwitch(1);
            break;
        case 51: // 3
            if (isPressed) trySwitch(2);
            break;
        case 52: // 4
            if (isPressed) trySwitch(3);
            break;
        case 53: // 5
            if (isPressed) trySwitch(4);
            break;
        case 54: // 6
            if (isPressed) trySwitch(5);
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
            lookEuler.y -= dx * TOUCH_LOOK_SENSITIVITY * lookScale;
            lookEuler.x -= dy * TOUCH_LOOK_SENSITIVITY * lookScale;
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
        case 'reloadStart': sfx.playReload('out', idx); break;
        case 'reloadMid': sfx.playReload('in', idx); break;
        case 'reloadEnd': sfx.playReload('bolt', idx); break;
        case 'draw': sfx.playDraw(idx); break;
    }
}

// ================= Level / XP / Skins =================

// Waffe per Zahlentaste: gesperrte Waffen zeigen den nötigen Level
function trySwitch(i) {
    if (!weapon.isUnlocked(i)) {
        const c = WEAPON_CONFIGS[i];
        showNotice(`🔒 ${c.name} ab Level ${c.unlockLevel}`);
        return;
    }
    weapon.switchTo(i);
}

// Nach Wechsel des Spielstands (Login, Server-Abgleich): Waffen, Skin und HUD neu setzen
function refreshProgressUI() {
    weapon.setLevel(prog.getProgress().level);
    if (!weapon.isUnlocked(weapon.activeIndex)) weapon.switchTo(0); // aktuelle Waffe nicht mehr freigeschaltet
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
    const skin = SKINS[prog.getSkinId()] || SKINS[0];
    weapon.setSkin(skin.accent, !!skin.rainbow);
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
    WEAPON_CONFIGS.forEach(c => { if (c.unlockLevel > from && c.unlockLevel <= to) lines.push(`🔫 Neue Waffe: ${c.name}`); });
    SKINS.forEach(s => { if (s.unlockLevel > from && s.unlockLevel <= to) lines.push(`🎨 Neuer Skin: ${s.name}`); });

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

// Waffenleiste unten: aktive Waffe hervorgehoben, gesperrte mit nötigem Level
function renderWeaponSlots() {
    const el = document.getElementById('weapon-slots');
    if (!el || !weapon) return;
    const key = weapon.activeIndex + '|' + WEAPON_CONFIGS.map((_, i) => (weapon.isUnlocked(i) ? 1 : 0)).join('');
    if (key === lastSlotKey) return;
    lastSlotKey = key;
    el.innerHTML = WEAPON_CONFIGS.map((c, i) => {
        const unlocked = weapon.isUnlocked(i);
        return `<div class="wslot${i === weapon.activeIndex ? ' active' : ''}${unlocked ? '' : ' locked'}"><b>${i + 1}</b>${unlocked ? esc(c.name) : '🔒 Lv ' + c.unlockLevel}</div>`;
    }).join('');
}

// Loadout-Panel: Skins wählen, Waffenübersicht
function renderLoadout() {
    const p = prog.getProgress();
    const lvl = document.getElementById('loadout-level');
    if (lvl) lvl.textContent = `Level ${p.level}` + (p.max ? ' (MAX)' : ` — ${p.xpInLevel} / ${p.need} XP bis Level ${p.level + 1}`) + ` — Kill: +${prog.XP_PER_KILL} XP`;

    const grid = document.getElementById('skin-grid');
    const selected = prog.getSkinId();
    grid.innerHTML = SKINS.map(s => {
        const unlocked = p.level >= s.unlockLevel;
        return `<div class="skin-card${s.id === selected ? ' selected' : ''}${unlocked ? '' : ' locked'}" data-skin="${s.id}">
            <div class="skin-swatch" style="background:${s.preview}"></div>${esc(s.name)}
            <small>${unlocked ? (s.id === selected ? 'ausgerüstet' : 'wählen') : '🔒 Level ' + s.unlockLevel}</small></div>`;
    }).join('');
    grid.querySelectorAll('.skin-card').forEach(card => {
        card.addEventListener('click', () => {
            if (prog.setSkinId(parseInt(card.dataset.skin, 10))) {
                applyOwnSkin();
                sendProfile();
                flushProgress(); // Skinwechsel sofort sichern
                renderLoadout();
            }
        });
    });

    document.getElementById('weapon-list').innerHTML = WEAPON_CONFIGS.map((c, i) => {
        const unlocked = p.level >= c.unlockLevel;
        const dmg = c.pellets ? `${c.damage} x ${c.pellets}` : c.damage;
        return `<div class="weapon-row${unlocked ? '' : ' locked'}"><span>${i + 1} — ${esc(c.name)}${c.automatic ? ' (Auto)' : ''}</span><span>Schaden ${dmg} · ${unlocked ? 'freigeschaltet' : '🔒 Level ' + c.unlockLevel}</span></div>`;
    }).join('');
}

// Zielen: FOV gleitend zur Zoomstufe der Waffe, Empfindlichkeit passend zum Zoom (sonst wirkt die
// Maus im Zielfernrohr viel zu schnell), Zielfernrohr-Overlay bei Sniper, Fadenkreuz dabei ausblenden.
const _scopeEl = () => document.getElementById('scope-overlay');
let _scopeShown = false;
function updateAimView() {
    const e = Number.isFinite(weapon.aimAmount) ? weapon.aimAmount : 0;
    const zoomFov = Number.isFinite(weapon.aimFov) ? weapon.aimFov : BASE_FOV;
    const fov = BASE_FOV + (zoomFov - BASE_FOV) * e;
    if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    lookScale = Math.tan(fov * Math.PI / 360) / Math.tan(BASE_FOV * Math.PI / 360);
    controls.pointerSpeed = lookScale; // wirkt bei PointerLockControls (Maus)

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
    const active = resetHeld && (controls.isLocked || touchActive);

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

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

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

    if (controls.isLocked || touchActive) {
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

        feetY += velocity.y * delta;

        // Bodenerkennung: Raycast senkrecht nach unten findet Boden, Treppenstufe oder Plattform.
        // Dadurch kann der Spieler Treppen/Rampen aus map.js hochlaufen, statt bei y=2 hart zu kleben.
        groundRaycaster.set(
            new THREE.Vector3(camera.position.x, feetY + 5, camera.position.z),
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

        // --- Sounds: Schritte (zeitgesteuert, schneller beim Sprinten, leise beim Ducken) und Rutschen ---
        const hSpeed = Math.hypot(velocity.x, velocity.z);
        if (canJump && !sliding && hSpeed > 1.5) {
            stepTimer += delta;
            const interval = sprintHeld ? 0.30 : (crouchInput ? 0.52 : 0.38);
            if (stepTimer >= interval) {
                stepTimer = 0;
                sfx.playFootstep(crouchInput ? 0.35 : (sprintHeld ? 1 : 0.7));
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
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
