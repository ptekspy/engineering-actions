---
name: list-open-prs
description: 'List open pull requests across configured repositories. Use for PR triage, open PR reporting, repo sweep, GitHub CLI based status checks, and scheduled engineering review workflows.'
argument-hint: 'Optional JSON array of owner/repo values to override the default repository list'
user-invocable: true
disable-model-invocation: false
---

# List Open PRs

Use this skill when you need a consolidated view of open pull requests across the repositories configured for this workspace.

## What This Skill Uses

- The repository list in `apps/pr-open-report/repositories.json`
- The TypeScript implementation in `apps/pr-open-report/src/index.ts`
- The scheduled workflow in `.github/workflows/list-open-prs.yml`

## Procedure

1. Read the configured repositories from `apps/pr-open-report/repositories.json` unless the user provides an override.
2. Use the PR reporting app as the source of truth for how repositories should be queried.
3. Keep shell-outs limited to `gh` and `git` when extending the workflow.
4. Return the open PRs as a concise markdown summary grouped by repository when the user asks for the result directly.
5. If the user asks to change automation behavior, update the workflow and the TypeScript app together so the skill and scheduled job stay aligned.

## Notes

- Prefer `gh pr list --repo <owner/repo> --state open` patterns when adding or modifying logic.
- Do not introduce other CLI dependencies into the reporting workflow without explicit approval.
- If the user wants new metadata in the report, update the JSON fields requested from `gh` in the TypeScript app.

See [workflow reference](./references/workflow.md).