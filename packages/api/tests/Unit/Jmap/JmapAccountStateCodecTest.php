<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use PHPUnit\Framework\TestCase;

/**
 * Envelope state codec round-trips (spec §4): the empty and single-calendar
 * cases are exactly where the pre-existing helpers fail
 * (composeCalendarState collapses to a bare token; parseInstancesState
 * rejects "0:").
 */
final class JmapAccountStateCodecTest extends TestCase
{
    public function test_empty_map_round_trips_via_zero_colon(): void
    {
        $state = JmapAccountStateCodec::compose([]);

        $this->assertSame('0:', $state);
        $this->assertSame([], JmapAccountStateCodec::decompose($state));
    }

    public function test_single_calendar_map_round_trips(): void
    {
        $map = ['default' => '17'];
        $state = JmapAccountStateCodec::compose($map);

        $this->assertSame('1:default:17', $state);
        $this->assertSame($map, JmapAccountStateCodec::decompose($state));
    }

    public function test_multi_calendar_map_round_trips_sorted_by_uri(): void
    {
        $state = JmapAccountStateCodec::compose(['work' => '3', 'default' => '17']);

        $this->assertSame('2:default:17,work:3', $state);
        $this->assertSame(
            ['default' => '17', 'work' => '3'],
            JmapAccountStateCodec::decompose($state),
        );
    }

    public function test_initial_sync_forms_decompose_to_the_empty_map(): void
    {
        $this->assertSame([], JmapAccountStateCodec::decompose(''));
        $this->assertSame([], JmapAccountStateCodec::decompose('0'));
        $this->assertSame([], JmapAccountStateCodec::decompose('0:'));
    }

    public function test_malformed_states_decompose_to_null(): void
    {
        $this->assertNull(JmapAccountStateCodec::decompose(null));
        $this->assertNull(JmapAccountStateCodec::decompose('17'));
        $this->assertNull(JmapAccountStateCodec::decompose('garbage'));
        $this->assertNull(JmapAccountStateCodec::decompose('2:default:17'));
        $this->assertNull(JmapAccountStateCodec::decompose('1:default'));
        $this->assertNull(JmapAccountStateCodec::decompose('1:default:'));
        $this->assertNull(JmapAccountStateCodec::decompose('1::17'));
        $this->assertNull(JmapAccountStateCodec::decompose('1:default:abc'));
    }

    public function test_uri_containing_colon_still_round_trips(): void
    {
        // Calendar uris are [a-z0-9_-]+ in practice, but the codec's
        // two-part split must not corrupt exotic uris.
        $map = ['a:b' => '5'];

        $this->assertSame($map, JmapAccountStateCodec::decompose(JmapAccountStateCodec::compose($map)));
    }
}
