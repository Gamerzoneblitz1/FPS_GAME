export class Weapon {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

        // Waffengruppe an Kamera hängen
        this.weaponGroup = new THREE.Group();

        const handleGeo = new THREE.BoxGeometry(0.1, 0.3, 0.1);
        const handleMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        const handle = new THREE.Mesh(handleGeo, handleMat);

        const barrelGeo = new THREE.BoxGeometry(0.12, 0.12, 0.6);
        const barrelMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.position.set(0, 0.1, -0.2);

        this.weaponGroup.add(handle);
        this.weaponGroup.add(barrel);

        // Position unten rechts im Sichtfeld
        this.weaponGroup.position.set(0.3, -0.25, -0.5);
        this.camera.add(this.weaponGroup);
    }

    shoot() {
        // Rückstoß-Animation
        this.weaponGroup.position.z += 0.08;
        setTimeout(() => {
            this.weaponGroup.position.z -= 0.08;
        }, 50);

        // Mündungsfeuer
        const flashGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(0.3, -0.15, -0.85);

        this.camera.add(flash);
        setTimeout(() => {
            this.camera.remove(flash);
        }, 40);
    }
}
