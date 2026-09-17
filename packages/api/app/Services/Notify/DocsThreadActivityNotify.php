<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;

/**
 * Structured facts + copy for docs.thread_activity: comment/suggestion/reply on a doc.
 *
 * TODO(#801 / Goal #549): do not ship `docs.mentioned` inbox rows until mention
 * persistence exists; {@see mentionUsernamesFromBody} only feeds auto-subscribe.
 */
final class DocsThreadActivityNotify
{
    public const ACTION = 'thread_activity';

    public const PREVIEW_MAX = 140;

    /**
     * @param  list<string>  $recipients
     * @return array{
     *     recipients: list<string>,
     *     actor: string,
     *     path: string,
     *     fileName: string,
     *     threadId: string,
     *     messageId: string,
     *     kind: string,
     *     isReply: bool,
     *     snippet: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }
     */
    public static function eventData(
        string $actorLabel,
        string $path,
        string $threadId,
        string $messageId,
        string $kind,
        bool $isReply,
        array $recipients,
        ?string $snippet = null,
    ): array {
        $name = basename($path) ?: $path;
        $preview = $snippet !== null ? mb_substr(trim($snippet), 0, self::PREVIEW_MAX) : null;
        if ($preview === '') {
            $preview = null;
        }

        return [
            'recipients' => $recipients,
            'actor' => $actorLabel,
            'path' => $path,
            'fileName' => $name,
            'threadId' => $threadId,
            'messageId' => $messageId,
            'kind' => $kind,
            'isReply' => $isReply,
            'snippet' => $preview,
            'navigate' => self::navigate($path),
            'tag' => self::tag($threadId),
            'dedupe_key' => self::dedupeKey($threadId),
            'supersede' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        if ($actor === '') {
            $actor = 'Someone';
        }
        $fileName = trim((string) ($data['fileName'] ?? ''));
        $path = trim((string) ($data['path'] ?? ''));
        if ($fileName === '') {
            $fileName = $path !== '' ? (basename($path) ?: $path) : 'a document';
        }
        $kind = trim((string) ($data['kind'] ?? 'comment'));
        $isReply = ($data['isReply'] ?? false) === true;
        $snippet = isset($data['snippet']) && is_string($data['snippet']) ? trim($data['snippet']) : '';

        $noun = $kind === 'suggestion' ? 'suggestion' : 'comment';
        $titleRest = $isReply
            ? ' replied on '.$fileName
            : ' left a '.$noun.' on '.$fileName;

        return [
            'title' => $actor.$titleRest,
            'body' => $snippet !== '' ? $snippet : null,
        ];
    }

    public static function navigate(string $path): string
    {
        $trimmed = ltrim(trim($path), '/');

        return $trimmed === '' ? '/docs' : '/docs?file='.rawurlencode($trimmed);
    }

    public static function dedupeKey(string $threadId): string
    {
        return 'docs.thread_activity:'.trim($threadId);
    }

    public static function tag(string $threadId): string
    {
        return self::dedupeKey($threadId);
    }

    public static function actorLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }

    /**
     * Path ACL owners as resolved by Drive path roots: personal owner, or all
     * group members for `/groups/{slug}/…` (group-owned docs).
     *
     * @return list<string>
     */
    public static function pathAclOwnerUsernames(string $path): array
    {
        $segments = explode('/', ltrim($path, '/'));
        $root = $segments[0] ?? '';
        $owner = strtolower(trim((string) ($segments[1] ?? '')));
        if ($owner === '') {
            return [];
        }
        if ($root === 'users') {
            return [$owner];
        }
        if ($root === 'groups') {
            return self::usernamesForGroupSlug($owner);
        }

        return [];
    }

    /**
     * Cheap @token scan for auto-subscribe; unknown tokens ignored.
     *
     * @return list<string>
     */
    public static function mentionUsernamesFromBody(string $body): array
    {
        if ($body === '' || ! preg_match_all('/(?:^|[\s([{])@([a-zA-Z0-9._-]+)/u', $body, $matches)) {
            return [];
        }
        $out = [];
        foreach ($matches[1] as $token) {
            $username = strtolower(trim((string) $token));
            if ($username === '' || isset($out[$username])) {
                continue;
            }
            if (Principal::forUsername($username) === null) {
                continue;
            }
            $out[$username] = $username;
        }

        return array_values($out);
    }

    /**
     * @param  list<string>  $owners
     * @param  list<string>  $participants
     * @param  list<string>  $mentions
     * @return list<string>
     */
    public static function unionRecipients(array $owners, array $participants, array $mentions = []): array
    {
        $out = [];
        foreach ([$owners, $participants, $mentions] as $set) {
            foreach ($set as $username) {
                if (! is_string($username)) {
                    continue;
                }
                $trimmed = strtolower(trim($username));
                if ($trimmed !== '') {
                    $out[$trimmed] = $trimmed;
                }
            }
        }

        return array_values($out);
    }

    /**
     * @return list<string>
     */
    private static function usernamesForGroupSlug(string $slug): array
    {
        $uri = AdminConstants::GROUP_PREFIX.$slug;

        return GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', $uri)
            ->pluck('m.uri')
            ->map(static fn (mixed $uri): string => str_replace('principals/', '', (string) $uri))
            ->map(static fn (string $username): string => strtolower(trim($username)))
            ->filter(static fn (string $username): bool => $username !== '')
            ->unique()
            ->values()
            ->all();
    }
}
