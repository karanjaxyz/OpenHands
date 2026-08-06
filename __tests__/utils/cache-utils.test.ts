import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionEvent } from "#/types/agent-server/core/events/action-event";
import { handleActionEventCacheInvalidation } from "#/utils/cache-utils";
import { useModelStore } from "#/stores/model-store";

const makeActionEvent = (overrides: Partial<ActionEvent>): ActionEvent =>
  ({
    id: "ev-1",
    timestamp: new Date().toISOString(),
    source: "agent",
    tool_name: "SwitchLLMTool",
    tool_call_id: "call-1",
    action: { kind: "SwitchLLMAction" },
    ...overrides,
  }) as unknown as ActionEvent;

describe("handleActionEventCacheInvalidation", () => {
  beforeEach(() => {
    useModelStore.setState({
      entriesByConversation: {},
      activeProfileByConversation: {},
    });
  });

  it("refreshes the conversation and drops the optimistic profile when SwitchLLMTool fires", () => {
    useModelStore.setState({
      activeProfileByConversation: { "conv-1": "haiku" },
    });
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({ tool_name: "SwitchLLMTool" }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["user", "conversation", "conv-1"],
    });
    expect(
      useModelStore.getState().activeProfileByConversation["conv-1"],
    ).toBeUndefined();
  });

  it("does not touch the conversation cache for unrelated tool events", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({ tool_name: "terminal" }),
      "conv-1",
      queryClient,
    );

    const conversationInvalidations = spy.mock.calls.filter(
      ([arg]) =>
        Array.isArray((arg as { queryKey?: unknown[] })?.queryKey) &&
        (arg as { queryKey: unknown[] }).queryKey[0] === "user",
    );
    expect(conversationInvalidations).toHaveLength(0);
  });

  it("invalidates the changed-files list and every cached file diff when a bash action fires", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({
        tool_name: "terminal",
        action: {
          kind: "ExecuteBashAction",
          command: "git commit -am wip",
          is_input: false,
          timeout: null,
          reset: false,
        },
      }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["file_changes", "conv-1"] },
      { cancelRefetch: false },
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["file_diff", "conv-1"],
    });
  });

  it("invalidates only the edited file's diff for editor actions", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({
        tool_name: "str_replace_editor",
        action: {
          kind: "StrReplaceEditorAction",
          command: "str_replace",
          path: "/workspace/repo/src/file.py",
          file_text: null,
          old_str: "foo",
          new_str: "bar",
          insert_line: null,
          view_range: null,
        },
      }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["file_changes", "conv-1"] },
      { cancelRefetch: false },
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["file_diff", "conv-1", "src/file.py"],
    });
    expect(spy).not.toHaveBeenCalledWith({
      queryKey: ["file_diff", "conv-1"],
    });
  });
});
