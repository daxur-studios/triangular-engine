# Triangular Engine

# Peer Dependencies

```json
  "peerDependencies": {
    "@angular/common": "^18.2.0",
    "@angular/core": "^18.2.0",
    "@angular/core": "^18.2.0",
    "@angular/material": "^18.2.0",
    "@dimforge/rapier3d-compat": "^0.18.0",
    "dexie": "^4.0.11",
    "three": "^0.178.0",
  },
```

# Draco Loader

Add this to angular.json assets array

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
}
```

# Troubleshooting

If serving both triangular-engine and app locally, make sure you've ran `npm link triangular-engine`

## Serving both triangular-engine and a separate app with npm link

If making changes in triangular-engine isn't reflected in the app, you may have to put `"preserveSymlinks": true` in angular.json into build options of your app, and update tsconfig.json with the following paths:

Should update tsconfig.json of your app to include the following paths:

```json
    "paths": {
      "triangular-engine": ["node_modules/triangular-engine"]
    },
```

## Have not injected EngineService

`core.mjs:7195 ERROR NullInjectorError` `NullInjectorError: No provider for _EngineService`

Each component that have a scene should provide the `EngineService` and `provideEngineServiceOptions(...)`
