# Exploration Phase

1. Gather information recursively following the Grounding Guidelines.
2. Update what has been learned following the Context Representation.
3. Propose exploratory tasks recursively along the Grounding Dimensions.
4. Write the proposed exploratory tasks into the `## Prior` of the latest `# Round N` in the current task's `task.md`.
5. Schedule the highest-priority unblocked task by creating its subdirectory and `task.md`, then writing its `# Brief`.

- If new exploratory tasks can be proposed recursively or any existing exploratory task remains unexplored to complete, must confirm a sub-directory have been created, then stop.
- If neither new exploratory tasks can be proposed recursively nor any existing exploratory task remains unexplored to complete, and any hypothesis has not been cross-validated, then proceed to Execution Phase.
- If neither new exploratory tasks can be proposed recursively nor any existing exploratory task remains unexplored to complete, and every hypothesis has been cross-validated, then stop.

# Execution Phase

Write the `## Observation` in the latest `# Round N` of the current task's `task.md`.

# Evaluation Phase (following the **evaluation** skill)

Write the `## Posterior` in the latest `# Round N` of the current task's `task.md`, then return to the Planning Phase to re-plan.

# Reflection Phase (following the **reflection** skill)

{%- if upper_task_path %}
Write the current task's report into the latest `## Observation` and `## Posterior` of the upper task's `task.md` in `{{upper_task_path}}`, following the Observation and Posterior templates.
{%- endif %}

# Workflow

Current task: `{{current_task_path}}`. Working directory: `{{cwd}}`.

```
while True:
    do the Steps in the Planning Phase
    if verdict == "schedule":
        break
    elif verdict == "terminate":
        do the Steps in the Reflection Phase
        break
    else:
        do the Steps in the Execution Phase
        do the Steps in the Evaluation Phase
```
