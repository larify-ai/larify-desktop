---
name: memory-representation
description: How memory is represented, e.g. semantic memory, procedural memory, etc.
eager: true
---

# Directory Structure

Organize memory as a recursive hierarchy of domains:

```
~/.larify/memory/
  index.md
  <domain>/
    index.md
    <subject>.md
    <subdomain>/
      index.md
      <subject>.md
      <subsubdomain>/
        index.md
        <subject>.md
```

# Document Template

```markdown
---
name: <human-readable unique name>
description: <what it covers and when to use it>
---

# <the subject>

<one subject per document>
```

# Relation Specification

- Index each domain's direct subdomains with links in its `index.md`.
- Index each domain's direct subjects with links in its `index.md`.
- Express each relation through an inline Markdown link.
- State the relation's meaning in the surrounding natural language.
- Cite local sources by relative path and external sources by URL.

# Navigable Small World

- Navigate vertically from upper to lower through indexes.
- Navigate horizontally between subjects through related links.
- Keep relevant subjects reachable through few meaningful hops.

# Quality Criteria

- **Accuracy**: whether subjects are recursively grounded in evidence, conflicting claims are made explicit, and temporal validity is maintained.
- **Completeness**: whether subjects are recursively explored, verified, and critiqued across granularities until no meaningful expansion remains.
- **Effectiveness**: whether context retrieval achieves sufficient precision and recall.
- **Efficiency**: whether sufficient context is reached with low latency and token cost.

# Version Control

- Track memory in a Git repository.
- Commit every update as a checkpoint.
- Track large assets through Git LFS.

# Constraints

- Represent everything learned in `<subject>.md`; only track task progress in `task.md`.
- Use Chinese throughout, including directory names, file names, metadata, and content.
- Keep `<subject>.md` self-contained.
- Never cite `task.md` in `<subject>.md`.
