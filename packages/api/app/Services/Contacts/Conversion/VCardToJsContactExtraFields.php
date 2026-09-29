<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use Sabre\VObject\Component\VCard;
use Sabre\VObject\Property;
use DateTimeInterface;
use App\Services\VObject\VObjectScalar;

trait VCardToJsContactExtraFields
{
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
                $entry['service'] = VObjectScalar::string($property['SERVICE-TYPE']);
            }
            if (isset($property['USERNAME'])) {
                $entry['user'] = VObjectScalar::string($property['USERNAME']);
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
                $entry['service'] = VObjectScalar::string($property['SERVICE-TYPE']);
            }
            if (isset($property['USERNAME'])) {
                $entry['user'] = VObjectScalar::string($property['USERNAME']);
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
                $entry['listAs'] = (int) VObjectScalar::string($property['INDEX']);
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
                $entry['level'] = ConversionSupport::expertiseLevelFromVCard(VObjectScalar::string($property['LEVEL']));
            }
            if (isset($property['INDEX'])) {
                $entry['listAs'] = (int) VObjectScalar::string($property['INDEX']);
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
                $entry['listAs'] = (int) VObjectScalar::string($property['INDEX']);
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
                $entry['listAs'] = (int) VObjectScalar::string($property['INDEX']);
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
                $entry['mediaType'] = VObjectScalar::string($property['MEDIATYPE']);
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
        // When TYPE already encodes Home/Work/Mobile/School, skip the custom label and Apple itemN group so PROP-ID + TYPE round-trips.
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
