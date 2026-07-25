# triangular-engine/postprocessing

Declarative post-processing built on the optional `postprocessing` peer.

```ts
import {
  PostprocessingComposerComponent,
  PostprocessingModule,
} from 'triangular-engine/postprocessing';
```

```html
<postprocessing-composer>
  <!-- effect components -->
</postprocessing-composer>
```

The composer registers as the engine render pipeline and owns its render,
normal, and effect passes. It currently requires `THREE.WebGLRenderer` with
WebGL2-class functionality.

Install the optional peer when using this entry point:

```bash
npm i postprocessing
```

