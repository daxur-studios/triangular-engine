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

# Useful Links

https://gltf.pmnd.rs/

# Troubleshooting

> You have to put variable "preserveSymlinks": true in angular.json into build options of your app if you are serving both triangular-engine and a separate app with npm link
