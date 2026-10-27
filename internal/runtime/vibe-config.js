'use strict';

// Vibe 3.0.0's effective configuration as export.json records it, classified key by key from the 3.0.0 configuration schema.
// COMPARED_DEFAULTS holds each compared key's built-in default as recorded (the launcher's own values replace some of them, in
// vibe.js); ALLOWLISTED_KEYS are keys that cannot change the reviewer's instructions, tools, agents, prompts, model or endpoint,
// whatever their value: terminal-interface, operational and logging keys, and catalog and provider entries other than the active
// model's. models and providers are compared per entry. disabled_tools records the two tools Vibe's headless client disables
// on every run.

const COMPARED_DEFAULTS = Object.freeze({
  "active_model": "",
  "routed_default_model": "",
  "routed_model_config": null,
  "catalog_model_aliases": {},
  "catalog_recommended_model": "",
  "routed_extra_models": [],
  "allowed_models": [],
  "compaction_model": null,
  "vision_model": null,
  "utility_models": {
    "title": "",
    "smart_approve": ""
  },
  "tools": {},
  "tool_paths": [],
  "enabled_tools": [],
  "disabled_tools": [
    "ask_user_question",
    "cron"
  ],
  "mcp_servers": [],
  "enable_connectors": true,
  "enable_mcp": true,
  "experimental_enable_document_library_connector": false,
  "connectors": [],
  "agent_paths": [],
  "enabled_agents": [],
  "disabled_agents": [],
  "installed_agents": [],
  "default_agent": "accept-edits",
  "smart_approve_available": false,
  "smart_approve_default": false,
  "skill_paths": [],
  "enabled_skills": [],
  "disabled_skills": [],
  "experimental_enable_registry_skills": false,
  "experimental_enable_model_catalog": false,
  "console_base_url": "https://console.mistral.ai",
  "bypass_tool_permissions": false,
  "enable_telemetry": true,
  "system_prompt_id": "cli",
  "managed_shell_tools_enabled": false,
  "enable_background_processes": true,
  "enable_subagents": true,
  "compaction_prompt_id": "compact",
  "title_prompt_id": "session_title",
  "include_commit_signature": true,
  "include_model_info": true,
  "include_project_context": true,
  "include_prompt_detail": true,
  "enable_system_trust_store": false,
  "vibe_base_url": "https://chat.mistral.ai",
  "vibe_code_sessions_base_url": "https://chat.mistral.ai",
  "project_context": {
    "default_commit_count": 5,
    "timeout_seconds": 2
  },
  "experiments": {
    "enable": true,
    "api_host": "https://experiments.mistral.services/",
    "client_key": "sdk-OE8yJgTXZY6tj"
  }
});

const ALLOWLISTED_KEYS = Object.freeze(["auto_compact_threshold","active_transcribe_model","transcribe_providers","transcribe_models","active_tts_model","tts_providers","tts_models","enable_otel","otel_endpoint","otel_redaction","theme","applied_migrations","disable_welcome_banner_animation","cursor_blink","show_greeting","autocopy_to_clipboard","file_watcher_for_autocomplete","ask_confirmation_on_exit","displayed_workdir","context_warnings","voice_mode_enabled","narrator_enabled","show_thinking_nodes","show_subagent_status_list","worktree_limit","raise_on_compaction_failure","enable_update_checks","enable_auto_update","enable_notifications","experimental_enable_tab_status","api_timeout","api_retry_max_elapsed_time","api_stream_idle_timeout","api_connect_timeout","api_write_timeout","api_pool_timeout","log_level","session_logging"]);

// Keys compared per entry: the active model's entry in models and its provider's entry in providers.
const PER_ENTRY_KEYS = Object.freeze(['models', 'providers']);

// The subkeys of the active model's entry that are compared. Its display name, prices and auto-compact threshold, which Vibe copies
// from an operational top-level setting into every entry, are not.
const MODEL_ENTRY_COMPARED = Object.freeze(['name', 'provider', 'alias', 'thinking', 'thinking_levels', 'temperature', 'top_p', 'max_output_tokens', 'supports_images', 'max_context_length']);
const MODEL_ENTRY_ALLOWLISTED = Object.freeze(['display_name', 'input_price', 'output_price', 'cached_input_price', 'auto_compact_threshold']);

// Built-in provider entries, keyed by provider name; the active model's provider entry is compared subkey by subkey.
const PROVIDER_DEFAULTS = Object.freeze({ mistral: Object.freeze({
  "name": "mistral",
  "api_base": "https://api.mistral.ai/v1",
  "api_key_env_var": "MISTRAL_API_KEY",
  "browser_auth_base_url": "https://console.mistral.ai",
  "browser_auth_api_base_url": "https://console.mistral.ai/api",
  "browser_auth_allow_origin_rewrite": false,
  "api_style": "openai",
  "backend": "mistral",
  "reasoning_field_name": "reasoning_content",
  "emits_finish_reason": true,
  "project_id": "",
  "region": "",
  "extra_headers": {}
}) });

module.exports = { ALLOWLISTED_KEYS, COMPARED_DEFAULTS, MODEL_ENTRY_ALLOWLISTED, MODEL_ENTRY_COMPARED, PER_ENTRY_KEYS, PROVIDER_DEFAULTS };
