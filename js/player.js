export function createPlayerMesh() {
    const group = new THREE.Group();

    // Beine
    const legsGeo = new THREE.BoxGeometry(0.6, 1, 0.4);
    const legsMat = new THREE.MeshBasicMaterial({ color: 0x222288 });
    const legs = new THREE.Mesh(legsGeo, legsMat);
    legs.position.y = 0.5;

    // Torso
    const torsoGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
    const torsoMat = new THREE.MeshBasicMaterial({ color: 0xcc2222 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.6;

    // Kopf
    const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffcc99 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.45;

    group.add(legs);
    group.add(torso);
    group.add(head);

    return group;
}
