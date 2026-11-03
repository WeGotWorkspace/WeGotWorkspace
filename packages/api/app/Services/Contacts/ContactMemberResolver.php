<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\Card;

/**
 * RFC 9610 group member resolution — preserve uids, optionally resolve to card ids.
 * Looks members up by the stored `cards.uid` ({@see CardUid}).
 */
final class ContactMemberResolver
{
    /**
     * @param  array<string, mixed>  $contact
     * @return array<string, mixed>
     */
    public function apply(string $username, array $contact): array
    {
        $members = $contact['members'] ?? null;
        if (! is_array($members) || $members === []) {
            return $contact;
        }

        $resolved = [];
        foreach (array_keys(array_filter($members, static fn ($enabled): bool => (bool) $enabled)) as $memberUid) {
            $cardId = $this->findCardIdByUid($username, (string) $memberUid);
            if ($cardId !== null) {
                $resolved[(string) $memberUid] = $cardId;
            }
        }

        if ($resolved !== []) {
            $contact['memberCardIds'] = $resolved;
        }

        return $contact;
    }

    private function findCardIdByUid(string $username, string $uid): ?string
    {
        $normalizedUid = CardUid::normalize($uid);
        if ($normalizedUid === null) {
            return null;
        }

        $uri = Card::query()
            ->whereHas('addressbook', function ($query) use ($username): void {
                $query->where('principaluri', 'principals/'.$username);
            })
            ->where('uid', $normalizedUid)
            ->orderBy('id')
            ->value('uri');

        return is_string($uri) ? ContactCardMapper::cardIdFromUri($uri) : null;
    }
}
