### Feedback Classifier Rovo Agent

---

#### Overview

This Forge app adds a **Rovo Agent** to Confluence Cloud that automatically:

1. Detects the first Confluence table whose first-row headers include **Subject** & **Description**.
2. Collects up to **20 rows** where the **Theme** and **Impact** columns are empty.
3. Sends the row text to Atlassian Intelligence (built into Rovo) to classify:

   * **Theme:** *Feature Request · Integration · Bug · Query · Other*
   * **Impact:** *High (≥ 0.90) · Medium (≥ 0.75) · Low (≥ 0.50, default)*
4. Adds missing Theme/Impact columns (header + empty cells) if necessary.
5. Fills only the previously-empty Theme / Impact cells—existing data are never overwritten.

The app works natively on **atlas\_doc\_format (ADF)**, so it is future-proof and requires no HTML parsing libraries.

---

#### How it works

```
Rovo chat (user) ──▶ Agent prompt
                     │
                     │ calls
                     ▼
 Action GET  ──▶  extractFeedbackTable()
                     │  (reads page via REST v2, ADF)
                     │  └── returns rows + meta
                     ▼
      🧠 Atlassian Intelligence classifies rows
                     ▼
 Action UPDATE ──▶  applyFeedbackLabels()
                     │  (adds cols if missing, writes labels, PUT page)
                     ▼
      Confluence page updated, logs stored (storage:app)
```

---

#### File list

| File / folder    | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| **manifest.yml** | Rovo agent definition, two action modules, required scopes       |
| **src/index.js** | Server code – ADF traversal, Confluence REST v2 helpers, logging |
| **README.md**    | This file                                                        |

---

#### Scopes required

```yaml
permissions:
  scopes:
    - read:page:confluence   # GET page (atlas_doc_format)
    - write:page:confluence  # PUT page
    - read:chat:rovo         # expose agent & actions in Rovo chat
    - storage:app            # persistent failure-log records
```

No `external.fetch` block is needed—only product APIs are used.

---

#### Prerequisites

* Node 22.x (managed by Forge runtime)
* Forge CLI ≥ 9 (`npm i -g @forge/cli`)
* A Confluence Cloud site where you have *Admin* rights
* An Atlassian account with Rovo enabled (beta / GA)

---

#### Setup & deployment

```bash
# clone or copy the project
cd feedback-label-agent

# install dependencies (none beyond the Forge runtime)
npm install

# login & register
forge login
forge register  # choose Confluence

# lint & deploy
forge lint
forge deploy --environment production
```

> **Runtime limits:** Node 22, memory 128 MB, timeout 25 s.

After deployment the agent **Customer Feedback Classifier** appears in the Rovo sidebar whenever you open a Confluence page. Select it and choose **“Classify feedback on this page”** or **“Label first 20 empty rows.”**

---

#### Configuration knobs

| Setting           | Location        | Default   | Notes                                        |
| ----------------- | --------------- | --------- | -------------------------------------------- |
| `rowsLimit`       | Action input    | 20        | Pass a smaller number in the chat if needed. |
| Impact thresholds | Agent prompt    | see above | Edit manifest prompt to change.              |
| Log retention     | `logCritical()` | unlimited | Add TTL purge if storage quota matters.      |

---

#### Logging & troubleshooting

* Each invocation gets a **correlationId** (`crypto.randomUUID()`), written to the Forge function log and to `@forge/storage`.
* Failure events: `extract_fail`, `update_fail`, etc.
* Purge or compress logs periodically if you process thousands of pages.

---

#### Extending the app

* **Custom taxonomies** – Adjust `THEME_SET` / `IMPACT_SET` in `index.js` and edit the prompt.
* **Process more rows** – Raise `ROW_LIMIT_MAX`, mindful of execution time.
* **Dry‑run mode** – Add an additional action that returns a diff instead of writing.

---

#### Security notes

* No PII stored; only the feedback text sent to Atlassian Intelligence.
* The app never overwrites existing data.
* All calls stay within the Atlassian cloud – no outbound fetch scopes required.

---

*Last updated — 1 Aug 2025*
