/// <reference lib="webworker" />

import { serveBakeRequests } from 'triangular-engine/lod-surface/core';

// The worker file stays in the app (a library cannot bundle one); it must import the Angular-free core entry only.
serveBakeRequests(self);
