# Karten (maps/)

Das Spiel liest die Kartenliste aus `maps/index.json`. Im Hauptmenü gibt es eine Auswahl „KARTE“.
(Kartenwechsel geht nur, wenn du allein auf dem Server bist – alle Spieler spielen immer dieselbe Karte.)

## Neue Karte hinzufügen (.glb)

1. Die Datei nach `maps/` legen, z. B. `maps/italy.glb`.
2. In `maps/index.json` einen Eintrag ergänzen:

```json
{
  "id": "italy",
  "name": "Italy",
  "type": "glb",
  "file": "maps/italy.glb",
  "scale": 0.03125
}
```

3. Server neu starten (er liest die Liste beim Start), Seite neu laden, Karte im Menü wählen.

## Skalierung (wichtig)

Spieler, Waffen und Bewegung bleiben unverändert – die **Karte** wird skaliert. Augenhöhe im Spiel = 2,0 m.

| Quelle der Karte | `scale` |
|---|---|
| Rohe Source-Einheiten (CS2/CSGO-Exporte, 1 Einheit ≈ 1 Zoll) | ca. `0.03125` (= 2.0 / 64) |
| Export in Metern | ca. `1.2` |

Zum Feintunen ohne Datei zu ändern: URL-Parameter `?mapscale=0.04`. Wenn es passt, den Wert in `index.json` eintragen.
Unter dem Kartennamen im Menü steht die Kartengröße, die Anzahl der Kollisionsboxen und die Spawn-Quelle.

## Optionale Felder

- `rotationY` (Grad), `spawns` (`[{"x":0,"y":2,"z":0}]`), `voxel` (Kollisionsraster, Standard 0.5 m), `wallSlope`,
  `chunk`, `lighting`, `ambient`, `hemisphere`, `sun`, `background`, `fog`, `fogDensity`, `doubleSide`.
- **Spawns:** Objekte in der Datei, deren Name mit `spawn` beginnt (z. B. `spawn_1`), werden als Spawnpunkte genutzt.
  Ohne solche Objekte und ohne `spawns` werden Spawns automatisch gesucht.

## Wie die Kollision entsteht

Wände (steile Dreiecke) werden automatisch in Kollisionsboxen umgewandelt; Böden, Treppen und Rampen
werden per Boden-Raycast gegen die Meshes erkannt. Die Karte wird automatisch zentriert und auf y = 0 gesetzt.
Fällst du aus der Karte, wirst du zurückgesetzt.

## Hinweise

- Sehr große Karten (> ~1 Mio. Dreiecke) laden langsam; vorher in Blender dezimieren oder Draco-komprimieren.
- Der Bloom-Effekt kann helle Tageslicht-Karten überstrahlen.
- Die alte `js/map.js` kann gelöscht werden (liegt jetzt als `maps/neon-vault.js`).
- Lokal testen: In `js/main.js` steht oben die feste Socket-URL (Render). Für lokale Tests auf `io()` ändern.
