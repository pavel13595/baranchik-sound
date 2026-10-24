import { describe, expect, it } from 'vitest';
import type { AlertLevel } from './types';
import { createInitialState, reduce, type AlertMachineState, type AlertObservation } from './state';

const config = { clearConfirmPolls: 2 };

function activeState(level: AlertLevel): AlertMachineState {
  return { level, clearPolls: 0 };
}

function observe(level: AlertLevel, stale = false): AlertObservation {
  return { kind: 'success', level, stale };
}

describe('reduce', () => {
  it('signals an active alert found on the first successful poll', () => {
    const result = reduce(createInitialState(), observe('yellow'), config);
    expect(result).toEqual({ state: activeState('yellow'), signal: 'yellow', stale: false });
  });

  it('does not repeat an alert that remains active after startup', () => {
    const initial = reduce(createInitialState(), observe('red'), config);
    const repeated = reduce(initial.state, observe('red'), config);
    expect(initial.signal).toBe('red');
    expect(repeated.signal).toBeNull();
    expect(repeated.state.level).toBe('red');
  });

  it('signals none to yellow and none to red transitions', () => {
    const initial = reduce(createInitialState(), observe('none'), config).state;
    expect(reduce(initial, observe('yellow'), config).signal).toBe('yellow');
    expect(reduce(initial, observe('red'), config).signal).toBe('red');
  });

  it('signals an escalation from yellow to red', () => {
    expect(reduce(activeState('yellow'), observe('red'), config).signal).toBe('red');
  });

  it('updates red to yellow without playing a signal', () => {
    const result = reduce(activeState('red'), observe('yellow'), config);
    expect(result.state.level).toBe('yellow');
    expect(result.signal).toBeNull();
  });

  it('confirms clear only after the configured number of none polls', () => {
    const first = reduce(activeState('red'), observe('none'), config);
    expect(first.state).toEqual({ level: 'red', clearPolls: 1 });
    expect(first.signal).toBeNull();

    const second = reduce(first.state, observe('none'), config);
    expect(second.state).toEqual({ level: 'none', clearPolls: 0 });
    expect(second.signal).toBe('clear');
  });

  it('preserves a pending clear confirmation across errors', () => {
    const firstNone = reduce(activeState('red'), observe('none'), config);
    const error = reduce(firstNone.state, { kind: 'error' }, config);
    const noData = reduce(error.state, { kind: 'no-data' }, config);
    const secondNone = reduce(noData.state, observe('none'), config);

    expect(error.state).toEqual(firstNone.state);
    expect(noData.state).toEqual(firstNone.state);
    expect(secondNone.signal).toBe('clear');
  });

  it('does not turn no data into quiet after startup', () => {
    const result = reduce(createInitialState(), { kind: 'no-data' }, config);
    expect(result.state.level).toBeNull();
    expect(result.signal).toBeNull();
  });

  it('ignores stale observations for status and sound', () => {
    const current = activeState('red');
    const result = reduce(current, observe('none', true), config);
    expect(result.state).toBe(current);
    expect(result.signal).toBeNull();
    expect(result.stale).toBe(true);
  });

  it('does not mutate the incoming state', () => {
    const current = activeState('yellow');
    reduce(current, observe('red'), config);
    expect(current).toEqual({ level: 'yellow', clearPolls: 0 });
  });
});
