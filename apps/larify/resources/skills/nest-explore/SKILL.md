---
name: nest-explore
description: How to decide what to explore next.
eager: true
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Propose Exploratory Tasks Recursively

Propose exploratory tasks recursively along the dimensions defined in the `inquiry-dimensions` skill to make better decisions.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority one — priority being how much it maximizes the rate of reducing uncertainty, complexity, and cost / risk. Only for the scheduled task, create its sub-directory and `task.md`, set its status to `in_progress`, and append its initial event, following the `task-representation` skill.

## Append the Observation

Append the observation as a new event in the current task's `task.md`, following the `task-representation` skill.

## Review the Verdict

- If further exploratory tasks can be proposed recursively, confirm that the scheduled task has a `task.md`, then stop the loop.
- Otherwise, proceed to the Verify phase.
