<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapSetErrors;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;
use App\Services\Notes\NoteRepository;

/**
 * Note/set over NoteRepository create/patch/delete (+ optional starred).
 */
final class NoteSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(private readonly NoteRepository $notes) {}

    public function name(): string
    {
        return 'Note/set';
    }

    public function capability(): string
    {
        return JmapCapabilities::NOTES;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $oldState = JmapAccountStateCodec::compose($this->notes->notebookSyncTokens($username));
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $created = [];
        $notCreated = [];
        foreach ($create as $creationId => $payload) {
            if (! is_array($payload)) {
                $notCreated[(string) $creationId] = [
                    'type' => 'invalidProperties',
                    'description' => 'Note create entry must be an object.',
                    'properties' => [],
                ];

                continue;
            }
            try {
                $note = $this->notes->create($username, $payload);
                $this->applyStarred($username, (string) $note['id'], $payload);
                $created[(string) $creationId] = $this->notes->show($username, (string) $note['id']);
            } catch (ApiHttpException $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::serverFail($e);
            }
        }

        $updated = [];
        $notUpdated = [];
        foreach ($update as $noteId => $patch) {
            if (! is_array($patch)) {
                $notUpdated[(string) $noteId] = [
                    'type' => 'invalidProperties',
                    'description' => 'Note update entry must be an object.',
                    'properties' => [],
                ];

                continue;
            }
            try {
                $fieldPatch = $patch;
                unset($fieldPatch['starred'], $fieldPatch['etag']);
                $ifMatch = isset($patch['etag']) && is_string($patch['etag']) ? $patch['etag'] : null;
                if ($fieldPatch !== []) {
                    $this->notes->patch(
                        $username,
                        (string) $noteId,
                        $fieldPatch,
                        $ifMatch,
                        requirePrecondition: $ifMatch !== null,
                    );
                }
                $this->applyStarred($username, (string) $noteId, $patch);
                $updated[(string) $noteId] = null;
            } catch (ApiHttpException $e) {
                $notUpdated[(string) $noteId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notUpdated[(string) $noteId] = JmapSetErrors::serverFail($e);
            }
        }

        $destroyed = [];
        $notDestroyed = [];
        foreach ($destroy as $noteId) {
            if (! is_string($noteId) || $noteId === '') {
                continue;
            }
            try {
                $this->notes->delete($username, $noteId, null, requirePrecondition: false);
                $destroyed[] = $noteId;
            } catch (ApiHttpException $e) {
                $notDestroyed[$noteId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notDestroyed[$noteId] = JmapSetErrors::serverFail($e);
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => JmapAccountStateCodec::compose($this->notes->notebookSyncTokens($username)),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function applyStarred(string $username, string $noteId, array $payload): void
    {
        if (! array_key_exists('starred', $payload)) {
            return;
        }
        if ($payload['starred'] === true) {
            $this->notes->star($username, $noteId);

            return;
        }
        if ($payload['starred'] === false) {
            $this->notes->unstar($username, $noteId);
        }
    }
}
