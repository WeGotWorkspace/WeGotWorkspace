<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CardDAV\Backend\PDO as CardPDO;
use Sabre\CardDAV\Plugin as CardDAVPlugin;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;

final class AddressBookRepository
{
    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username): array
    {
        $books = Addressbook::query()
            ->where('principaluri', $this->principalUri($username))
            ->orderBy('id')
            ->get();

        return [
            'list' => $books
                ->map(fn (Addressbook $book): array => $this->mapAddressBook($book))
                ->values()
                ->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $addressBookId): array
    {
        $book = $this->findOwnedBook($username, $addressBookId);
        if ($book === null) {
            throw new ApiHttpException(404, 'Address book not found.', 'not_found');
        }

        return $this->mapAddressBook($book);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'bad_request');
        }

        $uri = $this->allocateBookUri(
            $username,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
        );

        $properties = [
            '{DAV:}displayname' => $name,
        ];

        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $properties['{'.CardDAVPlugin::NS_CARDDAV.'}addressbook-description'] = is_string($description)
                ? $description
                : null;
        }

        try {
            $this->cardBackend()->createAddressBook($this->principalUri($username), $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $book = $this->findOwnedBook($username, $uri);
        if ($book === null) {
            throw new ApiHttpException(500, 'Could not load created address book.', 'server_error');
        }

        return $this->mapAddressBook($book);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(string $username, string $addressBookId, array $payload): array
    {
        $book = $this->findOwnedBook($username, $addressBookId);
        if ($book === null) {
            throw new ApiHttpException(404, 'Address book not found.', 'not_found');
        }

        $mutations = [];
        if (array_key_exists('name', $payload)) {
            $name = trim((string) $payload['name']);
            if ($name === '') {
                throw new ApiHttpException(400, 'name must not be empty.', 'invalidProperties');
            }
            $mutations['{DAV:}displayname'] = $name;
        }
        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $mutations['{'.CardDAVPlugin::NS_CARDDAV.'}addressbook-description'] = is_string($description)
                ? $description
                : null;
        }

        if ($mutations !== []) {
            $propPatch = new PropPatch($mutations);
            $this->cardBackend()->updateAddressBook((int) $book->id, $propPatch);
            $propPatch->commit();
        }

        $book->refresh();

        return $this->mapAddressBook($book);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array{ok: true}
     */
    public function delete(string $username, string $addressBookId, array $options = []): array
    {
        $book = $this->findOwnedBook($username, $addressBookId);
        if ($book === null) {
            throw new ApiHttpException(404, 'Address book not found.', 'not_found');
        }

        if ((string) $book->uri === 'default') {
            throw new ApiHttpException(403, 'The default address book cannot be deleted.', 'forbidden');
        }

        $removeContents = (bool) ($options['onDestroyRemoveContents'] ?? false);
        $hasCards = $book->cards()->exists();
        if ($hasCards && ! $removeContents) {
            throw new ApiHttpException(
                409,
                'Address book contains contact cards.',
                'addressBookHasContents',
            );
        }

        $this->cardBackend()->deleteAddressBook((int) $book->id);

        return ['ok' => true];
    }

    /**
     * @return array{
     *     oldState: string,
     *     newState: string,
     *     created: list<string>,
     *     updated: list<string>,
     *     destroyed: list<string>
     * }
     */
    public function changes(string $username, ?string $since): array
    {
        $books = Addressbook::query()
            ->where('principaluri', $this->principalUri($username))
            ->orderBy('uri')
            ->get(['uri', 'synctoken']);

        $currentState = $this->computeBooksState($books);
        $previous = $this->parseBooksState($since);

        if ($since === null || $since === '' || $since === '0') {
            return [
                'oldState' => '0',
                'newState' => $currentState,
                'created' => $books->pluck('uri')->map(fn ($uri): string => (string) $uri)->all(),
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($since === $currentState) {
            return [
                'oldState' => $since,
                'newState' => $currentState,
                'created' => [],
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($books as $book) {
            $currentMap[(string) $book->uri] = (int) $book->synctoken;
        }

        $created = [];
        $updated = [];
        foreach ($currentMap as $uri => $token) {
            if (! array_key_exists($uri, $previous)) {
                $created[] = $uri;

                continue;
            }
            if ($previous[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($previous) as $uri) {
            if (! array_key_exists($uri, $currentMap)) {
                $destroyed[] = $uri;
            }
        }

        return [
            'oldState' => $since,
            'newState' => $currentState,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }

    /**
     * Current Sabre sync token per owned address book uri — the contacts
     * analog of CalendarEventRepository::calendarSyncTokens(), feeding the
     * JMAP envelope's account-wide state codec.
     *
     * @return array<string, string>
     */
    public function syncTokens(string $username): array
    {
        $tokens = [];
        $books = Addressbook::query()
            ->where('principaluri', $this->principalUri($username))
            ->orderBy('uri')
            ->get(['uri', 'synctoken']);
        foreach ($books as $book) {
            $tokens[(string) $book->uri] = (string) (int) ($book->synctoken ?? 1);
        }

        return $tokens;
    }

    private function findOwnedBook(string $username, string $addressBookId): ?Addressbook
    {
        return Addressbook::query()
            ->where('principaluri', $this->principalUri($username))
            ->where('uri', $addressBookId)
            ->first();
    }

    private function allocateBookUri(string $username, ?string $requestedId, string $name): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            if ($requestedId === 'default') {
                throw new ApiHttpException(409, 'Address book id already exists.', 'alreadyExists');
            }
            if ($this->findOwnedBook($username, $requestedId) !== null) {
                throw new ApiHttpException(409, 'Address book id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }

        $base = Str::slug($name, '-');
        if ($base === '') {
            $base = 'book';
        }

        $candidate = $base;
        $suffix = 2;
        while ($this->findOwnedBook($username, $candidate) !== null) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    /**
     * @param  Collection<int, Addressbook>  $books
     */
    private function computeBooksState($books): string
    {
        $parts = [];
        foreach ($books as $book) {
            $parts[] = (string) $book->uri.':'.(int) $book->synctoken;
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    /**
     * @return array<string, int>|null
     */
    private function parseBooksState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }

        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }

        $expectedCount = (int) $matches[1];
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== $expectedCount) {
            return null;
        }

        $map = [];
        foreach ($entries as $entry) {
            $parts = explode(':', $entry, 2);
            if (count($parts) !== 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
                return null;
            }
            $map[$parts[0]] = (int) $parts[1];
        }

        return $map;
    }

    /**
     * @return array<string, mixed>
     */
    private function mapAddressBook(Addressbook $book): array
    {
        $uri = (string) $book->uri;
        $name = trim((string) ($book->displayname ?? ''));
        if ($name === '') {
            $name = $uri;
        }
        $isDefault = $uri === 'default';

        return [
            'id' => $uri,
            'name' => $name,
            'description' => is_string($book->description) && trim($book->description) !== ''
                ? trim($book->description)
                : null,
            'sortOrder' => (int) ($book->id ?? 0),
            'isDefault' => $isDefault,
            'isSubscribed' => true,
            'shareWith' => null,
            'myRights' => [
                'mayRead' => true,
                'mayWrite' => true,
                'mayShare' => false,
                'mayDelete' => ! $isDefault,
            ],
        ];
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function cardBackend(): CardPDO
    {
        return new CardPDO(DB::connection('wgw')->getPdo());
    }
}
