<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Services\Contacts\Conversion\ConversionSupport;
use Illuminate\Support\Str;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Reader;

/**
 * The stored form of a vCard UID (`cards.uid`).
 *
 * RFC 6352 §5.1 keeps a UID unique per address book. The column holds the
 * same normalized form the app uses to match group members
 * ({@see ConversionSupport::normalizeContactUidForMatch()}: no `urn:uuid:`,
 * lower-case), so two cards the app would treat as one contact cannot both
 * sit in one book. A UID longer than the column is stored as its hash.
 */
final class CardUid
{
    public const MAX_LENGTH = 255;

    private const HASH_PREFIX = 'sha256:';

    /** Normalized UID of a vCard, or null when it has none. */
    public static function forCardData(string $cardData): ?string
    {
        $uid = self::rawFromCardData($cardData);

        return $uid === null ? null : self::normalize($uid);
    }

    public static function normalize(string $uid): ?string
    {
        $normalized = ConversionSupport::normalizeContactUidForMatch($uid);
        if ($normalized === '') {
            return null;
        }
        if (strlen($normalized) > self::MAX_LENGTH) {
            return self::HASH_PREFIX.hash('sha256', $normalized);
        }

        return $normalized;
    }

    public static function generate(): string
    {
        return 'urn:uuid:'.Str::uuid()->toString();
    }

    /** The UID as written in the vCard, or null when it has none. */
    public static function rawFromCardData(string $cardData): ?string
    {
        $vcard = self::parse($cardData);
        if ($vcard !== null) {
            $uid = isset($vcard->UID) ? trim((string) $vcard->UID) : '';

            return $uid === '' ? null : $uid;
        }

        if (preg_match('/^UID(?:;[^:\r\n]*)?:(.+)$/mi', self::unfold($cardData), $matches) !== 1) {
            return null;
        }
        $uid = trim($matches[1]);

        return $uid === '' ? null : $uid;
    }

    /**
     * The vCard with its UID replaced (or added), or null when it is no vCard.
     * Only the UID line changes; every other byte of the card is kept.
     */
    public static function withUid(string $cardData, string $uid): ?string
    {
        $line = 'UID:'.$uid;
        $hasUid = self::rawFromCardData($cardData) !== null;

        // A single-line UID: swap just that line.
        $pattern = '/^UID(?:;[^:\r\n]*)?:[^\r\n]*(?=\r?\n(?![ \t]))/mi';
        if ($hasUid && preg_match_all($pattern, $cardData) === 1) {
            return preg_replace($pattern, $line, $cardData, 1);
        }
        if (! $hasUid && preg_match('/^BEGIN:VCARD(\r?\n)/mi', $cardData, $eol) === 1) {
            return preg_replace('/^BEGIN:VCARD\r?\n/mi', 'BEGIN:VCARD'.$eol[1].$line.$eol[1], $cardData, 1);
        }

        // A folded UID line: let VObject rewrite the card.
        $vcard = self::parse($cardData);
        if ($vcard === null) {
            return null;
        }
        $vcard->remove('UID');
        $vcard->add('UID', $uid);

        return $vcard->serialize();
    }

    private static function parse(string $cardData): ?VCard
    {
        try {
            $vcard = Reader::read($cardData, Reader::OPTION_FORGIVING | Reader::OPTION_IGNORE_INVALID_LINES);
        } catch (\Throwable) {
            return null;
        }

        return $vcard instanceof VCard ? $vcard : null;
    }

    private static function unfold(string $cardData): string
    {
        return preg_replace('/\r?\n[ \t]/', '', $cardData) ?? $cardData;
    }
}
