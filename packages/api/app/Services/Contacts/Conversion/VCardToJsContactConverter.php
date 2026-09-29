<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectPayloadGuard;

final class VCardToJsContactConverter
{
    public function __construct(
        private readonly VObjectPayloadGuard $guard = new VObjectPayloadGuard,
        private readonly VCardToJsContactCoreFields $core = new VCardToJsContactCoreFields,
        private readonly VCardToJsContactExtraFields $extra = new VCardToJsContactExtraFields,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function convert(string $vcard, string $logLevel = 'warning'): array
    {
        $document = $this->guard->readVCard($vcard, 'contacts', $logLevel);

        $state = new VCardToJsContactState;
        $this->core->bindState($state, $this->extra);
        $this->extra->bindState($state);
        $state->extraFnProperties = LocalizationSupport::extraFnProperties($document);
        foreach ($document->select('X-ABLABEL') as $labelProperty) {
            $group = $this->extra->groupNameFromProperty($labelProperty);
            if ($group !== null) {
                $state->groupLabels[$group] = trim((string) $labelProperty->getValue());
            }
        }

        $card = [
            '@type' => 'Card',
            'version' => '1.0',
        ];

        if (isset($document->UID)) {
            $card['uid'] = trim((string) $document->UID->getValue());
        } else {
            // RFC 9555 §2.1.1 for version "1.0"; RFC 9982 §5 omits uid for version "2.0"+.
            $card['uid'] = ConversionSupport::generateUid($vcard);
        }

        if (isset($document->KIND)) {
            $card['kind'] = strtolower(trim((string) $document->KIND->getValue()));
        }

        foreach ($document->select('X-ADDRESSBOOKSERVER-KIND') as $kindProperty) {
            if (strtolower(trim((string) $kindProperty->getValue())) === 'group') {
                $card['kind'] = 'group';
                break;
            }
        }

        foreach ($document->select('X-ABSHOWAS') as $showAsProperty) {
            if (strtoupper(trim((string) $showAsProperty->getValue())) === 'COMPANY') {
                $card['kind'] = 'org';
                break;
            }
        }

        if (isset($document->LANGUAGE)) {
            $card['language'] = trim((string) $document->LANGUAGE->getValue());
        }

        if (isset($document->PRODID)) {
            $card['prodId'] = trim((string) $document->PRODID->getValue());
        }

        if (isset($document->CREATED)) {
            $card['created'] = ConversionSupport::normalizeUtcDateTime((string) $document->CREATED->getValue());
        }

        if (isset($document->REV)) {
            $card['updated'] = ConversionSupport::normalizeUtcDateTime((string) $document->REV->getValue());
        }

        $this->core->convertName($document, $card);
        $this->core->convertEmails($document, $card);
        $this->core->convertPhones($document, $card);
        $this->core->convertAddresses($document, $card);
        $this->core->convertOrganizations($document, $card);
        $this->core->convertNotes($document, $card);
        $this->core->convertMedia($document, $card);
        $this->core->convertKeywords($document, $card);
        $this->core->convertMembers($document, $card);
        $this->core->convertNicknames($document, $card);
        $this->core->convertTitles($document, $card);
        $this->extra->convertLinks($document, $card);
        $this->extra->convertPreferredLanguages($document, $card);
        $this->extra->convertOnlineServices($document, $card);
        $this->extra->convertSpeakToAs($document, $card);
        $this->extra->convertAnniversaries($document, $card);
        $this->extra->convertRelated($document, $card);
        $this->extra->convertDirectories($document, $card);
        $this->extra->convertPersonalInfo($document, $card);
        $this->extra->convertCryptoKeys($document, $card);
        $this->extra->convertCalendars($document, $card);
        $this->extra->convertSchedulingAddresses($document, $card);
        LocalizationSupport::applyFromVCard($document, $card);
        $this->extra->convertVCardProps($document, $card);

        return $card;
    }
}
