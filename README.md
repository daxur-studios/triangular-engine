# Triangular Engine Workspace

## Getting Started

This repository contains the `triangular-engine` Angular library and its demo app.

For AI-agent and maintainer conventions, start with [AGENTS.md](AGENTS.md). For the consumer-facing API, start with the [library README](projects/triangular-engine/README.md).

Open the library README here: [triangular-engine](projects/triangular-engine/README.md)

### Triangular Engine

See the npm scripts in [package.json](package.json).

To use in another project run `npm run link` here and `npm link triangular-engine` in the other project
To build and watch the library, run `npm run watch`. To serve the demo app, run `npx ng serve demo-app` in a second terminal.

```json
    "build:triangular-engine": "ng build triangular-engine",
    "publish": "npm run build:triangular-engine && cd dist/triangular-engine && npm publish",
    "link": "npm run build:triangular-engine && cd dist/triangular-engine && npm link",
    "watch": "ng build triangular-engine --watch --configuration development",
    "dev": "npm run watch"
```

### Demo App

Run `npx ng serve demo-app -o` to serve the demo app. `npm run start` prepares a linked library and starts its watch build; it does not start the demo server.

# See roadmap at [roadmap.md](instructions/roadmap.md)

# See summary at [summary.md](instructions/summary.md)
