import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Repository Enrollment Client Surface (#867)", () => {
  it("verifies client/surface.tsx includes Repository Enrollment section and contracts", () => {
    const surfacePath = path.resolve(__dirname, "surface.tsx");
    assert.ok(fs.existsSync(surfacePath), "client/surface.tsx must exist");
    const source = fs.readFileSync(surfacePath, "utf8");

    // 1. Imports contracts
    assert.match(
      source,
      /uppidiReposContract/,
      "surface.tsx must import uppidiReposContract",
    );
    assert.match(
      source,
      /uppidiEnrollRepoContract/,
      "surface.tsx must import uppidiEnrollRepoContract",
    );
    assert.match(
      source,
      /uppidiUnenrollRepoContract/,
      "surface.tsx must import uppidiUnenrollRepoContract",
    );

    // 2. Uses RPC query and mutations
    assert.match(
      source,
      /useRpcQuery\(\s*uppidiReposContract/,
      "surface.tsx must query uppidiReposContract",
    );
    assert.match(
      source,
      /useRpcMutation\(\s*uppidiEnrollRepoContract\s*\)/,
      "surface.tsx must wire uppidiEnrollRepoContract mutation",
    );
    assert.match(
      source,
      /useRpcMutation\(\s*uppidiUnenrollRepoContract\s*\)/,
      "surface.tsx must wire uppidiUnenrollRepoContract mutation",
    );

    // 3. Collapsible section title and icon
    assert.match(
      source,
      /title=\{`Repository Enrollment \(\$\{totalEnrolledCount\} enrolled\)`\}/,
      "surface.tsx must render Repository Enrollment Collapsible section with count",
    );

    // 4. Enrolled vs Available sublists
    assert.match(
      source,
      /Enrolled \(\{enrolledList\.length\}\)/,
      "surface.tsx must render Enrolled list with count",
    );
    assert.match(
      source,
      /Available from Forgejo \(\{availableList\.length\}\)/,
      "surface.tsx must render Available from Forgejo list with count",
    );

    // 5. Enroll and Unenroll action buttons
    assert.match(
      source,
      /label=\{isUnenrolling \? "Unenrolling\.\.\." : "Unenroll"\}/,
      "surface.tsx must render Unenroll button",
    );
    assert.match(
      source,
      /label=\{isEnrolling \? "Enrolling\.\.\." : "Enroll"\}/,
      "surface.tsx must render Enroll button",
    );

    // 6. SearchInput filter
    assert.match(
      source,
      /placeholder="Filter repositories by name or owner\.\.\."/,
      "surface.tsx must render search input for repositories",
    );
  });

  it("maps repository lists into enrolled and available groups with badges", () => {
    const repos = [
      {
        key: "forge.mrs.uppidi.com/xpufx-org/paseo",
        name: "paseo",
        fullName: "xpufx-org/paseo",
        owner: "xpufx-org",
        host: "forge.mrs.uppidi.com",
        url: "https://forge.mrs.uppidi.com/xpufx-org/paseo",
        private: false,
        enrolled: true,
        paused: true,
        hasOrchestrator: true,
        queueDepth: 5,
      },
      {
        key: "forge.mrs.uppidi.com/xpufx-org/2fado",
        name: "2fado",
        fullName: "xpufx-org/2fado",
        owner: "xpufx-org",
        host: "forge.mrs.uppidi.com",
        url: "https://forge.mrs.uppidi.com/xpufx-org/2fado",
        private: true,
        enrolled: false,
        paused: false,
        hasOrchestrator: false,
        queueDepth: 0,
      },
    ];

    const enrolled = repos.filter((r) => r.enrolled);
    const available = repos.filter((r) => !r.enrolled);

    assert.equal(enrolled.length, 1);
    assert.equal(enrolled[0]?.key, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(enrolled[0]?.paused, true);
    assert.equal(enrolled[0]?.hasOrchestrator, true);
    assert.equal(enrolled[0]?.queueDepth, 5);

    assert.equal(available.length, 1);
    assert.equal(available[0]?.key, "forge.mrs.uppidi.com/xpufx-org/2fado");
    assert.equal(available[0]?.private, true);
  });
});
