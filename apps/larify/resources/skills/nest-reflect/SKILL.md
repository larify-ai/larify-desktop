---
name: nest-reflect
description: How to reflect to perfect context and task outcomes.
eager: true
---

# Goal

Reorganize everything learned to improve the completeness, reliability, accessibility, and reusability of the context representation.

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Validate Context Representation

Resolve the diagnostics reported while updating the context representation.

## Write the Debrief

Write the reflection into the task's `# Debrief`, following the `task-representation` skill.

## Review the Verdict

- If reflection remains incomplete, continue the Reflect phase.
- If reflection is complete, then stop and return `{ "verdict": "terminate" }`.
