#!/usr/bin/env python3
"""Contract tests for runner-host diagnostics embedded in Paseo CI workflows."""
import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = (
    ROOT / ".forgejo/workflows/install-smoke.yml",
    ROOT / ".forgejo/workflows/issue-label-triage.yml",
    ROOT / ".forgejo/workflows/npm-stage.yml",
)
DIAGNOSTIC = 'runner_host="${XP_RUNNER_HOST:-<unset>}"'


class RunnerHostDiagnosticsTests(unittest.TestCase):
    def test_configured_and_unset_values(self):
        command = 'runner_host="${XP_RUNNER_HOST:-<unset>}"; printf %s "$runner_host"'
        configured = subprocess.run(
            ["sh", "-ceu", command], env={**os.environ, "XP_RUNNER_HOST": "builder-west-01"},
            check=True, capture_output=True, text=True,
        )
        unset = subprocess.run(
            ["sh", "-ceu", command], env={key: value for key, value in os.environ.items() if key != "XP_RUNNER_HOST"},
            check=True, capture_output=True, text=True,
        )
        self.assertEqual(configured.stdout, "builder-west-01")
        self.assertEqual(unset.stdout, "<unset>")

    def test_every_shared_job_reports_and_summarizes_the_host(self):
        for workflow in WORKFLOWS:
            contents = workflow.read_text(encoding="utf-8")
            with self.subTest(workflow=workflow.name):
                self.assertIn(DIAGNOSTIC, contents)
                self.assertIn("Runner OS: %s\\nRunner architecture: %s\\nRunner host: %s\\n", contents)
                self.assertIn("GITHUB_STEP_SUMMARY", contents)


if __name__ == "__main__":
    unittest.main()
