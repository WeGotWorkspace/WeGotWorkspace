<?php

declare(strict_types=1);

namespace App\Services\Installer;

use Ramsey\Uuid\Uuid;
use RuntimeException;

/**
 * Deterministic vCard 4.0 payloads for local-dev Contacts seeding.
 *
 * Names are hardcoded. Emails use @example.test only.
 *
 * @phpstan-type SeedCard array{uri: string, uid: string, email: string, vcard: string}
 */
final class DevContactCatalog
{
    public const PROFILE_FULL = 'full';

    public const PROFILE_COMPACT = 'compact';

    public const PROFILE_LARGE = 'large';

    public const URI_PREFIX = 'dev-seed-contact-';

    public const FULL_TARGET = 1000;

    public const COMPACT_TARGET = 40;

    /** 126 ContactCard/get pages of 40. */
    public const LARGE_TARGET = 5040;

    public const FIXED_CARD_COUNT = 6;

    /** RFC 4122 NAMESPACE_URL. Do not replace this at implementation time. */
    public const UID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

    public const UID_NAME_PREFIX = 'https://wegotworkspace.dev/dev-seed-contact/';

    /** @var list<string> */
    private const GIVEN_NAMES = [
        'Anna', 'Bram', 'Clara', 'Daan', 'Eva', 'Finn', 'Greta', 'Hugo',
        'Iris', 'Jonas', 'Kate', 'Lars', 'Mina', 'Nils', 'Olga', 'Peter',
        'Quinn', 'Rosa', 'Sam', 'Tess', 'Uma', 'Victor', 'Wendy', 'Xander',
        'Yara', 'Zora',
    ];

    /** @var list<string> */
    private const FAMILY_NAMES = [
        'Adams', 'Berg', 'Chen', 'Dijkstra', 'Ellis', 'Fischer', 'Garcia',
        'Hassan', 'Ivanov', 'Jansen', 'Khan', 'Lopez', 'Meyer', 'Nguyen',
        'Olsen', 'Patel', 'Quinn', 'Rossi', 'Silva', 'Taylor', 'Ueda',
        'Vogel', 'Walker', 'Xu', 'Young', 'Zimmerman',
    ];

    /**
     * @return list<SeedCard>
     */
    public function cards(string $profile = self::PROFILE_FULL, ?int $count = null): array
    {
        $target = $this->target($profile, $count);
        $out = $this->fixedCards();
        $need = $target - count($out);
        for ($i = 0; $i < $need; $i++) {
            $n = count($out) + 1;
            $given = self::GIVEN_NAMES[$i % count(self::GIVEN_NAMES)];
            $family = self::FAMILY_NAMES[$i % count(self::FAMILY_NAMES)];
            $out[] = $this->person($n, $given, $family);
        }

        return $out;
    }

    public function target(string $profile, ?int $count = null): int
    {
        if ($count !== null) {
            if ($count < self::FIXED_CARD_COUNT) {
                throw new RuntimeException(
                    'Contacts seed count must be at least '.self::FIXED_CARD_COUNT.' so the fixed edge cards are kept.',
                );
            }

            return $count;
        }

        return match ($profile) {
            self::PROFILE_COMPACT => self::COMPACT_TARGET,
            self::PROFILE_FULL => self::FULL_TARGET,
            self::PROFILE_LARGE => self::LARGE_TARGET,
            default => throw new RuntimeException('Unknown contacts seed profile: '.$profile),
        };
    }

    /**
     * @return list<SeedCard>
     */
    private function fixedCards(): array
    {
        return [
            $this->person(1, 'Ada', 'van der Berg', 'ada.van-der-berg@example.test'),
            $this->person(2, 'Martin', 'Ødegaard', 'martin.odegaard@example.test'),
            $this->person(3, 'Ayşe', 'Çelik', 'ayse.celik@example.test'),
            $this->person(4, 'Éric', 'Dupont', 'eric.dupont@example.test'),
            $this->organization(5, 'Northwind Traders', 'northwind.traders@example.test'),
            $this->emailOnly(6),
        ];
    }

    /**
     * @return SeedCard
     */
    private function person(int $n, string $given, string $family, ?string $email = null): array
    {
        $email ??= $this->defaultEmail($n);
        $fn = $given.' '.$family;

        return $this->card($n, $email, [
            'FN:'.$this->escape($fn),
            'N:'.$this->escape($family).';'.$this->escape($given).';;;',
            'EMAIL:'.$this->escape($email),
        ]);
    }

    /**
     * @return SeedCard
     */
    private function organization(int $n, string $org, string $email): array
    {
        return $this->card($n, $email, [
            'FN:'.$this->escape($org),
            'ORG:'.$this->escape($org),
            'EMAIL:'.$this->escape($email),
        ]);
    }

    /**
     * @return SeedCard
     */
    private function emailOnly(int $n): array
    {
        $email = $this->defaultEmail($n);

        return $this->card($n, $email, [
            'FN:'.$this->escape($email),
            'EMAIL:'.$this->escape($email),
        ]);
    }

    /**
     * @param  list<string>  $lines
     * @return SeedCard
     */
    private function card(int $n, string $email, array $lines): array
    {
        $stem = self::URI_PREFIX.sprintf('%04d', $n);
        $uid = 'urn:uuid:'.Uuid::uuid5(self::UID_NAMESPACE, self::UID_NAME_PREFIX.$n)->toString();
        $body = array_merge([
            'BEGIN:VCARD',
            'VERSION:4.0',
            'UID:'.$uid,
        ], $lines, [
            'END:VCARD',
        ]);

        return [
            'uri' => $stem.'.vcf',
            'uid' => $uid,
            'email' => $email,
            'vcard' => implode("\r\n", $body)."\r\n",
        ];
    }

    private function defaultEmail(int $n): string
    {
        return self::URI_PREFIX.sprintf('%04d', $n).'@example.test';
    }

    private function escape(string $value): string
    {
        return str_replace(
            ['\\', "\r\n", "\n", "\r", ',', ';'],
            ['\\\\', '\\n', '\\n', '', '\\,', '\\;'],
            $value,
        );
    }
}
