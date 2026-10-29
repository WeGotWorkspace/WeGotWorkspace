<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\AssertionFailedError;
use Tests\TestCase;

/**
 * Shared checks for ownership matrix cases.
 *
 * @mixin TestCase
 */
trait OwnershipAssertions
{
    /** Set when a pending row with an observed outcome matched that outcome. */
    private bool $ownershipObservedHit = false;

    /**
     * Runs a case's assertions.
     *
     * A row marked pending() without an observed outcome that fails is
     * reported as incomplete. With an observed outcome, only the response may
     * deviate from the spec, and only to the observed one: every other
     * failure is a real failure. Either way, a pending row whose spec outcome
     * holds fails, so the marker is removed as soon as the fix lands.
     */
    protected function runOwnershipCase(OwnershipCase $case, callable $assertions): void
    {
        if ($case->pendingId === null) {
            $assertions();

            return;
        }

        if ($case->observed !== null) {
            $this->ownershipObservedHit = false;
            $assertions();
            if ($this->ownershipObservedHit) {
                $this->markTestIncomplete('Pending row '.$case->pendingId.' (observed response holds).');
            }
        } else {
            try {
                $assertions();
            } catch (AssertionFailedError) {
                $this->markTestIncomplete('Pending row '.$case->pendingId.'.');
            }
        }

        $this->fail($case->key().' is marked pending '.$case->pendingId.' but now passes. Remove the marker.');
    }

    /**
     * Checks a response against the case's outcome. For a pending row with an
     * observed outcome, a mismatch with the spec outcome is accepted only when
     * the response matches the observed outcome instead. Suites route their
     * own response checks through this so observed outcomes work for them.
     *
     * @param  callable(OwnershipCase): void  $check
     */
    protected function assertCaseOutcome(OwnershipCase $case, callable $check): void
    {
        if ($case->observed === null) {
            $check($case);

            return;
        }

        try {
            $check($case);
        } catch (AssertionFailedError $specMismatch) {
            try {
                $check($case->asObserved());
            } catch (AssertionFailedError $observedMismatch) {
                $this->fail($case->key().' matches neither its spec outcome nor its observed outcome '.$case->observed->value.': '.$observedMismatch->getMessage());
            }
            $this->ownershipObservedHit = true;
        }
    }

    protected function assertRestOutcome(TestResponse $response, OwnershipCase $case): void
    {
        $this->assertCaseOutcome($case, fn (OwnershipCase $case) => $this->assertRestOutcomeExactly($response, $case));
    }

    private function assertRestOutcomeExactly(TestResponse $response, OwnershipCase $case): void
    {
        $status = $response->getStatusCode();
        $context = $case->key().' returned '.$status.': '.$this->ownershipBodyExcerpt($response);

        match ($case->outcome) {
            Outcome::Allowed, Outcome::Dismissed => $this->assertTrue($status >= 200 && $status < 300, $context),
            Outcome::NotFound, Outcome::AccountNotFound => $this->assertStatusAndCode($response, 404, $case->errorCode ?? 'not_found', $context),
            Outcome::Forbidden => $this->assertStatusAndCode($response, 403, $case->errorCode ?? 'forbidden', $context),
            Outcome::Rejected => $this->assertStatusAndCode($response, 400, $case->errorCode ?? 'bad_request', $context),
            Outcome::Conflict => $this->assertStatusAndCode($response, 409, $case->errorCode, $context),
            Outcome::Unauthenticated => $this->assertSame(401, $status, $context),
            Outcome::Gone => $this->assertStatusAndCode($response, 410, $case->errorCode, $context),
            Outcome::PasswordRequired => $this->assertStatusAndCode($response, 401, 'share_password_required', $context),
            Outcome::PasswordInvalid => $this->assertStatusAndCode($response, 401, 'share_password_invalid', $context),
        };
    }

    /**
     * Checks one id in a JMAP `/get` response.
     */
    protected function assertJmapGetOutcome(TestResponse $response, string $id, OwnershipCase $case, int $index = 0): void
    {
        $this->assertCaseOutcome($case, fn (OwnershipCase $case) => $this->assertJmapGetOutcomeExactly($response, $id, $case, $index));
    }

    private function assertJmapGetOutcomeExactly(TestResponse $response, string $id, OwnershipCase $case, int $index): void
    {
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case, $index);

            return;
        }

        $args = $this->jmapArguments($response, $case, $index);
        $listed = array_column(is_array($args['list'] ?? null) ? $args['list'] : [], 'id');
        $notFound = is_array($args['notFound'] ?? null) ? $args['notFound'] : [];

        match ($case->outcome) {
            Outcome::Allowed => $this->assertContains($id, $listed, $case->key().': id missing from list.'),
            Outcome::NotFound => $this->assertJmapHidden($id, $listed, $notFound, $case),
            default => throw new LogicException($case->outcome->value.' is not a JMAP get outcome.'),
        };
    }

    /**
     * Checks one id in a JMAP `/set` response.
     *
     * @param  'create'|'update'|'destroy'  $operation
     */
    protected function assertJmapSetOutcome(TestResponse $response, string $operation, string $id, OwnershipCase $case, int $index = 0): void
    {
        $this->assertCaseOutcome($case, fn (OwnershipCase $case) => $this->assertJmapSetOutcomeExactly($response, $operation, $id, $case, $index));
    }

    /**
     * @param  'create'|'update'|'destroy'  $operation
     */
    private function assertJmapSetOutcomeExactly(TestResponse $response, string $operation, string $id, OwnershipCase $case, int $index): void
    {
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case, $index);

            return;
        }

        $args = $this->jmapArguments($response, $case, $index);
        [$okKey, $failKey] = match ($operation) {
            'create' => ['created', 'notCreated'],
            'update' => ['updated', 'notUpdated'],
            'destroy' => ['destroyed', 'notDestroyed'],
        };
        $ok = is_array($args[$okKey] ?? null) ? $args[$okKey] : [];
        $failed = is_array($args[$failKey] ?? null) ? $args[$failKey] : [];
        $succeeded = $operation === 'destroy' ? in_array($id, $ok, true) : array_key_exists($id, $ok);
        $context = $case->key().' '.$operation.' '.$id.': '.json_encode($args);

        match ($case->outcome) {
            Outcome::Allowed, Outcome::Dismissed => $this->assertTrue($succeeded, $context),
            Outcome::NotFound => $this->assertSame('notFound', $failed[$id]['type'] ?? null, $context),
            Outcome::Forbidden => $this->assertSame('forbidden', $failed[$id]['type'] ?? null, $context),
            Outcome::Rejected => $this->assertSame($case->errorCode ?? 'invalidProperties', $failed[$id]['type'] ?? null, $context),
            Outcome::Conflict => $this->assertSame('alreadyExists', $failed[$id]['type'] ?? null, $context),
            default => throw new LogicException($case->outcome->value.' is not a JMAP set outcome.'),
        };
    }

    protected function assertJmapMethodError(TestResponse $response, string $type, OwnershipCase $case, int $index = 0): void
    {
        $response->assertOk();
        $entry = $response->json('methodResponses.'.$index);
        $this->assertIsArray($entry, $case->key().': no method response at index '.$index.'.');
        $this->assertSame('error', $entry[0] ?? null, $case->key().': expected a method error, got '.json_encode($entry));
        $this->assertSame($type, $entry[1]['type'] ?? null, $case->key().': '.json_encode($entry));
    }

    /**
     * Runs a denied action and proves the target did not change. Returns the
     * action's result so the caller can also assert the response.
     *
     * @template T
     *
     * @param  callable(): mixed  $snapshot
     * @param  callable(): T  $action
     * @return T
     */
    protected function assertUnchanged(callable $snapshot, callable $action, string $context): mixed
    {
        $before = $snapshot();
        $result = $action();
        $this->assertSame($before, $snapshot(), $context.': target changed after a denied write.');

        return $result;
    }

    /**
     * Proves that ids from denied scopes are absent from a list, changes, or
     * query result.
     *
     * @param  list<string>  $deniedIds
     * @param  list<string>  $listedIds
     */
    protected function assertIdsAbsent(array $deniedIds, array $listedIds, string $context): void
    {
        $this->assertSame([], array_values(array_intersect($deniedIds, $listedIds)), $context.': denied ids leaked into the result.');
    }

    private function assertStatusAndCode(TestResponse $response, int $status, ?string $code, string $context): void
    {
        $this->assertSame($status, $response->getStatusCode(), $context);
        if ($code !== null) {
            // Some routes (collaboration, meetings, RTC) put the code under `error`.
            $this->assertSame($code, $response->json('code') ?? $response->json('error'), $context);
        }
    }

    /**
     * @param  list<mixed>  $listed
     * @param  list<mixed>  $notFound
     */
    private function assertJmapHidden(string $id, array $listed, array $notFound, OwnershipCase $case): void
    {
        $this->assertNotContains($id, $listed, $case->key().': hidden id returned in list.');
        $this->assertContains($id, $notFound, $case->key().': hidden id missing from notFound.');
    }

    /**
     * @return array<string, mixed>
     */
    private function jmapArguments(TestResponse $response, OwnershipCase $case, int $index): array
    {
        $response->assertOk();
        $entry = $response->json('methodResponses.'.$index);
        $this->assertIsArray($entry, $case->key().': no method response at index '.$index.'.');
        $this->assertNotSame('error', $entry[0] ?? null, $case->key().': unexpected method error '.json_encode($entry));

        return is_array($entry[1] ?? null) ? $entry[1] : [];
    }

    private function ownershipBodyExcerpt(TestResponse $response): string
    {
        return substr((string) $response->getContent(), 0, 300);
    }
}
