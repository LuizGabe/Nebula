export type CircuitBreakerState = "closed" | "open" | "half_open";

export type CircuitBreakerSnapshot = {
  state: CircuitBreakerState;
  failures: number;
  openedAt: string | null;
  nextRetryAt: string | null;
};

type CircuitBreakerOptions = {
  failureThreshold?: number;
  cooldownMs?: number;
};

type CircuitState = {
  state: CircuitBreakerState;
  failures: number;
  openedAt: number | null;
  nextRetryAt: number | null;
};

export class CircuitBreakerRegistry {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly states = new Map<string, CircuitState>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  beforeCheck(key: string) {
    const state = this.getState(key);
    if (state.state === "open" && state.nextRetryAt && Date.now() >= state.nextRetryAt) {
      state.state = "half_open";
    }
    return this.snapshot(key);
  }

  recordSuccess(key: string) {
    this.states.set(key, {
      state: "closed",
      failures: 0,
      openedAt: null,
      nextRetryAt: null,
    });
    return this.snapshot(key);
  }

  recordFailure(key: string) {
    const state = this.getState(key);
    const failures = state.failures + 1;
    const shouldOpen = failures >= this.failureThreshold || state.state === "half_open";
    const openedAt = shouldOpen ? Date.now() : state.openedAt;
    const nextRetryAt = openedAt ? openedAt + this.cooldownMs : state.nextRetryAt;

    this.states.set(key, {
      state: shouldOpen ? "open" : "closed",
      failures,
      openedAt,
      nextRetryAt: shouldOpen ? nextRetryAt : state.nextRetryAt,
    });

    return this.snapshot(key);
  }

  snapshot(key: string): CircuitBreakerSnapshot {
    const state = this.getState(key);
    return {
      state: state.state,
      failures: state.failures,
      openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
      nextRetryAt: state.nextRetryAt ? new Date(state.nextRetryAt).toISOString() : null,
    };
  }

  private getState(key: string): CircuitState {
    const existing = this.states.get(key);
    if (existing) return existing;

    const initial: CircuitState = {
      state: "closed",
      failures: 0,
      openedAt: null,
      nextRetryAt: null,
    };
    this.states.set(key, initial);
    return initial;
  }
}

export const systemCircuitBreakers = new CircuitBreakerRegistry();
