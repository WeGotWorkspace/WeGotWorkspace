<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Card;
use App\Models\JmapContactState;
use Illuminate\Support\Str;

final class JmapContactStateService
{
    public function attachStateToken(
        string $username,
        array $contact,
        Card $card,
        string $addressBookUri,
    ): array {
        $state = $this->ensureStateRow($username, $card, $addressBookUri);
        $contact['state'] = $state->state_token;

        return $contact;
    }

    public function stateTokenForCard(string $username, string $cardId): ?string
    {
        $row = JmapContactState::query()
            ->where('username', $username)
            ->where('card_id', $cardId)
            ->first();

        return $row !== null ? $row->state_token : null;
    }

    /**
     * Resolve JMAP ifInState to a CardDAV etag for If-Match.
     */
    public function resolveEtagForIfInState(string $username, string $cardId, string $ifInState): string
    {
        $row = JmapContactState::query()
            ->where('username', $username)
            ->where('card_id', $cardId)
            ->first();

        if ($row === null || $row->state_token !== $ifInState) {
            throw new ApiHttpException(
                412,
                'Contact state does not match ifInState.',
                'stateMismatch',
            );
        }

        $etag = is_string($row->etag) ? trim($row->etag) : '';
        if ($etag === '') {
            throw new ApiHttpException(
                412,
                'Contact state does not match ifInState.',
                'stateMismatch',
            );
        }

        return $etag;
    }

    public function deleteForCard(string $username, string $cardId): void
    {
        JmapContactState::query()
            ->where('username', $username)
            ->where('card_id', $cardId)
            ->delete();
    }

    /**
     * Every card id ever surfaced for an address book — used by the JMAP
     * envelope's account-wide ContactCard/changes to expand a deleted (or
     * no-longer-visible) book into destroyed ids. Rows survive book deletion
     * because Sabre removes the cards directly, without the per-card REST
     * delete path that clears state rows.
     *
     * @return list<string>
     */
    public function recordedCardIdsForBook(string $username, string $addressBookUri): array
    {
        return JmapContactState::query()
            ->where('username', $username)
            ->where('address_book_uri', $addressBookUri)
            ->orderBy('card_id')
            ->pluck('card_id')
            ->map(fn ($id): string => (string) $id)
            ->all();
    }

    /**
     * Ensures a state row exists and rotates state_token when the CardDAV etag changes (read path).
     */
    private function ensureStateRow(string $username, Card $card, string $addressBookUri): JmapContactState
    {
        $cardId = ContactCardMapper::cardIdFromUri((string) $card->uri);
        $row = JmapContactState::query()
            ->where('username', $username)
            ->where('card_id', $cardId)
            ->first();

        $rawEtag = is_string($card->etag) ? $card->etag : null;

        if ($row === null) {
            $row = JmapContactState::query()->create([
                'username' => $username,
                'card_id' => $cardId,
                'address_book_uri' => $addressBookUri,
                'card_uri' => (string) $card->uri,
                'state_token' => $this->generateStateToken(),
                'etag' => $rawEtag,
            ]);

            return $row;
        }

        $bookChanged = $row->address_book_uri !== $addressBookUri;
        $etagChanged = $rawEtag !== null && $rawEtag !== '' && $row->etag !== $rawEtag;
        if ($bookChanged || $etagChanged) {
            $row->address_book_uri = $addressBookUri;
            if ($etagChanged) {
                $row->etag = $rawEtag;
            }
            $row->state_token = $this->generateStateToken();
            $row->save();
        }

        return $row;
    }

    private function generateStateToken(): string
    {
        return Str::lower(Str::replace('-', '', Str::uuid()->toString()));
    }
}
