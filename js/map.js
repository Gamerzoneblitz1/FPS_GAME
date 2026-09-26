// map.js — "Neon Vault" map
// Builds the map with real Three.js geometry (no external FBX models needed)
// and returns an array of THREE.Box3 colliders, matching what main.js expects
// from: colliders = setupMap(scene);

const TILE_SIZE = 2.0;
const WALL_HEIGHT = 4.0;

// # = wall | . = floor | G = neon gate (walk-through) | L = neon pillar (blocks) | C = spawn zone
// Vergrößerte Version: 41x13 statt 33x11 Tiles (~1.5x mehr Fläche) + eine zusätzliche
// Raumebene (Zeile 5/7) mit 4 weiteren Spawnpunkten -> insgesamt 10 statt 6 Spawnpunkte,
// damit sich mehr Spieler über die Karte verteilen können.
const NEON_VAULT_GRID = [
    "#".repeat(41),
    "#C.......L..........#..........L.......C#",
    "#.###G##############.##############G###.#",
    "#.#............#.........#............#.#",
    "#.#.....L......#..G#.#G..#......L.....#.#",
    "#.#.....C......#.........#......C.....#.#",
    "#LG.....C.......................C.....GL#",
    "#.#.....C......#.........#......C.....#.#",
    "#.#.....L......#..G#.#G..#......L.....#.#",
    "#.#............#.........#............#.#",
    "#.###G##############.##############G###.#",
    "#C.......L..........#..........L.......C#",
    "#".repeat(41)
];

export function setupMap(scene) {
    const colliders = [];
    const spawnPoints = [];
    const groundMeshes = []; // begehbare Flächen: Boden, Treppen, Plattformen (für Bodenraycast)

    const rows = NEON_VAULT_GRID.length;
    const cols = NEON_VAULT_GRID[0].length;
    const halfWidth = (cols * TILE_SIZE) / 2;
    const halfDepth = (rows * TILE_SIZE) / 2;

    // --- Mood: dark background + fog so neon accents pop ---
    scene.background = new THREE.Color(0x02020a);
    scene.fog = new THREE.FogExp2(0x02020a, 0.035);
    scene.add(new THREE.AmbientLight(0x0a0a1a, 0.4));

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(cols * TILE_SIZE, rows * TILE_SIZE);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    groundMeshes.push(floor);

    // Tron-style neon grid lines on the floor
    const gridHelper = new THREE.GridHelper(Math.max(cols, rows) * TILE_SIZE, Math.max(cols, rows), 0x00f0ff, 0x111133);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // --- Low ceiling to keep the space moody / enclosed ---
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

    function addBoxCollider(mesh) {
        colliders.push(new THREE.Box3().setFromObject(mesh));
    }

    // Reusable materials
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.8, metalness: 0.1 });
    const gateMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.3, metalness: 0.4,
        emissive: 0x00f0ff, emissiveIntensity: 2.5
    });
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x101018, roughness: 0.2, metalness: 0.4,
        emissive: 0xff0055, emissiveIntensity: 3.0
    });

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
                // Neon gate arch — decorative, walk-through, cyan glow
                const gate = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.9, WALL_HEIGHT * 0.9, 0.2), gateMat);
                gate.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gate);

                const gateLight = new THREE.PointLight(0x00f0ff, 2.0, 6.0);
                gateLight.position.set(x, WALL_HEIGHT / 2, z);
                scene.add(gateLight);

            } else if (char === 'L') {
                // Neon pillar — solid obstacle, pink glow
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, WALL_HEIGHT, TILE_SIZE * 0.5), pillarMat);
                pillar.position.set(x, WALL_HEIGHT / 2, z);
                pillar.castShadow = true;
                scene.add(pillar);
                addBoxCollider(pillar);

                const pillarLight = new THREE.PointLight(0xff0055, 3.0, 5.0);
                pillarLight.position.set(x, WALL_HEIGHT * 0.7, z);
                scene.add(pillarLight);

            } else if (char === 'C') {
                // Spawn zone — warm spotlight marker
                spawnPoints.push({ x, y: 2, z });

                const spotLight = new THREE.SpotLight(0xfff5e6, 1.5, 8.0, Math.PI / 4);
                spotLight.position.set(x, WALL_HEIGHT, z);
                spotLight.target.position.set(x, 0, z);
                scene.add(spotLight);
                scene.add(spotLight.target);
            }
            // '.' and ' ' -> plain floor, nothing extra needed
        }
    }

    // Extra ambient neon strip lights along the long side walls
    [-halfWidth + TILE_SIZE, halfWidth - TILE_SIZE].forEach((x) => {
        const strip = new THREE.PointLight(0x9d00ff, 1.5, 10);
        strip.position.set(x, WALL_HEIGHT - 0.5, 0);
        scene.add(strip);
    });

    // --- Deckungskisten (blockieren Bewegung + Sichtlinien, kein Hochklettern) ---
    const crateMat = new THREE.MeshStandardMaterial({
        color: 0x0d0d18, roughness: 0.6, metalness: 0.3,
        emissive: 0x9d00ff, emissiveIntensity: 0.4
    });

    const cratePositions = [
        { x: -30, z: -6 }, { x: -24, z: -6 }, { x: -18, z: -6 }, // linke Kammer oben
        { x: 14, z: -6 },  { x: 20, z: -6 },  { x: 26, z: -6 },  // rechte Kammer oben
        { x: -30, z: 6 },  { x: -24, z: 6 },  { x: -18, z: 6 },  // linke Kammer unten
        { x: 14, z: 6 },   { x: 20, z: 6 },   { x: 26, z: 6 },   // rechte Kammer unten
        { x: -12, z: 1.3 }, { x: -4, z: -1.3 }, { x: 4, z: 1.3 }, { x: 12, z: -1.3 } // mittlerer Korridor
    ];

    cratePositions.forEach(({ x, z }) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), crateMat);
        crate.position.set(x, 0.65, z);
        crate.castShadow = true;
        crate.receiveShadow = true;
        scene.add(crate);
        addBoxCollider(crate); // harte Deckung, blockiert horizontale Bewegung wie eine Wand
    });

    // --- Rampen/Treppen mit begehbarer Plattform (nutzt Bodenraycast statt Collider) ---
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
            groundMeshes.push(step); // begehbar, kein harter Collider -> Spieler kann hochlaufen
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

    addStaircase(-34, -2, 1, 3, 0.5, 1.0, 2.0);  // links oben
    addStaircase(34, -2, -1, 3, 0.5, 1.0, 2.0);  // rechts oben
    addStaircase(-34, 2, 1, 3, 0.5, 1.0, 2.0);   // links unten
    addStaircase(34, 2, -1, 3, 0.5, 1.0, 2.0);   // rechts unten

    // Extra data for main.js: Spawnpunkte + begehbare Flächen für den Bodenraycast
    colliders.spawnPoints = spawnPoints;
    colliders.groundMeshes = groundMeshes;
    return colliders;
}
