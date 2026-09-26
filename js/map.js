export function setupMap(scene) {
    // Boden
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x44aa44, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Außenwände
    const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x555555 });
    const wallGeometryHorizontal = new THREE.BoxGeometry(200, 10, 2);
    const wallGeometryVertical = new THREE.BoxGeometry(2, 10, 200);

    const wallN = new THREE.Mesh(wallGeometryHorizontal, wallMaterial);
    wallN.position.set(0, 5, -100);
    scene.add(wallN);

    const wallS = new THREE.Mesh(wallGeometryHorizontal, wallMaterial);
    wallS.position.set(0, 5, 100);
    scene.add(wallS);

    const wallE = new THREE.Mesh(wallGeometryVertical, wallMaterial);
    wallE.position.set(100, 5, 0);
    scene.add(wallE);

    const wallW = new THREE.Mesh(wallGeometryVertical, wallMaterial);
    wallW.position.set(-100, 5, 0);
    scene.add(wallW);

    // Kisten als Deckung
    const crateMaterial = new THREE.MeshBasicMaterial({ color: 0x8b5a2b });
    for (let i = 0; i < 15; i++) {
        const size = Math.random() * 2 + 2;
        const crateGeometry = new THREE.BoxGeometry(size, size, size);
        const crate = new THREE.Mesh(crateGeometry, crateMaterial);
        crate.position.set(
            (Math.random() - 0.5) * 160,
            size / 2,
            (Math.random() - 0.5) * 160
        );
        scene.add(crate);
    }

    // Säulen
    const pillarMaterial = new THREE.MeshBasicMaterial({ color: 0x888888 });
    const pillarGeometry = new THREE.CylinderGeometry(1, 1, 12, 16);
    for (let i = 0; i < 10; i++) {
        const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
        pillar.position.set(
            (Math.random() - 0.5) * 160,
            6,
            (Math.random() - 0.5) * 160
        );
        scene.add(pillar);
    }
}
