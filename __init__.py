"""The Hermes half of euthyna: in-session slash commands driving the CLI.

The CLI (``bin/euthyna.js``, installed by ``npm install -g euthyna``) produces
the deterministic facts; this plugin registers ``/euthyna`` so a user can invoke
the four CLI subcommands from inside a Hermes session without leaving chat. The
handler shells out to the real CLI and returns its output verbatim — it does not
reimplement any measurement, and it injects nothing into the conversation.

Like the DSH slash command, this runs without reaching the model: whatever the
CLI prints comes back as the command result.

@module euthyna_hermes
"""

import shutil
import subprocess

# Ponytail: one flat dict, not a command framework — there are exactly four
# subcommands and the CLI already owns usage/exit codes.
_USAGE = """euthyna slash command — usage:

  /euthyna history <path> [<path> <rev>...]   deleted-code provenance & security classification
  /euthyna coverage <path>                    symbol invocation counts from a coverage run
  /euthyna deps <path>                        dependency pinned versions from lockfiles
  /euthyna gate <report> [--verify]           validate an audit report against the six gates

Args after the subcommand are passed to the CLI unchanged. Requires the CLI:
npm install -g euthyna (Node >= 20)."""


def _find_cli():
    """Return the absolute path of the euthyna CLI, or None if not installed."""
    for name in ("euthyna", "euthyna.cmd", "euthyna.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _run(raw_args: str):
    """Handle /euthyna: forward <subcommand> <args...> to the CLI, return its output."""
    argv = raw_args.split()
    if not argv or argv[0] in ("help", "-h", "--help"):
        return _USAGE
    sub, rest = argv[0], argv[1:]
    if sub not in ("history", "coverage", "deps", "gate"):
        return f"unknown subcommand: {sub}\n\n{_USAGE}"

    cli = _find_cli()
    if cli is None:
        return ("euthyna CLI not found. Install it first:\n"
                "  npm install -g euthyna\n"
                f"then retry /euthyna {sub} …")

    # Text mode with explicit utf-8: the CLI reports are written in Chinese and
    # Windows decode would otherwise land on the system codepage.
    proc = subprocess.run(
        [cli, sub, *rest],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    # The CLI's exit-code contract (0/10/1/2) is part of the interface; keep it visible.
    header = f"[euthyna {sub} → exit {proc.returncode}]"
    return "\n".join(part for part in (header, out, err) if part)


def register(ctx):
    """Wire /euthyna into the session command registry."""
    ctx.register_command(
        "euthyna",
        handler=_run,
        description="euthyna security audit: run history/coverage/deps/gate fact producers",
        args_hint="<history|coverage|deps|gate> <args…>",
    )


if __name__ == "__main__":
    # Self-check, no Hermes needed: usage path, unknown-subcommand path, and a
    # real CLI run when euthyna is on PATH (skipped when it is not).
    result = _run("")
    assert result == _USAGE, "empty args must print usage"
    assert "unknown subcommand" in _run("bogus"), "unknown subcommand must be rejected"
    cli = _find_cli()
    if cli:
        probe = _run("deps .")
        assert probe.startswith("[euthyna deps"), f"unexpected probe output: {probe[:80]}"
    print("self-check ok", f"(cli={'found' if cli else 'absent'})")
