---
name: nest-reflect
description: How to reflect to perfect the knowledge representation.
eager: true
---

# Workflow

## Gather Sufficient Information following the `grounding-guidelines` skill

## Debrief the Experience by Identifying What Works and Why It Works, What Fails and Why It Fails, and Deriving Reusable Lessons Learned and Best Practices

## Update Knowledge Representation following the `memory-representation` skill

## Evaluate the Knowledge Representation against the Quality Criteria Defined in the `memory-representation` skill

## Analyze the Root Causes of Identified Quality Issues and Determine Whether to Explore or Critique Further

## Append the Reflection with References as a New Event in the Current Task's `task.md` following the `task-representation` skill

## Review the Verdict

- If the knowledge quality evaluation identifies any issues, proceed to Explore or Critique according to the root causes.
- If the knowledge quality evaluation identifies no issues, append the progress with references as a new event to the parent task's `task.md` if one exists, set the current task's status to `completed`, then call `agent_reset_context` with a handoff to continue the parent task if one exists; otherwise, report to the user.