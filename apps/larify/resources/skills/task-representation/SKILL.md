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

# Events

<chronological events>
```

# Event Format

Append each event chronologically under `# Events`:

```markdown
## <event title>

<event summary>

### References

<links only to related documents under `<cwd>/.larify/` without backlinks to the `task.md` file>
```
