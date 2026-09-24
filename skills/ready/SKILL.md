---
name: ready
description: "Use to inspect dependency-resolved ready work in a project with the .nightshift four-index backlog; selection does not authorize implementation."
---

# Ready work

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Run the bound launcher with entry `ready` and the absolute project root. It returns ready, blocked, external and exploring work plus structural errors and notices. Report parser failures as failures, not an empty or clean backlog.

Present the ready set with concise context and dependencies. Keep blocked/external work distinguishable and Exploring drafts out of the ready set. Number the ready set continuously. When work is ready, the report always includes a recommendation: inspect the linked source entries and recommend a small selection grounded in the user's goals and the invariant order of autonomy, quality and efficiency, with a brief reason for each choice. Cite the ready-set numbers rather than numbering the recommendations separately, so a bare numeric reply selects one item unambiguously. When no work is ready, say so plainly and recommend nothing. Close the report by asking which items the user wants to take on, as a colleague's offer.

Readiness and your own recommendation do not authorize implementation. A reply that names items selects them. A reply that expresses intent without identifying specific items is not a selection: propose a concrete selection by ready-set number and wait for the user to confirm it. A confirmed selection starts interactive investigation and a readback, and nothing is edited before the user agrees that readback. Once the readback is agreed, proceed with the agreed work in the current session. Do not ask whether to hand over, start a separate task or open a new conversation; the user directs handover or any other change of execution context. These constraints are guidance for you and not for the user.

Present every Exploring entry in a separate list after the ready set, including when no work is ready. Give each draft its title as a clickable Markdown link to its source and concise context from the parser or linked record; a count alone does not surface the drafts. Resolve relative record links against the containing index directory, normally the actual project's .nightshift directory, and preserve absolute links. When no record link exists, link to the actual containing index file in that directory. Use forward slashes in local Markdown link targets and wrap targets containing spaces in angle brackets. Use bullets for Exploring so the ready selection numbers remain unambiguous. Omit the Exploring list only when the parser returns none. Report blocked and external entries separately with their blockers so the report accounts for all returned work.

After a backlog edit, run this actual parser again to verify its grammar and dependency references. This skill is read-only unless the user separately authorizes an edit.
