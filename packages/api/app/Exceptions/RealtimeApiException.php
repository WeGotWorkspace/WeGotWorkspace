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
 * One class for all three domains: a caller that catches it around a domain
 * check (for example `CollabJoinAuthorizer::assertMayJoin`) only ever sees that
 * domain's refusals, because each check throws for its own domain only.
 *
 * It stays a `RuntimeException`, so Laravel still reports it (#1646 keeps
 * logging unchanged; see `.agents/specs/1646-error-shape/plan.md`).
 */
final class RealtimeApiException extends RuntimeException implements RendersApiError
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        public readonly ?string $detail = null,
    ) {
        parent::__construct($errorCode);
    }

    /**
     * Rewrap a signaling failure for the HTTP layer.
     */
    public static function fromSignaling(RtcSignalingException $exception): self
    {
        $message = $exception->payload['message'] ?? null;

        return new self(
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
