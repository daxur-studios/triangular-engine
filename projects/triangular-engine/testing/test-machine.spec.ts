import { describeGpuAdapter, describeRendererGpu, gpuVendorIssue, sendMachineMessage } from './test-machine';

describe('describeGpuAdapter', () => {
  it('flattens adapter info into gpu.* settings and labels blanks as unknown', () => {
    expect(describeGpuAdapter({ vendor: 'nvidia', architecture: 'ada', device: '', description: ' RTX ' })).toEqual({
      'gpu.backend': 'webgpu', 'gpu.vendor': 'nvidia', 'gpu.architecture': 'ada', 'gpu.device': 'unknown', 'gpu.description': 'RTX',
    });
  });

  it('never invents an adapter when none is given', () => {
    const settings = describeGpuAdapter(undefined);
    expect(settings['gpu.backend']).toBe('unknown');
    expect(settings['gpu.vendor']).toBe('unknown');
  });

  it('reads a Three.js renderer: WebGPU adapterInfo, WebGL unmasked strings, or nothing', () => {
    expect(describeRendererGpu({ backend: { isWebGPUBackend: true, device: { adapterInfo: { vendor: 'amd' } } } })['gpu.vendor']).toBe('amd');
    const gl = { getExtension: () => ({}), getParameter: (p: number) => (p === 0x9245 ? 'Intel Inc.' : 'Intel UHD') };
    const webgl = describeRendererGpu({ backend: { isWebGLBackend: true, gl } });
    expect(webgl['gpu.backend']).toBe('webgl');
    expect(webgl['gpu.vendor']).toBe('Intel Inc.');
    expect(webgl['gpu.description']).toBe('Intel UHD');
    expect(describeRendererGpu({ backend: { isWebGLBackend: true, gl: { getExtension: () => null, getParameter: () => '' } } })['gpu.vendor']).toBe('unknown');
    expect(describeRendererGpu(undefined)['gpu.backend']).toBe('unknown');
  });
});

describe('gpuVendorIssue', () => {
  it('passes without an expectation or on a case-insensitive match, and flags a mismatch or a missing adapter', () => {
    expect(gpuVendorIssue(undefined, { 'gpu.vendor': 'intel' })).toBeUndefined();
    expect(gpuVendorIssue('NVIDIA', { 'gpu.vendor': 'nvidia' })).toBeUndefined();
    expect(gpuVendorIssue('nvidia', { 'gpu.vendor': 'intel' })).toContain('differs');
    expect(gpuVendorIssue('nvidia', {})).toContain('not recorded');
    expect(gpuVendorIssue('nvidia', describeGpuAdapter(undefined))).toContain('not recorded');
  });
});

describe('sendMachineMessage', () => {
  const message = { runId: 'r', suiteId: 's', suiteVersion: 1, scenarioId: 'a', repetition: 1 };

  it('posts text/plain JSON to <sink>/machine/<kind>', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(new Response('{}'));
    await sendMachineMessage('/sink/', 'start', message);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/sink/machine/start');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toContain('text/plain');
    expect(JSON.parse(init.body as string)).toEqual(message);
  });

  it('resolves when the receiver is absent, errors, or hangs past the timeout', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.rejectWith(new TypeError('Failed to fetch'));
    await expectAsync(sendMachineMessage('/sink', 'stop', message)).toBeResolved();
    fetchSpy.and.callFake(((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch);
    await expectAsync(sendMachineMessage('/sink', 'stop', message, 10)).toBeResolved();
  });
});
