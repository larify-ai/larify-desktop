---
name: context-representation
description: How context is represented.
---

# Directory Structure

Organize context as a recursive hierarchy of domains:

```
~/.larify/context/<domain>/
  README.md
  <subject>.md
  <subdomain>/
    README.md
    <subject>.md
    <subsubdomain>/
      README.md
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

- Index each domain's subjects with links in its `README.md`.
- Express a relation as an inline Markdown link to a relative path.
- Cite an external source with an inline Markdown link to its URL.
- State the relation's meaning in the surrounding natural language.
- Represent a relation bidirectional through its link and backlink.

# Version Control

- Initialize and maintain context as a Git repository.
- All context changes must be committed.
- Store large assets with Git LFS.
