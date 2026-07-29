---
name: task-representation
description: How tasks are represented.
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
...

# Round 1
## Prior
## Observation
## Posterior

# Round 2
## Prior
## Observation
## Posterior

...

# Debrief
...
```
