export interface ReplayTurn {
  round: number;
  participant: string;
  action: string;
  speech: string;
  readiness: string;
  agreement: Record<string, number>;
  questions: { id: string; to: string; question: string }[];
  responses: { id: string; status: string }[];
}

export interface ReplayTranscript {
  question: string;
  participants: string[];
  turns: ReplayTurn[];
}

/** Validate before handing user-selected JSON to the scene. */
export function readTranscript(value: unknown): ReplayTranscript {
  const t = value as ReplayTranscript;
  if (!t || typeof t.question !== 'string' || !Array.isArray(t.participants) ||
      t.participants.length < 2 || t.participants.length > 6 ||
      t.participants.some(p => typeof p !== 'string' || !p) || new Set(t.participants).size !== t.participants.length ||
      !Array.isArray(t.turns) || t.turns.some(turn => !turn || !t.participants.includes(turn.participant) ||
        typeof turn.speech !== 'string' || typeof turn.round !== 'number' || typeof turn.action !== 'string' ||
        typeof turn.readiness !== 'string' || !turn.agreement || typeof turn.agreement !== 'object' ||
        Array.isArray(turn.agreement) || !Array.isArray(turn.questions) || !Array.isArray(turn.responses) ||
        turn.questions.some(q => !q || typeof q.id !== 'string' || typeof q.to !== 'string' || typeof q.question !== 'string') ||
        turn.responses.some(r => !r || typeof r.id !== 'string' || typeof r.status !== 'string'))) {
    throw new Error('This is not a supported conversation transcript.');
  }
  return t;
}

/** Rebuild state from the beginning so backwards navigation never leaks later knowledge. */
export function replayState(transcript: ReplayTranscript, count: number) {
  const agreements: Record<string, Record<string, number>> = {};
  const readiness: Record<string, string> = {};
  const questions: { id: string; from: string; to: string; text: string; status: string }[] = [];
  for (const turn of transcript.turns.slice(0, count)) {
    readiness[turn.participant] = turn.readiness;
    agreements[turn.participant] ??= {};
    for (const [other, score] of Object.entries(turn.agreement)) {
      if (transcript.participants.includes(other) && other !== turn.participant && Number.isFinite(score) && score >= 0 && score <= 10) {
        agreements[turn.participant][other] = score;
      }
    }
    for (const q of turn.questions) questions.push({ id: q.id, from: turn.participant, to: q.to, text: q.question, status: 'open' });
    for (const response of turn.responses) {
      const q = questions.find(item => item.id === response.id && item.to === turn.participant);
      if (q && (response.status === 'answered' || response.status === 'declined')) q.status = response.status;
    }
  }
  return { agreements, readiness, questions };
}

/** Approximate layout: pair distance reflects the mean of available directional scores. */
export function replayPositions(participants: readonly string[], agreements: Record<string, Record<string, number>>): [number, number][] {
  const points = participants.map((_, i) => {
    const angle = i * Math.PI * 2 / participants.length + Math.PI / participants.length;
    return [Math.sin(angle) * 3, Math.cos(angle) * 3];
  });
  for (let iteration = 0; iteration < 100; iteration++) {
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const scores = [agreements[participants[i]]?.[participants[j]], agreements[participants[j]]?.[participants[i]]]
        .filter((score): score is number => score !== undefined);
      const target = scores.length ? 5.5 - (scores.reduce((a, b) => a + b, 0) / scores.length) * 0.4 : 4.2;
      const dx = points[j][0] - points[i][0], dz = points[j][1] - points[i][1];
      const distance = Math.max(0.001, Math.hypot(dx, dz));
      const adjustment = (distance - target) * 0.06;
      points[i][0] += dx / distance * adjustment; points[i][1] += dz / distance * adjustment;
      points[j][0] -= dx / distance * adjustment; points[j][1] -= dz / distance * adjustment;
    }
  }
  return points as [number, number][];
}
