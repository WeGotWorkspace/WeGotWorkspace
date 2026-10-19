<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\UpdateFeedDefaults;
use PHPUnit\Framework\TestCase;

final class UpdateFeedDefaultsTest extends TestCase
{
    private const CHANNEL_BASE = 'https://github.com/WeGotWorkspace/wegotworkspace/releases/download/channel-';

    public function test_each_channel_has_its_own_feed(): void
    {
        $this->assertSame(UpdateFeedDefaults::MANIFEST_URL, UpdateFeedDefaults::manifestUrlFor('stable'));
        $this->assertSame(self::CHANNEL_BASE.'beta/manifest.json', UpdateFeedDefaults::manifestUrlFor('beta'));
        $this->assertSame(self::CHANNEL_BASE.'edge/manifest.json', UpdateFeedDefaults::manifestUrlFor('edge'));
    }

    public function test_unknown_or_empty_channel_is_stable(): void
    {
        foreach ([null, '', 'nightly', 42] as $value) {
            $this->assertSame('stable', UpdateFeedDefaults::normalizeChannel($value));
        }
        $this->assertSame('beta', UpdateFeedDefaults::normalizeChannel(' Beta '));
    }

    public function test_the_seeded_stable_feed_url_follows_the_channel(): void
    {
        $this->assertSame(
            self::CHANNEL_BASE.'edge/manifest.json',
            UpdateFeedDefaults::feedUrl(UpdateFeedDefaults::MANIFEST_URL, 'edge'),
        );
        $this->assertSame(self::CHANNEL_BASE.'beta/manifest.json', UpdateFeedDefaults::feedUrl('', 'beta'));
        $this->assertSame(UpdateFeedDefaults::MANIFEST_URL, UpdateFeedDefaults::feedUrl(null, null));
    }

    public function test_a_custom_feed_url_overrides_the_channel(): void
    {
        $this->assertSame(
            'https://updates.example/manifest.json',
            UpdateFeedDefaults::feedUrl(' https://updates.example/manifest.json ', 'edge'),
        );
    }
}
