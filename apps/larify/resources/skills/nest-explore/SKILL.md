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

Append the proposed exploratory tasks as a new `Explore` event using the Task Graph Format defined in the `task-representation` skill.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority ones — priority being how much they maximize the rates of expected value increase, information gain, uncertainty reduction, complexity reduction, and cost / risk reduction. Schedule multiple tasks only when they can be completed independently in parallel. Only for scheduled tasks, create their sub-directories and `task.md` files, write their `# Brief` following the `task-representation` skill, then add their links to the table.

## Review the Verdict

- If new exploratory tasks can be proposed recursively or any existing exploratory task remains incomplete, confirm that every scheduled task has a `task.md` with a name and description; then stop and return `{ "verdict": "schedule", "taskFiles": ["<relative task.md path>"] }`.
- If neither new exploratory tasks can be proposed recursively nor any existing exploratory task remains incomplete, and any hypothesis has not been cross-validated, proceed to the Execute phase.
- If neither new exploratory tasks can be proposed recursively nor any existing exploratory task remains incomplete, and every hypothesis has been cross-validated, proceed to the Critique phase.
