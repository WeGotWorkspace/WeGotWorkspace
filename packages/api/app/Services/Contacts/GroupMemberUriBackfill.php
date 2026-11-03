<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Dav\Server\WgwCardBackend;
use App\Models\Card;

/**
 * One-time repair for macOS CardDAV corrupt group member URIs already stored in cards.carddata.
 */
final class GroupMemberUriBackfill
{
    public function __construct(
        private readonly MemberUriSanitizer $sanitizer,
    ) {}

    /**
     * @return array{scanned: int, updated: int}
     */
    public function run(): array
    {
        $cardBackend = WgwCardBackend::fromConnection();
        $scanned = 0;
        $updated = 0;

        Card::query()
            ->where(function ($query): void {
                $query->where('carddata', 'like', '%MEMBER:%')
                    ->orWhere('carddata', 'like', '%X-ADDRESSBOOKSERVER-MEMBER:%')
                    ->orWhere('carddata', 'like', '%X-ABGROUPMEMBER:%');
            })
            ->orderBy('id')
            ->chunkById(100, function ($cards) use ($cardBackend, &$scanned, &$updated): void {
                foreach ($cards as $card) {
                    $scanned++;
                    $raw = is_string($card->carddata) ? $card->carddata : (string) $card->carddata;
                    if ($raw === '') {
                        continue;
                    }

                    $result = $this->sanitizer->sanitize($raw);
                    if (! $result['changed']) {
                        continue;
                    }

                    $cardBackend->updateCard(
                        (int) $card->addressbookid,
                        (string) $card->uri,
                        $result['vcard'],
                    );
                    $updated++;
                }
            });

        return [
            'scanned' => $scanned,
            'updated' => $updated,
        ];
    }
}
