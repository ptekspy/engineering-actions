# Workflow Reference

This workspace uses a small Turborepo layout so each autonomous script can become its own app without mixing concerns.

## Current App

- `apps/pr-open-report`: lists open pull requests for the configured repository set

## Expected Operating Rules

- Runtime shell commands for the automation should stay limited to `gh` and `git`
- Repository targets belong in `apps/pr-open-report/repositories.json`
- The GitHub Action should execute the built artifact from `apps/pr-open-report/dist/index.js`

## Typical Updates

1. Add or remove repositories in `apps/pr-open-report/repositories.json`
2. Extend the requested `gh pr list --json` fields in `apps/pr-open-report/src/index.ts`
3. Adjust the report formatting in the same file
4. Keep `.github/workflows/list-open-prs.yml` aligned with the app entrypoint