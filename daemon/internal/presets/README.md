# Presets

Factory presets live under `daemon/internal/presets/defaultcrew` and are embedded
into the daemon binary with `//go:embed defaultcrew`.

## Directory Layout

```text
defaultcrew/
  manifest.json
  agents/
    coding.md
    designer.md
    partner.md
    product.md
  skills/
    <agent-key>/
      <skill-key>/
        SKILL.md
        ...
```

`agents/*.md` files are copied into each seeded agent's instruction. Skill
directories are copied into user-owned skill records, preserving any files under
the skill directory.

## Manifest Format

`manifest.json` defines the preset crew:

```json
{
  "preset_id": "default-crew",
  "version": 1,
  "agents": [
    {
      "preset_key": "coding",
      "name": "Coding Agent",
      "instruction_file": "agents/coding.md",
      "is_default": false,
      "skill_refs": ["coding/test-driven-development"]
    }
  ]
}
```

Fields:

- `preset_id`: Stable preset family identifier. The current value is
  `default-crew`.
- `version`: Integer version for the embedded factory definition.
- `agents`: Ordered list of preset agents to seed or reset.
- `preset_key`: Stable agent key inside this preset. Idempotency and reset logic
  use this key, not the display name.
- `name`: Display name assigned when the agent is seeded or reset.
- `instruction_file`: Path under `defaultcrew/` to the agent instruction file.
- `is_default`: Marks the default starter agent for UI/API metadata.
- `skill_refs`: Paths under `defaultcrew/skills/`; each referenced directory
  must contain `SKILL.md`.

Do not add `runtime_id` or model fields to preset definitions. Runtime selection
happens at seed/reset time from the user's available runtimes.

## Validation Rules

`LoadDefaultCrewManifest()` fails startup/test validation when:

- `preset_id` is empty.
- `agents` is empty.
- An agent is missing `preset_key`, `name`, or `instruction_file`.
- `instruction_file` cannot be read.
- Any `skill_refs` entry does not contain a readable `SKILL.md`.

Run `go test ./...` from `daemon/` after changing preset files.
