<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\ChatChannelMeta;

/**
 * Structured facts + copy for chat.message_posted: who/where title, message snippet.
 */
final class ChatMessagePostedNotify
{
    public const PREVIEW_MAX = 140;

    /**
     * @return array{
     *     actor: string,
     *     actorUsername: string,
     *     channelKind: string,
     *     channelName: string,
     *     channelUri: string,
     *     snippet: string,
     *     isDm: bool,
     *     navigate: string,
     *     tag: string
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
    ): array {
        $preview = mb_substr(trim($body), 0, self::PREVIEW_MAX);
        if ($preview === '') {
            $preview = 'New message';
        }
        $authorLabel = trim($authorDisplayName) !== '' ? trim($authorDisplayName) : $authorUsername;
        $isDm = self::isDirectMessage($channelUri, $kind);

        return [
            'actor' => $authorLabel,
            'actorUsername' => $authorUsername,
            'channelKind' => $kind,
            'channelName' => trim($channelName),
            'channelUri' => $channelUri,
            'snippet' => $preview,
            'isDm' => $isDm,
            'navigate' => self::navigate($channelUri, $kind, $authorUsername),
            'tag' => 'chat.message:'.$messageUid,
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
            || self::isDirectMessage(
                (string) ($data['channelUri'] ?? ''),
                (string) ($data['channelKind'] ?? ''),
            );
        $where = self::channelTitle(
            (string) ($data['channelKind'] ?? ''),
            (string) ($data['channelName'] ?? ''),
        );
        $snippet = trim((string) ($data['snippet'] ?? ''));
        if ($snippet === '') {
            $snippet = 'New message';
        }

        return [
            'title' => $isDm
                ? $actor.' sent you a direct message'
                : $actor.' sent a message in '.$where,
            'body' => $snippet,
        ];
    }

    public static function navigate(string $channelUri, string $kind, string $authorUsername): string
    {
        if (self::isDirectMessage($channelUri, $kind)) {
            return '/meet/dms/'.rawurlencode(strtolower($authorUsername));
        }
        $public = rawurlencode(ChatCollectionUris::publicUriSegment($channelUri));
        if ($kind === ChatChannelMeta::KIND_MEETING) {
            return '/meet/meetings/'.$public;
        }

        return '/meet/channels/'.$public;
    }

    public static function isDirectMessage(string $channelUri, string $kind): bool
    {
        return $kind === ChatChannelMeta::KIND_DM
            || str_starts_with($channelUri, ChatCollectionUris::PREFIX_DM);
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
