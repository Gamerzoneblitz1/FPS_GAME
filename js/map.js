// map.js — "Neon Vault XL" Map
// Baut eine großflächige Arena mit Three.js Geometrie und gibt THREE.Box3 Collider zurück.

const TILE_SIZE = 2.0;
const WALL_HEIGHT = 4.0;

// Grid-Größe: 61 Spalten x 21 Zeilen
// # = Wand | . = Boden | G = Neon-Tor | L = Neon-Säule | C = Spawn-Punkt
const NEON_VAULT_GRID = [
    "#".repeat(61),
    "#C........L.............#...........#.............L........C#",
    "#.#######G#############.#.#########.#.#############G#######.#",
    "#.#...................#.#.........#.#...................#.#",
    "#.#.......L...........#.#....G....#.#...........L.......#.#",
    "#.#.......C...........#.###########.#...........C.......#.#",
    "#LG.......C...........#.............#...........C.......GL#",
    "#.#.......C...........#.###########.#...........C.......#.#",
    "#.#.......L...........#.....G.....#.#...........L.......#.#",
    "#.#...................#...........#.#...................#.#",
    "#.#######G#####.#######G###########G#######.#####G#######.#",
    "#.#...........#.........#.........#.........#...........#.#",
    "#.#...........#.........#....C....#.........#...........#.#",
    "#.#.......L...#...G.....#.........#.....G...#...L.......#.#",
    "#.#...........#.#########.#######.#########.#...........#.#",
    "#LG.......C...#.........#.........#.........#...C.......GL#",
    "#.#...........#.#########.#######.#########.#...........#.#",
    "#.#.......L...#.........#....G....#.........#...L.......#.#",
    "#.#######G#####.#######G###########G#######.#####G#######.#",
    "#C........L.............#...........#.............L........C#",
    "#".repeat(61)
];

export function setupMap(scene) {
    const colliders = [];
    const spawnPoints = [];
    const groundMeshes = [];

    const rows = NEON_VAULT_GRID.length;
    const cols = NEON_VAULT_GRID[0].length;
    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Stimmung & Beleuchtung ---
    scene.background = new THREE.Color(0x02020a);
    scene.fog = new THREE.FogExp2(0x02020a, 0.025);
    scene.add(new THREE.AmbientLight(0x0a0a1a, 0.5));

    // --- Boden ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    groundMeshes.push(floor);

    // Neon-Grid auf dem Boden
    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, Math.max(cols, rows), 0x00f0ff, 0x111133);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // --- Decke ---
    const ceiling = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x030308, roughness: 1.0 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    scene.add(ceiling);

    function worldPos(col, row) {
        return {
            x: (col * TILE_SIZE) - halfWidth + TILE_SIZE / 2,
            z: (row * TILE_SIZE) - halfDepth + TILE_SIZE / 2
        };
    }

    const COLLIDER_PADDING = 0.15;

    function addBoxCollider(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        box.expandByScalar(COLLIDER_PADDING);
        colliders.push(box);
    }

    // Wiederverwendbare Materialien
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.1 });
    const gateMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.3, metalness: 0.4,
        emissive: 0x00f0ff, emissiveIntensity: 2.5
    });
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.2, metalness: 0.4,
        emissive: 0xff0055, emissiveIntensity: 3.0
    });

    // Grid parsen
    for (let r = 0; r < rows; r++) {
        const line = NEON_VAULT_GRID[r];
        for (let c = 0; c < cols; c++) {
            const char = line[c];
            const { x, z } = worldPos(c, r);

            if (char === '#') {
                const wall = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE), wallMat);
                wall.position.set(x, WALL_HEIGHT / 2, z);
                wall.castShadow = true;
                wall.receiveShadow = true;
                scene.add(wall);
                addBoxCollider(wall);

            } else if (char === 'G') {
                const gate = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.9, 0.2), gateMat);
                gate.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gate);

                const gateLight = new THREE.PointLight(0x00f0ff, 2.0, 7.0);
                gateLight.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gateLight);

            } else if (char === 'L') {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5), pillarMat);
                pillar.position.set(x, WALL_HEIGHT / 2, z);
                pillar.castShadow = true;
                pillar.receiveShadow = true;
                scene.add(pillar);
                addBoxCollider(pillar);

                const pillarLight = new THREE.PointLight(0xff0055, 3.0, 6.0);
                pillarLight.position.set(x, WALL_HEIGHT * 0.7, z);
                scene.add(pillarLight);

            } else if (char === 'C') {
                spawnPoints.push({ x, y: 2, z });

                const spotLight = new THREE.SpotLight(0xfff5e6, 1.8, 9.0, Math.PI / 4);
                spotLight.position.set(x, WALL_HEIGHT, z);
                spotLight.target.position.set(x, 0, z);
                scene.add(spotLight);
                scene.add(spotLight.target);
            }
        }
    }

    // Neon-Lichtleisten entlang der Längswände
    [-halfWidth + TILE_SIZE * 2, -halfWidth / 2, 0, halfWidth / 2, halfWidth - TILE_SIZE * 2].forEach((x) => {
        const stripTop = new THREE.PointLight(0x9d00ff, 1.5, 12);
        stripTop.position.set(x, WALL_HEIGHT - 0.5, -halfDepth + TILE_SIZE);
        scene.add(stripTop);

        const stripBottom = new THREE.PointLight(0x9d00ff, 1.5, 12);
        stripBottom.position.set(x, WALL_HEIGHT - 0.5, halfDepth - TILE_SIZE);
        scene.add(stripBottom);
    });

    // --- Deckungskisten (auf neue Kartengröße verteilt) ---
    const crateMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d18, roughness: 0.6, metalness: 0.3,
        emissive: 0x9d00ff, emissiveIntensity: 0.4
    });

    const cratePositions = [
        // Linker Bereich
        { x: -48, z: -14 }, { x: -40, z: -14 }, { x: -32, z: -14 },
        { x: -48, z: 14 },  { x: -40, z: 14 },  { x: -32, z: 14 },
        { x: -42, z: -6 },  { x: -42, z: 6 },

        // Rechter Bereich
        { x: 48, z: -14 },  { x: 40, z: -14 },  { x: 32, z: -14 },
        { x: 48, z: 14 },   { x: 40, z: 14 },   { x: 32, z: 14 },
        { x: 42, z: -6 },   { x: 42, z: 6 },

        // Zentraler Bereich & Korridore
        { x: -20, z: -4 },  { x: -10, z: 4 },   { x: 0, z: -4 },    { x: 10, z: 4 },    { x: 20, z: -4 },
        { x: -16, z: 10 },  { x: 16, z: 10 },   { x: -16, z: -10 }, { x: 16, z: -10 }
    ];

    cratePositions.forEach(({ x, z }) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), crateMat);
        crate.position.set(x, 0.65, z);
        crate.castShadow = true;
        crate.receiveShadow = true;
        scene.add(crate);
        addBoxCollider(crate);
    });

    // --- Treppen & Plattformen ---
    const stepMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d18, roughness: 0.5, metalness: 0.3,
        emissive: 0x00f0ff, emissiveIntensity: 0.6
    });

    function addStaircase(startX, z, dirX, steps, stepHeight, stepDepth, platformDepth) {
        for (let i = 0; i < steps; i++) {
            const h = stepHeight * (i + 1);
            const step = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, h, TILE_SIZE * 0.9), stepMat);
            step.position.set(startX + dirX * stepDepth * i, h / 2, z);
            step.castShadow = true;
            step.receiveShadow = true;
            scene.add(step);
            groundMeshes.push(step);
        }

        const platformHeight = stepHeight * steps;
        const platform = new THREE.Mesh(
            new THREE.BoxGeometry(platformDepth, platformHeight, TILE_SIZE * 1.4),
            stepMat
        );
        platform.position.set(
            startX + dirX * (stepDepth * steps + platformDepth / 2 - stepDepth / 2),
            platformHeight / 2,
            z
        );
        platform.castShadow = true;
        platform.receiveShadow = true;
        scene.add(platform);
        groundMeshes.push(platform);

        const edgeLight = new THREE.PointLight(0x00f0ff, 2.0, 6.0);
        edgeLight.position.set(platform.position.x, platformHeight + 1, z);
        scene.add(edgeLight);
    }

    addStaircase(-52, -8, 1, 3, 0.5, 1.0, 2.0);  // links oben
    addStaircase(52, -8, -1, 3, 0.5, 1.0, 2.0);  // rechts oben
    addStaircase(-52, 8, 1, 3, 0.5, 1.0, 2.0);   // links unten
    addStaircase(52, 8, -1, 3, 0.5, 1.0, 2.0);    // rechts unten

    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    return colliders;
}
