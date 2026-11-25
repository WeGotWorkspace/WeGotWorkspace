<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;
use Illuminate\Support\Facades\Log;

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

    public static function name(): string
    {
        return 'ContactCard/get';
    }

    public static function capability(): string
    {
        return JmapCapabilities::CONTACTS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        Log::withContext(['principal' => $username]);

        $tokens = $this->books->syncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $projection = $this->getProjection($args);
        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $bookUri) {
                foreach ($this->cards->list($username, $bookUri)['list'] as $card) {
                    $list[] = $projection->apply($card);
                }
            }
            $this->guardGetAllBound($list);
        } else {
            // A projection without media (the photo-less first download) skips the photo blobs.
            $withMedia = $projection->wants('media');
            foreach ($this->cards->showEach($username, $ids, $withMedia) as $id => $card) {
                if ($card === null) {
                    $notFound[] = $id;

                    continue;
                }
                $list[] = $projection->apply($card);
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $list,
            'notFound' => $notFound,
        ];
    }
}
