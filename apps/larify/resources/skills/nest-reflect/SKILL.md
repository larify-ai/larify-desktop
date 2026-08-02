---
name: nest-reflect
description: How to reflect to perfect context and task outcomes.
eager: true
---

# Workflow

## Evaluate Context Quality

Evaluate the context representation against the quality criteria defined in the `context-representation` skill.

## Resolve Quality Issues

Analyze the root causes of identified issues, proceed to explore, verify, or critique as necessary.

## Debrief the Experience

Debrief what works and why it works, what fails and why it fails, and the resulting reusable best practices and lessons learned.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Append the Observation

Append the observation as a new event in the current task's `task.md`, following the `task-representation` skill.

## Review the Verdict

- If reevaluating context quality identifies any issues, proceed to Explore, Verify, or Critique according to the root causes.
- Otherwise, append the outcome as a new event to the parent task's task.md if exists, set the current task's status to `completed`, then stop the loop.
