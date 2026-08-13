<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * ContactCard/get (RFC 9610 §3.4): no multi-id repository method exists, so
 * the loop over ContactCardRepository::show() lives here — same pattern as
 * CalendarEvent/get. With args.ids null, all owned address books are
 * enumerated via syncTokens() and listed per book. Cards carry their
 * per-item `state` token (attached by the mapper) and resolve media blobIds
 * against the contacts REST blob store (documented deviation until real
 * envelope blobs land, #438).
 */
final class ContactCardGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(
        private readonly AddressBookRepository $books,
        private readonly ContactCardRepository $cards,
    ) {}

    public function name(): string
    {
        return 'ContactCard/get';
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
        $tokens = $this->books->syncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $bookUri) {
                foreach ($this->cards->list($username, $bookUri)['list'] as $card) {
                    $list[] = $card;
                }
            }
            $this->guardGetAllBound($list);
        } else {
            foreach ($ids as $id) {
                try {
                    $list[] = $this->cards->show($username, $id);
                } catch (ApiHttpException $e) {
                    if ($e->getStatusCode() === 404) {
                        $notFound[] = $id;

                        continue;
                    }
                    throw $e;
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
