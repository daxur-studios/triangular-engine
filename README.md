# Triangular Engine Workspace

## Getting Started

Open the Library's readme here: [triangular-engine](/projects/triangular-engine/README.md)

### Triangular Engine

See the npm scripts in [package.json](package.json).

To use in another project run `npm run link`.
To serve locally with hot reload run `npm run watch`.

```json
    "build:triangular-engine": "ng build triangular-engine",
    "publish": "npm run build:triangular-engine && cd dist/triangular-engine && npm publish",
    "link": "npm run build:triangular-engine && cd dist/triangular-engine && npm link",
    "watch": "ng build triangular-engine --watch --configuration development"
```

### Demo App

Run `npm run start` or `ng s -o` to serve the demo app.

# See roadmap at [roadmap.md](instructions/roadmap.md)

# See summary at [summary.md](instructions/summary.md)
