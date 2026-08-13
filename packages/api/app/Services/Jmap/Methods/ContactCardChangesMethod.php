<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Contacts\JmapContactStateService;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * Account-wide ContactCard/changes fan-out — the CalendarEvent/changes
 * algorithm on the contacts substrate: sinceState is decomposed with the
 * envelope codec into per-book sync tokens, then per address book —
 *  - not in sinceState (newly visible): every current card is `created`;
 *  - token changed: the per-book Sabre changes() delta is merged;
 *  - token unchanged: skipped;
 *  - in sinceState but gone now: every card id previously recorded for
 *    that book (jmap_contact_states) is `destroyed`.
 *
 * hasMoreChanges is always false — the same honest Sabre change-log
 * limitation as calendars, so maxChanges is validated but never truncates.
 */
final class ContactCardChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(
        private readonly AddressBookRepository $books,
        private readonly ContactCardRepository $cards,
        private readonly JmapContactStateService $states,
    ) {}

    public function name(): string
    {
        return 'ContactCard/changes';
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
        $sinceState = $this->sinceState($args);
        $since = JmapAccountStateCodec::decompose($sinceState);
        if ($since === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        $current = $this->books->syncTokens($username);

        $created = [];
        $updated = [];
        $destroyed = [];
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                // Newly visible book: all its current cards are created.
                $delta = $this->cards->changes($username, $uri, null);
                array_push($created, ...$delta['created']);

                continue;
            }
            if ($since[$uri] !== $token) {
                $delta = $this->cards->changes($username, $uri, $since[$uri]);
                array_push($created, ...$delta['created']);
                array_push($updated, ...$delta['updated']);
                array_push($destroyed, ...$delta['destroyed']);
            }
        }

        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                // Book deleted or no longer visible: every id ever surfaced
                // for it is destroyed.
                array_push($destroyed, ...$this->states->recordedCardIdsForBook($username, $uri));
            }
        }

        // An id may only appear in one list (RFC 8620 §5.2): created wins,
        // then updated.
        $created = array_values(array_unique($created));
        $updated = array_values(array_diff(array_unique($updated), $created));
        $destroyed = array_values(array_diff(array_unique($destroyed), $created, $updated));

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => JmapAccountStateCodec::compose($current),
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }
}
