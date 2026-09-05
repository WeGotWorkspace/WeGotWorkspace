<?php

declare(strict_types=1);

namespace App\Services\Chat;

/**
 * Canonical CalDAV collection URI prefixes for chat channels and DMs.
 *
 * Chat collections are VJOURNAL-only like notebooks; the URI prefix is the
 * discriminator that keeps notebook queries and chat queries out of each
 * other's results, and drives the DAV-exposure filter (chat collections are
 * API-only surfaces, invisible to CalDAV clients — see ChatHiddenCalendarBackend).
 */
final class ChatCollectionUris
{
    public const PREFIX_CHANNEL = 'chat-';

    public const PREFIX_DM = 'dm-';

    /** @return list<string> */
    public static function prefixes(): array
    {
        return [self::PREFIX_CHANNEL, self::PREFIX_DM];
    }

    /**
     * Prefixes hidden from DAV enumeration and direct DAV access.
     * Configurable so a future collection family can opt in without touching
     * the DAV layer; defaults to the chat prefixes only — notes stay visible
     * by design (see ChatCollectionsDavExposureTest).
     *
     * @return list<string>
     */
    public static function hiddenDavPrefixes(): array
    {
        $configured = config('wgw.chat.dav_hidden_prefixes');
        if (is_array($configured) && $configured !== []) {
            return array_values(array_filter(array_map('strval', $configured), static fn (string $prefix): bool => $prefix !== ''));
        }

        return self::prefixes();
    }

    public static function isChatUri(string $uri): bool
    {
        foreach (self::prefixes() as $prefix) {
            if (str_starts_with($uri, $prefix)) {
                return true;
            }
        }

        return false;
    }

    public static function channelUri(string $ulid): string
    {
        return self::PREFIX_CHANNEL.strtolower($ulid);
    }

    /**
     * DM collection uri for a user pair — order-independent hash over the
     * sorted usernames, so both sides derive the same collection id. Hashing
     * (vs joining the raw names) keeps the id unambiguous for usernames that
     * contain "-" and fits the 64-char meet room-id limit — DM calls use the
     * channel id as the room id (MeetChannelJoinPolicy).
     */
    public static function dmUri(string $usernameA, string $usernameB): string
    {
        $pair = [strtolower(trim($usernameA)), strtolower(trim($usernameB))];
        sort($pair, SORT_STRING);

        return self::PREFIX_DM.substr(hash('sha256', $pair[0]."\n".$pair[1]), 0, 40);
    }
}
