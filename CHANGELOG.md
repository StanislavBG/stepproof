# Changelog

All notable changes to stepproof are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [Semantic Versioning](https://semver.org/).

---

## [0.2.20] — 2026-03-22

### Changed
- **Upgrade CTA copy rewritten** — hard gate now reads "You've used your 3 free checks today. Upgrade to Stepproof Pro for unlimited daily checks" with correct Stepproof-specific Stripe URL (`3cIbJ3fA8am122VcwE8k804`)
- Free limit enforcement switched from 50/month suite-wide to **3/day per-tool** — more intuitive for solo developers, resets at midnight UTC
- Daily counter (`day_total`) added to shared usage schema; backward-compatible (missing field defaults to 0)
- Removed incorrect "Team · $49/mo" messaging — Stepproof standalone is **$19/mo**

### Fixed
- Stripe upgrade URL was pointing to agent-comply checkout page — now correctly targets Stepproof Pro product

---

## [0.2.1] — 2026-03-19

### Fixed
- Exit codes normalized: `stepproof` with no args exits 0 (not 1). Unknown commands exit 2.
- Dynamic version injection in terminal reporter — `--version` now reflects package.json, not hardcoded string.
- `@bilkobibitkov/preflight-license` dependency corrected (was `@preflight/license` — registry conflict).

### Changed
- `--help` output improved with concrete examples for every command.

### Added
- Edge-case tests for parser and variable substitution.
- CONTRIBUTING.md with full dev setup guide.

---

## [0.2.0] — 2026-02-28

### Added
- `stepproof init` command — scaffolds `first-test.yaml` for new users (zero-config onboarding).
- `--output <file>` flag on `run` command — exports results in SARIF or JUnit XML format (CI system integration).
- `--help` examples on root command and all subcommands.
- LICENSE file (MIT).

### Fixed
- `stepproof run` with file: path dependencies — resolved against registry instead.
- Exit code on scanner false negative when scenario file path doesn't exist.

### Changed
- DX audit pass: error messages now include the failing assertion type and line number.

---

## [0.1.0] — 2026-01-15

### Added
- Initial release.
- YAML-based scenario runner for AI agent behavioral regression testing.
- `run` command with terminal reporter and exit codes for CI.
- `report` command for post-run artifact generation.
- Assertion types: `contains`, `not_contains`, `matches`, `equals`, `json_path`.
- Variable substitution in scenarios (`{{var}}`).
- Multi-step chain support with output piping between steps.
- Preflight License integration for Team/Enterprise feature gates.

---

## Links
- npm: `npm install stepproof`
- GitHub: [StanislavBG/stepproof](https://github.com/StanislavBG/stepproof)
- Suite: [Preflight](https://github.com/StanislavBG/agent-gate) — stepproof + agent-comply + agent-gate
