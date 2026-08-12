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
}
