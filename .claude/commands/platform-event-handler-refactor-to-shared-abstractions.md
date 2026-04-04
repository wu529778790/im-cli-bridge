---
name: platform-event-handler-refactor-to-shared-abstractions
description: Workflow command scaffold for platform-event-handler-refactor-to-shared-abstractions in open-im.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /platform-event-handler-refactor-to-shared-abstractions

Use this workflow when working on **platform-event-handler-refactor-to-shared-abstractions** in `open-im`.

## Goal

Refactor platform-specific event handler logic to use shared abstractions for AI request handling, event context, and text flow, reducing code duplication and improving maintainability across platforms (QQ, Feishu, WeWork, WorkBuddy, DingTalk, Telegram).

## Common Files

- `src/platform/create-event-context.ts`
- `src/platform/handle-ai-request.ts`
- `src/platform/handle-text-flow.ts`
- `src/qq/event-handler.ts`
- `src/feishu/event-handler.ts`
- `src/wework/event-handler.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update shared abstraction modules (e.g., createPlatformEventContext, createPlatformAIRequestHandler, handleTextFlow) in src/platform/
- Refactor platform event-handler.ts files to replace custom logic with calls to shared abstractions
- Update or add tests for shared abstractions and platform event handlers
- Adjust platform-specific logic to fit new abstraction interfaces
- Update documentation or plans if necessary

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.