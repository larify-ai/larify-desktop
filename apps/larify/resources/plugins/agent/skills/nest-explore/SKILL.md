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

## Append the Event

Append the proposed exploratory tasks with references as a new event in the current task's `task.md`, following the `task-representation` skill.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority one — priority being how much it maximizes the rate of reducing uncertainty, complexity, and cost / risk. Only for the scheduled task, create its sub-directory and `task.md` under the current task's directory, set its status to `in_progress`, and append its `Brief` with references as the first event, following the `task-representation` skill.

## Review the Verdict

- If a task is scheduled, confirm that it has a `task.md` under the current task's directory.
- If no task is scheduled, confirm that no new `task.md` is created under the current task's directory.
