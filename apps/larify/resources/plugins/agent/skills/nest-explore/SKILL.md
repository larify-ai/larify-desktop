---
name: nest-explore
description: How to decide what to explore next.
eager: true
---

# Workflow

## Gather Sufficient Information following the `grounding-guidelines` skill

## Update Knowledge Representation following the `memory-representation` skill

## Propose Exploratory Tasks Recursively following the `inquiry-dimensions` skill

## Append the Proposed Exploratory Tasks with References as a New Event in the Current Task's `task.md` following the `task-representation` skill

## Schedule the Highest-Priority Task

Only for the scheduled task, create its subdirectory and `task.md` under the current task's directory, set its status to `in_progress`, and append its context and references as the first event following the `task-representation` skill.

## Review the Verdict

- If a task is scheduled, call `agent_reset_context` with a handoff to continue the scheduled task from the Explore phase.
- If no task is scheduled, proceed to the Critique phase.