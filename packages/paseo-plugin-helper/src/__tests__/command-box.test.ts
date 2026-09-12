import { describe, it, expect } from "vitest";
import React from "react";
import {
  CommandBox,
  formatCommandLine,
  type CommandBoxProps,
} from "../client/components/CommandBox.js";

describe("CommandBox component", () => {
  it("is exported as a function", () => {
    expect(typeof CommandBox).toBe("function");
  });

  it("formats command lines quoting arguments with spaces", () => {
    expect(formatCommandLine(["git", "status"])).toBe("git status");
    expect(formatCommandLine(["git", "commit", "-m", "hello world"])).toBe(
      'git commit -m "hello world"'
    );
    expect(formatCommandLine(["npm", "run", "build:all", "--flag"])).toBe(
      "npm run build:all --flag"
    );
  });

  it("handles empty argv gracefully", () => {
    expect(formatCommandLine([])).toBe("");
  });

  it("creates element with expected props", () => {
    const el = React.createElement(CommandBox, {
      argv: ["npm", "test"],
      command: "npm test --all",
      copyLabel: "Copy test command",
    });
    expect(el.props.argv).toEqual(["npm", "test"]);
    expect(el.props.command).toBe("npm test --all");
    expect(el.props.copyLabel).toBe("Copy test command");
  });
});
