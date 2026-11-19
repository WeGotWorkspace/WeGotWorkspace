<?php

declare(strict_types=1);

namespace Tests\Support\Threads;

use App\Services\Threads\ThreadSubject;
use App\Services\Threads\ThreadSubjectType;

/**
 * A test-only subject type with nothing to do with tasks (#2173, plan.md
 * "The shared thread layer has no task code"). A "note" lives in a "book";
 * who may read and post is set per note. Moving a note changes its book.
 */
final class FakeThreadSubject implements ThreadSubjectType
{
    public const TYPE = 'fakenote';

    /** @var array<string, array{book: string, owner: string, readers: array<string, bool>}> */
    private array $notes = [];

    /**
     * @param  array<string, bool>  $readers  username => may post
     */
    public function put(string $noteId, string $book, string $owner, array $readers): void
    {
        $this->notes[$noteId] = ['book' => $book, 'owner' => $owner, 'readers' => $readers];
    }

    public function move(string $noteId, string $book): void
    {
        $this->notes[$noteId]['book'] = $book;
    }

    public function type(): string
    {
        return self::TYPE;
    }

    public function resolve(string $username, string $subjectId): ?ThreadSubject
    {
        $note = $this->notes[$subjectId] ?? null;
        if ($note === null || ! array_key_exists($username, $note['readers'])) {
            return null;
        }

        return new ThreadSubject(self::TYPE, $subjectId, $subjectId, $note['book'], 'book-'.$note['book'], $note['owner'], $note['readers'][$username]);
    }

    public function audience(ThreadSubject $subject): array
    {
        return array_keys($this->notes[$subject->id]['readers'] ?? []);
    }

    public function followers(ThreadSubject $subject): array
    {
        return [];
    }

    public function readableScopes(string $username): array
    {
        $scopes = [];
        foreach ($this->notes as $note) {
            if (array_key_exists($username, $note['readers'])) {
                $scopes[$note['book']] = $note['book'];
            }
        }

        return array_values($scopes);
    }

    public function notificationActions(): array
    {
        return ['activity' => 'fakenotes.thread_activity', 'mentioned' => 'fakenotes.mentioned'];
    }

    public function navigate(ThreadSubject $subject): string
    {
        return '/fakenotes/'.$subject->id;
    }
}
