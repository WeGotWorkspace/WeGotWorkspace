<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\ChatChannelMeta;
use App\Services\Chat\ChatMessagePostedNotify;

/**
 * Structured facts + copy for chat.mentioned (mention-shaped; no dual message_posted).
 */
final class ChatMentionedNotify
{
    public const ACTION = 'mentioned';

    /**
     * @return array{
     *     actor: string,
     *     actorUsername: string,
     *     channelKind: string,
     *     channelName: string,
     *     channelUri: string,
     *     snippet: string,
     *     mentions: list<string>,
     *     messageId: string,
     *     isDm: bool,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string
     * }
     */
    public static function eventData(
        string $channelUri,
        string $kind,
        string $channelName,
        string $authorUsername,
        string $authorDisplayName,
        string $body,
        string $messageUid,
        array $mentions,
    ): array {
        $base = ChatMessagePostedNotify::eventData(
            $channelUri,
            $kind,
            $channelName,
            $authorUsername,
            $authorDisplayName,
            $body,
            $messageUid,
        );

        return [
            ...$base,
            'mentions' => array_values($mentions),
            'messageId' => $messageUid,
            'tag' => self::dedupeKey($messageUid),
            'dedupe_key' => self::dedupeKey($messageUid),
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
        $isDm = ($data['isDm'] ?? false) === true
            || ChatMessagePostedNotify::isDirectMessage(
                (string) ($data['channelUri'] ?? ''),
                (string) ($data['channelKind'] ?? ''),
            );
        $where = self::channelTitle(
            (string) ($data['channelKind'] ?? ''),
            (string) ($data['channelName'] ?? ''),
        );
        $snippet = trim((string) ($data['snippet'] ?? ''));
        if ($snippet === '') {
            $snippet = 'mentioned you';
        }

        return [
            'title' => $isDm
                ? $actor.' mentioned you in a direct message'
                : $actor.' mentioned you in '.$where,
            'body' => $snippet,
        ];
    }

    public static function dedupeKey(string $messageId): string
    {
        return 'chat.mentioned:'.trim($messageId);
    }

    private static function channelTitle(string $kind, string $channelName): string
    {
        $name = trim($channelName);
        if ($name === '') {
            $name = 'chat';
        }
        if ($kind === ChatChannelMeta::KIND_MEETING) {
            return $name;
        }

        return '#'.mb_strtolower($name);
    }
}
