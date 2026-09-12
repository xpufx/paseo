# AGENTS.md

Do not pre-load all skills on workspace entry. Skills under `.agents/skills/` are loaded lazily: read the SKILL.md whose task matches the current work (coding-agent for Forgejo issue work, orchestrator for fleet coordination, create-plugin for new plugins, audit-plugin for refactors), and ignore the rest.
