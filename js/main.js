import { setupMap } from './map.js';
import { Weapon } from './weapon.js';
import { createPlayerMesh } from './player.js';

const socket = io("https://fps-game-e18y.onrender.com");

let camera, scene, renderer, controls;
let weapon;
const otherPlayers = {};

let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Himmel blau

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => {
        controls.lock();
    });

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        instructions.style.display = 'flex';
    });

    setupMap(scene);
    weapon = new Weapon(camera, scene);

    // Tastatur Event-Listener
    document.addEventListener('keydown', (e) => onKeyChange(e.keyCode, true));
    document.addEventListener('keyup', (e) => onKeyChange(e.keyCode, false));
    document.addEventListener('mousedown', () => {
        if (controls.isLocked) {
            weapon.shoot();
        }
    });

    // Multiplayer Socket.io Events
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) {
                addOtherPlayer(id, players[id]);
            }
        });
    });

    socket.on('newPlayer', (data) => {
        addOtherPlayer(data.id, data.position);
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
        }
    });

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    window.addEventListener('resize', onWindowResize);
}

function addOtherPlayer(id, position) {
    const pMesh = createPlayerMesh();
    pMesh.position.set(position.x || 0, position.y || 0, position.z || 0);
    otherPlayers[id] = pMesh;
    scene.add(pMesh);
}

function onKeyChange(keyCode, isPressed) {
    switch (keyCode) {
        case 38: case 87: moveForward = isPressed; break; // Up / W
        case 37: case 65: moveLeft = isPressed; break;    // Left / A
        case 40: case 83: moveBackward = isPressed; break;// Down / S
        case 39: case 68: moveRight = isPressed; break;   // Right / D
        case 32: // Space
            if (isPressed && canJump) {
                velocity.y += 15;
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
        velocity.y -= 9.8 * 4.0 * delta; // Schwerkraft

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * 100.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 100.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        camera.position.y += velocity.y * delta;

        if (camera.position.y < 2) {
            velocity.y = 0;
            camera.position.y = 2;
            canJump = true;
        }

        // Position an Server senden
        const pos = camera.position;
        socket.emit('playerMove', { x: pos.x, y: pos.y - 1.5, z: pos.z });
    }

    prevTime = time;
    renderer.render(scene, camera);
}
