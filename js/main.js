import { setupMap } from './map.js';
import { Weapon, createTracer } from './weapon.js';
import { createPlayerMesh } from './player.js';

const socket = io("https://fps-game-e18y.onrender.com");

let camera, scene, renderer, controls;
let weapon;
let colliders = [];
const otherPlayers = {};
const playerMeshesList = [];

let health = 100;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb0e0e6); // Hellblauer Wüstenhimmel

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 80); // Start im T-Spawn
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    controls = new THREE.PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => controls.lock());
    controls.addEventListener('lock', () => instructions.style.display = 'none');
    controls.addEventListener('unlock', () => instructions.style.display = 'flex');

    // Map laden & Kollisions-Objekte speichern
    colliders = setupMap(scene);
    weapon = new Weapon(camera, scene);

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
    if (!controls.isLocked) return;

    weapon.shoot();

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

function checkCollisions(oldPosition) {
    // Spieler als kleine Box (Breite: 1.2, Höhe: 2.0)
    const playerBox = new THREE.Box3();
    const playerRadius = 0.6;
    
    playerBox.min.set(camera.position.x - playerRadius, camera.position.y - 1.5, camera.position.z - playerRadius);
    playerBox.max.set(camera.position.x + playerRadius, camera.position.y + 0.5, camera.position.z + playerRadius);

    for (let i = 0; i < colliders.length; i++) {
        if (playerBox.intersectsBox(colliders[i])) {
            // Bei Kollision Position auf den Stand vor der Bewegung zurücksetzen (Wand stoppt Spieler)
            camera.position.x = oldPosition.x;
            camera.position.z = oldPosition.z;
            break;
        }
    }
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
    }
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

    if (controls.isLocked) {
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

        // Prüfen, ob neue Position in Wand/Kiste liegt
        checkCollisions(oldPosition);

        camera.position.y += velocity.y * delta;

        if (camera.position.y < 2) {
            velocity.y = 0;
            camera.position.y = 2;
            canJump = true;
        }

        const pos = camera.position;
        socket.emit('playerMove', { x: pos.x, y: pos.y - 1.5, z: pos.z });
    }

    prevTime = time;
    renderer.render(scene, camera);
}
