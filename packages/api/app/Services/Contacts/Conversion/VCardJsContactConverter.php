<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectPayloadGuard;

/**
 * RFC 9555 bidirectional vCard ↔ JSContact Card converter.
 *
 * Emits JSContact 1.0 by default. uid conversion for version 2.0 is defined in RFC 9982.
 */
final class VCardJsContactConverter
{
    public function __construct(
        private readonly VObjectPayloadGuard $guard = new VObjectPayloadGuard,
        private readonly VCardToJsContactConverter $reader = new VCardToJsContactConverter,
        private readonly JsContactToVCardConverter $writer = new JsContactToVCardConverter,
    ) {}

    /**
     * @return array<string, mixed> JSContact Card
     */
    public function cardFromVCard(string $vcard, string $logLevel = 'warning'): array
    {
        return $this->reader->convert($vcard, $logLevel);
    }

    /**
     * @param  array<string, mixed>  $card  JSContact Card
     */
    public function vCardFromCard(array $card): string
    {
        $vcard = $this->writer->convert($card);
        $this->guard->assertVCardSize($vcard);

        return $vcard;
    }
}
