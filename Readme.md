### Feedback Labeller (Rovo Agent)

---

#### Overview

This Forge app adds a Rovo Agent to Confluence Cloud that:

1) Finds the first table whose header row includes Subject and Description.
2) Ensures Theme and Impact columns exist (adds them if missing).
3) Returns up to 20 rows where Theme or Impact is empty.
4) Uses the LLM (via the Rovo Agent) to decide Theme and Impact strictly from the taxonomy:
   - Theme: Feature Request · Integration · Bug · Query · Other
   - Impact: High · Medium · Low
5) Writes the LLM’s chosen values back into empty cells only (no overwrites).

Important: There is no keyword fallback or normalization in code. The app preserves exactly what the LLM returns.

The app works with atlas_doc_format (ADF) directly; no HTML parsing is used.

---

#### How it works

```
Rovo chat (user) ──▶ Feedback Labeller prompt
                     │
                     │ invokes actions
                     ▼
Action GET     ──▶  get-next-rows
                     │  (reads page via REST v2, ADF; returns unlabeled rows)
                     ▼
            🧠 LLM classifies Theme & Impact
                     ▼
Action UPDATE  ──▶  apply-labels
                     │  (adds missing columns; writes labels; PUT page)
                     ▼
                 Confluence page updated
```

---

#### Files

- manifest.yml: Rovo agent, actions, permissions.
- src/index.js: ADF helpers, Confluence REST v2 helpers, actions.
- Readme.md: This document.

---

#### Permissions

```yaml
permissions:
  scopes:
    - read:page:confluence   # GET page (atlas_doc_format)
    - write:page:confluence  # PUT page
    - read:chat:rovo         # expose agent & actions in Rovo chat
    - storage:app            # reserved; not currently used by code
```

No external.fetch/egress is required.

---

#### Prerequisites

- Atlassian Forge CLI (latest): `npm i -g @forge/cli`
- Confluence Cloud site where you can install apps
- Rovo enabled on your site

---

#### Setup and deployment

```bash
# from the repo root
npm install
forge login
forge register   # select Confluence
forge lint
forge deploy -e production
# if prompted about new scopes
forge install --upgrade -e production
```

Usage: On a Confluence page, open Rovo and run “Label the next 20 feedback rows on this page”, or use the content byline “Label next 20 rows”.

---

#### Configuration

- batchSize: Action input for get-next-rows (max 20).
- Taxonomy: Defined in the agent prompt in manifest.yml.
- Overwrite behavior: Only fills empty Theme/Impact cells; never overwrites.

---

#### Logging

- Structured JSON logs are printed to stdout and visible via `forge logs`.
- No persistent storage is used for logs in the current version.

---

#### Extensibility

- To change the taxonomy, edit the prompt in manifest.yml and (optionally) the constants in code.
- To alter batch size limits, change the `Math.min(..., 20)` logic in `src/index.js`.

---

Last updated — 4 Sep 2025

