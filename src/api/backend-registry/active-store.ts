import { getBackendHealthEntry } from "./health-store";
import {
  readStoredActiveBackend,
  readStoredBackends,
  writeStoredActiveBackend,
  writeStoredBackends,
} from "./storage";
import type { Backend, BackendSelection, ResolvedActiveBackend } from "./types";

type Listener = () => void;

interface Snapshot {
  backends: Backend[];
  selection: BackendSelection | null;
  active: ResolvedActiveBackend;
}

export const NO_BACKEND_ID = "no-backend";

/**
 * Sentinel returned when the registry has no usable backend. It must never be
 * persisted, and callers must check `isNoBackend()` before interpreting fields
 * like `kind`, `host`, or `apiKey`.
 */
export const NO_BACKEND: Backend = {
  id: NO_BACKEND_ID,
  name: "No Backend Available",
  host: "",
  apiKey: "",
  kind: "local",
};

export function isNoBackend(backend: Backend): boolean {
  return backend.id === NO_BACKEND_ID;
}

/**
 * True when `a` should be preferred over `b` as a fallback: not disabled
 * while `b` is, or — if both are equally disabled — fewer recorded
 * consecutive failures. A backend with no health entry is treated as
 * healthy (0 failures, not disabled), since it simply hasn't been probed
 * yet. Ties are resolved by keeping the earlier candidate, which preserves
 * insertion order as the final tiebreaker.
 */
function isHealthierFallback(a: Backend, b: Backend): boolean {
  const healthA = getBackendHealthEntry(a.id);
  const healthB = getBackendHealthEntry(b.id);

  const disabledA = healthA?.disabled ?? false;
  const disabledB = healthB?.disabled ?? false;
  if (disabledA !== disabledB) return !disabledA;

  const failuresA = healthA?.consecutiveFailures ?? 0;
  const failuresB = healthB?.consecutiveFailures ?? 0;
  return failuresA < failuresB;
}

// Picks the healthiest registered backend rather than always the first:
// a cloud backend or a dead local backend sitting at index 0 used to
// force `getEffectiveLocalBackend()` to null even when a healthy backend
// existed elsewhere in the list. Ranks by recorded health (disabled >
// failure count), keeping insertion order as the tiebreaker.
function pickFallbackBackend(backends: Backend[]): Backend {
  if (backends.length === 0) return NO_BACKEND;

  return backends.reduce((best, candidate) =>
    isHealthierFallback(candidate, best) ? candidate : best,
  );
}

function computeSnapshot(
  backends: Backend[],
  selection: BackendSelection | null,
): Snapshot {
  let activeBackend: Backend | null = null;
  let activeOrgId: string | null = null;

  if (selection) {
    const found = backends.find((b) => b.id === selection.backendId);
    if (found) {
      activeBackend = found;
      activeOrgId = selection.orgId ?? null;
    }
    // If the selection points at a removed backend, fall through to
    // the unselected case below; we also drop the orgId since it only
    // makes sense in the context of a specific cloud backend.
  }

  // @spec BM-003 — Fallback on active backend removal
  if (!activeBackend) {
    activeBackend = pickFallbackBackend(backends);
    activeOrgId = null;
  }

  return {
    backends,
    selection,
    active: { backend: activeBackend, orgId: activeOrgId },
  };
}

let snapshot: Snapshot = computeSnapshot(
  readStoredBackends(),
  readStoredActiveBackend(),
);

const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getActiveBackend(): ResolvedActiveBackend {
  return snapshot.active;
}

/**
 * Pick the backend to use for *local agent-server protocol* calls.
 *
 * Most of the GUI's services (settings reads/writes, conversation CRUD,
 * skills/MCP/secrets, etc.) speak the local agent-server's protocol —
 * they would fail against a cloud host. Only the active backend is eligible:
 * a cloud selection must not borrow another registered local backend.
 */
export function getEffectiveLocalBackend(): Backend | null {
  const active = snapshot.active.backend;
  if (active.kind === "local" && !isNoBackend(active)) return active;
  return null;
}

export function getRegisteredBackends(): Backend[] {
  return snapshot.backends;
}

export function getActiveSelection(): BackendSelection | null {
  return snapshot.selection;
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function setActiveSelection(selection: BackendSelection | null): void {
  writeStoredActiveBackend(selection);
  snapshot = computeSnapshot(snapshot.backends, selection);
  notify();
}

export function setRegisteredBackends(backends: Backend[]): void {
  writeStoredBackends(backends);

  let nextSelection = snapshot.selection;
  if (
    nextSelection &&
    !backends.some((b) => b.id === nextSelection!.backendId)
  ) {
    nextSelection = null;
    writeStoredActiveBackend(null);
  }

  snapshot = computeSnapshot(backends, nextSelection);
  notify();
}

export function subscribeActiveBackend(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: re-read storage and clear listeners. */

export function __resetActiveStoreForTests(): void {
  snapshot = computeSnapshot(readStoredBackends(), readStoredActiveBackend());
  listeners.clear();
}
