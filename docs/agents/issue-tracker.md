# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`. Don't create GitHub issues or use any external tracker.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Put each implementation issue in its own file at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`. Never combine tickets into one file.
- Put a `Status: open` or `Status: done` line near the top of each issue file
- Add comments and conversation history at the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally give the path or issue number.
