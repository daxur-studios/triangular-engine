import {
  CapacityGuard,
  DoubleBuffer,
  FlowBuffer,
  FlowDevice,
  GpuCapacityError,
  JobScheduler,
  LatencyWindow,
  ReadbackRing,
  UploadRing,
  createWebGpuFlowDevice,
  webGpuDeviceOf,
} from './public-api';

class FakeBuffer implements FlowBuffer {
  destroyed = false;
  bytes: Uint8Array;
  constructor(
    readonly size: number,
    readonly label: string,
    readonly kind: 'storage' | 'readback',
  ) {
    this.bytes = new Uint8Array(size);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeDevice implements FlowDevice {
  limits = { maxStorageBufferBindingSize: 1024, maxBufferSize: 2048, maxUniformBufferBindingSize: 256 };
  writes: { target: FakeBuffer; offset: number; length: number }[] = [];
  copies = 0;
  /** Pending maps; the spec resolves them to simulate the GPU finishing. */
  maps: { buffer: FakeBuffer; resolve: (d: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
  createBuffer(desc: { size: number; kind: 'storage' | 'readback'; label?: string }): FlowBuffer {
    return new FakeBuffer(desc.size, desc.label ?? '', desc.kind);
  }
  writeBuffer(target: FlowBuffer, offset: number, data: Uint8Array): void {
    (target as FakeBuffer).bytes.set(data, offset);
    this.writes.push({ target: target as FakeBuffer, offset, length: data.byteLength });
  }
  copyBuffer(src: FlowBuffer, so: number, dst: FlowBuffer, d: number, size: number): void {
    (dst as FakeBuffer).bytes.set((src as FakeBuffer).bytes.subarray(so, so + size), d);
    this.copies++;
  }
  mapRead(buffer: FlowBuffer, offset: number, size: number): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const b = buffer as FakeBuffer;
      const copy = b.bytes.slice(offset, offset + size).buffer;
      this.maps.push({ buffer: b, resolve: () => resolve(copy), reject });
    });
  }
  /** Finish the oldest pending map. */
  finish(): void {
    this.maps.shift()!.resolve(new ArrayBuffer(0));
  }
}

const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('LatencyWindow', () => {
  it('reports count, min, max, mean, nearest-rank percentiles and the newest sample', () => {
    const w = new LatencyWindow(100);
    for (let i = 1; i <= 100; i++) w.record(i);
    const s = w.summary();
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.mean).toBe(50.5);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.last).toBe(100);
  });

  it('keeps only the most recent window but counts all samples', () => {
    const w = new LatencyWindow(3);
    [100, 1, 2, 3].forEach((v) => w.record(v));
    const s = w.summary();
    expect(s.count).toBe(4);
    expect(s.max).toBe(3);
    expect(s.last).toBe(3);
  });

  it('is all zero when empty', () => {
    expect(new LatencyWindow().summary().count).toBe(0);
  });
});

describe('CapacityGuard', () => {
  const limits = { maxStorageBufferBindingSize: 1000, maxBufferSize: 2000, maxUniformBufferBindingSize: 100 };

  it('allows a buffer at the limit and throws one byte over, naming the limit', () => {
    const g = new CapacityGuard({ limits });
    g.check(1000, 'storage', 'ok');
    let error: unknown;
    try {
      g.check(1001, 'storage', 'grid');
    } catch (e) {
      error = e;
    }
    expect(error instanceof GpuCapacityError).toBeTrue();
    const e = error as GpuCapacityError;
    expect(e.limitName).toBe('maxStorageBufferBindingSize');
    expect(e.requestedBytes).toBe(1001);
    expect(e.message).toContain('grid');
    expect(g.telemetry().rejected).toBe(1);
  });

  it('caps storage by maxBufferSize too, and uniform by its own limit', () => {
    const g = new CapacityGuard({ limits: { ...limits, maxBufferSize: 500 } });
    expect(g.maxBytes('storage')).toBe(500);
    expect(() => g.check(101, 'uniform', 'u')).toThrowError(GpuCapacityError);
  });

  it('applies headroom', () => {
    const g = new CapacityGuard({ limits, headroom: 0.5 });
    expect(g.maxBytes('storage')).toBe(500);
    expect(() => g.check(501, 'storage', 'x')).toThrowError(GpuCapacityError);
  });

  it('tracks reservations, peaks, releases once, and enforces a total budget', () => {
    const g = new CapacityGuard({ limits, maxTotalBytes: 1500 });
    const r1 = g.reserve(1000, 'storage', 'a');
    expect(() => g.reserve(600, 'storage', 'b')).toThrowError(/over the budget/);
    r1();
    r1();
    expect(g.telemetry().reservedBytes).toBe(0);
    expect(g.telemetry().peakReservedBytes).toBe(1000);
    g.reserve(600, 'storage', 'b');
    expect(g.telemetry().reservedBytes).toBe(600);
  });
});

describe('DoubleBuffer', () => {
  it('alternates read and write on swap', () => {
    const d = new FakeDevice();
    const db = new DoubleBuffer(d, new CapacityGuard({ limits: d.limits }), 64, 'state');
    const [r, w] = [db.read, db.write];
    db.swap();
    expect(db.read).toBe(w);
    expect(db.write).toBe(r);
    expect(db.telemetry().swaps).toBe(1);
  });

  it('trips the guard on creation and growth before creating anything', () => {
    const d = new FakeDevice();
    const created = spyOn(d, 'createBuffer').and.callThrough();
    const guard = new CapacityGuard({ limits: d.limits });
    expect(() => new DoubleBuffer(d, guard, 1025, 'big')).toThrowError(GpuCapacityError);
    expect(created).not.toHaveBeenCalled();
    const db = new DoubleBuffer(d, guard, 512, 'state');
    created.calls.reset();
    expect(() => db.grow(2000)).toThrowError(GpuCapacityError);
    expect(created).not.toHaveBeenCalled();
    expect(db.size).toBe(512);
  });

  it('grows keeping the read contents, destroys the old pair and accounts for bytes', () => {
    const d = new FakeDevice();
    const guard = new CapacityGuard({ limits: d.limits });
    const db = new DoubleBuffer(d, guard, 16, 'state');
    const oldRead = db.read as FakeBuffer;
    oldRead.bytes.set([1, 2, 3, 4]);
    expect(db.grow(32)).toBeTrue();
    expect((db.read as FakeBuffer).bytes.subarray(0, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(oldRead.destroyed).toBeTrue();
    expect(guard.telemetry().reservedBytes).toBe(64);
    expect(db.grow(32)).toBeFalse();
    db.destroy();
    expect(guard.telemetry().reservedBytes).toBe(0);
  });
});

describe('UploadRing', () => {
  const setup = (budget: number, size = 1024) => {
    const d = new FakeDevice();
    const target = d.createBuffer({ size, kind: 'storage' }) as FakeBuffer;
    return { d, target, ring: new UploadRing(d, { bytesPerFrame: budget }) };
  };

  it('never writes more than the budget in a frame and drains the queue over frames', () => {
    const { d, target, ring } = setup(100);
    const payload = new Uint8Array(252).map((_, i) => i % 251);
    let done = false;
    ring.enqueue(target, 0, payload, () => (done = true));
    const frames: number[] = [];
    while (ring.queueDepth > 0) frames.push(ring.flush());
    expect(frames).toEqual([100, 100, 52]);
    expect(done).toBeTrue();
    expect(target.bytes.subarray(0, 252)).toEqual(payload);
    expect(d.writes.every((w) => w.length <= 100)).toBeTrue();
    expect(ring.telemetry().totalBytes).toBe(252);
    expect(ring.telemetry().completed).toBe(1);
  });

  it('reports queue depth and peak, serving in order', () => {
    const { target, ring } = setup(8);
    for (let i = 0; i < 5; i++) ring.enqueue(target, i * 8, new Uint8Array(8).fill(i + 1));
    expect(ring.telemetry().queueDepth).toBe(5);
    ring.flush();
    expect(ring.telemetry().queueDepth).toBe(4);
    expect(ring.telemetry().peakQueueDepth).toBe(5);
    expect(ring.telemetry().queuedBytes).toBe(32);
    expect(target.bytes[0]).toBe(1);
    expect(target.bytes[8]).toBe(0);
  });

  it('packs several small writes into one frame budget', () => {
    const { d, target, ring } = setup(100);
    for (let i = 0; i < 4; i++) ring.enqueue(target, i * 40, new Uint8Array(40));
    expect(ring.flush()).toBe(100);
    expect(d.writes.length).toBe(3);
    expect(ring.telemetry().bytesLastFrame).toBe(100);
  });

  it('rounds the budget to 4 bytes and rejects misaligned or overrunning writes', () => {
    const { target, ring } = setup(102, 16);
    expect(ring.telemetry().bytesPerFrame).toBe(100);
    expect(() => ring.enqueue(target, 1, new Uint8Array(4))).toThrowError(RangeError);
    expect(() => ring.enqueue(target, 0, new Uint8Array(6))).toThrowError(RangeError);
    expect(() => ring.enqueue(target, 8, new Uint8Array(12))).toThrowError(/overruns/);
  });
});

describe('ReadbackRing', () => {
  const setup = (slots = 2, clockValues: number[] = []) => {
    const d = new FakeDevice();
    const src = d.createBuffer({ size: 64, kind: 'storage' }) as FakeBuffer;
    let t = 0;
    const clock = () => clockValues.shift() ?? t++;
    const ring = new ReadbackRing<string>(d, { slots, slotBytes: 16, clock });
    return { d, src, ring };
  };

  it('does not block: request returns at once and poll is empty until the GPU finishes', async () => {
    const { d, src, ring } = setup();
    expect(ring.request(src, 0, 10, 'a')).toBeTrue();
    expect(ring.poll(10)).toEqual([]);
    d.finish();
    await flush();
    expect(ring.poll(11).length).toBe(1);
  });

  it('tags every result with the frame it was requested in, not the one it arrived in', async () => {
    const { d, src, ring } = setup();
    src.bytes.set([7, 7, 7, 7]);
    ring.request(src, 0, 5, 'five');
    ring.request(src, 0, 6, 'six');
    d.finish();
    d.finish();
    await flush();
    const out = ring.poll(9);
    expect(out.map((r) => [r.frame, r.tag, r.deliveredFrame, r.latencyFrames])).toEqual([
      [5, 'five', 9, 4],
      [6, 'six', 9, 3],
    ]);
    expect(new Uint8Array(out[0].data).subarray(0, 4)).toEqual(new Uint8Array([7, 7, 7, 7]));
  });

  it('measures submit to usable in milliseconds and keeps statistics', async () => {
    // Clock reads: submit at 100, ready at 142; submit at 200, ready at 255.
    const { d, src, ring } = setup(2, [100, 142, 200, 255]);
    ring.request(src, 0, 1, 'a');
    d.finish();
    await flush();
    ring.request(src, 0, 2, 'b');
    d.finish();
    await flush();
    const out = ring.poll(4);
    expect(out.map((r) => r.latencyMs)).toEqual([42, 55]);
    const t = ring.telemetry();
    expect(t.latencyMs.count).toBe(2);
    expect(t.latencyMs.min).toBe(42);
    expect(t.latencyMs.max).toBe(55);
    expect(t.latencyMs.mean).toBe(48.5);
    expect(t.latencyFrames.max).toBe(3);
    expect(t.delivered).toBe(2);
  });

  it('drops requests when every slot is in flight, counts them, and reuses slots once free', async () => {
    const { d, src, ring } = setup(2);
    expect(ring.request(src, 0, 1, 'a')).toBeTrue();
    expect(ring.request(src, 0, 1, 'b')).toBeTrue();
    expect(ring.request(src, 0, 1, 'c')).toBeFalse();
    expect(ring.telemetry().dropped).toBe(1);
    expect(ring.telemetry().inFlight).toBe(2);
    d.finish();
    await flush();
    expect(ring.request(src, 0, 2, 'd')).toBeTrue();
  });

  it('survives a failed map: slot freed, failure counted, other results kept', async () => {
    const { d, src, ring } = setup(2);
    ring.request(src, 0, 1, 'bad');
    ring.request(src, 0, 2, 'good');
    d.maps.shift()!.reject(new Error('lost'));
    d.finish();
    await flush();
    expect(ring.poll(3).map((r) => r.tag)).toEqual(['good']);
    expect(ring.telemetry().failed).toBe(1);
    expect(ring.freeSlots).toBe(2);
  });

  it('rejects reads larger than a slot', () => {
    const { src, ring } = setup();
    expect(() => ring.request(src, 0, 1, 'x', 32)).toThrowError(RangeError);
  });
});

describe('JobScheduler', () => {
  const make = (gpu = 4, worker = 4, maxInFlight?: number) => {
    const errors: unknown[] = [];
    const s = new JobScheduler({
      gpu: { costPerFrame: gpu },
      worker: { costPerFrame: worker, maxInFlight },
      onError: (e) => errors.push(e),
    });
    return { s, errors };
  };

  it('starts jobs up to each lane budget per frame and carries the rest over', () => {
    const { s } = make(3, 2);
    const ran: string[] = [];
    for (let i = 0; i < 5; i++) s.add({ lane: 'gpu', cost: 1, run: () => void ran.push(`g${i}`) });
    for (let i = 0; i < 3; i++) s.add({ lane: 'worker', cost: 1, run: () => void ran.push(`w${i}`) });
    expect(s.tick()).toBe(5);
    expect(ran).toEqual(['g0', 'g1', 'g2', 'w0', 'w1']);
    expect(s.telemetry().gpu.queued).toBe(2);
    expect(s.telemetry().gpu.costLastFrame).toBe(3);
    expect(s.tick()).toBe(3);
    expect(s.telemetry().gpu.queued).toBe(0);
    expect(s.telemetry().worker.queued).toBe(0);
  });

  it('weighs jobs by cost and runs an over-budget job alone', () => {
    const { s } = make(5);
    const ran: string[] = [];
    s.add({ lane: 'gpu', cost: 3, run: () => void ran.push('a') });
    s.add({ lane: 'gpu', cost: 3, run: () => void ran.push('b') });
    s.add({ lane: 'gpu', cost: 9, run: () => void ran.push('huge') });
    s.tick();
    expect(ran).toEqual(['a']);
    s.tick();
    expect(ran).toEqual(['a', 'b']);
    s.tick();
    expect(ran).toEqual(['a', 'b', 'huge']);
  });

  it('orders by priority, then arrival', () => {
    const { s } = make(10);
    const ran: string[] = [];
    s.add({ lane: 'gpu', run: () => void ran.push('low1') });
    s.add({ lane: 'gpu', priority: 5, run: () => void ran.push('hi1') });
    s.add({ lane: 'gpu', run: () => void ran.push('low2') });
    s.add({ lane: 'gpu', priority: 5, run: () => void ran.push('hi2') });
    s.tick();
    expect(ran).toEqual(['hi1', 'hi2', 'low1', 'low2']);
  });

  it('limits async jobs in flight without waiting for them', async () => {
    const { s } = make(10, 10, 1);
    const resolvers: (() => void)[] = [];
    for (let i = 0; i < 3; i++) {
      s.add({ lane: 'worker', run: () => new Promise<void>((r) => resolvers.push(r)) });
    }
    expect(s.tick()).toBe(1);
    expect(s.tick()).toBe(0);
    expect(s.telemetry().worker.inFlight).toBe(1);
    resolvers[0]();
    await flush();
    expect(s.telemetry().worker.completed).toBe(1);
    expect(s.tick()).toBe(1);
  });

  it('keeps going after a job throws or rejects, and reports it', async () => {
    const { s, errors } = make(10);
    const ran: string[] = [];
    s.add({ lane: 'gpu', run: () => { throw new Error('sync'); } });
    s.add({ lane: 'worker', run: () => Promise.reject(new Error('async')) });
    s.add({ lane: 'gpu', run: () => void ran.push('after') });
    s.tick();
    await flush();
    expect(ran).toEqual(['after']);
    expect(errors.length).toBe(2);
    expect(s.telemetry().gpu.failed).toBe(1);
    expect(s.telemetry().worker.failed).toBe(1);
    expect(s.telemetry().worker.inFlight).toBe(0);
  });
});

describe('WebGPU binding', () => {
  it('creates buffers with spec usage flags, reads limits and maps a copy', async () => {
    const calls: string[] = [];
    const usages: number[] = [];
    const fakeGpu = (size: number) => ({
      size,
      mapAsync: async () => void calls.push('map'),
      getMappedRange: () => new Uint8Array([1, 2, 3, 4]).buffer,
      unmap: () => void calls.push('unmap'),
      destroy: () => void calls.push('destroy'),
    });
    const device = {
      limits: { maxStorageBufferBindingSize: 4096 },
      queue: { writeBuffer: () => void calls.push('write'), submit: () => void calls.push('submit') },
      createBuffer: (d: { size: number; usage: number }) => (usages.push(d.usage), fakeGpu(d.size)),
      createCommandEncoder: () => ({ copyBufferToBuffer: () => void calls.push('copy'), finish: () => ({}) }),
    };
    const flow = createWebGpuFlowDevice(device);
    expect(flow.limits.maxStorageBufferBindingSize).toBe(4096);
    expect(flow.limits.maxBufferSize).toBe(256 * 1024 * 1024);
    const storage = flow.createBuffer({ size: 16, kind: 'storage' });
    const readback = flow.createBuffer({ size: 16, kind: 'readback' });
    expect(usages).toEqual([0x80 | 0x4 | 0x8, 0x1 | 0x8]);
    flow.writeBuffer(storage, 0, new Uint8Array(4));
    flow.copyBuffer(storage, 0, readback, 0, 4);
    const bytes = await flow.mapRead(readback, 0, 4);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(calls).toEqual(['write', 'copy', 'submit', 'map', 'unmap']);
  });

  it('finds the device behind a three renderer, or null', () => {
    const device = {} as any;
    expect(webGpuDeviceOf({ backend: { device } })).toBe(device);
    expect(webGpuDeviceOf({ backend: {} })).toBeNull();
    expect(webGpuDeviceOf(null)).toBeNull();
  });
});
