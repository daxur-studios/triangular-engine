# Troubleshooting


### 3D Canvas / Scene is 0 Height (Invisible)

**Symptom**: The 3D canvas is not displaying, or the container has a height of 0.

**Cause**: The `<scene>` element relies on a `ResizeObserver` observing a flexbox layout. If any of the parent elements/components wrapping the `<scene>` element are block elements without defined heights or are not participating in the flex layout, the layout collapses.

**Fix**: Ensure every parent component in the DOM tree, from the root application element down to the `<scene>` container, participates in a flexbox layout:

1. Register `host: { class: 'flex-page' }` on your parent components/directives.
2. In your global stylesheet (e.g., `styles.scss`), define the `.flex-page` helper class:
   ```css
   .flex-page {
     display: flex;
     flex-direction: column;
     flex: 1 1;
     overflow: auto;
   }
   ```
3. Make sure any intermediate wrapper `div` elements are styled as flex containers (e.g., `display: flex; flex-direction: column; flex: 1;`).

### EngineService provider missing

Error: `NullInjectorError: No provider for _EngineService`

Fix: Provide `EngineService.provide(...)` in every component that hosts a `<scene>`.

### Web Worker importing an engine entry point is silently empty

**Symptom**: A worker that imports `triangular-engine/terrain`, `.../worldgen/render`,
`.../jolt`, `.../takram`, etc. throws on load (`ɵɵngDeclareComponent` →
"The injectable ... needs to be compiled using the JIT compiler") and produces nothing. The
same import works on the main thread.

**Cause**: Angular's `bundleWebWorker` builds the worker with esbuild `buildSync({ plugins: undefined })`,
so the Angular linker never runs on workers. Partially-compiled libraries keep their `ɵɵngDeclare*`
calls, which throw when the module is evaluated. Main bundles *are* linked, so only workers break.

**Fix**: Add `import '@angular/compiler';` as the first import of the worker entry file to register
the JIT facade (bundles the compiler into that worker). Entry points with no partial declarations
(verified: `worldgen` core, `celestial`) don't need it.

### Working locally with npm link

If serving both `triangular-engine` and your app locally, link the package:

```bash
# in this repo
npm run link

# in your app
npm link triangular-engine
```

**Important**: Set `"preserveSymlinks": true` in your app's `angular.json` build options to avoid runtime injection errors (such as `_HighContrastModeDetector` token injection failures). Also add the following to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "triangular-engine": ["node_modules/triangular-engine"]
    }
  }
}
```
