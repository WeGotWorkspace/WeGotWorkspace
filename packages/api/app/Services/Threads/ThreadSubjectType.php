<?php

declare(strict_types=1);

namespace App\Services\Threads;

/**
 * What an app implements to get threads (#2173, docs/architecture/threads.md,
 * "Adding threads to another app"). The shared service asks it everything it
 * needs to know about the subject; it never looks at the app's data itself.
 */
interface ThreadSubjectType
{
    /** The short name in routes and in `X-WGW-SUBJECT-TYPE`, such as `task`. */
    public function type(): string;

    /** Null when $username cannot see the subject; the route then answers 404. */
    public function resolve(string $username, string $subjectId): ?ThreadSubject;

    /**
     * Everyone who can see the subject now. Mentions outside it are not stored,
     * and nobody outside it is notified.
     *
     * @return list<string> usernames
     */
    public function audience(ThreadSubject $subject): array;

    /**
     * The people who always hear about new comments (for tasks, the assignees).
     *
     * @return list<string> usernames
     */
    public function followers(ThreadSubject $subject): array;

    /**
     * The scopes $username can read now, for the push state.
     *
     * @return list<string>
     */
    public function readableScopes(string $username): array;

    /**
     * The app's own notification actions.
     *
     * @return array{activity: string, mentioned: string}
     */
    public function notificationActions(): array;

    /** The web app path a notification about the subject opens. */
    public function navigate(ThreadSubject $subject): string;
}
