# Domain Docs

How engineering skills should use this repo's domain docs. The repo has a single context.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the domain glossary.
- **`docs/adr/`**: ADRs that touch the area you're about to work in.

If these don't exist yet, **proceed silently**. `/domain-modeling` and `/improve-codebase-architecture` create them when a term or decision is actually settled.

## Layout

```
/
├── CONTEXT.md        ← glossary only, no implementation details
├── docs/adr/         ← 0001-slug.md, 0002-slug.md, …
├── client/
└── server/
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, refactor proposal, hypothesis or test name), use the term as `CONTEXT.md` defines it. Don't switch to synonyms the glossary avoids. If the term you need isn't there, either you're inventing language the project doesn't use or there's a real gap; note it for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, say so explicitly instead of silently overriding it:

> _Contradicts ADR-0003 (…), but worth reopening because…_
