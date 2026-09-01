<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

/**
 * Split multi-vCard files and classify group cards for ordered import.
 */
final class ContactCardVcfImportSupport
{
    /**
     * Split a vCard file into complete cards. Prelude, orphan END:VCARD,
     * empty/stub tails, and a truncated last card are omitted so leftover
     * text is never treated as a failed import block.
     *
     * @return list<string>
     */
    public static function splitVcards(string $input): array
    {
        $normalized = preg_replace("/^\xEF\xBB\xBF/", '', str_replace(["\r\n", "\r"], "\n", $input));
        if (! is_string($normalized) || $normalized === '') {
            return [];
        }

        $blocks = [];
        $current = null;
        foreach (explode("\n", $normalized) as $line) {
            if ($current === null) {
                if (preg_match('/^BEGIN:VCARD\s*$/i', $line) === 1) {
                    $current = [$line];
                }

                continue;
            }
            $current[] = $line;
            if (preg_match('/^END:VCARD\s*$/i', $line) === 1) {
                if (self::isImportableVcardBlock($current)) {
                    $blocks[] = implode("\n", $current);
                }
                $current = null;
            }
        }

        return $blocks;
    }

    /**
     * @param  list<string>  $lines
     */
    private static function isImportableVcardBlock(array $lines): bool
    {
        if (count($lines) < 2) {
            return false;
        }

        $interior = [];
        foreach (array_slice($lines, 1, -1) as $line) {
            $trimmed = trim((string) $line);
            if ($trimmed !== '') {
                $interior[] = $trimmed;
            }
        }
        if ($interior === []) {
            return false;
        }
        foreach ($interior as $line) {
            if (preg_match('/^(VERSION|PRODID)[:;]/i', $line) !== 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $card
     */
    public static function isGroupCard(array $card): bool
    {
        if (($card['kind'] ?? null) === 'group') {
            return true;
        }

        $members = $card['members'] ?? null;
        if (! is_array($members)) {
            return false;
        }

        foreach ($members as $enabled) {
            if ($enabled === true) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    public static function createPayload(array $card, string $addressBookUri): array
    {
        unset($card['id'], $card['etag'], $card['memberCardIds']);
        $card['addressBookIds'] = [$addressBookUri => true];

        return $card;
    }
}
