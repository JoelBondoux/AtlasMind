import { describe, expect, it } from 'vitest';

import {
  buildLensStateMap,
  normalizeLensStateMachineFile,
} from '../../src/core/lensStateMachine';

const FILE = {
  version: 1,
  machines: [{
    id: 'checkout',
    label: 'Checkout',
    initial: 'idle',
    states: [
      { id: 'idle', label: 'Idle', source: { workspacePath: 'src/checkout.ts', range: { startLine: 2, startColumn: 1, endLine: 4, endColumn: 2 } } },
      { id: 'submitting', label: 'Submitting' },
      { id: 'complete', label: 'Complete', terminal: true },
      { id: 'abandoned', label: 'Abandoned' },
    ],
    transitions: [
      { id: 'submit', from: 'idle', to: 'submitting', event: 'SUBMIT', guard: 'cart is valid' },
      { id: 'succeed', from: 'submitting', to: 'complete', effect: 'store receipt', source: { workspacePath: 'src/checkout.ts' } },
    ],
  }],
};

describe('Lens state-machine model', () => {
  it('derives reachability, terminal states, dead ends, and source-backed targets', () => {
    const file = normalizeLensStateMachineFile(FILE);
    expect(file).toBeDefined();

    const map = buildLensStateMap(file!.machines[0]!, { name: 'web', index: 0 });

    expect(map.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'idle', initial: true, reachable: true, depth: 0, target: expect.any(Object) }),
      expect.objectContaining({ id: 'complete', terminal: true, reachable: true, depth: 2, deadEnd: false }),
      expect.objectContaining({ id: 'abandoned', reachable: false, depth: -1, deadEnd: true }),
    ]));
    expect(map.transitions[1]).toEqual(expect.objectContaining({ id: 'succeed', target: expect.any(Object) }));
    expect(map.notices.join(' ')).toContain('does not execute project code');
    expect(map.notices.join(' ')).toContain('unreachable');
  });

  it('fails closed on duplicate ids, dangling transitions, and unsafe source paths', () => {
    const machine = FILE.machines[0];
    expect(normalizeLensStateMachineFile({
      version: 1,
      machines: [{ ...machine, states: [machine.states[0], machine.states[0]] }],
    })).toBeUndefined();
    expect(normalizeLensStateMachineFile({
      version: 1,
      machines: [{ ...machine, transitions: [{ id: 'bad', from: 'idle', to: 'missing' }] }],
    })).toBeUndefined();
    expect(normalizeLensStateMachineFile({
      version: 1,
      machines: [{ ...machine, states: [{ ...machine.states[0], source: { workspacePath: '../secret.txt' } }] }],
    })).toBeUndefined();
  });
});
