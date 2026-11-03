<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\Plugin as CardDAVPlugin;
use Sabre\DAV;
use Sabre\HTTP;

/**
 * A write would give an address book a second card with the same UID.
 *
 * Over CardDAV this is the RFC 6352 §6.3.2.1 `no-uid-conflict` precondition:
 * 403 with the href of the card that already holds the UID. REST callers map
 * it to 409 `alreadyExists`.
 */
final class CardUidConflict extends DAV\Exception\Forbidden
{
    /**
     * @param  string  $existingPath  DAV path of the card holding the UID, relative to the server root
     */
    public function __construct(
        private readonly string $existingPath,
        private readonly string $existingCardUri,
    ) {
        parent::__construct('A card with this UID already exists in this address book.');
    }

    public function existingPath(): string
    {
        return $this->existingPath;
    }

    public function existingCardUri(): string
    {
        return $this->existingCardUri;
    }

    public function serialize(DAV\Server $server, \DOMElement $errorNode): void
    {
        $doc = $errorNode->ownerDocument;
        if ($doc === null) {
            return;
        }

        $conflict = $doc->createElementNS(CardDAVPlugin::NS_CARDDAV, 'card:no-uid-conflict');
        $href = $doc->createElementNS('DAV:', 'd:href');
        $href->appendChild($doc->createTextNode($server->getBaseUri().HTTP\encodePath($this->existingPath)));
        $conflict->appendChild($href);
        $errorNode->appendChild($conflict);
    }
}
