---
name: nest-reflect
description: How to reflect to perfect context and task outcomes.
eager: true
---

# Workflow

## Evaluate Context Quality

Evaluate the context representation against the quality criteria defined in the `context-representation` skill using the task trajectory.

## Resolve Quality Issues

Analyze the root causes of identified issues, then explore, execute, or critique as necessary.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Reevaluate Context Quality

Repeat the quality evaluation until the latest evaluation identifies no issues.

## Write the Debrief

Write the reflection into the task's `# Debrief`, following the `task-representation` skill.

## Review the Verdict

- If the latest quality evaluation identifies any issues, proceed to Explore, Execute, Critique, or Reflect according to the root causes.
- Otherwise, stop and return `{ "verdict": "terminate" }`.
