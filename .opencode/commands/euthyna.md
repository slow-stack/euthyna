---
description: Run the euthyna code security audit CLI
---
If the arguments match a mode word in the euthyna skill’s "Modes (slash commands)" table,
translate them per that table and run the mapped command; the table is maintained in the
skill, not here. Otherwise run the CLI with the arguments as given:

    euthyna $ARGUMENTS

If `euthyna` is not installed, use `npx -y euthyna $ARGUMENTS` instead. Quote the command's output verbatim, exit code included — never estimate or re-derive numbers. If the euthyna skill is installed (`.agents/skills/euthyna/` or `~/.agents/skills/euthyna/`), read its SKILL.md and interpret the output under the six-gate adjudication format; claims without evidence are downgraded to observations.
