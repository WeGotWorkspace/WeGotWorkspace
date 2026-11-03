<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\FileNodeSetMethod;
use App\Services\Jmap\Methods\JmapMethodInterface;

/**
 * FileNode/set for a guest upload account (#1715): only what an upload
 * needs. A create must be a file with a blobId; an update may only replace
 * content and must name the version it replaces; destroy and onExists are
 * refused. Whatever passes runs through the member FileNode/set, so
 * visibility, rights, name checks, and the version check are the same code.
 */
final class GuestFileNodeSetMethod implements JmapMethodInterface
{
    private const CREATE_PROPS = ['parentId', 'name', 'nodeType', 'blobId', 'size', 'type'];

    private const UPDATE_PROPS = ['blobId', 'size', 'expectedBlobId'];

    public function __construct(private readonly FileNodeSetMethod $set) {}

    public function name(): string
    {
        return 'FileNode/set';
    }

    public function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        if (($args['onExists'] ?? null) !== null) {
            throw new JmapMethodException('invalidArguments', 'onExists is not available to guests.');
        }

        $refusedCreates = [];
        $creates = is_array($args['create'] ?? null) ? $args['create'] : [];
        foreach ($creates as $creationId => $payload) {
            $reason = is_array($payload) ? $this->createRefusal($payload) : null;
            if ($reason !== null) {
                $refusedCreates[(string) $creationId] = $this->forbidden($reason);
                unset($creates[$creationId]);
            }
        }

        $refusedUpdates = [];
        $updates = is_array($args['update'] ?? null) ? $args['update'] : [];
        foreach ($updates as $nodeId => $patch) {
            $reason = is_array($patch) ? $this->updateRefusal($patch) : null;
            if ($reason !== null) {
                $refusedUpdates[(string) $nodeId] = $this->forbidden($reason);
                unset($updates[$nodeId]);
            }
        }

        $refusedDestroys = [];
        $destroy = is_array($args['destroy'] ?? null) && array_is_list($args['destroy']) ? $args['destroy'] : [];
        foreach ($destroy as $nodeId) {
            if (is_string($nodeId) && $nodeId !== '') {
                $refusedDestroys[$nodeId] = $this->forbidden('Guests cannot delete files.');
            }
        }

        $args['create'] = $creates;
        $args['update'] = $updates;
        $args['destroy'] = [];
        unset($args['onDestroyRemoveChildren']);
        $result = $this->set->handle($username, $args);

        $result['notCreated'] = $this->merge($result['notCreated'] ?? [], $refusedCreates);
        $result['notUpdated'] = $this->merge($result['notUpdated'] ?? [], $refusedUpdates);
        $result['notDestroyed'] = $this->merge($result['notDestroyed'] ?? [], $refusedDestroys);

        return $result;
    }

    /**
     * @param  array<mixed>  $payload
     */
    private function createRefusal(array $payload): ?string
    {
        $extra = array_diff(array_map(strval(...), array_keys($payload)), self::CREATE_PROPS);
        if ($extra !== []) {
            return 'Guests cannot set '.implode(', ', $extra).'.';
        }
        if (($payload['nodeType'] ?? 'file') !== 'file') {
            return 'Guests can only add files.';
        }
        $blobId = $payload['blobId'] ?? null;
        if (! is_string($blobId) || $blobId === '') {
            return 'Guests can only add files with uploaded content.';
        }

        return null;
    }

    /**
     * @param  array<mixed>  $patch
     */
    private function updateRefusal(array $patch): ?string
    {
        $extra = array_diff(array_map(strval(...), array_keys($patch)), self::UPDATE_PROPS);
        if ($extra !== []) {
            return 'Guests can only replace the content of a file.';
        }
        if (! array_key_exists('blobId', $patch) || ! array_key_exists('expectedBlobId', $patch)) {
            return 'Guests replace a file only with blobId and expectedBlobId.';
        }

        return null;
    }

    /**
     * @return array{type: string, description: string}
     */
    private function forbidden(string $description): array
    {
        return ['type' => 'forbidden', 'description' => $description];
    }

    /**
     * @param  array<string, mixed>  $refused
     * @return array<string, mixed>
     */
    private function merge(mixed $fromSet, array $refused): array
    {
        $fromSet = is_array($fromSet) ? $fromSet : [];

        return $refused === [] ? $fromSet : $fromSet + $refused;
    }
}
