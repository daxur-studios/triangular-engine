import { readTranscript, replayPositions, replayState } from './conversation-replay';

describe('conversation replay', () => {
  const transcript = readTranscript({
    question: 'Example?', participants: ['A', 'B'], turns: [
      { round: 1, participant: 'A', action: 'speak', speech: 'Question', readiness: 'discussing', agreement: {}, questions: [{ id: 'Q1', to: 'B', question: 'Why?' }], responses: [] },
      { round: 2, participant: 'B', action: 'speak', speech: 'Answer', readiness: 'ready', agreement: { A: 9 }, questions: [], responses: [{ id: 'Q1', status: 'answered' }] },
    ],
  });

  it('reconstructs questions and directional agreement at each turn', () => {
    expect(replayState(transcript, 1).questions[0].status).toBe('open');
    expect(replayState(transcript, 1).agreements['B']).toBeUndefined();
    expect(replayState(transcript, 2).questions[0].status).toBe('answered');
    expect(replayState(transcript, 2).agreements['B']['A']).toBe(9);
    expect(replayState(transcript, 1).questions[0].status).toBe('open');
  });

  it('brings agreeing participants closer than disagreeing participants', () => {
    const distance = (score: number) => {
      const [a, b] = replayPositions(['A', 'B'], { A: { B: score } });
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    expect(distance(10)).toBeLessThan(distance(0));
  });

  it('rejects an invalid file', () => {
    expect(() => readTranscript({ participants: [] })).toThrow();
  });
});
