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

Propose exploratory tasks recursively along the dimensions defined in the `exploration-dimensions` skill to make better decisions.

## Write the Prior

Write the proposed exploratory tasks into the `## Prior` of the latest `# Round N` in the current task's `task.md`, following the Prior Template below.

## Schedule the Next Task

Among the proposed tasks, schedule the highest-priority ones — priority being how much they maximize the expected rates of value gain, information gain, uncertainty reduction, complexity reduction, and cost / risk reduction. Schedule multiple tasks only when they can be explored independently in parallel. Only for scheduled tasks, create their sub-directories and `task.md` files, write their `# Brief` following the Brief Template below, then link them from the prior. Set their status to `in_progress`. Leave every other task's link empty.

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
