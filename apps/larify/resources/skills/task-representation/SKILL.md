---
name: task-representation
description: How tasks are represented.
eager: true
---

# Directory Structure

Organize progress as a recursive hierarchy of tasks:

```
~/.larify/tasks/<task>/
  task.md
  <subtask>/
    task.md
    <subsubtask>/
      task.md
```

# Task File Format

```markdown
---
name: <human-readable task title>
description: <brief description of the task>
status: <in_progress | completed>
---

# Brief

# Round 1

## Explore

<exploratory task graph>

### References

<references to related context>

## Execute

<execution result>

### References

<references to related context>

## Critique

<critical task graph>

### References

<references to related context>

...

# Round N

# Debrief
```

# Brief Template

```markdown
---
name: <human-readable task title>
description: <brief description of the task>
status: in_progress
---

# Brief

## What

<what to explore>

## Why

<why it matters>

## References

<references to related context>
```

# Task Graph Format

````markdown
```mermaid
flowchart TD
  nameA --> nameC
  nameB --> nameC
```

| name  | description | link                   |
|-------|-------------|------------------------|
| nameA | descA       | [nameA](nameA/task.md) |
| nameB | descB       | -                      |
| nameC | descC       | -                      |
````
