<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBook;
use Sabre\CardDAV\Card;
use Sabre\DAV;
use Sabre\DAV\IMoveTarget;
use Sabre\Uri;

/**
 * {@see AddressBook} that renames a card inside its own book without going
 * through Sabre's copy-then-delete, which would trip the UID check against the
 * source card itself. MOVE into another book, and COPY, keep the default path.
 */
final class AppAddressBook extends AddressBook implements IMoveTarget
{
    public function moveInto($targetName, $sourcePath, DAV\INode $sourceNode): bool
    {
        $backend = $this->carddavBackend;
        if (! $backend instanceof WgwCardBackend || ! $sourceNode instanceof Card) {
            return false;
        }
        [$sourceDir, $sourceName] = Uri\split($sourcePath);
        $principal = Uri\split((string) $this->addressBookInfo['principaluri'])[1];
        if (trim($sourceDir, '/') !== 'addressbooks/'.$principal.'/'.$this->addressBookInfo['uri']) {
            return false;
        }

        return $backend->renameCard((int) $this->addressBookInfo['id'], $sourceName, (string) $targetName);
    }
}
