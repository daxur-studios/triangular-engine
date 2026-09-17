# triangular-engine/image-compression

Optional `browser-image-compression` integration for screenshot and impostor
compression.

Install the peer dependency and provide the adapter only in applications that
use compression:

```bash
npm install browser-image-compression
```

```ts
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';

bootstrapApplication(AppComponent, {
  providers: [provideBrowserImageCompression()],
});
```

Applications that only use the core engine do not need this entry point or the
`browser-image-compression` package.
