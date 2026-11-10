<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Services\Rtc\Signaling\RtcSignalingException;
use RuntimeException;

/**
 * Error from the realtime routes (Meet, Collab, Principal presence).
 *
 * These routes put the machine code in `error` and an optional sentence in
 * `message`, and their clients read `error` first. The body keeps that and adds
 * `code` with the same value, so it matches the `{ error, code? }` contract.
 *
 * It stays a `RuntimeException`, so Laravel still reports it (#1646 keeps
 * logging unchanged; see `.agents/specs/1646-error-shape/plan.md`).
 */
abstract class DomainResponseException extends RuntimeException implements RendersApiError
{
    final public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        public readonly ?string $detail = null,
    ) {
        parent::__construct($errorCode);
    }

    /**
     * Rewrap a signaling failure for the HTTP layer of one realtime domain.
     */
    public static function fromSignaling(RtcSignalingException $exception): static
    {
        $message = $exception->payload['message'] ?? null;

        return new static(
            $exception->status,
            (string) ($exception->payload['error'] ?? 'signaling_error'),
            is_string($message) ? $message : null,
        );
    }

    public function apiErrorStatus(): int
    {
        return $this->status;
    }

    public function apiErrorBody(): array
    {
        $body = ['error' => $this->errorCode, 'code' => $this->errorCode];
        if ($this->detail !== null) {
            $body['message'] = $this->detail;
        }

        return $body;
    }

    public function apiErrorHeaders(): array
    {
        return [];
    }
}
