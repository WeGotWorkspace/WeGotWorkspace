<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Dav\Server\CardUidConflict;
use App\Exceptions\ApiHttpException;

/**
 * Maps a card backend UID clash ({@see CardUidConflict}) to the REST and JMAP
 * error: 409 `alreadyExists`, the shape Notes uses for a taken note UID.
 */
final class ContactCardUidGuard
{
    public const MESSAGE = 'A contact with this UID already exists in this address book.';

    /**
     * @param  callable(): mixed  $write
     */
    public static function write(callable $write): void
    {
        try {
            $write();
        } catch (CardUidConflict) {
            throw new ApiHttpException(409, self::MESSAGE, 'alreadyExists');
        }
    }
}
