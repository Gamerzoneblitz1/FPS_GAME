import { setupMap } from './map.js';
import { Weapon, createTracer } from './weapon.js';
import { createPlayerMesh, updatePlayerAnimations } from './player.js';

const socket = io("https://fps-game-e18y.onrender.com");

let camera, scene, renderer, controls;
let composer = null; // Bloom-Postprocessing (null = Fallback auf normales Rendering)

// Einstellungen: aus localStorage laden (bleiben nach Neuladen erhalten), sonst Standardwerte
const SETTINGS_KEY = 'fpsGameSettings';
const savedSettings = (() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
})();
let userPixelRatioPercent = savedSettings.pixelRatio ?? 90; // 90% Standard, im Menü 50-100% einstellbar
let bloomEnabled = savedSettings.bloomEnabled ?? false; // Standard jetzt AUS (war zu hell) - im Menü weiter an-/abschaltbar

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ pixelRatio: userPixelRatioPercent, bloomEnabled }));
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

    if (isTouchDevice) {
        const hint = instructions.querySelector('p');
        if (hint) hint.innerText = 'Linker Stick = Bewegen | Rechte Bildschirmhälfte ziehen = Umsehen | 🔫 = Schießen | R = Nachladen | Tippen zum Starten';

        document.getElementById('touch-controls').style.display = 'block';

        instructions.addEventListener('click', () => {
            touchActive = true;
            instructions.style.display = 'none';
        });

        setupTouchControls();
    } else {
        instructions.addEventListener('click', () => controls.lock());
        controls.addEventListener('lock', () => instructions.style.display = 'none');
        controls.addEventListener('unlock', () => instructions.style.display = 'flex');
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
    weapon = new Weapon(camera, scene, updateAmmoUI);

    document.addEventListener('keydown', (e) => onKeyChange(e.keyCode, true));
    document.addEventListener('keyup', (e) => onKeyChange(e.keyCode, false));
    document.addEventListener('mousedown', handleShooting);

    // Socket Events
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) addOtherPlayer(id, players[id]);
        });

        // Eigenen Spawnpunkt vom Server übernehmen (der wählt zufällig, weit weg von anderen Spielern)
        const me = players[socket.id];
        if (me) {
            camera.position.set(me.x, me.y, me.z);
            feetY = me.y - currentEyeHeight;
            velocity.set(0, 0, 0);
        }
    });

    socket.on('newPlayer', (data) => addOtherPlayer(data.id, data.position));

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
        }
    });

    socket.on('playerShot', (data) => createTracer(scene, data.start, data.end));

    socket.on('playerHealthUpdate', (data) => {
        if (data.id === socket.id) {
            health = data.health;
            updateHealthUI();
        }
    });

    socket.on('playerRespawned', (data) => {
        if (data.id === socket.id) {
            health = 100;
            updateHealthUI();
            currentEyeHeight = EYE_HEIGHT_STAND; // falls man geduckt/slidend gestorben ist -> sauber stehend respawnen
            camera.position.set(data.position.x, data.position.y, data.position.z);
            feetY = data.position.y - currentEyeHeight;
            velocity.set(0, 0, 0); // Restgeschwindigkeit vom Tod löschen, sonst "reißt" es den Spieler nach dem Respawn
            canJump = true;
        } else if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
        }
    });

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

function handleShooting() {
    if (!controls.isLocked && !touchActive) return;

    const fired = weapon.shoot();
    if (!fired) return; // Magazin leer oder wird gerade nachgeladen -> kein Schuss

    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const playerHits = raycaster.intersectObjects(playerMeshesList, true);
    // Wände/Türme/Kisten/Rampen blockieren Schüsse jetzt auch (Gates bewusst ausgenommen - Portale
    // bleiben durchlässig). Ohne das gingen Kugeln bisher durch jede Wand/Rampenseite hindurch.
    const wallHits = shootBlockers.length ? raycaster.intersectObjects(shootBlockers, false) : [];

    const startPos = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.5));
    let endPos = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(100));

    const nearestPlayerHit = playerHits.length > 0 ? playerHits[0] : null;
    const nearestWallHit = wallHits.length > 0 ? wallHits[0] : null;

    // Näherer Treffer gewinnt: steht eine Wand/Rampenwand im Weg, zählt kein Spielertreffer dahinter
    if (nearestPlayerHit && (!nearestWallHit || nearestPlayerHit.distance <= nearestWallHit.distance)) {
        endPos = nearestPlayerHit.point;

        let hitGroup = nearestPlayerHit.object;
        while (hitGroup.parent && !hitGroup.userData.id) {
            hitGroup = hitGroup.parent;
        }

        if (hitGroup.userData.id) {
            socket.emit('hitPlayer', hitGroup.userData.id);
        }
    } else if (nearestWallHit) {
        endPos = nearestWallHit.point;
    }

    createTracer(scene, startPos, endPos);
    socket.emit('shoot', { start: startPos, end: endPos });
}

function addOtherPlayer(id, position) {
    const pMesh = createPlayerMesh(id);
    pMesh.position.set(position.x || 0, position.y || 2, position.z || 0);
    otherPlayers[id] = pMesh;
    playerMeshesList.push(pMesh);
    scene.add(pMesh);
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

function updateAmmoUI(ammoInMag, reserveAmmo, isReloading) {
    const ammoVal = document.getElementById('ammo-val');
    const ammoBar = document.getElementById('ammo-bar-fill');
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

    ammoVal.innerText = `${ammoInMag} / ${reserveAmmo}`;
    ammoVal.style.color = ammoInMag === 0 ? '#ff0000' : ammoInMag <= Math.ceil(12 * 0.3) ? '#ffff00' : '#00f0ff';
    if (ammoBar) ammoBar.style.width = (ammoInMag / 12) * 100 + '%'; // 12 = magSize aus weapon.js
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
        case 82: // R
            if (isPressed) weapon.reload();
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
            lookEuler.y -= dx * TOUCH_LOOK_SENSITIVITY;
            lookEuler.x -= dy * TOUCH_LOOK_SENSITIVITY;
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
        handleShooting();
        e.preventDefault();
    }, { passive: false });

    btnReload.addEventListener('touchstart', (e) => {
        weapon.reload();
        e.preventDefault();
    }, { passive: false });
}

// Bloom-Postprocessing für den Neon-Glow-Look. Absichtlich mit try/catch + Feature-Check: falls die
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

    // Skybox folgt nur der Position der Kamera (nicht der Rotation) -> wirkt unendlich weit entfernt,
    // dreht sich aber nicht mit, wenn man sich umschaut
    if (skyboxGroup) skyboxGroup.position.copy(camera.position);

    // Portal-Ringe an den Gates langsam rotieren lassen
    for (let i = 0; i < portalRings.length; i++) {
        portalRings[i].rotation.z += delta * 0.6;
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
            velocity.y = 0;
            feetY = groundY;
            canJump = true;
        }

        // Kamera-Höhe = Fuß-Position + aktuelle Augenhöhe -> Ducken/Sliden wirkt sich SOFORT aus,
        // unabhängig davon ob man gerade am Boden steht oder in der Luft ist.
        camera.position.y = feetY + currentEyeHeight;

        const pos = camera.position;
        socket.emit('playerMove', { x: pos.x, y: pos.y - 1.5, z: pos.z });
    }

    updateNearestEnemyUI();

    prevTime = time;
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
