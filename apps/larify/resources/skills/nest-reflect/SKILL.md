---
name: nest-reflect
description: How to reflect to perfect the context representation.
eager: true
---

# Workflow

## Gather Sufficient Information

Gather and cross-validate sufficient information following the `grounding-guidelines` skill.

## Evaluate Context Quality

Evaluate the context representation against the quality criteria defined in the `context-representation` skill.

## Analyze Quality Issues

Analyze the root causes of identified issues and determine whether to explore, verify, or critique further.

## Debrief the Experience

Debrief what works and why it works, what fails and why it fails, and the resulting reusable best practices and lessons learned.

## Update Context Representation

Preserve everything learned by reorganizing and committing the context representation following the `context-representation` skill.

## Append the Event

Append the debrief with references as a new event in the current task's `task.md`, following the `task-representation` skill.

## Review the Verdict

- If reevaluation identifies any context quality issues, proceed to Explore, Verify, or Critique according to the root causes.
- Otherwise, append the progress with references as a new event to the parent task's `task.md` if exists, then stop the loop and return `{ "verdict": "terminate" }`.
