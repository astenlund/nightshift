---
name: marketplace-installation-surface
description: Explore an explicit, tested policy for which Nightshift repository paths ship in marketplace installations
metadata:
  type: feature
status: exploring
---

# Marketplace installation surface

Define which Nightshift files and directories are included when the plugin is installed from a marketplace. The current package includes repository-maintenance data such as backlog files under `.claude/`, even though installed users need only the runtime plugin surface and intentionally bundled resources.

The design must establish one authoritative package-surface policy, make exclusions and required runtime assets mechanically testable, and ensure Claude Code and Codex marketplace installations receive equivalent usable content. It must distinguish source-repository maintenance files, development-only tests and fixtures, public documentation, plugin metadata, public skills, internal runtime modules, hooks, and skill-owned assets without accidentally removing resources resolved through `${CLAUDE_PLUGIN_ROOT}`.

Open questions for graduation: whether the marketplace supports a native inclusion manifest or requires repository layout or release packaging, whether the policy is an allowlist or denylist, which documentation should remain available in installed packages, and how release tests compare the declared surface with the actual installed artifact on every supported host.

Captured 2026-09-02 during the implementation-scratch-isolation handover after observing backlog files in the installed marketplace package.
