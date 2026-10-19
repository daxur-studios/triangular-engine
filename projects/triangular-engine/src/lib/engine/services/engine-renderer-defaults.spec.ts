import { withRendererDefaults } from './renderer-defaults';

describe('withRendererDefaults', () => {
  it('asks for the high-performance GPU by default', () => {
    expect(withRendererDefaults({ antialias: true })).toEqual({ powerPreference: 'high-performance', antialias: true });
  });

  it('keeps a scene that asks for less', () => {
    expect(withRendererDefaults({ powerPreference: 'low-power' }).powerPreference).toBe('low-power');
    expect(withRendererDefaults({ powerPreference: 'default' }).powerPreference).toBe('default');
  });
});
