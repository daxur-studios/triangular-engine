import { readTranscript, replayPositions, replayState, replayWalkStep, speakerCameraPosition } from './conversation-replay';

describe('conversation replay', () => {
  it('places the speaker camera outside the circle for each seat', () => {
    for (const [x, z] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const [cx, cz] = speakerCameraPosition(x, z, 4);
      expect(cx * x + cz * z).toBeGreaterThan(x * x + z * z);
      expect(Math.hypot(cx - x, cz - z)).toBeCloseTo(4);
    }
  });
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

  it('only accepts responses from the addressed participant and restores declined questions when rewound', () => {
    const example = readTranscript({
      question: 'Example?', participants: ['A', 'B', 'C'], turns: [
        { round: 1, participant: 'A', action: 'speak', speech: 'Questions', readiness: 'discussing', agreement: {}, questions: [{ id: 'Q1', to: 'B', question: 'Why?' }, { id: 'Q2', to: 'C', question: 'How?' }], responses: [] },
        { round: 2, participant: 'C', action: 'speak', speech: 'Response', readiness: 'discussing', agreement: {}, questions: [], responses: [{ id: 'Q1', status: 'answered' }, { id: 'Q2', status: 'declined' }] },
      ],
    });
    expect(replayState(example, 0).questions.length).toBe(0);
    expect(replayState(example, 2).questions.map(q => q.status)).toEqual(['open', 'declined']);
    expect(replayState(example, 1).questions.map(q => q.status)).toEqual(['open', 'open']);
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

  it('walks toward a destination and becomes idle after arriving', () => {
    const walking = replayWalkStep(0, 0, [1, 0], 0.5);
    expect(walking.walking).toBeTrue();
    expect(walking.x).toBeCloseTo(0.5);
    expect(walking.heading).toBeCloseTo(Math.PI / 2);
    const arriving = replayWalkStep(walking.x, walking.z, [1, 0], 1);
    expect(arriving.x).toBe(1);
    expect(replayWalkStep(arriving.x, arriving.z, [1, 0], 0.1).walking).toBeFalse();
  });
});
