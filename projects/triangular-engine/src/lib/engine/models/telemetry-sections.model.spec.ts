import { TelemetrySections } from './telemetry-sections.model';

describe('TelemetrySections', () => {
  it('formats nothing when no section is registered', () => {
    expect(new TelemetrySections().format()).toBe('');
  });

  it('formats each section as a heading and indented key: value lines, in registration order', () => {
    const sections = new TelemetrySections();
    sections.register('planet', () => ({ morph: 0.5, patches: 140 }));
    sections.register('input', () => ({ tool: 'orbit' }));

    expect(sections.format()).toBe(
      'planet:\n  morph: 0.5\n  patches: 140\ninput:\n  tool: orbit',
    );
  });

  it('omits undefined values and keeps null, boolean and zero values', () => {
    const sections = new TelemetrySections();
    sections.register('state', () => ({ ready: true, queued: 0, target: null, skipped: undefined }));

    expect(sections.format()).toBe('state:\n  ready: true\n  queued: 0\n  target: null');
  });

  it('replaces a section registered again under the same name', () => {
    const sections = new TelemetrySections();
    sections.register('planet', () => ({ patches: 1 }));
    sections.register('planet', () => ({ patches: 2 }));

    expect(sections.format()).toBe('planet:\n  patches: 2');
  });

  it('removes a section when its unregister function is called', () => {
    const sections = new TelemetrySections();
    const unregister = sections.register('planet', () => ({ patches: 1 }));

    unregister();

    expect(sections.format()).toBe('');
  });

  it('keeps a section that a newer provider with the same name replaced', () => {
    const sections = new TelemetrySections();
    const unregisterFirst = sections.register('planet', () => ({ patches: 1 }));
    sections.register('planet', () => ({ patches: 2 }));

    unregisterFirst();

    expect(sections.format()).toBe('planet:\n  patches: 2');
  });

  it('calls providers only when the report is formatted', () => {
    const sections = new TelemetrySections();
    const provider = jasmine.createSpy('provider').and.returnValue({ patches: 1 });
    sections.register('planet', provider);
    expect(provider).not.toHaveBeenCalled();

    sections.format();

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('reports a throwing provider without hiding the other sections', () => {
    const warn = spyOn(console, 'warn');
    const sections = new TelemetrySections();
    sections.register('broken', () => {
      throw new Error('boom');
    });
    sections.register('planet', () => ({ patches: 1 }));

    expect(sections.format()).toBe(
      'broken:\n  error: provider threw\nplanet:\n  patches: 1',
    );
    expect(warn).toHaveBeenCalled();
  });
});
