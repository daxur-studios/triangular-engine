# Starbase catch tower study

The preview compares open and closed baked meshes on a linked orbit. Choose **Pin contact** to see both stock pin undersides on the pads, or **Top** to check approach clearance. **V-shaped sweep** pivots about the visible arm roots. **Game lab slide** uses the centered stock lab positions and speeds. The lift carries the reference proxy with the pads to keep the mating faces visible at any height.

## Build and check

From the workspace root:

```powershell
node projects/brep-poc/studies/catch-tower/verify.mjs
node projects/brep-poc/studies/catch-tower/build.mjs
```

Open `artifacts/brep-catch-tower/preview.html` in a WebGL browser. The HTML includes the meshes and needs no server. The same folder contains the separate GLBs, the local transforms in `asset-manifest.json`, and the `brep verify --check` reports for five default parts and four variant/hand combinations.

## Coordinates and fit

The `.brep.ts` files use millimetres and Z-up. The GLBs use metres and Y-up. The tower origin is on the foundation centre at ground level. The carriage origin is the housing centre. Each arm origin is the centre of its root mount. The proxy origin is the plane beneath its pins. The pads are included in the arm GLBs as a separate material. Their centres and top faces stay fixed in arm space as the boom and pad dimensions change.

| Interface | Stock study value |
| --- | ---: |
| Tower height | 80.00 m |
| Nominal rail top | 35.75 m |
| Lab catch socket | 35.90 m |
| Stock pin span / body diameter | 4.40 m / 1.00 m |
| Open / closed pad centre spacing | 12.00 m / 3.20 m |
| Centered slide per arm / available stroke | 4.40 m / 5.50 m |
| Open clearance beyond each pin in slide mode | 3.30 m |
| Closed support under each stock pin | 1.00 m |
| Default boom length / depth | 15.10 m / 1.40 m |
| Default rail pad length × width × depth | 11.00 × 1.00 × 0.30 m |

On the game axes, the stock pin crosses the tower at X = 6.00 m. Both pads are centred at X = 6.50 m. At closed, they sit at Z = ±1.60 m. The nominal rail plane is 0.15 m below the catch socket. The preview lift covers rail heights from 4.85 to 74.85 m, corresponding to the lab's 5–75 m socket range. Both arm modes share the same closed pose. The V uses 28° per arm, a visual choice within the engine demo archetype's hinge range.

Flight 5 Pad A provides the visual reference for the braced steel mast, tapered twin trusses and rail carriage. The stock game interface sets the scale. The simplified proxy reproduces the stock pin span, footprint and flat underside. [SpaceX Flight 5](https://www.spacex.com/launches/starship-flight-5) · [John Kraus catch photography](https://www.johnkrausphotos.com/Galleries/Launches/Starship-Flight-5/i-TM7brD2)
