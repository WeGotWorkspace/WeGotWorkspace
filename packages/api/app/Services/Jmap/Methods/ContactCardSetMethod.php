<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardSetService;
use App\Services\Contacts\JmapContactStateService;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapSetErrors;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * ContactCard/set over the existing ContactCardSetService (unmodified — its
 * per-record ifInState stays available for the legacy REST endpoint).
 *
 * The envelope implements genuine RFC 8620 §5.3 top-level ifInState
 * independently, compared against the envelope-codec account state BEFORE
 * the service runs. The service's legacy REST response shapes are normalized
 * here, at the adapter layer (parity-gaps decision — REST untouched):
 *  - created:  creationId → id string   becomes creationId → {id, state};
 *  - updated:  id → state-token string  becomes id → {state} (or null);
 *  - not*:     snake_case error types   become RFC 8620 SetError types.
 * Top-level oldState/newState are envelope-codec account states (the
 * service returns none) — same account-wide discipline as calendars.
 */
final class ContactCardSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(
        private readonly AddressBookRepository $books,
        private readonly ContactCardSetService $set,
        private readonly JmapContactStateService $states,
    ) {}

    public function name(): string
    {
        return 'ContactCard/set';
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
        $oldState = JmapAccountStateCodec::compose($this->books->syncTokens($username));
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $result = $this->set->set($username, [
            'create' => $create,
            'update' => $update,
            'destroy' => $destroy,
        ]);

        $created = [];
        foreach ($result['created'] as $creationId => $cardId) {
            $entry = ['id' => (string) $cardId];
            $stateToken = $this->states->stateTokenForCard($username, (string) $cardId);
            if ($stateToken !== null) {
                $entry['state'] = $stateToken;
            }
            $created[(string) $creationId] = $entry;
        }

        $updated = [];
        foreach ($result['updated'] as $cardId => $stateToken) {
            $updated[(string) $cardId] = is_string($stateToken) && $stateToken !== ''
                ? ['state' => $stateToken]
                : null;
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => JmapAccountStateCodec::compose($this->books->syncTokens($username)),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $result['destroyed'],
            'notCreated' => array_map(JmapSetErrors::fromLegacyShape(...), $result['notCreated']),
            'notUpdated' => array_map(JmapSetErrors::fromLegacyShape(...), $result['notUpdated']),
            'notDestroyed' => array_map(JmapSetErrors::fromLegacyShape(...), $result['notDestroyed']),
        ];
    }
}
