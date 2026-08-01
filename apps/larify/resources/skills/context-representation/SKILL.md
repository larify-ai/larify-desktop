---
name: context-representation
description: How context is represented.
eager: true
---

# Directory Structure

Organize context as a recursive hierarchy of domains:

```
<cwd>/.larify/
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
- Express a relation as an inline Markdown link to a relative path.
- Cite an external source with an inline Markdown link to its URL.
- State the relation's meaning in the surrounding natural language.

# Navigable Small World

- Navigate vertically from upper to lower through indexes.
- Navigate horizontally through related links and backlinks.
- Keep relevant subjects reachable through few meaningful hops.
- Link `<cwd>` contents outside `.larify/` from related subjects.

# Quality Criteria

- **Accuracy**: whether subjects are recursively grounded in evidence, conflicting claims are made explicit, and temporal validity is maintained.
- **Completeness**: whether subjects are recursively explored, verified, and critiqued across granularities until no meaningful expansion remains.
- **Effectiveness**: whether context retrieval achieves sufficient precision and recall.
- **Efficiency**: whether sufficient context is reached with low latency and token cost.

# Version Control

- Track context in the current Git repository.
- Commit context with its related repository changes.
- Track large context assets through Git LFS.

# Tips

- Use Chinese throughout, including directory names, file names, metadata, and content.
