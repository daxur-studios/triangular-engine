/// <reference lib="webworker" />

import {
  handleCdlodWorkerMessage,
  ICdlodWorkerRequest,
} from 'triangular-engine/celestial';

export { handleCdlodWorkerMessage };

if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage: (msg: unknown) => void }).postMessage === 'function' &&
  typeof (self as unknown as { document?: unknown }).document === 'undefined'
) {
  const workerScope = self as unknown as {
    postMessage: (msg: unknown, transfer?: Transferable[]) => void;
    onmessage: ((event: MessageEvent<ICdlodWorkerRequest>) => void) | null;
  };
  workerScope.onmessage = (event: MessageEvent<ICdlodWorkerRequest>) => {
    const { response, transfer } = handleCdlodWorkerMessage(event.data);
    if (transfer && transfer.length > 0) {
      workerScope.postMessage(response, transfer);
    } else {
      workerScope.postMessage(response);
    }
  };
}
