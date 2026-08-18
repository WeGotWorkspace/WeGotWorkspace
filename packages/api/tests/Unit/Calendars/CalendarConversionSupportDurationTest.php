<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\CalendarConversionSupport;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * RFC 8984 §1.4.6: duration = "P" (dur-cal [dur-time] / dur-time)
 * where dur-cal is weeks and/or days only — no dur-year / dur-month.
 */
final class CalendarConversionSupportDurationTest extends TestCase
{
    #[DataProvider('rfc8984Durations')]
    public function test_duration_uses_days_hours_minutes_seconds_never_years_or_months(
        string $start,
        string $end,
        string $expected,
    ): void {
        $duration = CalendarConversionSupport::durationBetweenJmapDateTimes($start, $end);

        $this->assertSame($expected, $duration);
        $this->assertDoesNotMatchRegularExpression(
            '/P[^T]*[YM]/',
            (string) $duration,
            'RFC 8984 §1.4.6 forbids years and months before T',
        );
        $this->assertMatchesRegularExpression(
            '/^P(?=\d|T)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/',
            (string) $duration,
        );
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function rfc8984Durations(): array
    {
        return [
            'one hour utc' => ['2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z', 'PT1H'],
            'four hours floating' => ['2026-08-10T10:00:00', '2026-08-10T14:00:00', 'PT4H'],
            'one all-day' => ['2026-07-04', '2026-07-05', 'P1D'],
            'one calendar month is days' => ['2026-01-01', '2026-02-01', 'P31D'],
            'two months five days is days' => ['2026-01-01', '2026-03-06', 'P64D'],
            'timed span across months' => ['2026-01-15T10:00:00Z', '2026-03-20T14:30:00Z', 'P64DT4H30M'],
            'one year is days' => ['2025-01-01', '2026-01-01', 'P365D'],
            'leap year is days' => ['2024-01-01', '2025-01-01', 'P366D'],
        ];
    }

    public function test_empty_or_inverted_span_returns_null(): void
    {
        $this->assertNull(CalendarConversionSupport::durationBetweenJmapDateTimes('', '2026-01-02'));
        $this->assertNull(CalendarConversionSupport::durationBetweenJmapDateTimes('2026-01-02', '2026-01-01'));
        $this->assertNull(CalendarConversionSupport::durationBetweenJmapDateTimes('2026-01-01', '2026-01-01'));
    }
}
