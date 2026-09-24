Source: #590 (body-hash: d6550f9e)

# Line-coverage artifacts

Technical translation of Task #590. Reports are uploaded on `main`. Nothing fails because a percentage is too low.

## Goal

Upload a PHPUnit clover report and a Vitest v8 report for pushes to `main`, so dark spots are visible. The jobs do not set a coverage threshold.

## Non-goals

- An 80% gate or any failing percent threshold
- Adding tests only to move a number
- Storybook catalog coverage (`check:storybook-coverage`) or the Storybook browser Vitest project
- Slowing pull-request CI (the existing quality jobs stay without a coverage driver)

## Affected packages

- `.github/workflows/ci.yml` — `api-coverage` and `apps-coverage`, `push` to `main` only
- `packages/apps/scripts/run-jsdom.mjs` — per-shard coverage argv
- `packages/api/phpunit.xml` — existing `<source><include><directory>app</directory>` stays

## Technical constraints

- PHPUnit is invoked as `php vendor/bin/phpunit -c phpunit.xml --coverage-clover=...`, not through `composer test`.
- `setup-php` uses `coverage: pcov` on that job only.
- After the run, the job fails if the clover XML contains no `<file` element. That is a measurement check, not a percent threshold.
- `timeout-minutes: 45` and `concurrency` `cancel-in-progress: true` on each coverage job.
- Vitest `coverage.include` is `src/**`, so files that no test loaded still appear in the report. `coverage.exclude` drops `**/*.stories.*`, `**/stories/**`, and `**/mock/**` so Storybook stories, story fixtures, and mock trees are not reported as uncovered product code.
- Vitest unit and jsdom only. Each jsdom child gets `--coverage --reporter=blob --outputFile=.vitest-reports/blob-<shard>.json` and its own `--coverage.reportsDirectory` under `.coverage-shards/`. The uploaded artifact is the merged `coverage/` directory, not the shard temp dirs.
- `isDirectInvocation` compares `realpath` of the script and `argv[1]`. The unit project include already lists `scripts/**/*.test.mjs`, so the argv test runs in the normal unit suite.
- Merge with `vitest --merge-reports=.vitest-reports --coverage.enabled --coverage.reporter=lcov,json-summary` against `packages/apps/vitest.config.ts`. If unit and jsdom blobs do not merge, upload two reports.

## Edge cases

- A shard that exits 0 without writing its blob fails the jsdom run.
- Parallel children must not share a reports directory, or v8 wipes `.tmp` and the merged report only contains the last shard.
