<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\JmapSetErrors;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * AddressBook/set (RFC 9610 §2.2) over the existing AddressBookRepository
 * create/update/delete, wrapped in the RFC 8620 §5.3 SetResponse shape with
 * genuine top-level ifInState and envelope-codec oldState/newState.
 *
 * onDestroyRemoveContents maps onto the repository's existing option; a
 * destroy of a non-empty book without it yields the RFC 9610
 * addressBookHasContents SetError. onSuccessSetIsDefault is not supported
 * (the default book is fixed to the `default` uri in storage) — requests
 * carrying it get a method-level invalidArguments rather than silent drop.
 */
final class AddressBookSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(private readonly AddressBookRepository $books) {}

    public function name(): string
    {
        return 'AddressBook/set';
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
        if (($args['onSuccessSetIsDefault'] ?? null) !== null) {
            throw new JmapMethodException(
                'invalidArguments',
                'onSuccessSetIsDefault is not supported: the default address book is fixed.',
            );
        }

        $oldState = JmapAccountStateCodec::compose($this->books->syncTokens($username));
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $created = [];
        $notCreated = [];
        foreach ($create as $creationId => $payload) {
            if (! is_array($payload)) {
                $notCreated[(string) $creationId] = ['type' => 'invalidProperties', 'description' => 'AddressBook create entry must be an object.', 'properties' => []];

                continue;
            }
            try {
                if (array_key_exists('shareWith', $payload)) {
                    $notCreated[(string) $creationId] = [
                        'type' => 'invalidProperties',
                        'description' => 'shareWith is not supported.',
                        'properties' => ['shareWith'],
                    ];

                    continue;
                }
                $created[(string) $creationId] = $this->books->create($username, $payload);
            } catch (ApiHttpException $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::serverFail($e);
            }
        }

        $updated = [];
        $notUpdated = [];
        foreach ($update as $bookId => $patch) {
            if (! is_array($patch)) {
                $notUpdated[(string) $bookId] = ['type' => 'invalidProperties', 'description' => 'AddressBook update entry must be an object.', 'properties' => []];

                continue;
            }
            try {
                if (array_key_exists('shareWith', $patch)) {
                    $notUpdated[(string) $bookId] = [
                        'type' => 'invalidProperties',
                        'description' => 'shareWith is not supported.',
                        'properties' => ['shareWith'],
                    ];

                    continue;
                }
                $this->books->update($username, (string) $bookId, $patch);
                $updated[(string) $bookId] = null;
            } catch (ApiHttpException $e) {
                $notUpdated[(string) $bookId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notUpdated[(string) $bookId] = JmapSetErrors::serverFail($e);
            }
        }

        $destroyed = [];
        $notDestroyed = [];
        $destroyOptions = ($args['onDestroyRemoveContents'] ?? false) === true
            ? ['onDestroyRemoveContents' => true]
            : [];
        foreach ($destroy as $bookId) {
            if (! is_string($bookId) || $bookId === '') {
                continue;
            }
            try {
                $this->books->delete($username, $bookId, $destroyOptions);
                $destroyed[] = $bookId;
            } catch (ApiHttpException $e) {
                $notDestroyed[$bookId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notDestroyed[$bookId] = JmapSetErrors::serverFail($e);
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => JmapAccountStateCodec::compose($this->books->syncTokens($username)),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }
}
