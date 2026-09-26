export const neonVaultMap = {
  name: "Neon Vault",
  dimensions: {
    width: 33,
    height: 11,
    tileSize: 2.0
  },
  tileDefinitions: {
    "#": {
      type: "wall",
      model: "room-corner.fbx",
      material: { color: "#080810", roughness: 0.8, emission: "#000000" }
    },
    ".": {
      type: "floor",
      model: "corridor.fbx",
      material: { color: "#080810", roughness: 0.8, emission: "#000000" }
    },
    "G": {
      type: "gate",
      model: "gate-metal-bars.fbx",
      material: { color: "#101018", roughness: 0.3, emission: "#00F0FF", emissionIntensity: 2.5 }
    },
    "L": {
      type: "light_pillar",
      model: "gate-overhang.fbx",
      material: { color: "#101018", roughness: 0.2, emission: "#FF0055", emissionIntensity: 4.0 },
      light: { type: "point", color: "#FF0055", intensity: 3.0, range: 5.0 }
    },
    "C": {
      type: "character_spawn",
      model: "corridor-wide.fbx",
      light: { type: "spot", color: "#FFF5E6", intensity: 1.5, range: 8.0, angle: 45 },
      characterMaterial: { rimLightColor: "#FFE600", rimLightPower: 3.0, baseEmission: 0.3 }
    }
  },
  environment: {
    ambientLight: { color: "#020208", intensity: 0.05 },
    postProcessing: {
      bloom: { enabled: true, threshold: 0.8, intensity: 1.2 },
      vignette: { enabled: true, intensity: 0.35 }
    }
  },
  grid: [
    "#################################",
    "# C . . . . L . . # . . L . . . C #",
    "# . ### G ####### . ####### G ### . #",
    "# . #           # . #           # . #",
    "# . #  L . . .  # G #  . . . L  # . #",
    "# L G . . C . . . . . . . C . . G L #",
    "# . #  L . . .  # G #  . . . L  # . #",
    "# . #           # . #           # . #",
    "# . ### G ####### . ####### G ### . #",
    "# C . . . L . . . # . . . L . . C #",
    "#################################"
  ]
};
