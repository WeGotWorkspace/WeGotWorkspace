<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * AddressBook/get (RFC 9610 §2.1): the existing AddressBookRepository::list()
 * filtered to args.ids, wrapped in the RFC 8620 §5.1 GetResponse shape with
 * envelope-codec state. The REST mapping already emits the RFC 9610
 * AddressBook shape (incl. the four-property AddressBookRights), so no
 * per-record remapping is needed — unlike calendars' myRights.
 */
final class AddressBookGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly AddressBookRepository $books) {}

    public function name(): string
    {
        return 'AddressBook/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::CONTACTS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $state = JmapAccountStateCodec::compose($this->books->syncTokens($username));
        $all = $this->books->list($username)['list'];

        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $this->guardGetAllBound($all);
            $list = $all;
        } else {
            $byId = [];
            foreach ($all as $book) {
                $byId[(string) $book['id']] = $book;
            }
            $list = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
