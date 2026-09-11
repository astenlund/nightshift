---
name: init-backlog
description: "Use when the user requests Nightshift project setup or migration to the .nightshift four-index backlog, including safe partial and interrupted reruns."
---

# Initialize or migrate Nightshift

Use the bundled init-backlog.js with the absolute project root. Inspect existing .claude and .nightshift content, host configuration, tracking/ignore choices, unfinished runs and writers before applying. The deterministic setup preserves source content and staged/working differences, relocates Nightshift-owned files to .nightshift, repairs navigable references, and validates the result with the actual ready parser.

Run inspect first and review the concrete migration inventory, then apply the authorized setup. Reconcile conflicts rather than overwriting destinations or uncertain ownership. Stop/pause and reconcile the owning run and every worker before migrating unfinished work. Safe reruns recover from the saved journal. A failed operation is incomplete; preserve the journal and diagnose the named cause before retrying.

Preserve host-owned configuration and existing plans. Retiring plan generation does not authorize deleting plans. New run records are ignored by default; retain explicit existing tracking choices. Root instruction changes beyond mechanical authorized references are concrete proposals requiring independent assessment and user approval. Bulk conversion of legacy guidance and general structural repair are outside the MVP; diagnose incompatibilities before handover and handle them as scoped work.

The optional third CLI argument is a JSON options file. Use ownership to map legacy project-relative files or directory prefixes to nightshift or preserve. Plans and specs need explicit ownership decisions; inspect lists undecided paths and apply refuses them. A narrower path decision overrides a containing directory decision. excludeReferences lists files or directory prefixes ending in / that must not be rewritten. historicalReferences uses the same shape for historical prose whose navigable Markdown links may move but inline code examples must remain unchanged. These choices are saved in the journal and reused on interrupted reruns; omitted options retain the saved policy.

On migration or reference drift, compare the named source, destination, staged blob and journal hashes. Preserve intentional edits before reconciling to the saved before/after state. Restoring known source bytes permits the original journal to resume. Do not delete the journal to bypass a conflict; a new migration decision needs explicit scoped reconciliation of both locations and the Git index.

For hard-wrap notices, run the bundled unwrap.js against the named backlog Markdown file, inspect the bounded paragraph-join diff, and run ready again. Initialization itself does not unwrap existing prose.

Inspect also reports referenceDecisions for source files mentioning the legacy home outside automatically supported document/configuration formats. Classify deliberate history with historicalReferences or excludeReferences. Select activeReferences only for concrete literal path consumers whose complete proposed edit is understood; computed paths need a scoped source repair before migration can complete. Markdown navigation is resolved from each document's old location to its new location, including reference definitions and links to preserved host configuration.

Migrated run state records a project-home-migrated transition, translates live spec, worker, probe and follow-up paths, and preserves original snapshots, native receipts and history. Existing assessments are not restamped as current; resume the normal spec and cumulative review gates against the relocated inputs. Interrupted reruns keep the same transition and original evidence.
