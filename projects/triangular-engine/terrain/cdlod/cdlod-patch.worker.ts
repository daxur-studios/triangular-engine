/// <reference lib="webworker" />

import {
  handleCdlodWorkerMessage,
  ICdlodWorkerRequest,
} from 'triangular-engine/celestial';

addEventListener('message', (event: MessageEvent<ICdlodWorkerRequest>) => {
  const { response, transfer } = handleCdlodWorkerMessage(event.data);
  if (transfer && transfer.length > 0) {
    postMessage(response, transfer);
  } else {
    postMessage(response);
  }
});

