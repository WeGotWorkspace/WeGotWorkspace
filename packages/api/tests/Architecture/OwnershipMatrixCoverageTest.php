<?php

declare(strict_types=1);

namespace Tests\Architecture;

use Tests\Support\Ownership\OwnershipRegistry;
use Tests\TestCase;

/**
 * Every REST operation and JMAP method declares ownership rows for a
 * signed-in actor, an exemption with a reason, or a pending entry for a named
 * plan chunk — exactly one.
 *
 * Spec: .agents/specs/000-ad-hoc-ownership-matrix/spec.md
 */
final class OwnershipMatrixCoverageTest extends TestCase
{
    public function test_every_operation_is_covered_exempt_or_pending(): void
    {
        $known = array_merge(
            array_keys(OwnershipRegistry::coveredOperations()),
            array_keys(OwnershipRegistry::exemptions()),
            array_keys(OwnershipRegistry::pending()),
        );

        $missing = array_values(array_diff(OwnershipRegistry::allOperations(), $known));

        $this->assertSame([], $missing, "Operations without ownership rows, exemption, or pending entry:\n".implode("\n", $missing));
    }

    public function test_declarations_name_existing_operations(): void
    {
        $all = OwnershipRegistry::allOperations();
        $stale = [];

        foreach (['covered' => OwnershipRegistry::coveredOperations(), 'exempt' => OwnershipRegistry::exemptions(), 'pending' => OwnershipRegistry::pending()] as $kind => $declared) {
            foreach (array_keys($declared) as $operation) {
                if (! in_array($operation, $all, true)) {
                    $stale[] = $kind.': '.$operation;
                }
            }
        }

        $this->assertSame([], $stale, "Declarations for operations that do not exist:\n".implode("\n", $stale));
    }

    public function test_no_operation_is_both_covered_and_exempt(): void
    {
        $exempt = OwnershipRegistry::exemptions();
        $both = array_values(array_filter(
            array_keys(OwnershipRegistry::coveredOperations()),
            static fn (string $operation): bool => isset($exempt[$operation]),
        ));

        $this->assertSame([], $both, "Operations with signed-in rows that are also exempt:\n".implode("\n", $both));
    }

    public function test_pending_list_only_names_undeclared_operations(): void
    {
        $declared = array_merge(
            array_keys(OwnershipRegistry::coveredOperations()),
            array_keys(OwnershipRegistry::exemptions()),
        );

        $stillPending = array_values(array_intersect(array_keys(OwnershipRegistry::pending()), $declared));

        $this->assertSame([], $stillPending, "Covered or exempt operations still on the pending list; remove them:\n".implode("\n", $stillPending));
    }

    public function test_pending_entries_name_a_plan_chunk(): void
    {
        $unknown = [];
        foreach (OwnershipRegistry::pending() as $operation => $chunk) {
            if (! in_array($chunk, OwnershipRegistry::chunkIds(), true)) {
                $unknown[] = $operation.' => '.$chunk;
            }
        }

        $this->assertSame([], $unknown, "Pending entries with an unknown chunk id:\n".implode("\n", $unknown));
    }

    public function test_exemptions_give_a_reason(): void
    {
        $blank = [];
        foreach (OwnershipRegistry::exemptions() as $operation => $exemption) {
            if (trim($exemption['why']) === '') {
                $blank[] = $operation;
            }
        }

        $this->assertSame([], $blank, "Exemptions without a reason:\n".implode("\n", $blank));
    }

    /**
     * Several suites may declare rows for one operation (for example the
     * guest role gate, or sharing a group collection), but never the same row.
     */
    public function test_case_keys_are_unique_across_suites(): void
    {
        $seen = [];
        $duplicates = [];
        foreach (OwnershipRegistry::suites() as $suite) {
            foreach ($suite::ownershipCases() as $case) {
                $key = $case->key();
                if (isset($seen[$key])) {
                    $duplicates[] = $key.' ('.$seen[$key].', '.$suite.')';
                }
                $seen[$key] = $suite;
            }
        }

        $this->assertSame([], $duplicates, "Duplicate ownership cases:\n".implode("\n", $duplicates));
    }
}
