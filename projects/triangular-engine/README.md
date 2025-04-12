# Triangular Engine

# Peer Dependencies

```json
  "peerDependencies": {
    "@angular/common": "^18.2.0",
    "@angular/core": "^18.2.0",
    "@angular/core": "^18.2.0",
    "three": "^0.173.0",
    "@dimforge/rapier3d-compat": "^0.14.0",
    "dexie": "^4.0.11"
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

## Serving both triangular-engine and a separate app with npm link

If making changes in triangular-engine isn't reflected in the app, you may have to put `"preserveSymlinks": true` in angular.json into build options of your app, and update tsconfig.json with the following paths:

Should update tsconfig.json of your app to include the following paths:

```json
    "paths": {
      "triangular-engine": ["node_modules/triangular-engine"]
    },
```
