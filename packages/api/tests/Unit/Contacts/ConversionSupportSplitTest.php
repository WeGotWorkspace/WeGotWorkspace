<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\ConversionSupport;
use Tests\TestCase;

final class ConversionSupportSplitTest extends TestCase
{
    public function test_is_known_vcard_property(): void
    {
        $this->assertTrue(ConversionSupport::isKnownVCardProperty('EMAIL'));
        $this->assertFalse(ConversionSupport::isKnownVCardProperty('X-CUSTOM'));
    }

    public function test_generate_prop_id_is_uuid_shaped(): void
    {
        $id = ConversionSupport::generatePropId();
        $this->assertTrue(ConversionSupport::isUuidPropId($id));
    }

    public function test_derive_full_name_from_name_components(): void
    {
        $card = [
            'name' => [
                'components' => [
                    ['kind' => 'given', 'value' => 'Ada'],
                    ['kind' => 'surname', 'value' => 'Lovelace'],
                ],
            ],
        ];
        $this->assertSame('Ada Lovelace', ConversionSupport::deriveFullName($card));
    }

    public function test_public_access_helpers_still_on_facade(): void
    {
        $this->assertSame('low', ConversionSupport::expertiseLevelFromVCard('beginner'));
        $this->assertTrue(ConversionSupport::isUriValue('https://example.com'));
    }
}
