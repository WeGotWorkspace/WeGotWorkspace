<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * AddressBook/changes: the Calendar/changes algorithm on the contacts
 * substrate — diffing address-book existence and Sabre sync tokens against
 * the decomposed sinceState. Same over-reporting caveat: Sabre bumps a
 * book's synctoken on card activity, so card-only changes also mark the
 * book `updated` (harmless metadata refetch).
 */
final class AddressBookChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(private readonly AddressBookRepository $books) {}

    public function name(): string
    {
        return 'AddressBook/changes';
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
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                $created[] = $uri;
            } elseif ($since[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                $destroyed[] = $uri;
            }
        }

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
