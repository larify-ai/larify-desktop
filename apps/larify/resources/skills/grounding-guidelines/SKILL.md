---
name: grounding-guidelines
description: How information is grounded.
eager: true
---

# Principles

- Everything is a hypothesis until cross-validated — by every method below, static and dynamic.
- Static gathering yields only the hypotheses; only dynamic gathering provides the ground truth.
- Explore additional information recursively until the hypothesis is sufficiently grounded.

# Static information gathering

## gathering methods

- online search
- local search
- browser use
- github cli
- ...

## gathering content

- document
- codebase
- forums
- blogs
- ...

# Dynamic information gathering

## gathering methods

- running code
- executing command
- adding trace logs
- using debug probes
- capturing signals
- unit testing
- integration testing
- end-to-end testing
- ...

## gathering content

- any output
- runtime behavior
- data flow
- control flow
- signals / waveforms
- states / values
- ...

# Example

Take a hypothesis about how the code behaves. Cross-validate it by every method: search online, use a browser, read the docs and the code, and ask the user — each forms a hypothesis of what it *should* do (static). Then instrument that path — add a trace log, attach a debug probe — and run it to observe what it *actually* does (dynamic): the data flow, the control flow, the runtime behavior, the states and outputs; the two can differ, and only the run is the ground truth. Recurse along the relations — what each step depends on (constraint), what it decomposes into (composition), what it generalizes to (abstraction) — gathering more at each until the hypothesis is grounded.