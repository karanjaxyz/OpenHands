import { create } from "zustand";

export type Command = {
  content: string;
  type: "input" | "output";
};

interface CommandState {
  commands: Command[];
  /**
   * Ids of the ActionEvent/ObservationEvent that already produced a command
   * entry. The WebSocket layer's own replay guard (`useEventStore`'s
   * `eventIds`) is keyed off a single shared store, but the main and
   * planning-agent connections each run it independently against events they
   * see first — so the same event id can still reach `appendInput` /
   * `appendOutput` more than once (e.g. a reconnect on one socket replaying
   * an event the other socket already delivered). Tracking ids here keeps
   * the terminal panel free of duplicate lines regardless of which caller
   * re-delivers an event.
   */
  seenEventIds: Set<string>;
  appendInput: (content: string, eventId?: string) => void;
  appendOutput: (content: string, eventId?: string) => void;
  clearTerminal: () => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  commands: [],
  seenEventIds: new Set(),
  appendInput: (content: string, eventId?: string) =>
    set((state) => {
      if (eventId !== undefined && state.seenEventIds.has(eventId)) {
        return state;
      }
      return {
        commands: [...state.commands, { content, type: "input" }],
        seenEventIds:
          eventId !== undefined
            ? new Set(state.seenEventIds).add(eventId)
            : state.seenEventIds,
      };
    }),
  appendOutput: (content: string, eventId?: string) =>
    set((state) => {
      if (eventId !== undefined && state.seenEventIds.has(eventId)) {
        return state;
      }
      return {
        commands: [...state.commands, { content, type: "output" }],
        seenEventIds:
          eventId !== undefined
            ? new Set(state.seenEventIds).add(eventId)
            : state.seenEventIds,
      };
    }),
  clearTerminal: () => set({ commands: [], seenEventIds: new Set() }),
}));
