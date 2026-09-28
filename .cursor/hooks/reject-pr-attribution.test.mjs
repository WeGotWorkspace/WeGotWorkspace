import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = join(dirname(fileURLToPath(import.meta.url)), "reject-pr-attribution.mjs");

function decide(command) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ command }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).permission;
}

test("allows --draft before the body", () => {
  assert.equal(
    decide('gh pr create --draft --title x --body "hello"'),
    "allow",
  );
});

test("allows --draft after a heredoc body", () => {
  const command = `gh pr create --title x --body "$(cat <<'EOF'
Summary line
second line mentions -d flag
EOF
)" --draft`;
  assert.equal(decide(command), "allow");
});

test("denies gh pr create without a draft flag", () => {
  assert.equal(decide('gh pr create --title x --body "hello"'), "deny");
});

test("denies when -d appears only inside a heredoc body", () => {
  const command = `gh pr create --title x --body-file - <<EOF
Summary line
second line mentions -d flag
EOF`;
  assert.equal(decide(command), "deny");
});

test("allows --draft=true", () => {
  assert.equal(
    decide('gh pr create --draft=true --title x --body "hello"'),
    "allow",
  );
});
