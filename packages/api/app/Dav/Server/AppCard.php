<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\Card;
use Sabre\DAV\Exception\NotFound;

/**
 * {@see Card} that can be renamed. Sabre's Tree calls setName() for a MOVE
 * inside one book, which avoids the copy-then-delete that would trip the UID
 * check against the source card itself. MOVE into another book keeps the copy
 * path and its UID check.
 */
final class AppCard extends Card
{
    public function setName($name): void
    {
        $backend = $this->carddavBackend;
        if (! $backend instanceof WgwCardBackend
            || ! $backend->renameCard((int) $this->addressBookInfo['id'], (string) $this->cardData['uri'], (string) $name)) {
            throw new NotFound('Card not found');
        }
    }
}
