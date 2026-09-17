<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\Addressbook;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * One visible address book for a viewer: owned/membership or inbound sharee.
 */
final readonly class AddressBookListing
{
    public function __construct(
        public Addressbook $book,
        public bool $isSharee,
        public int $access,
    ) {}

    public function canShare(): bool
    {
        return ! $this->isSharee
            && $this->access === SharingPlugin::ACCESS_SHAREDOWNER;
    }

    public function isReadOnly(): bool
    {
        return $this->isSharee && $this->access === SharingPlugin::ACCESS_READ;
    }

    /**
     * @return array{mayRead: bool, mayWrite: bool, mayShare: bool, mayDelete: bool}
     */
    public function rights(): array
    {
        if ($this->isSharee) {
            return [
                'mayRead' => true,
                'mayWrite' => $this->access === SharingPlugin::ACCESS_READWRITE,
                'mayShare' => false,
                'mayDelete' => true,
            ];
        }

        return [
            'mayRead' => true,
            'mayWrite' => true,
            'mayShare' => true,
            'mayDelete' => false,
        ];
    }
}
