import type { AlertLevel } from './types';

export interface AlertMachineState {
  level: AlertLevel | null;
  clearPolls: number;
}

export type AlertObservation =
  | { kind: 'success'; level: AlertLevel; stale?: boolean }
  | { kind: 'error' | 'no-data' };

export interface AlertStateConfig {
  clearConfirmPolls: number;
}

export interface AlertReduction {
  state: AlertMachineState;
  signal: AlertLevel | 'clear' | null;
  stale: boolean;
}

export function createInitialState(): AlertMachineState {
  return { level: null, clearPolls: 0 };
}

function requiredClearPolls(config: AlertStateConfig): number {
  if (!Number.isFinite(config.clearConfirmPolls)) {
    return 2;
  }
  return Math.max(1, Math.floor(config.clearConfirmPolls));
}

export function reduce(
  state: AlertMachineState,
  observation: AlertObservation,
  config: AlertStateConfig,
): AlertReduction {
  if (observation.kind !== 'success') {
    return { state, signal: null, stale: false };
  }
  if (observation.stale) {
    return { state, signal: null, stale: true };
  }

  const nextLevel = observation.level;
  if (state.level === null) {
    const initialSignal = nextLevel === 'yellow' || nextLevel === 'red' ? nextLevel : null;
    return {
      state: { level: nextLevel, clearPolls: 0 },
      signal: initialSignal,
      stale: false,
    };
  }

  if (nextLevel === state.level) {
    return {
      state: { level: state.level, clearPolls: 0 },
      signal: null,
      stale: false,
    };
  }

  if (nextLevel === 'none' && state.level !== 'none') {
    const clearPolls = state.clearPolls + 1;
    if (clearPolls < requiredClearPolls(config)) {
      return {
        state: { level: state.level, clearPolls },
        signal: null,
        stale: false,
      };
    }
    return {
      state: { level: 'none', clearPolls: 0 },
      signal: 'clear',
      stale: false,
    };
  }

  let signal: AlertReduction['signal'] = null;
  if (state.level === 'none' && nextLevel === 'yellow') {
    signal = 'yellow';
  } else if (nextLevel === 'red' && state.level !== 'red') {
    signal = 'red';
  }
  return {
    state: { level: nextLevel, clearPolls: 0 },
    signal,
    stale: false,
  };
}
