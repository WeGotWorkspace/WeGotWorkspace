<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use Sabre\VObject\Component\VCard;
use Sabre\VObject\Property;

trait VCardToJsContactCoreFields
{
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

}
