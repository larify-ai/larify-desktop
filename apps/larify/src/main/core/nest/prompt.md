To complete the current task `{{ taskFile }}`,

1. gather sufficient information to propose prerequisite, decomposed, dependent tasks along all the epistemic dimensions
2. gather sufficient information to prioritize the proposed tasks along all the practical dimensions
3. evaluate whether completing the proposed tasks at once would increase uncertainty, complexity or cost/risk
4. If it would, reorganize and commit the knowledge representation about everything learned so far, then append the proposed tasks with references as a new event in the current task's task.md, then schedule only the highest-priority task - create its subdirectory and task.md under the current task's directory, set its status to `pending` and append its context and references as the first event, finally call `agent_schedule_task` only once with the scheduled task.md path
5. If not, complete the proposed tasks directly, then reorganize and commit the knowledge representation about everything learned so far, then set its status to `completed` and append the context and references as a new event in the current task's task.md{{ parentClause }}.