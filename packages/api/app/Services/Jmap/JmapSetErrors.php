<?php

declare(strict_types=1);

namespace App\Services\Jmap;

use App\Exceptions\ApiHttpException;

/**
 * Maps service-layer exceptions onto the RFC 8620 §5.3 SetError vocabulary
 * (plus draft-ietf-jmap-calendars' calendarHasEvent). Anything outside the
 * recognized vocabulary degrades to serverFail rather than inventing types
 * (spec §7).
 */
final class JmapSetErrors
{
    /**
     * @return array<string, mixed>
     */
    public static function fromApiException(ApiHttpException $e): array
    {
        $type = match ($e->errorCode()) {
            'not_found' => 'notFound',
            'bad_request', 'invalidProperties' => 'invalidProperties',
            'forbidden' => 'forbidden',
            'stateMismatch', 'precondition_failed' => 'stateMismatch',
            // draft-ietf-jmap-calendars Calendar/set destroy without onDestroyRemoveEvents.
            'calendarHasContents' => 'calendarHasEvent',
            // RFC 9610 AddressBook/set destroy without onDestroyRemoveContents.
            'addressBookHasContents' => 'addressBookHasContents',
            'notebookHasContents' => 'notebookHasContents',
            // Unknown/foreign media blobId (ContactMediaBlobResolver) — a
            // client-input problem, not a server failure.
            'invalid_blob' => 'invalidProperties',
            'alreadyExists' => 'invalidProperties',
            default => 'serverFail',
        };

        $shape = [
            'type' => $type,
            'description' => $e->getMessage(),
        ];
        if ($type === 'invalidProperties') {
            $shape['properties'] = $e->errorCode() === 'alreadyExists' ? ['id'] : $e->invalidProperties();
        }

        return $shape;
    }

    /**
     * Normalizes a legacy REST SetError shape (snake_case types such as
     * `not_found` / `serverError`, produced by services that catch their own
     * exceptions, e.g. ContactCardSetService::errorShape()) to the RFC 8620
     * §5.3 vocabulary. The REST wire format is untouched — this runs only in
     * envelope adapters (parity-gaps: legacy shapes normalize at the adapter
     * layer).
     *
     * @param  array<string, mixed>  $shape
     * @return array<string, mixed>
     */
    public static function fromLegacyShape(array $shape): array
    {
        $legacyType = is_string($shape['type'] ?? null) ? $shape['type'] : 'serverFail';
        $type = match ($legacyType) {
            'not_found', 'notFound' => 'notFound',
            // invalid_blob: unknown/foreign media blobId — client input, not
            // a server failure (spec.md edge case: "never a 500").
            'bad_request', 'invalidProperties', 'alreadyExists', 'invalid_blob' => 'invalidProperties',
            'forbidden' => 'forbidden',
            'stateMismatch', 'precondition_failed' => 'stateMismatch',
            'addressBookHasContents' => 'addressBookHasContents',
            default => 'serverFail',
        };

        $description = is_string($shape['description'] ?? null) ? $shape['description'] : '';
        if ($type === 'serverFail' && ! config('app.debug')) {
            // Same sanitization as serverFail(): legacy shapes carry raw
            // Throwable messages that must not leak internals on the wire.
            $description = 'An unexpected error occurred.';
        }

        $normalized = ['type' => $type, 'description' => $description];
        if ($type === 'invalidProperties') {
            $normalized['properties'] = [];
        }

        return $normalized;
    }

    /**
     * Unexpected internal failure, shaped for both the method-level `error`
     * invocation and the per-item SetError buckets. The raw exception message
     * is logged but kept off the wire outside debug mode — internals (SQL,
     * file paths) must not leak into responses.
     *
     * @return array<string, mixed>
     */
    public static function serverFail(\Throwable $e): array
    {
        report($e);

        return [
            'type' => 'serverFail',
            'description' => config('app.debug') ? $e->getMessage() : 'An unexpected error occurred.',
        ];
    }
}
