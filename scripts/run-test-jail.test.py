#!/usr/bin/env python3
"""Tests for scripts/run-test-jail.sh.

The jail is a static wrapper: it resolves Podman, refuses to run from a
main/master checkout unless ALLOW_MAIN_TESTS=1, then execs a rootless
container that mounts only the active worktree with the network off. Most
assertions therefore read the script text; the guard and argument forwarding
are exercised against a fake ``podman`` so no real container is launched.
"""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "run-test-jail.sh"
SCRATCH = ROOT / ".tmp"


def git(cwd, *args):
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=test-jail",
            "-c",
            "user.email=test-jail@test.invalid",
            *args,
        ],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )


def make_repo(base, branch):
    """A throwaway git repo checked out to *branch* (created if absent)."""
    repo = base / f"repo-{branch}"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    (repo / "seed.txt").write_text("seed\n", encoding="utf-8")
    git(repo, "add", "seed.txt")
    git(repo, "commit", "-q", "-m", "seed")
    if branch != "main":
        git(repo, "checkout", "-q", "-b", branch)
    return repo


def fake_podman(base):
    """A PATH stub that records the argv it was handed."""
    bin_dir = base / "fakebin"
    bin_dir.mkdir()
    args_file = base / "podman-args.txt"
    stub = bin_dir / "podman"
    stub.write_text(
        f'#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "{args_file}"\n',
        encoding="utf-8",
    )
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
    return bin_dir, args_file


def hermetic_copy(base):
    """Copy of the script whose /opt Podman pin falls back to $PATH.

    The production script prefers /opt/podman/current/bin/podman when it is
    executable; that absolute binary cannot be stubbed, so the copy neuters
    the pin to let the fake ``podman`` on PATH be observed. The real script's
    pin is covered by the static test below.
    """
    copy = base / "run-test-jail.sh"
    text = SCRIPT.read_text(encoding="utf-8").replace(
        "/opt/podman/current/bin/podman", "/nonexistent-podman-pin-for-tests"
    )
    copy.write_text(text, encoding="utf-8")
    return copy


class RunTestJailStaticTests(unittest.TestCase):
    def setUp(self):
        self.source = SCRIPT.read_text(encoding="utf-8")

    def test_script_is_executable(self):
        self.assertTrue(SCRIPT.is_file())
        self.assertTrue(os.access(SCRIPT, os.X_OK))

    def test_uses_strict_shell_mode(self):
        self.assertIn("set -euo pipefail", self.source)

    def test_prefers_bundled_podman_with_path_fallback(self):
        self.assertIn("/opt/podman/current/bin/podman", self.source)
        self.assertIn('PODMAN="podman"', self.source)

    def test_resolves_worktree_and_branch_from_git(self):
        self.assertIn("git rev-parse --show-toplevel", self.source)
        self.assertIn("|| pwd", self.source)
        self.assertIn("git rev-parse --abbrev-ref HEAD", self.source)

    def test_refuses_main_and_master(self):
        self.assertIn('"$CURRENT_BRANCH" == "main"', self.source)
        self.assertIn('"$CURRENT_BRANCH" == "master"', self.source)

    def test_allow_main_tests_is_the_opt_in(self):
        self.assertIn("ALLOW_MAIN_TESTS", self.source)
        self.assertIn('"${ALLOW_MAIN_TESTS:-0}" != "1"', self.source)

    def test_network_is_disabled(self):
        self.assertIn("--network none", self.source)

    def test_mounts_only_the_worktree(self):
        self.assertIn('--volume "$WORKTREE_DIR:/workspace:rw"', self.source)
        volume_lines = [
            line for line in self.source.splitlines() if "--volume" in line
        ]
        self.assertEqual(len(volume_lines), 1)
        self.assertNotIn(".paseo", volume_lines[0])
        self.assertNotIn(".config", volume_lines[0])

    def test_workdir_is_workspace(self):
        self.assertIn("--workdir /workspace", self.source)

    def test_ephemeral_home_and_test_env(self):
        self.assertIn("--env HOME=/tmp", self.source)
        self.assertIn("--env NODE_ENV=test", self.source)

    def test_default_image_and_override(self):
        self.assertIn("TEST_CONTAINER_IMAGE", self.source)
        self.assertIn("docker.io/library/node:22-bookworm-slim", self.source)

    def test_forwards_caller_arguments(self):
        self.assertIn('"$@"', self.source)


class RunTestJailBehaviourTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(exist_ok=True)
        self.base = Path(
            tempfile.mkdtemp(prefix="run-test-jail-", dir=str(SCRATCH))
        ).resolve()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def run_script(self, script, cwd, extra_env=None, args=()):
        bin_dir, args_file = fake_podman(self.base)
        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
        env["ARGS_FILE"] = str(args_file)
        env.pop("ALLOW_MAIN_TESTS", None)
        if extra_env:
            env.update(extra_env)
        result = subprocess.run(
            ["bash", str(script), *args],
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
        )
        return result, args_file

    def test_main_checkout_refused(self):
        repo = make_repo(self.base, "main")
        result, args_file = self.run_script(SCRIPT, repo, args=("true",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to run tests", result.stderr)
        self.assertIn("ALLOW_MAIN_TESTS=1", result.stderr)
        self.assertFalse(args_file.exists(), "podman ran despite main refusal")

    def test_master_checkout_refused(self):
        repo = make_repo(self.base, "master")
        result, args_file = self.run_script(SCRIPT, repo, args=("true",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to run tests", result.stderr)
        self.assertFalse(args_file.exists(), "podman ran despite master refusal")

    def test_allow_main_tests_bypasses_and_forwards(self):
        repo = make_repo(self.base, "main")
        script = hermetic_copy(self.base)
        result, args_file = self.run_script(
            script,
            repo,
            extra_env={"ALLOW_MAIN_TESTS": "1"},
            args=("python3", "-m", "unittest"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        recorded = args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(recorded[0], "run")
        self.assertIn("--rm", recorded)
        self.assertIn("--network", recorded)
        self.assertEqual(recorded[recorded.index("--network") + 1], "none")
        self.assertIn("--volume", recorded)
        self.assertEqual(
            recorded[recorded.index("--volume") + 1],
            f"{repo}:/workspace:rw",
        )
        self.assertIn("--env", recorded)
        self.assertIn("HOME=/tmp", recorded)
        self.assertIn("NODE_ENV=test", recorded)
        self.assertEqual(recorded[-3:], ["python3", "-m", "unittest"])

    def test_feature_branch_runs_in_jail(self):
        repo = make_repo(self.base, "feat-jail")
        script = hermetic_copy(self.base)
        result, args_file = self.run_script(script, repo, args=("true",))
        self.assertEqual(result.returncode, 0, result.stderr)
        recorded = args_file.read_text(encoding="utf-8").splitlines()
        self.assertIn(f"{repo}:/workspace:rw", recorded)
        self.assertEqual(recorded[-1], "true")


if __name__ == "__main__":
    unittest.main(verbosity=2)
