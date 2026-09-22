To complete the current task `{{ taskFile }}`, follow the workflow below:

### Before completing the current task

1. gather sufficient information to propose prerequisite tasks along the epistemic dimensions
2. gather sufficient information to prioritize the proposed prerequisite tasks along the practical dimensions
3. evaluate whether completing the proposed prerequisite tasks at once would increase uncertainty, complexity or cost/risk
- If it would increase, reorganize and commit the knowledge representation about everything learned so far, then append the proposed prerequisite tasks with references as a new event in the current task's task.md, then schedule only the highest-priority task - create its subdirectory and task.md under the current task's directory, set its status to `pending` and append its context and references as the first event, finally call `agent_schedule_task` only once with the scheduled task.md path to set status to `in_progress` after call `agent_ask_user`
- If it would reduce, complete the proposed prerequisite tasks directly, then reorganize and commit the knowledge representation about everything learned so far, then set its status to `completed` and append the context and references as a new event in the current task's task.md{{ parentClause }}.

### While completing the current task

1. gather sufficient information to propose decomposed tasks along the epistemic dimensions
2. gather sufficient information to prioritize the proposed decomposed tasks along the practical dimensions
3. evaluate whether completing the proposed decomposed tasks at once would increase uncertainty, complexity or cost/risk
- If it would increase, reorganize and commit the knowledge representation about everything learned so far, then append the proposed decomposed tasks with references as a new event in the current task's task.md, then schedule only the highest-priority task - create its subdirectory and task.md under the current task's directory, set its status to `pending` and append its context and references as the first event, finally call `agent_schedule_task` only once with the scheduled task.md path to set status to `in_progress` after call `agent_ask_user`
- If it would reduce, complete the proposed decomposed tasks directly, then reorganize and commit the knowledge representation about everything learned so far, then set its status to `completed` and append the context and references as a new event in the current task's task.md{{ parentClause }}.