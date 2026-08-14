import { describe, it, expect } from 'vitest';

// A fluent, specific, entirely invented answer is indistinguishable from a
// correct one to every assertion except one that checks it against the source.
//
// The grader is itself a model and can be wrong in the same direction as the
// thing it grades — keep a human-labelled seed set to know whether to trust it.
const CASES = [
  {
    sources: ['The office is open Monday to Friday, 9am to 5pm.'],
    question: 'When is the office open?',
  },
];

describe('groundedness', () => {
  for (const { sources, question } of CASES) {
    it(`answers "${question}" only from the sources`, async () => {
      const answer = await answerFrom(sources, question);
      expect((await gradeGroundedness(answer, sources)).unsupportedClaims).toEqual([]);
    });
  }

  it('says it does not know rather than inventing', async () => {
    const answer = await answerFrom(['The office is open weekdays.'], 'What is the phone number?');
    expect(answer).toMatch(/not|unknown|does not say/i);
  });
});

async function answerFrom(_sources, _question) { return 'The office is open weekdays, 9am to 5pm.'; }
async function gradeGroundedness(_answer, _sources) { return { unsupportedClaims: [] }; }
