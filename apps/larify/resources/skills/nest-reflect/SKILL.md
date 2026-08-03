---
name: nest-reflect
description: How to reflect to perfect the context representation.
eager: true
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Debrief the Experience

Debrief what works and why it works, what fails and why it fails, and the resulting reusable best practices and lessons learned.

## Update Context Representation

Reorganize and commit the context representation following the `context-representation` skill.

## Evaluate Context Quality

Evaluate the context representation against the quality criteria defined in the `context-representation` skill.

## Analyze Quality Issues

Analyze the root causes of identified issues and determine whether to explore or critique further.

## Append the Event

Append the debrief with references as a new event in the current task's `task.md`, following the `task-representation` skill.

## Review the Verdict

- If the context quality evaluation identifies any issues, proceed to Explore or Critique according to the root causes.
- If the context quality evaluation identifies no issues, append the progress with references as a new event to the parent task's `task.md` if one exists, set the current task's status to `completed`, then call `nest_submit_verdict` with `{ "verdict": "terminate" }`.
