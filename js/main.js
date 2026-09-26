import { setupMap } from './map.js';
import { Weapon, createTracer } from './weapon.js';
import { createPlayerMesh, updatePlayerAnimations } from './player.js';

const socket = io("https://fps-game-e18y.onrender.com");

let camera, scene, renderer, controls;
let weapon;
let colliders = [];
let groundMeshes = []; // begehbare Flächen (Boden, Treppen, Plattformen) für den Bodenraycast
const otherPlayers = {};
const playerMeshesList = [];

const EYE_HEIGHT = 2; // Abstand Kamera <-> Standfläche

let health = 100;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
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

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(-38, 2, -10); // Spawn an einer der "C"-Zonen der vergrößerten Neon Vault Map
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

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

    // Map laden & Kollisions-/Boden-Objekte speichern
    colliders = setupMap(scene);
    groundMeshes = colliders.groundMeshes || [];
    weapon = new Weapon(camera, scene, updateAmmoUI);

    document.addEventListener('keydown', (e) => onKeyChange(e.keyCode, true));
    document.addEventListener('keyup', (e) => onKeyChange(e.keyCode, false));
    document.addEventListener('mousedown', handleShooting);

    // Socket Events
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) addOtherPlayer(id, players[id]);
        });
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
            camera.position.set(data.position.x, data.position.y, data.position.z);
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
    const intersects = raycaster.intersectObjects(playerMeshesList, true);

    const startPos = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.5));
    let endPos = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(100));

    if (intersects.length > 0) {
        const hit = intersects[0];
        endPos = hit.point;

        let hitGroup = hit.object;
        while (hitGroup.parent && !hitGroup.userData.id) {
            hitGroup = hitGroup.parent;
        }

        if (hitGroup.userData.id) {
            socket.emit('hitPlayer', hitGroup.userData.id);
        }
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
    if (healthVal) {
        healthVal.innerText = health;
        healthVal.style.color = health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000';
    }
}

function updateAmmoUI(ammoInMag, reserveAmmo, isReloading) {
    const ammoVal = document.getElementById('ammo-val');
    if (!ammoVal) return;

    if (isReloading) {
        ammoVal.innerText = 'Nachladen…';
        ammoVal.style.color = '#ffff00';
        return;
    }

    ammoVal.innerText = `${ammoInMag} / ${reserveAmmo}`;
    ammoVal.style.color = ammoInMag === 0 ? '#ff0000' : ammoInMag <= Math.ceil(12 * 0.3) ? '#ffff00' : '#00f0ff';
}

const PLAYER_RADIUS = 0.5; // etwas schmaler als vorher (0.6) -> mehr Spielraum in 1-Tile-Korridoren

function isColliding() {
    const playerBox = new THREE.Box3();
    playerBox.min.set(camera.position.x - PLAYER_RADIUS, camera.position.y - 1.5, camera.position.z - PLAYER_RADIUS);
    playerBox.max.set(camera.position.x + PLAYER_RADIUS, camera.position.y + 0.5, camera.position.z + PLAYER_RADIUS);

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
        case 32:
            if (isPressed && canJump) {
                velocity.y += 12;
                canJump = false;
            }
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
        onKeyChange(32, true);
        e.preventDefault();
    }, { passive: false });

    btnFire.addEventListener('touchstart', (e) => {
        handleShooting();
        e.preventDefault();
    }, { passive: false });

    btnReload.addEventListener('touchstart', (e) => {
        weapon.reload();
        e.preventDefault();
    }, { passive: false });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    updatePlayerAnimations(playerMeshesList, delta);

    if (controls.isLocked || touchActive) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= 9.8 * 3.5 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * 90.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 90.0 * delta;

        // Alte Position sichern
        const oldPosition = camera.position.clone();

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Prüfen, ob neue Position in Wand/Kiste liegt (harte Deckung, blockiert X/Z)
        checkCollisions(oldPosition);

        camera.position.y += velocity.y * delta;

        // Bodenerkennung: Raycast senkrecht nach unten findet Boden, Treppenstufe oder Plattform.
        // Dadurch kann der Spieler Treppen/Rampen aus map.js hochlaufen, statt bei y=2 hart zu kleben.
        groundRaycaster.set(
            new THREE.Vector3(camera.position.x, camera.position.y + 5, camera.position.z),
            new THREE.Vector3(0, -1, 0)
        );
        const groundHits = groundMeshes.length ? groundRaycaster.intersectObjects(groundMeshes, false) : [];
        const groundY = groundHits.length > 0 ? groundHits[0].point.y : 0;

        if (camera.position.y <= groundY + EYE_HEIGHT) {
            velocity.y = 0;
            camera.position.y = groundY + EYE_HEIGHT;
            canJump = true;
        }

        const pos = camera.position;
        socket.emit('playerMove', { x: pos.x, y: pos.y - 1.5, z: pos.z });
    }

    prevTime = time;
    renderer.render(scene, camera);
}
