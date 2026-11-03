import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
  /** Selectors must return primitives or stable references. */
  use<S>(selector: (state: T) => S): S;
}

/** Minimal external store (no extra dependency) consumed through useSyncExternalStore. */
export function createStore<T extends object>(initial: T, onChange?: (state: T) => void): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      onChange?.(state);
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use: (selector) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSyncExternalStore(store.subscribe, () => selector(state)),
  };
  return store;
}
