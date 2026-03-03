# Project Context Management Skill — Design

## What this is

A personal Claude Code skill (`~/.claude/skills/project-context-management/`) that manages CLAUDE.md and `.claude/context/` files for session continuity. Generic — not tied to any specific project.

## Problem

Claude Code sessions lose context through compaction and session boundaries. Without persistent, structured context files, each session starts nearly blank and must be re-briefed by the user.

## Description (YAML frontmatter)

Use when (i) starting a new project; (ii) when context files may be stale after work; and (iii) after compaction when session context has been lost — manages CLAUDE.md and .claude/context/ files for detailed session continuity.

---

## Three modes

### Bootstrap

Triggered when CLAUDE.md doesn't exist, or user explicitly invokes for restructuring.

1. **Detect** — check for CLAUDE.md at project root. If missing, offer to bootstrap.
2. **Explore** — scan codebase: language/runtime, directory structure, existing docs, git state, existing `.claude/` content.
3. **Interview** — ask user one question at a time to fill gaps: project identity and purpose, architecture constraints, current phase, established patterns, success criteria, user preferences.
4. **Generate** — create four files from templates. Present each for review before writing.
5. **Recommend** — run `claude-automation-recommender` if available.
6. **Commit** — `docs: add project context files for session continuity`

For greenfield projects with no code, spec.md and patterns.md start minimal and grow through maintenance.

### Maintenance

Triggered at checkpoints during a session.

**Checkpoint triggers:**
- Post-commit (if it changes architecture, patterns, completes a task, or deviates from spec)
- Task/phase completion
- Pre-session-end (if detectable)
- Significant decision (deviation from spec agreed)

**Skip-when-recent:** Check git log for last context file commit. If last update was within the same logical chunk of work and nothing has changed since, skip. If any staleness criteria would fail, update.

**What gets updated:**

| File | Update when... |
|------|---------------|
| status.md | Task completed, phase changed, deviation recorded, blocker identified |
| patterns.md | New convention established, existing pattern changed, new code example worth preserving |
| spec.md | Design changed, feature deferred, scope adjusted, success criteria revised |
| CLAUDE.md | Phase status line changed, architecture constraint added, project identity updated (rare) |

**Update process:** Read current file → diff against reality (git state, code changes, conversation decisions) → surgical edits (not full rewrites) → commit with `docs: update [filename] — [what changed]`

### Recovery

Triggered after compaction when session context has been lost.

1. **Detect** — recognise compaction occurred (conversation feels fresh but CLAUDE.md references in-progress work, or user says "continue"/"where were we").
2. **Orient** — read status.md: current phase/task, last completed, open deviations/blockers.
3. **Assess staleness** — compare status.md against `git log --oneline -10`, `git status`, `git diff --stat`.
4. **Load context** — per CLAUDE.md tiered instructions.
5. **Reconcile** — if git shows work status.md doesn't reflect, update status.md first.
6. **Suggest skills** — use decision matrix.
7. **Resume** — continue without asking user "what were we doing?"

Key principle: recovery is invisible to the user. If context files are well-maintained, recovery is just reading files and resuming.

---

## Fixed file structure

```
project-root/
├── CLAUDE.md                          # Auto-loaded every session
└── .claude/
    └── context/
        ├── spec.md                    # Living design spec
        ├── status.md                  # Phase/task status + deviations
        └── patterns.md               # Established conventions + code examples
```

---

## CLAUDE.md template

```markdown
# [Project Name]

## What this is
[One paragraph — what the project is, what it does, the purpose of the development]

## Success criteria
- [What does success look like — defined during bootstrap]

## Architecture constraints
- [Non-negotiable rules]
- [Runtime/framework constraints]
- [Branch context: current branch, base branch, deploy branch]

## Environment
- [Runtime version requirements]
- [Required env vars / API keys (names only, not values)]
- [External services / databases / local-only notes]

## How to run
- [Dev server commands]
- [Test commands]
- [Build/verify commands]

## Known issues
- [Gotchas that would trip a new session]
- [Known bugs not yet fixed]
- [Workarounds in use and why]

## Current status
- **Phase N: [Name]** — [status + brief summary]

## When to read context files

Context files live in `.claude/context/`. Read them based on what you're doing:

| Situation | Read |
|-----------|------|
| Starting a new phase | spec.md + status.md + patterns.md |
| Bug fix or small change | patterns.md (if unsure on conventions) |
| Status question | status.md |
| Design/architecture work | spec.md |
| After compaction | status.md first, then load per above |

### Context file inventory
- **spec.md** — [one-line description of what's in it]
- **status.md** — [one-line description]
- **patterns.md** — [one-line description]

## Skill guidance

Analyse the current situation and invoke relevant skills:

| Situation | Suggest |
|-----------|---------|
| No spec or spec is thin | brainstorming → writing-plans |
| Phase transition | brainstorming (if design needed), writing-plans |
| Implementation tasks pending | TDD + subagent-driven-development or executing-plans |
| Multiple independent tasks | dispatching-parallel-agents |
| Feature needs isolation | using-git-worktrees |
| Bug or test failure | systematic-debugging |
| Implementation complete | requesting-code-review + pr-review-toolkit |
| PR ready | finishing-a-development-branch |
| Review feedback received | receiving-code-review |
| About to claim completion | verification-before-completion |
| Context files may be stale | project-context-management (maintenance) |
| Research needed | firecrawl |

## Key conventions
- [Short list — not full examples, those are in patterns.md]

## Domain terminology
- [Project-specific terms that could be ambiguous]
- [Only if the project has meaningful domain language]

## User preferences
- [How the user likes to work, communication style, output conventions]

## Project structure
` ` `
[depth-2 directory tree with annotations]
` ` `
```

---

## Context file templates

### spec.md

```markdown
# [Project Name] — Specification

## Architecture
[System architecture, servers, data flow, isolation rules]

## Pages / Features
[Per-page or per-feature specs: what it does, what data it shows, interactions]

## API surface
[Every endpoint: method, path, request/response shape, error cases]

## Data model
[Key data structures, file formats, database schemas]

## Build order
[Phases with dependencies — what must be built first, what can parallelise]

## Visual design
[Design system: colours, typography, component styles, tokens]
```

### status.md

```markdown
# [Project Name] — Status

## Phase 1: [Name]
**Status:** [Complete / In progress / Not started]
**Files:** [Inventory of every file created/modified]
**Verification:** [Test results, build results]
**Deviations from spec:** [What changed and why]
**Deferred:** [What was pushed to later phases and why]

## Phase 2: [Name]
[Same structure]

## Known blockers
- [Anything blocking progress]
```

### patterns.md

```markdown
# [Project Name] — Coding Patterns

## [Pattern category 1, e.g. "API Server"]
### [Pattern name]
[Description + code example]

## [Pattern category 2, e.g. "React App"]
### [Pattern name]
[Description + code example]

## CSS / Design conventions
[Token reference, naming conventions, style rules]

## Testing
[Test commands, test file locations, assertion patterns]
```

---

## Skill guidance: decision matrix

CLAUDE.md contains this matrix so every session (including post-compaction) can analyse the situation and suggest relevant skills:

| Situation detected | Suggest |
|---|---|
| No CLAUDE.md / no context structure | project-context-management (bootstrap) + claude-automation-recommender |
| No spec or spec is thin | brainstorming → PM methodology → writing-plans |
| Phase transition (new phase starting) | brainstorming (if design needed), writing-plans |
| Implementation plan exists, tasks pending | subagent-driven-development or executing-plans + TDD |
| Multiple independent tasks identified | dispatching-parallel-agents |
| Feature needs isolation | using-git-worktrees |
| Bug or test failure | systematic-debugging |
| Implementation complete | requesting-code-review + pr-review-toolkit (code-reviewer, silent-failure-hunter, pr-test-analyzer) |
| PR ready | finishing-a-development-branch |
| Review feedback received | receiving-code-review |
| Research needed | firecrawl |
| About to claim completion | verification-before-completion |
| Context files may be stale | project-context-management (maintenance) |
| Post-compaction | project-context-management (recovery) |
| Want to automate workflows | claude-automation-recommender + hook-development |

---

## Success criteria

### Skill-level (does the context system work?)

1. **Cold start test** — fresh session orients from CLAUDE.md alone without opening context files. Pass/fail.
2. **Post-compaction test** — session resumes current task without asking user "what were we doing?" Pass/fail.
3. **Staleness test** — at any checkpoint, context files reflect reality. status.md matches git state, patterns.md matches code conventions, spec.md matches design intent. Verified by diff.
4. **New session ramp-up** — session writes code that passes existing tests and follows established patterns without being told conventions. Verified by code review.
5. **Context file freshness** — no file is more than one significant work session out of date.

### Project-level (prescribed in CLAUDE.md template)

Bootstrap mode asks the user to define project success criteria during interview. These are baked into CLAUDE.md so every session knows what the project is trying to achieve.

---

## Maintenance discipline

### Rationalization table

| Excuse | Reality |
|--------|---------|
| "I'll update at the end" | Compaction might happen first. Update now. |
| "Nothing significant changed" | If you committed, something changed. Check. |
| "The context files are close enough" | Close enough = wrong after compaction. Be exact. |
| "It's just a small fix" | Small fixes that change patterns need patterns.md updated. |
| "I'll remember" | You won't. The next session won't. Write it down. |

### Recovery red flags

- Asking the user "what were we working on?" — context files should answer this
- Writing code that contradicts patterns.md — patterns weren't loaded
- Repeating work that's already committed — status.md wasn't checked
- Missing a deviation that was already agreed — status.md wasn't updated pre-compaction
