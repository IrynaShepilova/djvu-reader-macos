# DjVu Reader

## Project structure

- `angular/` — Angular frontend
- `node/` — Express backend and SQLite persistence
- `electron/` — Electron application

## Development guidelines

- Keep changes narrowly scoped to the requested feature.
- Follow existing project architecture and naming conventions.
- Do not perform unrelated refactoring.
- Do not modify database schema unless explicitly required.
- Prefer existing services, repositories, and components over introducing duplicate abstractions.
- Run the relevant build/tests after implementation.
- Report what was changed and any issues discovered.

## Change policy

- Do not modify any files unless explicitly asked to implement a change.
- When asked to investigate or plan a feature, inspect the codebase and propose a plan only.
- Do not implement the plan until explicitly instructed to do so.
- Do not make unrelated changes or refactors.
- Before making changes outside the scope of the approved plan, ask for approval.
- Never commit or push changes.
