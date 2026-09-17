import { CellTacticalOverlay } from './cell-tactical-overlay';

describe('CellTacticalOverlay', () => {
  it('initializes texture dimensions and transparent buffer', () => {
    const overlay = new CellTacticalOverlay(100);
    expect(overlay.cellCount).toBe(100);
    expect(overlay.texWidth).toBeGreaterThan(0);
    expect(overlay.texHeight).toBeGreaterThan(0);
    expect(overlay.texWidth * overlay.texHeight).toBeGreaterThanOrEqual(100);

    const data = overlay.rawBuffer;
    // All bytes should start at 0
    expect(data[0]).toBe(0);
    expect(data[3]).toBe(0);

    overlay.dispose();
  });

  it('sets and clears individual cell highlights', () => {
    const overlay = new CellTacticalOverlay(50);
    overlay.setCellHighlight(5, '#ff0000', 0.8);

    const data = overlay.rawBuffer;
    const offset = 5 * 4;
    expect(data[offset]).toBe(255); // R
    expect(data[offset + 1]).toBe(0); // G
    expect(data[offset + 2]).toBe(0); // B
    expect(data[offset + 3]).toBeCloseTo(Math.round(0.8 * 255), -1); // A

    // Clear
    overlay.setCellHighlight(5, null);
    expect(data[offset + 3]).toBe(0);

    overlay.dispose();
  });

  it('sets reachable range highlights across multiple cells', () => {
    const overlay = new CellTacticalOverlay(60);
    overlay.setReachableRange([2, 4, 8], '#00ff00', 0.5);

    const data = overlay.rawBuffer;
    for (const id of [2, 4, 8]) {
      const offset = id * 4;
      expect(data[offset + 1]).toBe(255); // G
      expect(data[offset + 3]).toBeGreaterThan(0); // A
    }

    // Unaffected cell
    expect(data[3 * 4 + 3]).toBe(0);

    overlay.dispose();
  });

  it('clears all highlights', () => {
    const overlay = new CellTacticalOverlay(30);
    overlay.setCellHighlight(1, '#ffffff');
    overlay.setCellHighlight(2, '#ffffff');

    overlay.clearAll();
    const data = overlay.rawBuffer;
    expect(data[1 * 4 + 3]).toBe(0);
    expect(data[2 * 4 + 3]).toBe(0);

    overlay.dispose();
  });
});
