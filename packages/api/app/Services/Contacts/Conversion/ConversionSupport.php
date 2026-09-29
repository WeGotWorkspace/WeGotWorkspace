<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarUid;
use Illuminate\Support\Str;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\InvalidDataException;
use Sabre\VObject\Property;

/**
 * Shared helpers for RFC 9555 vCard ↔ JSContact conversion.
 *
 * uid rules for JSContact 2.0 are updated by RFC 9982; see docs/contacts/rfc9982-conversion-matrix.md.
 */
final class ConversionSupport
{
    use ConversionIdMethods;
    use ConversionPropertyMethods;
    use ConversionUidNameMethods;

    /** @var array<int, string> */
    private const N_LEGACY_KINDS = ['surname', 'given', 'given2', 'title', 'credential'];

    /** @var array<int, string> */
    private const N_EXTENDED_KINDS = ['surname', 'given', 'given2', 'title', 'credential', 'surname2', 'generation'];

    /** @var array<int, string> */
    private const ADR_LEGACY_KINDS = ['postOfficeBox', 'apartment', 'name', 'locality', 'region', 'postcode', 'country'];

    /** @var array<int, string> */
    private const ADR_RFC9554_KINDS = [
        'postOfficeBox',
        'apartment',
        'name',
        'locality',
        'region',
        'postcode',
        'country',
        'room',
        'floor',
        'apartment',
        'building',
        'block',
        'number',
        'name',
        'direction',
        'landmark',
        'subdistrict',
        'district',
    ];

    /** @var array<string, string> */
    private const TEL_TYPE_TO_FEATURE = [
        'cell' => 'mobile',
        'fax' => 'fax',
        'main-number' => 'main-number',
        'pager' => 'pager',
        'text' => 'text',
        'textphone' => 'textphone',
        'video' => 'video',
        'voice' => 'voice',
    ];

    /** @var array<string, string> */
    private const TEL_FEATURES = [
        'mobile' => 'cell',
        'fax' => 'fax',
        'main-number' => 'main-number',
        'pager' => 'pager',
        'text' => 'text',
        'textphone' => 'textphone',
        'video' => 'video',
        'voice' => 'voice',
    ];

    /** @var array<string, true> */
    private const KNOWN_VCARD_PROPERTIES = [
        'UID' => true,
        'KIND' => true,
        'FN' => true,
        'N' => true,
        'NICKNAME' => true,
        'PHOTO' => true,
        'EMAIL' => true,
        'TEL' => true,
        'ADR' => true,
        'ORG' => true,
        'TITLE' => true,
        'ROLE' => true,
        'NOTE' => true,
        'CATEGORIES' => true,
        'MEMBER' => true,
        'PRODID' => true,
        'CREATED' => true,
        'REV' => true,
        'LANGUAGE' => true,
        'LOGO' => true,
        'SOUND' => true,
        'URL' => true,
        'CONTACT-URI' => true,
        'LANG' => true,
        'IMPP' => true,
        'SOCIALPROFILE' => true,
        'KEY' => true,
        'CALADRURI' => true,
        'CALURI' => true,
        'FBURL' => true,
        'GEO' => true,
        'TZ' => true,
        'GRAMGENDER' => true,
        'PRONOUNS' => true,
        'BDAY' => true,
        'BIRTHPLACE' => true,
        'DEATHDATE' => true,
        'DEATHPLACE' => true,
        'ANNIVERSARY' => true,
        'EXPERTISE' => true,
        'HOBBY' => true,
        'INTEREST' => true,
        'ORG-DIRECTORY' => true,
        'SOURCE' => true,
        'RELATED' => true,
        'X-ABLABEL' => true,
    ];

    /** @var array<string, true> */
    private const PRESERVE_VCARD_PROPERTIES = [
        'VERSION' => true,
        'CLIENTPIDMAP' => true,
        'GENDER' => true,
        'XML' => true,
    ];

    /** @var array<string, string> */
    private const EXPERTISE_LEVEL_TO_JS = [
        'beginner' => 'low',
        'average' => 'medium',
        'expert' => 'high',
    ];

    /** @var array<string, string> */
    private const EXPERTISE_LEVEL_TO_VCARD = [
        'low' => 'beginner',
        'medium' => 'average',
        'high' => 'expert',
    ];

}
