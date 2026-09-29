<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Property;

final class VCardToJsContactConverter
{
    use VCardToJsContactCoreFields;
    use VCardToJsContactExtraFields;

    public function __construct(
        private readonly VObjectPayloadGuard $guard = new VObjectPayloadGuard,
    ) {}

    /** @var array<string, string> */
    private array $groupLabels = [];

    /** @var array<string, string> */
    private array $organizationIdsByGroup = [];

    /** @var list<Property> */
    private array $deferredKnownProperties = [];

    /** @var list<Property> */
    private array $extraFnProperties = [];

    /**
     * @return array<string, mixed>
     */
    public function convert(string $vcard, string $logLevel = 'warning'): array
    {
        $document = $this->guard->readVCard($vcard, 'contacts', $logLevel);

        $this->groupLabels = [];
        $this->organizationIdsByGroup = [];
        $this->deferredKnownProperties = [];
        $this->extraFnProperties = LocalizationSupport::extraFnProperties($document);
        foreach ($document->select('X-ABLABEL') as $labelProperty) {
            $group = $this->groupNameFromProperty($labelProperty);
            if ($group !== null) {
                $this->groupLabels[$group] = trim((string) $labelProperty->getValue());
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

        $this->convertName($document, $card);
        $this->convertEmails($document, $card);
        $this->convertPhones($document, $card);
        $this->convertAddresses($document, $card);
        $this->convertOrganizations($document, $card);
        $this->convertNotes($document, $card);
        $this->convertMedia($document, $card);
        $this->convertKeywords($document, $card);
        $this->convertMembers($document, $card);
        $this->convertNicknames($document, $card);
        $this->convertTitles($document, $card);
        $this->convertLinks($document, $card);
        $this->convertPreferredLanguages($document, $card);
        $this->convertOnlineServices($document, $card);
        $this->convertSpeakToAs($document, $card);
        $this->convertAnniversaries($document, $card);
        $this->convertRelated($document, $card);
        $this->convertDirectories($document, $card);
        $this->convertPersonalInfo($document, $card);
        $this->convertCryptoKeys($document, $card);
        $this->convertCalendars($document, $card);
        $this->convertSchedulingAddresses($document, $card);
        LocalizationSupport::applyFromVCard($document, $card);
        $this->convertVCardProps($document, $card);

        return $card;
    }
}
