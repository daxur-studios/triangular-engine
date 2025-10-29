/**
 * Dynamic loader for Jolt Physics with helpful error messages.
 * This allows jolt-physics to be an optional peer dependency.
 */

const JOLT_ERROR_MESSAGE = `
jolt-physics is not installed. To use Jolt Physics features, please install it:

  npm install jolt-physics

or

  yarn add jolt-physics

or

  pnpm add jolt-physics
`;

let joltModule: typeof import('jolt-physics/wasm-compat') | null = null;
let joltLoadPromise: Promise<typeof import('jolt-physics/wasm-compat')> | null =
  null;

/**
 * Dynamically loads the jolt-physics module.
 * @throws Error if jolt-physics is not installed
 */
export async function loadJolt(): Promise<
  typeof import('jolt-physics/wasm-compat')
> {
  if (joltModule) {
    return joltModule;
  }

  if (joltLoadPromise) {
    return joltLoadPromise;
  }

  joltLoadPromise = (async () => {
    try {
      joltModule = await import('jolt-physics/wasm-compat');
      return joltModule;
    } catch (error: any) {
      if (
        error?.code === 'MODULE_NOT_FOUND' ||
        error?.message?.includes('Cannot find module') ||
        error?.message?.includes('jolt-physics')
      ) {
        throw new Error(JOLT_ERROR_MESSAGE.trim());
      }
      throw error;
    }
  })();

  return joltLoadPromise;
}

/**
 * Gets the Jolt type, throwing an error if it's not available.
 * This should only be used for type checking - use loadJolt() for runtime.
 */
export type JoltType = typeof import('jolt-physics/wasm-compat');
