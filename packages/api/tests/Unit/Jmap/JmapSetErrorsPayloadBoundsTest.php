<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\JmapSetErrors;
use App\Services\VObject\VObjectPayloadGuard;
use PHPUnit\Framework\TestCase;

final class JmapSetErrorsPayloadBoundsTest extends TestCase
{
    public function test_from_api_exception_maps_payload_codes_to_too_large(): void
    {
        $large = new ApiHttpException(413, 'too big', VObjectPayloadGuard::ERROR_PAYLOAD_TOO_LARGE);
        $complex = new ApiHttpException(400, 'too complex', VObjectPayloadGuard::ERROR_PAYLOAD_TOO_COMPLEX);

        $this->assertSame(
            ['type' => 'tooLarge', 'description' => 'too big'],
            JmapSetErrors::fromApiException($large),
        );
        $this->assertSame(
            ['type' => 'tooLarge', 'description' => 'too complex'],
            JmapSetErrors::fromApiException($complex),
        );
    }

    public function test_from_legacy_shape_maps_payload_codes_without_message_matching(): void
    {
        $this->assertSame(
            ['type' => 'tooLarge', 'description' => 'size'],
            JmapSetErrors::fromLegacyShape([
                'type' => VObjectPayloadGuard::ERROR_PAYLOAD_TOO_LARGE,
                'description' => 'size',
            ]),
        );
        $this->assertSame(
            ['type' => 'tooLarge', 'description' => 'components'],
            JmapSetErrors::fromLegacyShape([
                'type' => VObjectPayloadGuard::ERROR_PAYLOAD_TOO_COMPLEX,
                'description' => 'components',
            ]),
        );

        // Generic bad_request must not become tooLarge even if the message
        // mentions size — detection is by stable error code only.
        $normalized = JmapSetErrors::fromLegacyShape([
            'type' => 'bad_request',
            'description' => 'iCalendar payload exceeds the maximum allowed size of 1 bytes.',
        ]);
        $this->assertSame('invalidProperties', $normalized['type']);
    }
}
