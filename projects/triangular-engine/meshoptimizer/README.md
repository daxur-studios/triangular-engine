# triangular-engine/meshoptimizer

Optional generic indexed-geometry simplification backed by the `meshoptimizer`
npm package. Install the peer dependency only when this entry point is used:

```bash
npm install meshoptimizer
```

The helpers can be used by runtime terrain chunks, procedural meshes and other
geometry pipelines. They preserve existing vertex attributes and return the
reported relative simplification error alongside the simplified geometry.
