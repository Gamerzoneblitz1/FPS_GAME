export function setupMap(scene) {
    // -----------------------------------------------------------------
    // MATERIALIEN & FARBEN (Mirage Wüsten-Look)
    // -----------------------------------------------------------------
    const groundMat   = new THREE.MeshBasicMaterial({ color: 0xd2b48c }); // Sand-Boden
    const wallMat     = new THREE.MeshBasicMaterial({ color: 0xbe8a58 }); // Sandstein-Wände
    const darkWallMat = new THREE.MeshBasicMaterial({ color: 0x8b6d43 }); // Dunkle Gebäude
    const crateMat    = new THREE.MeshBasicMaterial({ color: 0x6e4a27 }); // Holzkisten
    const metalMat    = new THREE.MeshBasicMaterial({ color: 0x4a5d4e }); // Metallkisten
    const siteAMat    = new THREE.MeshBasicMaterial({ color: 0xcc4444 }); // A-Spot Markierung
    const siteBMat    = new THREE.MeshBasicMaterial({ color: 0x4444cc }); // B-Spot Markierung

    // Helper-Funktion für Kisten
    function createBox(w, h, d, x, y, z, mat = crateMat) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);
        return mesh;
    }

    // Helper-Funktion für Wände
    function createWall(w, h, d, x, y, z, mat = wallMat) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);
        return mesh;
    }

    // -----------------------------------------------------------------
    // 1. HAUPTBODEN & AUSSENWÄNDE (Map-Grenzen: 200x200)
    // -----------------------------------------------------------------
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Außenmauern (hohe Mauern)
    createWall(220, 20, 4, 0, 10, -110, darkWallMat); // CT Side Wall
    createWall(220, 20, 4, 0, 10, 110, darkWallMat);  // T Side Wall
    createWall(4, 20, 220, -110, 10, 0, darkWallMat); // B Side Wall
    createWall(4, 20, 220, 110, 10, 0, darkWallMat);  // A Side Wall

    // -----------------------------------------------------------------
    // 2. MID (Zentrum der Map)
    // -----------------------------------------------------------------
    // Mid-Boxen / Abdeckung
    createBox(3, 3, 3, -5, 1.5, 0, crateMat);
    createBox(3, 3, 3, -5, 1.5, -4, metalMat);
    createBox(3, 3, 3, -5, 4.5, -2, crateMat); // Gestapelt

    // Window / Sniper-Window (CT-Mid Deckung)
    createWall(20, 8, 4, 0, 4, -45, wallMat);
    createWall(8, 6, 4, 0, 11, -45, wallMat); // Fensteröffnung darunter frei

    // Top Mid / Connector Wand (T-Sichtschutz)
    createWall(4, 8, 30, 20, 4, -10, wallMat); 

    // -----------------------------------------------------------------
    // 3. A-SITE (Rechter Bereich der Map: X > 30, Z < -30)
    // -----------------------------------------------------------------
    // Bombspot A Boden-Markierung
    const siteAFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), siteAMat);
    siteAFloor.rotation.x = -Math.PI / 2;
    siteAFloor.position.set(50, 0.01, -60);
    scene.add(siteAFloor);

    // Triple Box auf A
    createBox(3, 3, 3, 48, 1.5, -58, crateMat);
    createBox(3, 3, 3, 51, 1.5, -58, crateMat);
    createBox(3, 3, 3, 49.5, 4.5, -58, crateMat);

    // Tetris (Treppen-Kisten Richtung A-Ramp)
    createBox(4, 2, 4, 65, 1, -40, metalMat);
    createBox(4, 4, 4, 65, 2, -46, metalMat);

    // A-Palast (Palace) - Erhöhte Struktur
    createWall(25, 10, 20, 80, 5, -70, darkWallMat); // Palast-Gebäude
    createWall(20, 2, 10, 70, 4, -50, wallMat);      // Palast-Balkon
    createBox(3, 4, 3, 62, 2, -50, crateMat);        // Aufstiegskiste

    // Connector-Wand (Verbindung Mid zu A)
    createWall(30, 10, 4, 30, 5, -40, wallMat);

    // -----------------------------------------------------------------
    // 4. B-SITE (Linker Bereich der Map: X < -30, Z < -30)
    // -----------------------------------------------------------------
    // Bombspot B Boden-Markierung
    const siteBFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), siteBMat);
    siteBFloor.rotation.x = -Math.PI / 2;
    siteBFloor.position.set(-60, 0.01, -60);
    scene.add(siteBFloor);

    // B-Default Kisten
    createBox(4, 4, 4, -60, 2, -58, metalMat);
    createBox(4, 4, 4, -65, 2, -62, crateMat);

    // Bench (Mauer-Unterstand)
    createWall(12, 4, 3, -75, 2, -50, wallMat);

    // Apartments / B-Apps (Tunnel-Gang aus dem T-Spawn)
    createWall(4, 10, 50, -80, 5, -20, darkWallMat);
    createWall(20, 10, 4, -70, 5, -45, darkWallMat); // B-Apps Ausgangsfenster

    // Catwalk / Short-B (Erhöhung aus Mid)
    createWall(30, 4, 6, -35, 2, -35, wallMat);

    // -----------------------------------------------------------------
    // 5. DECKUNG UND SÄULEN IM SPANNSFELD
    // -----------------------------------------------------------------
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x9e7b4f });
    const pillarGeo = new THREE.CylinderGeometry(1.5, 1.5, 8, 12);

    // Säulen in der Nähe von Mid und CT-Spawn
    const pillarPositions = [
        [15, 4, -70],
        [-15, 4, -70],
        [35, 4, 10],
        [-35, 4, 10]
    ];

    pillarPositions.forEach(([px, py, pz]) => {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, py, pz);
        scene.add(pillar);
    });
}
