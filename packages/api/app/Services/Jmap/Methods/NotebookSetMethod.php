<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapSetErrors;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;
use App\Services\Notes\NotebookRepository;
use App\Services\Notes\NoteRepository;

/**
 * Notebook/set over NotebookRepository create/update/delete.
 */
final class NotebookSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(
        private readonly NotebookRepository $notebooks,
        private readonly NoteRepository $notes,
    ) {}

    public function name(): string
    {
        return 'Notebook/set';
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
                    'description' => 'Notebook create entry must be an object.',
                    'properties' => [],
                ];

                continue;
            }
            try {
                $created[(string) $creationId] = $this->notebooks->create($username, $payload);
            } catch (ApiHttpException $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::serverFail($e);
            }
        }

        $updated = [];
        $notUpdated = [];
        foreach ($update as $notebookId => $patch) {
            if (! is_array($patch)) {
                $notUpdated[(string) $notebookId] = [
                    'type' => 'invalidProperties',
                    'description' => 'Notebook update entry must be an object.',
                    'properties' => [],
                ];

                continue;
            }
            try {
                $this->notebooks->update($username, (string) $notebookId, $patch);
                $updated[(string) $notebookId] = null;
            } catch (ApiHttpException $e) {
                $notUpdated[(string) $notebookId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notUpdated[(string) $notebookId] = JmapSetErrors::serverFail($e);
            }
        }

        $destroyed = [];
        $notDestroyed = [];
        $destroyOptions = ($args['onDestroyRemoveContents'] ?? false) === true
            ? ['onDestroyRemoveContents' => true]
            : [];
        foreach ($destroy as $notebookId) {
            if (! is_string($notebookId) || $notebookId === '') {
                continue;
            }
            try {
                $this->notebooks->delete($username, $notebookId, $destroyOptions);
                $destroyed[] = $notebookId;
            } catch (ApiHttpException $e) {
                $notDestroyed[$notebookId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notDestroyed[$notebookId] = JmapSetErrors::serverFail($e);
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
}
