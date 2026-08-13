<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeSetService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * FileNode/set (draft-ietf-jmap-filenode-14 §3.2.3, #450) with genuine
 * top-level ifInState against the global sequence state, plus the draft's
 * extra arguments: onExists (null/replace/rename/newest),
 * onDestroyRemoveChildren, and compareCaseInsensitively.
 */
final class FileNodeSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeSetService $set,
    ) {}

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
        $oldState = (string) $this->index->currentSeq();
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $onExists = $args['onExists'] ?? null;
        if ($onExists !== null && ! in_array($onExists, ['replace', 'rename', 'newest'], true)) {
            throw new JmapMethodException('invalidArguments', 'onExists must be null, "replace", "rename", or "newest".');
        }
        $onDestroyRemoveChildren = ($args['onDestroyRemoveChildren'] ?? false) === true;
        $compareCaseInsensitively = ($args['compareCaseInsensitively'] ?? false) === true;

        $result = $this->set->apply(
            $username,
            $create,
            $update,
            $destroy,
            is_string($onExists) ? $onExists : null,
            $onDestroyRemoveChildren,
            $compareCaseInsensitively,
        );

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => (string) $this->index->currentSeq(),
        ] + $result;
    }
}
