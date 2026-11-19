<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Services\Tasks\Conversion\TaskConversionSupport;

/**
 * What one write changed on one task (#2172): a pure diff of two task arrays
 * as {@see TaskMapper} returns them. No I/O, so it can be unit-tested.
 *
 * REST, MCP and CalDAV writes all compute it. The `tasks.assigned`
 * notification reads it, and Epic #2173's activity log renders it.
 *
 * - Scalar fields report `{from, to}`.
 * - `categories` reports the added and removed keywords.
 * - `description` only reports that it changed.
 * - `assignees` reports the added and removed participant ids. The owner
 *   (ORGANIZER) is not an assignee.
 * - `taskListId` reports a move as `{from, to}`.
 * - `created` and `deleted` are set when one side is missing.
 */
final class TaskChangeSet
{
    /** @var list<string> */
    public const SCALAR_FIELDS = ['title', 'workflowStatus', 'priority', 'start', 'due', 'showWithoutTime', 'taskListId'];

    /**
     * @param  array<string, array{from: mixed, to: mixed}>  $scalars
     * @param  list<string>  $categoriesAdded
     * @param  list<string>  $categoriesRemoved
     * @param  list<string>  $assigneesAdded
     * @param  list<string>  $assigneesRemoved
     */
    private function __construct(
        public readonly ?string $taskId,
        public readonly bool $created,
        public readonly bool $deleted,
        public readonly array $scalars,
        public readonly array $categoriesAdded,
        public readonly array $categoriesRemoved,
        public readonly bool $descriptionChanged,
        public readonly array $assigneesAdded,
        public readonly array $assigneesRemoved,
    ) {}

    /**
     * @param  array<string, mixed>|null  $before  null for a create
     * @param  array<string, mixed>|null  $after  null for a delete
     */
    public static function between(?array $before, ?array $after): self
    {
        $old = $before ?? [];
        $new = $after ?? [];
        $id = $new['id'] ?? $old['id'] ?? null;

        $scalars = [];
        foreach (self::SCALAR_FIELDS as $field) {
            $from = $before === null ? null : self::scalar($old, $field);
            $to = $after === null ? null : self::scalar($new, $field);
            if ($from !== $to) {
                $scalars[$field] = ['from' => $from, 'to' => $to];
            }
        }

        $oldCategories = self::keywords($old);
        $newCategories = self::keywords($new);
        $oldAssignees = self::assigneeIds($old);
        $newAssignees = self::assigneeIds($new);

        return new self(
            taskId: is_string($id) && $id !== '' ? $id : null,
            created: $before === null && $after !== null,
            deleted: $before !== null && $after === null,
            scalars: $scalars,
            categoriesAdded: array_values(array_diff($newCategories, $oldCategories)),
            categoriesRemoved: array_values(array_diff($oldCategories, $newCategories)),
            descriptionChanged: self::description($old) !== self::description($new),
            assigneesAdded: array_values(array_diff($newAssignees, $oldAssignees)),
            assigneesRemoved: array_values(array_diff($oldAssignees, $newAssignees)),
        );
    }

    public function isEmpty(): bool
    {
        return ! $this->created
            && ! $this->deleted
            && $this->scalars === []
            && $this->categoriesAdded === []
            && $this->categoriesRemoved === []
            && ! $this->descriptionChanged
            && $this->assigneesAdded === []
            && $this->assigneesRemoved === [];
    }

    public function changed(string $field): bool
    {
        return array_key_exists($field, $this->scalars);
    }

    public function moved(): bool
    {
        return ! $this->created && ! $this->deleted && $this->changed('taskListId');
    }

    /**
     * Usernames of the added assignees that are accounts here (`u:` ids).
     *
     * @return list<string>
     */
    public function addedAssigneeUsernames(): array
    {
        $usernames = [];
        foreach ($this->assigneesAdded as $id) {
            $username = TaskConversionSupport::usernameFromParticipantId($id);
            if ($username !== null) {
                $usernames[$username] = $username;
            }
        }

        return array_values($usernames);
    }

    /**
     * @param  array<string, mixed>  $task
     */
    private static function scalar(array $task, string $field): mixed
    {
        $value = $task[$field] ?? null;
        if ($field === 'title' && is_string($value)) {
            return trim($value);
        }
        if ($field === 'showWithoutTime') {
            return $value === true;
        }

        return is_scalar($value) ? $value : null;
    }

    /**
     * @param  array<string, mixed>  $task
     * @return list<string>
     */
    private static function keywords(array $task): array
    {
        $keywords = $task['keywords'] ?? $task['categories'] ?? [];
        if (! is_array($keywords)) {
            return [];
        }
        $out = [];
        foreach ($keywords as $key => $value) {
            // JMAP keywords are a set ({"name": true}); a plain list also counts.
            $name = is_string($key) ? $key : (is_string($value) ? $value : null);
            if ($name !== null && $value !== false && trim($name) !== '') {
                $out[trim($name)] = trim($name);
            }
        }

        return array_values($out);
    }

    /**
     * @param  array<string, mixed>  $task
     */
    private static function description(array $task): string
    {
        $value = $task['description'] ?? '';

        return is_string($value) ? trim($value) : '';
    }

    /**
     * @param  array<string, mixed>  $task
     * @return list<string>
     */
    private static function assigneeIds(array $task): array
    {
        $participants = $task['participants'] ?? null;
        if (! is_array($participants)) {
            return [];
        }
        $ids = [];
        foreach ($participants as $id => $entry) {
            if (! is_array($entry) || TaskConversionSupport::isOwnerParticipant($entry)) {
                continue;
            }
            $ids[] = (string) $id;
        }

        return $ids;
    }
}
