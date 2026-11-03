<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use InvalidArgumentException;

/**
 * One row of the ownership matrix: an operation, run as an actor against an
 * object in a scope, with the declared outcome.
 *
 * `operation` is an OpenAPI key ("GET /notes/items/{noteId}") or a JMAP key
 * ("JMAP Note/get"), see OwnershipRegistry::jmapKey().
 */
final readonly class OwnershipCase
{
    private const PENDING_ID = '/^P-\d{3}$/';

    public function __construct(
        public string $operation,
        public Actor $actor,
        public Scope $scope,
        public Outcome $outcome,
        public ?string $errorCode = null,
        public ?string $pendingId = null,
        public ?string $variant = null,
        public ?Outcome $observed = null,
        public ?string $observedCode = null,
    ) {
        if ($pendingId !== null && preg_match(self::PENDING_ID, $pendingId) !== 1) {
            throw new InvalidArgumentException('Pending ids are opaque, like P-001: '.$pendingId);
        }
        if ($observed !== null && $pendingId === null) {
            throw new InvalidArgumentException('An observed outcome needs a pending id: '.$operation);
        }
    }

    public static function of(string $operation, Actor $actor, Scope $scope, Outcome $outcome): self
    {
        return new self($operation, $actor, $scope, $outcome);
    }

    /**
     * The same row with the outcome the spec declares for it, for rows whose
     * expected answer follows a product decision rather than the default.
     */
    public function declared(Outcome $outcome, ?string $errorCode = null): self
    {
        return new self($this->operation, $this->actor, $this->scope, $outcome, $errorCode, null, $this->variant);
    }

    public function withCode(string $errorCode): self
    {
        return new self($this->operation, $this->actor, $this->scope, $this->outcome, $errorCode, $this->pendingId, $this->variant, $this->observed, $this->observedCode);
    }

    /**
     * A second case for the same operation, actor and scope, such as the
     * destination side of a move or a wrong password.
     */
    public function variant(string $variant): self
    {
        return new self($this->operation, $this->actor, $this->scope, $this->outcome, $this->errorCode, $this->pendingId, $variant, $this->observed, $this->observedCode);
    }

    /**
     * Marks a row whose declared outcome does not hold yet, while its fix is
     * in progress. The id is an opaque label for that fix.
     *
     * Pass `$observed` (and its error code) when only the response differs,
     * such as 400 or 403 where the spec says 404. The row then pins today's
     * response: any other response, or a change to the target, still fails.
     * Without `$observed` every failure of the row is reported as incomplete,
     * so use that only when the access itself is what is being fixed.
     */
    public function pending(string $id, ?Outcome $observed = null, ?string $observedCode = null): self
    {
        return new self($this->operation, $this->actor, $this->scope, $this->outcome, $this->errorCode, $id, $this->variant, $observed, $observedCode);
    }

    /**
     * The same row with the observed outcome as its outcome, for checking the
     * response a pending row gives today.
     */
    public function asObserved(): self
    {
        if ($this->observed === null) {
            throw new InvalidArgumentException($this->key().' has no observed outcome.');
        }

        return new self($this->operation, $this->actor, $this->scope, $this->observed, $this->observedCode, $this->pendingId, $this->variant);
    }

    public function key(): string
    {
        $key = $this->operation.' | '.$this->actor->value.' | '.$this->scope->value;

        return $this->variant === null ? $key : $key.' | '.$this->variant;
    }
}
