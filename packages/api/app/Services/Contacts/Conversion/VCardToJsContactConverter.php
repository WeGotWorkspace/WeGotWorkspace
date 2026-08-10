<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Property;

final class VCardToJsContactConverter
{
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
    public function convert(string $vcard): array
    {
        $document = $this->guard->readVCard($vcard);

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

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertName(VCard $document, array &$card): void
    {
        $name = [];

        if (isset($document->FN) && ! ConversionSupport::isDerived($document->FN)) {
            $name['full'] = trim((string) $document->FN->getValue());
        }

        if (isset($document->N)) {
            $parsed = JscopmsSupport::nameComponentsFromProperty($document->N);
            $components = $parsed['components'];
            if ($components !== []) {
                $name['components'] = $components;
                $name['isOrdered'] = $parsed['isOrdered'];
                if (isset($parsed['defaultSeparator'])) {
                    $name['defaultSeparator'] = $parsed['defaultSeparator'];
                }
            }
            if (isset($document->N['SORT-AS'])) {
                $sortParts = $document->N->getParts();
                $sortAsParts = ConversionSupport::splitStructuredValues((string) $document->N['SORT-AS']);
                $sortAs = [];
                if (isset($sortAsParts[0]) && $sortAsParts[0] !== '') {
                    $sortAs['surname'] = $sortAsParts[0];
                }
                if (isset($sortAsParts[1]) && $sortAsParts[1] !== '') {
                    $sortAs['given'] = $sortAsParts[1];
                }
                if ($sortAs !== []) {
                    $name['sortAs'] = $sortAs;
                }
                unset($sortParts);
            }
        }

        if ($name !== []) {
            $name['@type'] = 'Name';
            $card['name'] = $name;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertEmails(VCard $document, array &$card): void
    {
        $emails = [];
        foreach ($document->select('EMAIL') as $index => $property) {
            $entry = [
                '@type' => 'EmailAddress',
                'address' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $this->applyGroupLabel($entry, $property);
            $emails[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($emails !== []) {
            $card['emails'] = $emails;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertPhones(VCard $document, array &$card): void
    {
        $phones = [];
        foreach ($document->select('TEL') as $index => $property) {
            $entry = [
                '@type' => 'Phone',
                'number' => trim((string) $property->getValue()),
            ];
            $features = ConversionSupport::telFeaturesFromProperty($property);
            if ($features === null && ConversionSupport::telTypeValues($property) === []) {
                $features = ['voice' => true];
            }
            if ($features !== null) {
                $entry['features'] = $features;
            }
            ConversionSupport::applySharedFields($entry, $property);
            $this->applyGroupLabel($entry, $property);
            $phones[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($phones !== []) {
            $card['phones'] = $phones;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertAddresses(VCard $document, array &$card): void
    {
        /** @var array<string, array{adr?: Property, geos: list<Property>, tzs: list<Property>}> $buckets */
        $buckets = [];
        $hasGrouped = false;

        foreach ($document->select('ADR') as $property) {
            $group = $this->groupKeyFromProperty($property);
            if ($group !== '') {
                $hasGrouped = true;
            }
            $buckets[$group]['adr'] = $property;
            $buckets[$group]['geos'] ??= [];
            $buckets[$group]['tzs'] ??= [];
        }

        foreach ($document->select('GEO') as $property) {
            $group = $this->groupKeyFromProperty($property);
            if ($group !== '') {
                $hasGrouped = true;
            }
            $buckets[$group]['geos'] ??= [];
            $buckets[$group]['geos'][] = $property;
            $buckets[$group]['tzs'] ??= [];
        }

        foreach ($document->select('TZ') as $property) {
            $group = $this->groupKeyFromProperty($property);
            if ($group !== '') {
                $hasGrouped = true;
            }
            $buckets[$group]['tzs'] ??= [];
            $buckets[$group]['tzs'][] = $property;
            $buckets[$group]['geos'] ??= [];
        }

        if ($buckets === []) {
            return;
        }

        if (! $hasGrouped && count($buckets) > 1) {
            $merged = ['geos' => [], 'tzs' => []];
            foreach ($buckets as $bucket) {
                if (isset($bucket['adr'])) {
                    $merged['adr'] = $bucket['adr'];
                }
                $merged['geos'] = array_merge($merged['geos'], $bucket['geos'] ?? []);
                $merged['tzs'] = array_merge($merged['tzs'], $bucket['tzs'] ?? []);
            }
            $buckets = ['' => $merged];
        }

        if (! $hasGrouped && isset($buckets['']['adr'])) {
            $buckets = ['' => $buckets['']];
        }

        $addresses = [];
        foreach ($buckets as $bucket) {
            if (isset($bucket['adr'])) {
                $geos = $bucket['geos'] ?? [];
                $tzs = $bucket['tzs'] ?? [];
                $mergeTzIntoAdr = ! isset($bucket['adr']['TZ']);
                $addresses[] = $this->addressEntryFromAdr(
                    $bucket['adr'],
                    $geos,
                    $mergeTzIntoAdr ? $tzs : [],
                );
                foreach (array_slice($geos, 1) as $index => $property) {
                    $addresses[] = $this->minimalAddressFromGeo($property, $index + 1);
                }
                $remainingTzs = $mergeTzIntoAdr ? array_slice($tzs, 1) : $tzs;
                foreach ($remainingTzs as $index => $property) {
                    $entry = $this->minimalAddressFromTz($property, $index + 1);
                    if ($entry !== null) {
                        $addresses[] = $entry;
                    }
                }

                continue;
            }

            foreach ($bucket['geos'] ?? [] as $index => $property) {
                $addresses[] = $this->minimalAddressFromGeo($property, $index);
            }

            foreach ($bucket['tzs'] ?? [] as $index => $property) {
                $entry = $this->minimalAddressFromTz($property, $index);
                if ($entry !== null) {
                    $addresses[] = $entry;
                }
            }
        }

        if ($addresses === []) {
            return;
        }

        $mapped = [];
        foreach ($addresses as $entry) {
            $property = $entry['__property'];
            unset($entry['__property']);
            $id = $entry['__propId'];
            unset($entry['__propId']);
            $mapped[$id] = $entry;
        }

        $card['addresses'] = $mapped;
    }

    /**
     * @param  list<Property>  $geos
     * @param  list<Property>  $tzs
     * @return array<string, mixed>
     */
    private function addressEntryFromAdr(Property $property, array $geos, array $tzs): array
    {
        $parsed = JscopmsSupport::addressComponentsFromProperty($property);
        $components = $parsed['components'];
        $entry = [
            '@type' => 'Address',
            'components' => $components,
            'isOrdered' => $parsed['isOrdered'],
            '__propId' => ConversionSupport::propertyId($property, 0),
            '__property' => $property,
        ];
        if (isset($parsed['defaultSeparator'])) {
            $entry['defaultSeparator'] = $parsed['defaultSeparator'];
        }
        if (isset($property['CC'])) {
            $entry['countryCode'] = (string) $property['CC'];
        }
        if (isset($property['LABEL'])) {
            $entry['full'] = (string) $property['LABEL'];
        }
        if (isset($property['GEO'])) {
            $entry['coordinates'] = $this->geoToCoordinates((string) $property['GEO']);
        } elseif ($geos !== []) {
            $entry['coordinates'] = $this->geoToCoordinates((string) $geos[0]->getValue());
        }
        if (isset($property['TZ'])) {
            $entry['timeZone'] = trim((string) $property['TZ']);
        } elseif ($tzs !== []) {
            foreach ($tzs as $tzProperty) {
                $timeZone = $this->tzToTimeZone($tzProperty);
                if ($timeZone !== null) {
                    $entry['timeZone'] = $timeZone;
                    break;
                }
            }
        }
        ConversionSupport::applySharedFields($entry, $property);
        $this->applyGroupLabel($entry, $property);

        return $entry;
    }

    /**
     * @return array<string, mixed>
     */
    private function minimalAddressFromGeo(Property $property, int $index): array
    {
        $entry = [
            '@type' => 'Address',
            'coordinates' => $this->geoToCoordinates((string) $property->getValue()),
            '__propId' => ConversionSupport::propertyId($property, $index),
            '__property' => $property,
        ];
        ConversionSupport::applySharedFields($entry, $property);
        $this->applyGroupLabel($entry, $property);

        return $entry;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function minimalAddressFromTz(Property $property, int $index): ?array
    {
        $timeZone = $this->tzToTimeZone($property);
        if ($timeZone === null) {
            $this->deferredKnownProperties[] = $property;

            return null;
        }

        $entry = [
            '@type' => 'Address',
            'timeZone' => $timeZone,
            '__propId' => ConversionSupport::propertyId($property, $index),
            '__property' => $property,
        ];
        ConversionSupport::applySharedFields($entry, $property);
        $this->applyGroupLabel($entry, $property);

        return $entry;
    }

    private function groupKeyFromProperty(Property $property): string
    {
        $group = $property->group;

        return ($group === null || $group === '') ? '' : (string) $group;
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertOrganizations(VCard $document, array &$card): void
    {
        $organizations = [];
        foreach ($document->select('ORG') as $index => $property) {
            $parts = ConversionSupport::structuredParts($property);
            $name = trim((string) ($parts[0] ?? ''));
            $units = [];
            for ($i = 1, $count = count($parts); $i < $count; $i++) {
                $unitName = trim((string) $parts[$i]);
                if ($unitName === '') {
                    continue;
                }
                $units[] = ['@type' => 'OrgUnit', 'name' => $unitName];
            }
            $entry = ['@type' => 'Organization'];
            if ($name !== '') {
                $entry['name'] = $name;
            }
            if ($units !== []) {
                $entry['units'] = $units;
            }
            if (isset($property['SORT-AS'])) {
                $sortParts = ConversionSupport::splitStructuredValues((string) $property['SORT-AS']);
                if (isset($sortParts[0]) && $sortParts[0] !== '') {
                    $entry['sortAs'] = $sortParts[0];
                }
                for ($i = 1, $count = count($sortParts); $i < $count; $i++) {
                    $unitIndex = $i - 1;
                    if (! isset($entry['units'][$unitIndex])) {
                        continue;
                    }
                    $entry['units'][$unitIndex]['sortAs'] = $sortParts[$i];
                }
            }
            ConversionSupport::applySharedFields($entry, $property);
            $group = $this->groupNameFromProperty($property);
            if ($group !== null) {
                $this->organizationIdsByGroup[$group] = ConversionSupport::propertyId($property, $index);
            }
            $organizations[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($organizations !== []) {
            $card['organizations'] = $organizations;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertNotes(VCard $document, array &$card): void
    {
        $notes = [];
        foreach ($document->select('NOTE') as $index => $property) {
            $entry = [
                '@type' => 'Note',
                'note' => str_replace('\,', ',', trim((string) $property->getValue())),
            ];
            if (isset($property['CREATED'])) {
                $entry['created'] = ConversionSupport::normalizeUtcDateTime((string) $property['CREATED']);
            }
            $author = [];
            if (isset($property['AUTHOR-NAME'])) {
                $author['name'] = (string) $property['AUTHOR-NAME'];
            }
            if (isset($property['AUTHOR'])) {
                $author['uri'] = (string) $property['AUTHOR'];
            }
            if ($author !== []) {
                $author['@type'] = 'Author';
                $entry['author'] = $author;
            }
            $notes[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($notes !== []) {
            $card['notes'] = $notes;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertMedia(VCard $document, array &$card): void
    {
        $media = [];
        foreach ($document->select('PHOTO') as $index => $property) {
            $entry = [
                '@type' => 'Media',
                'kind' => 'photo',
                'uri' => ConversionSupport::mediaUriFromProperty($property),
            ];
            if (isset($property['MEDIATYPE'])) {
                $entry['mediaType'] = (string) $property['MEDIATYPE'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $media[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('LOGO') as $index => $property) {
            $entry = [
                '@type' => 'Media',
                'kind' => 'logo',
                'uri' => ConversionSupport::mediaUriFromProperty($property),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $media[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('SOUND') as $index => $property) {
            $entry = [
                '@type' => 'Media',
                'kind' => 'sound',
                'uri' => ConversionSupport::mediaUriFromProperty($property),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $media[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($media !== []) {
            $card['media'] = $media;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertKeywords(VCard $document, array &$card): void
    {
        $keywords = [];
        foreach ($document->select('CATEGORIES') as $property) {
            foreach ($property->getParts() as $part) {
                $keyword = trim((string) $part);
                if ($keyword !== '') {
                    $keywords[$keyword] = true;
                }
            }
        }
        if ($keywords !== []) {
            $card['keywords'] = $keywords;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertMembers(VCard $document, array &$card): void
    {
        $members = [];
        $seen = [];
        foreach (['MEMBER', 'X-ADDRESSBOOKSERVER-MEMBER', 'X-ABGROUPMEMBER'] as $propertyName) {
            foreach ($document->select($propertyName) as $property) {
                $uid = ConversionSupport::normalizeMemberUid((string) $property->getValue());
                if ($uid === '') {
                    continue;
                }
                $matchKey = ConversionSupport::normalizeContactUidForMatch($uid);
                if (isset($seen[$matchKey])) {
                    continue;
                }
                $seen[$matchKey] = true;
                $members[$uid] = true;
            }
        }
        if ($members !== []) {
            $card['members'] = $members;
            if (! isset($card['kind'])) {
                $card['kind'] = 'group';
            }
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertNicknames(VCard $document, array &$card): void
    {
        $nicknames = [];
        foreach ($document->select('NICKNAME') as $index => $property) {
            $entry = [
                '@type' => 'Nickname',
                'name' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $nicknames[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($nicknames !== []) {
            $card['nicknames'] = $nicknames;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertTitles(VCard $document, array &$card): void
    {
        $titles = [];
        foreach ($document->select('TITLE') as $index => $property) {
            $entry = [
                '@type' => 'Title',
                'kind' => 'title',
                'name' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $this->applyOrganizationId($entry, $property);
            $titles[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('ROLE') as $index => $property) {
            $entry = [
                '@type' => 'Title',
                'kind' => 'role',
                'name' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $this->applyOrganizationId($entry, $property);
            $titles[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($titles !== []) {
            $card['titles'] = $titles;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertLinks(VCard $document, array &$card): void
    {
        $links = [];
        foreach ($document->select('URL') as $index => $property) {
            $entry = [
                '@type' => 'Link',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $links[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('CONTACT-URI') as $index => $property) {
            $entry = [
                '@type' => 'Link',
                'kind' => 'contact',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $links[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($links !== []) {
            $card['links'] = $links;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertPreferredLanguages(VCard $document, array &$card): void
    {
        $languages = [];
        foreach ($document->select('LANG') as $index => $property) {
            $entry = [
                '@type' => 'LanguagePref',
                'language' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $languages[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($languages !== []) {
            $card['preferredLanguages'] = $languages;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertOnlineServices(VCard $document, array &$card): void
    {
        $services = [];
        foreach ($document->select('IMPP') as $index => $property) {
            $entry = [
                '@type' => 'OnlineService',
                'uri' => trim((string) $property->getValue()),
                'vCardName' => 'impp',
            ];
            if (isset($property['SERVICE-TYPE'])) {
                $entry['service'] = (string) $property['SERVICE-TYPE'];
            }
            if (isset($property['USERNAME'])) {
                $entry['user'] = (string) $property['USERNAME'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $services[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('SOCIALPROFILE') as $index => $property) {
            $value = trim((string) $property->getValue());
            $entry = [
                '@type' => 'OnlineService',
                'vCardName' => 'socialprofile',
            ];
            if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $value) === 1) {
                $entry['uri'] = $value;
            } else {
                $entry['user'] = $value;
            }
            if (isset($property['SERVICE-TYPE'])) {
                $entry['service'] = (string) $property['SERVICE-TYPE'];
            }
            if (isset($property['USERNAME'])) {
                $entry['user'] = (string) $property['USERNAME'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $services[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($services !== []) {
            $card['onlineServices'] = $services;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertSpeakToAs(VCard $document, array &$card): void
    {
        $speakToAs = [];
        if (isset($document->GRAMGENDER)) {
            $speakToAs['grammaticalGender'] = strtolower(trim((string) $document->GRAMGENDER->getValue()));
        }
        $pronouns = [];
        foreach ($document->select('PRONOUNS') as $index => $property) {
            $entry = [
                '@type' => 'Pronouns',
                'pronouns' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $pronouns[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($pronouns !== []) {
            $speakToAs['pronouns'] = $pronouns;
        }
        if ($speakToAs !== []) {
            $speakToAs['@type'] = 'SpeakToAs';
            $card['speakToAs'] = $speakToAs;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertAnniversaries(VCard $document, array &$card): void
    {
        $anniversaries = [];

        foreach ($document->select('BDAY') as $index => $property) {
            $date = ConversionSupport::anniversaryDateFromProperty($property, true);
            if ($date === null) {
                $this->deferredKnownProperties[] = $property;

                continue;
            }
            $entry = [
                '@type' => 'Anniversary',
                'kind' => 'birth',
                'date' => $date,
            ];
            $anniversaries[ConversionSupport::propertyId($property, $index)] = $entry;
        }

        foreach ($document->select('DEATHDATE') as $index => $property) {
            $date = ConversionSupport::anniversaryDateFromProperty($property, true);
            if ($date === null) {
                $this->deferredKnownProperties[] = $property;

                continue;
            }
            $entry = [
                '@type' => 'Anniversary',
                'kind' => 'death',
                'date' => $date,
            ];
            $anniversaries[ConversionSupport::propertyId($property, $index)] = $entry;
        }

        foreach ($document->select('ANNIVERSARY') as $index => $property) {
            $date = ConversionSupport::anniversaryDateFromProperty($property, false);
            if ($date === null) {
                $this->deferredKnownProperties[] = $property;

                continue;
            }
            $entry = [
                '@type' => 'Anniversary',
                'kind' => 'wedding',
                'date' => $date,
            ];
            $anniversaries[ConversionSupport::propertyId($property, $index)] = $entry;
        }

        $this->mergeAnniversaryPlace($document, $anniversaries, 'BIRTHPLACE', 'birth');
        $this->mergeAnniversaryPlace($document, $anniversaries, 'DEATHPLACE', 'death');

        if ($anniversaries !== []) {
            $card['anniversaries'] = $anniversaries;
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $anniversaries
     */
    private function mergeAnniversaryPlace(VCard $document, array &$anniversaries, string $propertyName, string $kind): void
    {
        foreach ($document->select($propertyName) as $index => $property) {
            $place = ConversionSupport::placeFromProperty($property);
            $merged = false;
            foreach ($anniversaries as &$entry) {
                if (($entry['kind'] ?? '') === $kind) {
                    $entry['place'] = $place;
                    $merged = true;
                    break;
                }
            }
            unset($entry);
            if (! $merged) {
                continue;
            }
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertRelated(VCard $document, array &$card): void
    {
        $relatedTo = [];
        foreach ($document->select('RELATED') as $property) {
            $value = trim((string) $property->getValue());
            if ($value === '') {
                continue;
            }
            $relations = ConversionSupport::relationTypesFromProperty($property);
            $entry = ['@type' => 'Relation'];
            if ($relations !== []) {
                $entry['relation'] = $relations;
            } else {
                $entry['relation'] = [];
            }
            $relatedTo[$value] = $entry;
        }
        if ($relatedTo !== []) {
            $card['relatedTo'] = $relatedTo;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertDirectories(VCard $document, array &$card): void
    {
        $directories = [];
        foreach ($document->select('SOURCE') as $index => $property) {
            $entry = [
                '@type' => 'Directory',
                'kind' => 'entry',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $directories[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('ORG-DIRECTORY') as $index => $property) {
            $entry = [
                '@type' => 'Directory',
                'kind' => 'directory',
                'uri' => trim((string) $property->getValue()),
            ];
            if (isset($property['INDEX'])) {
                $entry['listAs'] = (int) (string) $property['INDEX'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $directories[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($directories !== []) {
            $card['directories'] = $directories;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertPersonalInfo(VCard $document, array &$card): void
    {
        $personalInfo = [];
        foreach ($document->select('EXPERTISE') as $index => $property) {
            $entry = [
                '@type' => 'PersonalInfo',
                'kind' => 'expertise',
                'value' => trim((string) $property->getValue()),
            ];
            if (isset($property['LEVEL'])) {
                $entry['level'] = ConversionSupport::expertiseLevelFromVCard((string) $property['LEVEL']);
            }
            if (isset($property['INDEX'])) {
                $entry['listAs'] = (int) (string) $property['INDEX'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $personalInfo[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('HOBBY') as $index => $property) {
            $entry = [
                '@type' => 'PersonalInfo',
                'kind' => 'hobby',
                'value' => trim((string) $property->getValue()),
            ];
            if (isset($property['INDEX'])) {
                $entry['listAs'] = (int) (string) $property['INDEX'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $personalInfo[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('INTEREST') as $index => $property) {
            $entry = [
                '@type' => 'PersonalInfo',
                'kind' => 'interest',
                'value' => trim((string) $property->getValue()),
            ];
            if (isset($property['INDEX'])) {
                $entry['listAs'] = (int) (string) $property['INDEX'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $personalInfo[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($personalInfo !== []) {
            $card['personalInfo'] = $personalInfo;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertCryptoKeys(VCard $document, array &$card): void
    {
        $cryptoKeys = [];
        foreach ($document->select('KEY') as $index => $property) {
            $entry = [
                '@type' => 'CryptoKey',
                'uri' => ConversionSupport::mediaUriFromProperty($property),
            ];
            if (isset($property['MEDIATYPE'])) {
                $entry['mediaType'] = (string) $property['MEDIATYPE'];
            }
            ConversionSupport::applySharedFields($entry, $property);
            $cryptoKeys[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($cryptoKeys !== []) {
            $card['cryptoKeys'] = $cryptoKeys;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertCalendars(VCard $document, array &$card): void
    {
        $calendars = [];
        foreach ($document->select('CALURI') as $index => $property) {
            $entry = [
                '@type' => 'Calendar',
                'kind' => 'calendar',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $calendars[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        foreach ($document->select('FBURL') as $index => $property) {
            $entry = [
                '@type' => 'Calendar',
                'kind' => 'freeBusy',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $calendars[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($calendars !== []) {
            $card['calendars'] = $calendars;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertSchedulingAddresses(VCard $document, array &$card): void
    {
        $schedulingAddresses = [];
        foreach ($document->select('CALADRURI') as $index => $property) {
            $entry = [
                '@type' => 'SchedulingAddress',
                'uri' => trim((string) $property->getValue()),
            ];
            ConversionSupport::applySharedFields($entry, $property);
            $schedulingAddresses[ConversionSupport::propertyId($property, $index)] = $entry;
        }
        if ($schedulingAddresses !== []) {
            $card['schedulingAddresses'] = $schedulingAddresses;
        }
    }

    /**
     * @param  array<string, mixed>  $card
     */
    private function convertVCardProps(VCard $document, array &$card): void
    {
        $props = [];
        $deferredKeys = [];
        foreach ($this->deferredKnownProperties as $property) {
            $deferredKeys[$this->propertyIdentity($property)] = true;
        }
        foreach ($this->extraFnProperties as $property) {
            $props[] = ConversionSupport::jCardTupleFromProperty($property);
        }
        foreach ($document->children() as $child) {
            if (! $child instanceof Property) {
                continue;
            }
            $name = strtoupper((string) $child->name);
            if ($name === 'BEGIN' || $name === 'END') {
                continue;
            }
            $isKnown = ConversionSupport::isKnownVCardProperty($name);
            $isPreserveOnly = ConversionSupport::shouldPreserveVCardProperty($name);
            $isDeferred = isset($deferredKeys[$this->propertyIdentity($child)]);
            if ($name === 'X-ABSHOWAS') {
                continue;
            }
            if ($name === 'X-ADDRESSBOOKSERVER-KIND' && ($card['kind'] ?? '') === 'group') {
                continue;
            }
            if (in_array($name, ['MEMBER', 'X-ADDRESSBOOKSERVER-MEMBER', 'X-ABGROUPMEMBER'], true) && isset($card['members'])) {
                continue;
            }
            if ($isKnown && ! $isPreserveOnly && ! $isDeferred) {
                continue;
            }
            $props[] = ConversionSupport::jCardTupleFromProperty($child);
        }
        if ($props !== []) {
            $card['vCardProps'] = $props;
        }
    }

    private function propertyIdentity(Property $property): string
    {
        return strtoupper((string) $property->name).':'.$property->serialize();
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function applyGroupLabel(array &$entry, Property $property): void
    {
        $group = $this->groupNameFromProperty($property);
        if ($group === null) {
            return;
        }

        $label = $this->groupLabels[$group] ?? null;
        // When TYPE already encodes Home/Work/Mobile/School, skip both the custom
        // `label` and the Apple `itemN` group so PROP-ID + TYPE round-trips cleanly.
        if (is_string($label) && $this->isRedundantStandardAbLabel($label, $entry)) {
            return;
        }

        $params = ConversionSupport::vCardParamsFromObject($entry) ?? [];
        $params['group'] = $group;
        $entry['vCardParams'] = $params;

        if (is_string($label) && $label !== '') {
            $entry['label'] = $label;
        }
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function isRedundantStandardAbLabel(string $label, array $entry): bool
    {
        $normalized = strtolower(trim($label));
        if (preg_match('/^_\$!<(.+)>!\$_$/u', $normalized, $matches) === 1) {
            $normalized = strtolower(trim((string) $matches[1]));
        }

        return match ($normalized) {
            'mobile', 'cell' => isset($entry['features']['mobile']),
            'home', 'private' => isset($entry['contexts']['private']),
            'work' => isset($entry['contexts']['work']),
            'school' => isset($entry['contexts']['school']),
            default => false,
        };
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function applyOrganizationId(array &$entry, Property $property): void
    {
        $group = $this->groupNameFromProperty($property);
        if ($group !== null && isset($this->organizationIdsByGroup[$group])) {
            $entry['organizationId'] = $this->organizationIdsByGroup[$group];
        }
    }

    private function groupNameFromProperty(Property $property): ?string
    {
        $group = $property->group;
        if ($group === null || $group === '') {
            return null;
        }

        return (string) $group;
    }

    private function geoToCoordinates(string $value): string
    {
        $trimmed = trim($value);
        if (str_starts_with(strtolower($trimmed), 'geo:')) {
            return $trimmed;
        }
        if (str_contains($trimmed, ',')) {
            return 'geo:'.$trimmed;
        }
        $parts = array_map('trim', explode(';', $trimmed));
        if (count($parts) >= 2) {
            return 'geo:'.$parts[0].','.$parts[1];
        }

        return $trimmed;
    }

    private function tzToTimeZone(Property $property): ?string
    {
        $value = trim((string) $property->getValue());
        $valueType = strtolower((string) ($property['VALUE'] ?? $property->getValueType()));

        if ($valueType === 'text' || ($valueType === 'unknown' && ! preg_match('/^[+-]?\d/', $value))) {
            return $value;
        }

        if ($valueType === 'utc-offset' || preg_match('/^[+-]?\d{4}$/', $value) === 1) {
            $sign = $value[0] === '-' ? -1 : 1;
            $digits = ltrim($value, '+-');
            if (strlen($digits) < 4) {
                return null;
            }
            $hours = (int) substr($digits, 0, 2);
            $minutes = (int) substr($digits, 2, 2);
            if ($minutes !== 0) {
                return null;
            }
            if ($hours === 0 && $sign === 1) {
                return 'Etc/UTC';
            }

            return 'Etc/GMT'.($sign < 0 ? '+' : '-').$hours;
        }

        return null;
    }
}
