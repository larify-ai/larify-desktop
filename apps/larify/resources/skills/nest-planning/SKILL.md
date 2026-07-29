---
name: nest-planning
description: How to decide what to explore next.
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Update Context Representation

Organize what was learned into the context representation following the `context-representation` skill.

## Propose Exploratory Tasks Recursively

Propose exploratory tasks recursively along the dimensions defined in the `exploration-dimensions` skill.

## Write the Prior

Write the proposed exploratory tasks into the `## Prior` of the latest `# Round N` in the current task's `task.md`, with their dependencies drawn in the graph, following the Prior Template below.

## Schedule the Next Task

Among the proposed tasks whose predecessors are all met, schedule the highest-priority one — priority being how much it maximizes the expected rates of value gain, information gain, uncertainty reduction, complexity reduction, and cost / risk reduction: only for the scheduled task, create a sub-directory, create a `task.md` inside the sub-directory, write the task's `# Brief` into the `task.md` following the Brief Template below, then link the task to the `task.md`. Set the scheduled task's status to `in_progress`. Leave every other task's link empty — a later round schedules the next task once its predecessors are met.

# Prior Template

```
# Round N

## Prior

```mermaid
flowchart TD
  nameA --> nameC
  nameB --> nameC
````

| name  | description | link                              |
|-------|-------------|-----------------------------------|
| nameA | descA       | [nameA](nameA/task.md)            |
| nameB | descB       | -                                 |
| nameC | descC       | -                                 |
```

# Brief Template

```
---
name: <human-readable task title>
description: <brief description of the task>
status: in_progress
---

# Brief

## Context

<what is referenced context>

## Question

<the open question to explore, without specifying the hypothesis>
```
