---
name: ready
description: "Use to inspect dependency-resolved ready work in a project with the .nightshift four-index backlog; selection does not authorize implementation."
---

# Ready work

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Run the bound launcher with entry `ready` and the absolute project root. It returns ready, blocked, external and exploring work plus structural errors and notices. Report parser failures as failures, not an empty or clean backlog.

Present the ready set with concise context and dependencies. Keep blocked/external work distinguishable and Exploring drafts out of the ready set. Inspect linked source entries when recommending priorities, using the user goals and the invariant order of autonomy, quality and efficiency. Number the ready set continuously and cite those numbers in the recommendations rather than numbering the recommendations separately, so a bare numeric reply selects one item unambiguously. Readiness does not authorize implementation: do not implement a recommendation on your own. Close the report by asking which items the user wants to take on, as a colleague's offer. Selecting items starts interactive investigation and readback, and the user decides separately when to hand over. This constraint is guidance for you and not for the user.

Present every Exploring entry in a separate list after the ready set, including when no work is ready. Give each draft its title as a clickable Markdown link to its source and concise context from the parser or linked record; a count alone does not surface the drafts. Resolve relative record links against the containing index directory, normally the actual project's .nightshift directory, and preserve absolute links. When no record link exists, link to the actual containing index file in that directory. Use forward slashes in local Markdown link targets and wrap targets containing spaces in angle brackets. Use bullets for Exploring so the ready selection numbers remain unambiguous. Omit the Exploring list only when the parser returns none. Report blocked and external entries separately with their blockers so the report accounts for all returned work.

After a backlog edit, run this actual parser again to verify its grammar and dependency references. This skill is read-only unless the user separately authorizes an edit.
