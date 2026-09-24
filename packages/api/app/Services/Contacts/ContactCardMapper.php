<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Http\Support\OptimisticConcurrency;
use App\Models\Card;
use App\Services\Contacts\Conversion\ConversionSupport;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use Illuminate\Support\Str;

final class ContactCardMapper
{
    public function __construct(
        private readonly VCardJsContactConverter $converter,
        private readonly ContactMediaBlobResolver $mediaBlobs,
        private readonly ContactMemberResolver $members,
        private readonly JmapContactStateService $contactStates,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toContactCard(Card $card, string $addressBookUri, string $username): array
    {
        $raw = is_string($card->carddata) ? $card->carddata : (string) $card->carddata;
        $contact = $this->converter->cardFromVCard($raw, 'debug');
        $contact = $this->mediaBlobs->exposeBlobsOnRead($username, $contact);
        $contact = $this->members->apply($username, $contact);
        $contact = self::hydrateDerivedNameFull($contact);

        $contact['id'] = self::cardIdFromUri((string) $card->uri);
        $contact['addressBookIds'] = [$addressBookUri => true];

        $etag = OptimisticConcurrency::formatEtag(is_string($card->etag) ? $card->etag : null);
        if ($etag !== null) {
            $contact['etag'] = $etag;
        }

        $lastModified = (int) ($card->lastmodified ?? 0);
        if ($lastModified > 0) {
            $timestamp = gmdate('Y-m-d\TH:i:s\Z', $lastModified);
            // DB lastmodified is the authoritative modification time; always override
            // any stale REV value that was preserved in the vCard data on a previous write.
            $contact['updated'] = $timestamp;
            if (! isset($contact['created']) || ! is_string($contact['created']) || $contact['created'] === '') {
                $contact['created'] = $timestamp;
            }
        }

        return $this->contactStates->attachStateToken($username, $contact, $card, $addressBookUri);
    }

    /**
     * API responses should always include a user-facing display name when one can
     * be derived from structured name components.
     *
     * @param  array<string, mixed>  $contact
     * @return array<string, mixed>
     */
    private static function hydrateDerivedNameFull(array $contact): array
    {
        if (! is_array($contact['name'] ?? null)) {
            return $contact;
        }

        $name = $contact['name'];
        if (($name['isOrdered'] ?? false) === false && is_array($name['components'] ?? null)) {
            $name['components'] = self::reorderUnorderedNameComponents($name['components']);
            $contact['name'] = $name;
        }

        $existingFull = trim((string) ($contact['name']['full'] ?? ''));
        if ($existingFull !== '') {
            return $contact;
        }

        $derivedFull = ConversionSupport::deriveFullName($contact);
        if ($derivedFull === '') {
            return $contact;
        }

        $contact['name']['full'] = $derivedFull;

        return $contact;
    }

    /**
     * vCard N stores unordered components in surname/given buckets. For API reads,
     * prefer a stable human-readable order for unordered names.
     *
     * @param  array<int|string, mixed>  $components
     * @return list<array<string, mixed>>
     */
    private static function reorderUnorderedNameComponents(array $components): array
    {
        /** @var array<string, int> $priority */
        $priority = [
            'title' => 0,
            'given' => 1,
            'given2' => 2,
            'surname' => 3,
            'surname2' => 4,
            'generation' => 5,
            'credential' => 6,
        ];

        $decorated = [];
        foreach ($components as $index => $component) {
            if (! is_array($component)) {
                continue;
            }
            $kind = (string) ($component['kind'] ?? '');
            $decorated[] = [
                'priority' => $priority[$kind] ?? 100,
                'index' => (int) $index,
                'component' => $component,
            ];
        }

        usort(
            $decorated,
            static function (array $left, array $right): int {
                if ($left['priority'] === $right['priority']) {
                    return $left['index'] <=> $right['index'];
                }

                return $left['priority'] <=> $right['priority'];
            },
        );

        return array_values(array_map(
            static fn (array $item): array => $item['component'],
            $decorated,
        ));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function toVCard(string $username, array $payload): string
    {
        $payload = $this->mediaBlobs->resolveBlobsOnWrite($username, $payload);
        $payload = ConversionSupport::syncGroupDisplayName($payload);

        return $this->converter->vCardFromCard($payload);
    }

    public static function cardIdFromUri(string $uri): string
    {
        return str_ends_with($uri, '.vcf')
            ? substr($uri, 0, -4)
            : $uri;
    }

    public static function cardUriFromId(string $cardId): string
    {
        return str_ends_with($cardId, '.vcf')
            ? $cardId
            : $cardId.'.vcf';
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function generateCardUri(array $payload): string
    {
        $base = ConversionSupport::deriveFullName($payload);
        $slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $base) ?? '', '-'));
        if ($slug === '') {
            $slug = 'contact';
        }

        $suffix = substr(str_replace('-', '', (string) Str::uuid()), 0, 8);

        return $slug.'-'.$suffix.'.vcf';
    }
}
