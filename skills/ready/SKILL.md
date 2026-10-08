---
name: ready
description: "Use to inspect dependency-resolved ready work in a project with the .nightshift four-index backlog; selection does not authorize implementation."
---

# Ready work

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Run the bound launcher with entry `ready` and the absolute project root. It returns ready, blocked, external and exploring work plus structural errors and notices. Report parser failures as failures, not an empty or clean backlog.

Present the ready set with concise context and dependencies. Keep blocked/external work distinguishable and Exploring drafts out of the ready set. Number the ready set continuously. When work is ready, the report always includes a recommendation: inspect the linked source entries and recommend a small selection grounded in the user's goals and the invariant priorities of reliability, through autonomy and trust, before efficiency, with a brief reason for each choice. Cite the ready-set numbers rather than numbering the recommendations separately, so a bare numeric reply selects one item unambiguously. When no work is ready, say so plainly and recommend nothing. Close the report by asking which items the user wants to take on, as a colleague's offer.

Explain before selection that choosing ready work requests Nightshift delivery after investigation and scope confirmation. Readiness and recommendations do not authorize implementation. A reply naming items selects them and preserves handover intent; it creates no run. A reply expressing intent without specific items needs a concrete proposed selection and confirmation. Investigate the selected work and present its readback or governing spec with a plain question asking whether to begin. Only a yes to that question confirms implementation scope. Once scope and any required spec assessment are resolved, invoke [handover](../handover/SKILL.md) in this session without another handover question or request, record acceptance and visibly say that the user can leave. An explicit pause keeps the selection pending; an explicit request for direct work cancels pending handover and creates no run. Recover selection and agreement from actual evidence after compaction; missing provenance is a question, not inferred authority. These constraints guide the agent, not the wording of the ready list.

Present every Exploring entry in a separate list after the ready set, including when no work is ready. Give each draft its title as a clickable Markdown link to its source and concise context from the parser or linked record; a count alone does not surface the drafts. Resolve relative record links against the containing index directory, normally the actual project's .nightshift directory, and preserve absolute links. When no record link exists, link to the actual containing index file in that directory. Use forward slashes in local Markdown link targets and wrap targets containing spaces in angle brackets. Use bullets for Exploring so the ready selection numbers remain unambiguous. Omit the Exploring list only when the parser returns none. Report blocked and external entries separately with their blockers so the report accounts for all returned work.

After a backlog edit, run this actual parser again to verify its grammar and dependency references. This skill is read-only unless the user separately authorizes an edit.
