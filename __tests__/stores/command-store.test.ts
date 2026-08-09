import { beforeEach, describe, expect, it } from "vitest";
import { useCommandStore } from "#/stores/command-store";

describe("command store", () => {
  beforeEach(() => {
    useCommandStore.setState({ commands: [], seenEventIds: new Set() });
  });

  it("appends input and output commands", () => {
    useCommandStore.getState().appendInput("echo manual-test");
    useCommandStore.getState().appendOutput("manual-test");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "echo manual-test", type: "input" },
      { content: "manual-test", type: "output" },
    ]);
  });

  it("drops a second appendOutput call carrying an already-seen event id", () => {
    useCommandStore.getState().appendOutput("manual-test", "event-1");
    // Same event id delivered again (e.g. one WebSocket connection replaying
    // an event the other connection already processed) must not duplicate
    // the terminal panel entry.
    useCommandStore.getState().appendOutput("manual-test", "event-1");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "manual-test", type: "output" },
    ]);
  });

  it("drops a second appendInput call carrying an already-seen event id", () => {
    useCommandStore.getState().appendInput("echo manual-test", "event-1");
    useCommandStore.getState().appendInput("echo manual-test", "event-1");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "echo manual-test", type: "input" },
    ]);
  });

  it("still appends entries with no event id (backwards compatible)", () => {
    useCommandStore.getState().appendOutput("first");
    useCommandStore.getState().appendOutput("second");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "first", type: "output" },
      { content: "second", type: "output" },
    ]);
  });

  it("treats different event ids as distinct entries", () => {
    useCommandStore.getState().appendOutput("first", "event-1");
    useCommandStore.getState().appendOutput("second", "event-2");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "first", type: "output" },
      { content: "second", type: "output" },
    ]);
  });

  it("clearTerminal resets both commands and the seen event id set", () => {
    useCommandStore.getState().appendOutput("first", "event-1");
    useCommandStore.getState().clearTerminal();
    useCommandStore.getState().appendOutput("first", "event-1");

    expect(useCommandStore.getState().commands).toEqual([
      { content: "first", type: "output" },
    ]);
  });
});
