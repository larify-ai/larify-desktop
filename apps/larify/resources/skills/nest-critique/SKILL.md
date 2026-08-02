---
name: nest-critique
description: How to decide what to critique next.
eager: true
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Propose Critical Tasks Recursively

Propose critical tasks recursively along the dimensions defined in the `inquiry-dimensions` skill to make better decisions.

## Update Context Representation

Preserve everything learned by reorganizing and committing the context representation following the `context-representation` skill.

## Append the Event

Append the progress with references as a new event in the current task's `task.md`, following the `task-representation` skill.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority one — priority being how much it maximizes the rate of reducing uncertainty, complexity, and cost / risk. Only for the scheduled task, create its sub-directory and `task.md`, set its status to `in_progress`, and append its `Brief` with references as the first event, following the `task-representation` skill.

## Review the Verdict

- If further critical tasks can be proposed recursively, confirm that the scheduled task has a `task.md`, then stop the loop and return `{ "verdict": "schedule" }`.
- Otherwise, proceed to the Reflect phase.
