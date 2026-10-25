# triangular-engine/gpu-data-flow

Transport and scheduling for data that moves between the CPU, the GPU and workers: an upload ring with a byte budget, a readback ring with frame tags and measured latency, double-buffered storage buffers, capacity guards, and a job scheduler with per-frame budgets. No Angular, no three.js. Design: Plan 055, "Data-flow core".

Status: **preview.** The logic is plain TypeScript behind a small `FlowDevice` interface and is covered by specs with a fake device. The WebGPU binding is thin and not yet exercised on hardware.

## The rules it enforces

1. **The CPU never awaits the GPU in a frame.** `ReadbackRing.request` returns at once; `poll` hands over what has arrived.
2. **Results the CPU needs are small and fixed in size.** A readback slot has a fixed size; bigger data stays on the GPU.
3. **Uploads have a per-frame byte budget.** Excess waits in a queue, and the queue depth is a metric.
4. **Every buffer is checked against the device limits before it is created or grown.** You get a `GpuCapacityError`, not a lost device.
5. **Round trips are measured whole**, from submit to usable on the CPU.

## Setup

```ts
import {
  CapacityGuard, DoubleBuffer, JobScheduler, ReadbackRing, UploadRing,
  createWebGpuFlowDevice, webGpuDeviceOf,
} from 'triangular-engine/gpu-data-flow';

await renderer.init(); // three WebGPURenderer
const raw = webGpuDeviceOf(renderer); // renderer.backend.device, or null on the WebGL fallback
if (!raw) return;
const device = createWebGpuFlowDevice(raw);
const guard = new CapacityGuard({ limits: device.limits, headroom: 0.9 });
```

`createWebGpuFlowDevice` takes any object shaped like a `GPUDevice` (the entry declares structural types, so `@webgpu/types` is not required). `adoptGpuBuffer(gpuBuffer)` wraps a buffer you already own, for example the one behind a render storage buffer, so a ring can copy from it. `WebGpuFlowBuffer.gpu` is the raw `GPUBuffer` to bind.

## Upload ring

```ts
const uploads = new UploadRing(device, { bytesPerFrame: 1 << 20 });
uploads.enqueue(buffer, byteOffset, float32Array, () => /* written */);
// once per frame:
uploads.flush();
```

`flush()` writes in first-in order up to the budget. A write larger than the budget is split on 4-byte boundaries and finishes over several frames. The data is not copied: leave it unchanged until the callback fires. Offset and length must be multiples of 4. `setBudget` changes the budget at runtime.

## Readback ring

```ts
const reads = new ReadbackRing<{ block: number }>(device, { slots: 4, slotBytes: 128 * 1024 });

// frame N, after dispatching the compute pass that fills `grid`:
reads.request(gridBuffer, 0, frame, { block: 17 });

// every frame, later:
for (const r of reads.poll(frame)) {
  r.frame;          // the frame the data belongs to (N)
  r.tag;            // { block: 17 }
  r.data;           // ArrayBuffer copy
  r.latencyMs;      // submit to usable on the CPU
  r.latencyFrames;  // submit to delivered
}
```

`request` returns `false` when every slot is in flight; the request is dropped and counted (`dropped`), never waited for. Size the ring from the measured latency: slots at least request rate times `latencyFrames.p95`. Reads are limited to `slotBytes`.

## Double buffer

```ts
const state = new DoubleBuffer(device, guard, 64 * 1024 * 1024, 'density');
// compute reads state.read, writes state.write; once per frame:
state.swap();
state.grow(96 * 1024 * 1024); // keeps the read contents; throws GpuCapacityError if too large
```

Creation and `grow` both check the guard first, so nothing is created when a size is refused.

## Capacity guard

`CapacityGuard.check(bytes, 'storage' | 'uniform' | 'buffer', label)` throws `GpuCapacityError` (fields `label`, `requestedBytes`, `limitBytes`, `limitName`) when the size is over `maxStorageBufferBindingSize`, `maxUniformBufferBindingSize` or `maxBufferSize` (storage and uniform are also capped by `maxBufferSize`). `reserve` also counts bytes and returns a release function; `maxTotalBytes` caps the total this module holds, and `headroom` (default 1) uses only a fraction of each limit. The default limits are the WebGPU defaults (128 MiB storage binding), used when a device does not report its own.

## Job scheduler

```ts
const jobs = new JobScheduler({
  gpu: { costPerFrame: 2 },                  // e.g. ms of GPU time
  worker: { costPerFrame: 4, maxInFlight: 2 }, // e.g. blocks
});
jobs.add({ lane: 'gpu', cost: 1, priority: 5, run: () => dispatchCompute() });
jobs.add({ lane: 'worker', cost: 1, run: () => meshWorker.post(block) /* may return a promise */ });
// once per frame:
jobs.tick();
```

`tick()` starts jobs by priority, then arrival, until the lane's `costPerFrame` is used, and does not wait for them. A job dearer than the whole budget runs alone, first in its frame, so it cannot starve. Async jobs count as in flight until their promise settles, so the page never waits for a worker in lockstep. Failures are counted and passed to `onError`; the scheduler keeps going.

## Telemetry

Each part has `telemetry()` returning plain, JSON-safe data: `UploadTelemetry` (queue depth, queued bytes, peak depth, bytes last frame, totals), `ReadbackTelemetry` (in flight, requested, delivered, dropped, failed, `latencyMs` and `latencyFrames` as count, last, min, max, mean, p50, p95 over the last 128 samples), `SchedulerTelemetry` per lane, `CapacityTelemetry` and `DoubleBufferTelemetry`. Nothing in it holds a reference to a buffer, so a consumer can copy it into a result or a panel.

## Limits

- Each `copyBuffer` submits its own small command buffer. Batch copies yourself if you issue thousands per frame.
- Latency figures from headless or software-rendered runs are not hardware numbers.
