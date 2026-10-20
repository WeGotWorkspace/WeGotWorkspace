<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Release feeds per update channel. Stable is GitHub's releases/latest, which
 * skips prereleases. Beta and edge are rolling prereleases whose manifest.json
 * is replaced on every publish (tools/publish-release-channel.mjs).
 */
final class UpdateFeedDefaults
{
    public const MANIFEST_URL = 'https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/manifest.json';

    public const CHANNEL_STABLE = 'stable';

    public const CHANNEL_BETA = 'beta';

    public const CHANNEL_EDGE = 'edge';

    public const CHANNELS = [self::CHANNEL_STABLE, self::CHANNEL_BETA, self::CHANNEL_EDGE];

    private const CHANNEL_RELEASE_BASE = 'https://github.com/WeGotWorkspace/wegotworkspace/releases/download/channel-';

    public static function manifestUrlFor(string $channel): string
    {
        $channel = self::normalizeChannel($channel);

        return match ($channel) {
            self::CHANNEL_BETA, self::CHANNEL_EDGE => self::CHANNEL_RELEASE_BASE.$channel.'/manifest.json',
            default => self::MANIFEST_URL,
        };
    }

    /**
     * The installer seeds WGW_UPDATE_FEED_URL with the stable feed, so that
     * value is not an override: the channel decides. Any other URL wins.
     */
    public static function feedUrl(mixed $explicit, mixed $channel): string
    {
        $explicit = is_string($explicit) ? trim($explicit) : '';
        if ($explicit !== '' && $explicit !== self::MANIFEST_URL) {
            return $explicit;
        }

        return self::manifestUrlFor(is_string($channel) ? $channel : '');
    }

    /** Unknown or empty values fall back to stable. */
    public static function normalizeChannel(mixed $channel): string
    {
        $value = is_string($channel) ? strtolower(trim($channel)) : '';

        return in_array($value, self::CHANNELS, true) ? $value : self::CHANNEL_STABLE;
    }

    public static function isChannel(string $channel): bool
    {
        return in_array($channel, self::CHANNELS, true);
    }
}
