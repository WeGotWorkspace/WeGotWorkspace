<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use PHPUnit\Framework\TestCase;

final class CalendarColorPaletteTest extends TestCase
{
    public function test_reserved_personal_uris_have_distinct_colors(): void
    {
        $colors = [
            CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_DEFAULT),
            CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_HOME),
            CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_WORK),
            CalendarColorPalette::forUri(CalendarCollectionUris::TASK_INBOX),
            CalendarColorPalette::forUri(CalendarCollectionUris::TASK_HOME),
            CalendarColorPalette::forUri(CalendarCollectionUris::TASK_WORK),
        ];

        $this->assertSame(CalendarColorPalette::SHARED_DEFAULT, $colors[0]);
        $this->assertCount(count($colors), array_unique($colors));
        foreach ($colors as $color) {
            $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $color);
            $this->assertLessThanOrEqual(10, strlen($color));
        }
    }

    public function test_group_slug_hash_is_stable_and_skips_shared_default(): void
    {
        $first = CalendarColorPalette::forUri('engineering');
        $this->assertSame($first, CalendarColorPalette::forUri('engineering'));
        $this->assertNotSame(CalendarColorPalette::SHARED_DEFAULT, $first);
        $this->assertNotSame($first, CalendarColorPalette::forUri('marketing'));
        $this->assertContains($first, CalendarColorPalette::SWATCHES);
    }

    public function test_blank_or_shared_default_detects_indigo_and_apple_alpha(): void
    {
        $this->assertTrue(CalendarColorPalette::isBlankOrSharedDefault(null));
        $this->assertTrue(CalendarColorPalette::isBlankOrSharedDefault(''));
        $this->assertTrue(CalendarColorPalette::isBlankOrSharedDefault('  #6366F1  '));
        $this->assertTrue(CalendarColorPalette::isBlankOrSharedDefault('#6366f1ff'));
        $this->assertFalse(CalendarColorPalette::isBlankOrSharedDefault('#0ea5e9'));
        $this->assertFalse(CalendarColorPalette::isBlankOrSharedDefault('#ec4899'));
    }
}
