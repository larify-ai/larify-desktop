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

Propose exploratory tasks recursively along the dimensions defined in the `exploration-dimensions` skill to make better decisions.

## Write the Exploration

Write the proposed exploratory tasks into the `## Explore` of the latest `# Round N` in the current task's `task.md`, following the `task-representation` skill.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority ones — priority being how much they maximize the rates of expected value increase, information gain, uncertainty reduction, complexity reduction, and cost / risk reduction. Schedule multiple tasks only when they can be explored independently in parallel. Only for scheduled tasks, create their sub-directories and `task.md` files, write their `# Brief` following the `task-representation` skill, then add their links to the table. Set their status to `in_progress`. Leave every other task's link empty.
