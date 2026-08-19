---
name: nest-verify
description: How to execute and verify a task.
eager: false
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Execute and Verify

Execute and verify the task using every available static and dynamic source and method.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Append the Event

Append the progress with references as a new event in the current task's `task.md`, following the `task-representation` skill.

## Review the Verdict

- If any issue is identified, analyze its root cause, resolve it, then repeat the Verify phase.
- If no issue is identified, proceed to the Critique phase.
