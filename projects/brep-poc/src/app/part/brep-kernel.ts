/**
 * Loads brepjs once and shares the initialised kernel.
 *
 * The kernel is started explicitly instead of through `init()` because the
 * Angular build bundles `occt-wasm`'s JS into a chunk, so the 20 MB
 * `occt-wasm.wasm` cannot be resolved relative to the module URL. It is
 * served from `assets/` (see `angular.json`) and handed to `OcctKernel.init`.
 *
 * `brepjs` is imported dynamically so the WASM layer lands in its own lazy
 * chunk and the scene can render while the kernel boots.
 */
export type BrepApi = typeof import('brepjs');

/** Where the build copies `occt-wasm.wasm`; served from the app root. */
const OCCT_WASM_URL = 'assets/occt-wasm.wasm';

let apiPromise: Promise<BrepApi> | null = null;

/** Resolve the brepjs API with its OpenCascade kernel initialised. Safe to call repeatedly. */
export function loadBrep(): Promise<BrepApi> {
  apiPromise ??= (async () => {
    const [brep, { OcctKernel }] = await Promise.all([import('brepjs'), import('occt-wasm')]);
    const kernel = await OcctKernel.init({ wasm: OCCT_WASM_URL });
    brep.registerKernel('occt-wasm', brep.OcctWasmAdapter.fromKernel(kernel));
    return brep;
  })();
  return apiPromise;
}
