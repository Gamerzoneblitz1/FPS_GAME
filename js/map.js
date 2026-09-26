export function setupMap(scene) {
    const colliders = [];

    // -----------------------------------------------------------------
    // 1. BELEUCHTUNG & SCHATTEN (Gibt der Map 3D-Tiefe)
    // -----------------------------------------------------------------
    const ambientLight = new THREE.AmbientLight(0xffebcd, 0.5); // Warmes Sonnenlicht
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(80, 120, 60);
    scene.add(dirLight);

    // -----------------------------------------------------------------
    // 2. MATERIALIEN (Wüsten- / Mirage-Look)
    // -----------------------------------------------------------------
    const groundMat    = new THREE.MeshLambertMaterial({ color: 0xd2b48c }); // Sand
    const wallMat      = new THREE.MeshLambertMaterial({ color: 0xc8a27c }); // Sandstein-Wand
    const darkWallMat  = new THREE.MeshLambertMaterial({ color: 0x8b6d43 }); // Gebäude
    const crateWoodMat = new THREE.MeshLambertMaterial({ color: 0x7a4b21 }); // Holzkisten
    const crateMetalMat= new THREE.MeshLambertMaterial({ color: 0x3d5245 }); // Metallkisten
    const barrelMat    = new THREE.MeshLambertMaterial({ color: 0x224422 }); // Fässer
    const siteAMat     = new THREE.MeshLambertMaterial({ color: 0xd9534f }); // A-Spot
    const siteBMat     = new THREE.MeshLambertMaterial({ color: 0x0275d8 }); // B-Spot

    // -----------------------------------------------------------------
    // HELPER-FUNKTIONEN (Erzeugt Objekte & registriert Kollision)
    // -----------------------------------------------------------------
    function addSolidBox(w, h, d, x, y, z, mat) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);

        // Bounding Box für Kollision berechnen
        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
        return mesh;
    }

    function addCylinder(radius, h, x, y, z, mat) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 16), mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
        return mesh;
    }

    // -----------------------------------------------------------------
    // 3. BODEN & AUSSENWÄNDE
    // -----------------------------------------------------------------
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Hohe Außenmauern
    addSolidBox(220, 20, 4, 0, 10, -110, darkWallMat);
    addSolidBox(220, 20, 4, 0, 10, 110, darkWallMat);
    addSolidBox(4, 20, 220, -110, 10, 0, darkWallMat);
    addSolidBox(4, 20, 220, 110, 10, 0, darkWallMat);

    // -----------------------------------------------------------------
    // 4. MID (Zentrum: Sniper Window, Connector, Mid Boxes)
    // -----------------------------------------------------------------
    // Mid Kisten Stapel
    addSolidBox(3, 3, 3, -5, 1.5, 0, crateWoodMat);
    addSolidBox(3, 3, 3, -5, 1.5, -4, crateMetalMat);
    addSolidBox(3, 3, 3, -5, 4.5, -2, crateWoodMat);

    // Sniper Window (CT-Mid Deckung mit Fenster-Öffnung)
    addSolidBox(24, 4, 4, 0, 2, -45, wallMat);    // Untere Wand
    addSolidBox(8, 6, 4, -8, 7, -45, wallMat);   // Links
    addSolidBox(8, 6, 4, 8, 7, -45, wallMat);    // Rechts
    addSolidBox(24, 4, 4, 0, 12, -45, wallMat);   // Fenstersturz oben

    // Top Mid Wall & Connector
    addSolidBox(4, 10, 28, 20, 5, -10, wallMat); 

    // -----------------------------------------------------------------
    // 5. A-SITE (Rechts: Triple Box, Tetris, Palace, Connector)
    // -----------------------------------------------------------------
    // Bombspot A Markierung
    const siteAFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), siteAMat);
    siteAFloor.rotation.x = -Math.PI / 2;
    siteAFloor.position.set(50, 0.02, -60);
    scene.add(siteAFloor);

    // Triple Box auf A Spot
    addSolidBox(3.5, 3.5, 3.5, 48, 1.75, -58, crateWoodMat);
    addSolidBox(3.5, 3.5, 3.5, 52, 1.75, -58, crateWoodMat);
    addSolidBox(3.5, 3.5, 3.5, 50, 5.25, -58, crateWoodMat);

    // Tetris (Stufen-Kisten)
    addSolidBox(4, 2.5, 4, 65, 1.25, -40, crateMetalMat);
    addSolidBox(4, 5, 4, 65, 2.5, -46, crateMetalMat);

    // Palace (A-Palast Gebäude & Balkon)
    addSolidBox(26, 12, 20, 80, 6, -70, darkWallMat);
    addSolidBox(18, 1, 8, 70, 4.5, -52, wallMat); // Balkon
    addSolidBox(3, 4, 3, 62, 2, -52, crateWoodMat); // Aufstiegskiste

    // Connector Wand
    addSolidBox(32, 10, 4, 32, 5, -35, wallMat);

    // -----------------------------------------------------------------
    // 6. B-SITE (Links: B-Apps, Bench, Site Crates, Short B)
    // -----------------------------------------------------------------
    // Bombspot B Markierung
    const siteBFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), siteBMat);
    siteBFloor.rotation.x = -Math.PI / 2;
    siteBFloor.position.set(-60, 0.02, -60);
    scene.add(siteBFloor);

    // B-Default Kisten
    addSolidBox(4, 4, 4, -60, 2, -58, crateMetalMat);
    addSolidBox(4, 4, 4, -65, 2, -62, crateWoodMat);

    // Bench (Überdachte Mauer)
    addSolidBox(14, 4, 3, -75, 2, -48, wallMat);
    addSolidBox(14, 1, 5, -75, 4.5, -48, darkWallMat);

    // B-Apartments Structure
    addSolidBox(4, 12, 50, -82, 6, -20, darkWallMat);
    addSolidBox(20, 12, 4, -72, 6, -45, darkWallMat);

    // Short-B Catwalk (Erhöhte Mauer aus Mid)
    addSolidBox(30, 4, 6, -35, 2, -35, wallMat);

    // -----------------------------------------------------------------
    // 7. DEKORATION & DETAIL-PROPS (Fässer, Säulen & Absperrungen)
    // -----------------------------------------------------------------
    addCylinder(1.2, 3, 10, 1.5, -15, barrelMat);
    addCylinder(1.2, 3, 13, 1.5, -16, barrelMat);
    addCylinder(1.2, 3, 11.5, 4.5, -15.5, barrelMat); // Gestapeltes Fass

    addCylinder(1.2, 3, -50, 1.5, -50, barrelMat);
    addCylinder(1.2, 3, -53, 1.5, -51, barrelMat);

    // Säulen
    addCylinder(1.5, 10, 15, 5, -70, wallMat);
    addCylinder(1.5, 10, -15, 5, -70, wallMat);

    return colliders;
}
