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

    def test_context_and_env_fallbacks(self):
        command = '''
XP_RUNNER_HOST="${XP_RUNNER_HOST:-${FORGEJO_VARS_RUNNER_HOST:-${FORGEJO_ENV_RUNNER_HOST:-}}}"
runner_host="${XP_RUNNER_HOST:-<unset>}"
printf %s "$runner_host"
'''
        for env_dict, expected in [
            ({"XP_RUNNER_HOST": "host-env"}, "host-env"),
            ({"FORGEJO_VARS_RUNNER_HOST": "var-host"}, "var-host"),
            ({"FORGEJO_ENV_RUNNER_HOST": "context-env-host"}, "context-env-host"),
            ({}, "<unset>"),
        ]:
            res = subprocess.run(["sh", "-ceu", command], env=env_dict, check=True, capture_output=True, text=True)
            self.assertEqual(res.stdout, expected)

    def test_every_shared_job_reports_and_summarizes_the_host(self):
        for workflow in WORKFLOWS:
            contents = workflow.read_text(encoding="utf-8")
            with self.subTest(workflow=workflow.name):
                self.assertIn(DIAGNOSTIC, contents)
                self.assertIn("Runner OS: %s\\nRunner architecture: %s\\nRunner host: %s\\n", contents)
                self.assertIn("GITHUB_STEP_SUMMARY", contents)

    def test_always_first_step_and_runs_always(self):
        import yaml
        for workflow in WORKFLOWS:
            data = yaml.safe_load(workflow.read_text(encoding="utf-8"))
            for job_name, job in data.get("jobs", {}).items():
                steps = job.get("steps", [])
                with self.subTest(workflow=workflow.name, job=job_name):
                    self.assertTrue(len(steps) > 0, f"job {job_name} has no steps")
                    first_step = steps[0]
                    self.assertEqual(first_step.get("name"), "Report runner diagnostics")
                    self.assertEqual(first_step.get("if"), "always()")


if __name__ == "__main__":
    unittest.main()
