---
name: nest-critique
description: How to decide what to critique next.
eager: true
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Propose Critical Tasks Recursively

Propose critical tasks recursively along the dimensions defined in the `exploration-dimensions` skill to make better decisions.

## Write the Critique

Write the proposed critical tasks into the `## Critique` of the latest `# Round N` in the current task's `task.md`, following the `task-representation` skill.

## Schedule the Next Task

Among the proposed critical tasks, schedule the highest-priority ones — priority being how much they maximize the rates of expected value increase, information gain, uncertainty reduction, complexity reduction, and cost / risk reduction. Schedule multiple tasks only when they can be executed independently in parallel. Only for scheduled tasks, create their sub-directories and `task.md` files, write their `# Brief` following the `task-representation` skill, then add their links to the table. Set their status to `in_progress`. Leave every other task's link empty.
