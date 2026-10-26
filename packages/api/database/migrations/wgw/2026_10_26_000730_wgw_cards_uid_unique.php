<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Contacts\CardUid;
use App\Services\Contacts\CardUidBackfill;
use Illuminate\Database\Schema\Blueprint;

/**
 * RFC 6352 §5.1: a vCard UID is unique within one address book (#1609).
 *
 * The UID only lived inside `carddata`, so nothing stopped a second card with
 * the same UID. This adds `cards.uid` (normalized, see CardUid), fills it,
 * resolves existing duplicates (CardUidBackfill: lowest id keeps the UID, the
 * others get a new one; nothing is deleted) and then adds
 * UNIQUE(addressbookid, uid). Sabre's MySQL schema also lacks the
 * UNIQUE(addressbookid, uri) that SQLite has; it is added here too.
 */
return new class extends WgwMigration
{
    private const UID_INDEX = 'cards_addressbookid_uid_unique';

    private const URI_INDEX = 'cards_addressbookid_uri_unique';

    public function up(): void
    {
        if (! $this->wgwHasTable('cards')) {
            return;
        }

        $mysql = $this->wgw()->getConnection()->getDriverName() !== 'sqlite';
        if (! $this->wgwHasColumn('cards', 'uid')) {
            $this->wgw()->table('cards', function (Blueprint $table) use ($mysql): void {
                // MySQL: binary so equality is exact (no case or accent folding).
                $mysql
                    ? $table->binary('uid', CardUid::MAX_LENGTH)->nullable()
                    : $table->string('uid', CardUid::MAX_LENGTH)->nullable();
            });
        }

        app(CardUidBackfill::class)->run();

        $indexes = $this->indexNames();
        $this->wgw()->table('cards', function (Blueprint $table) use ($mysql, $indexes): void {
            if ($mysql && ! in_array(self::URI_INDEX, $indexes, true)) {
                $table->unique(['addressbookid', 'uri'], self::URI_INDEX);
            }
            if (! in_array(self::UID_INDEX, $indexes, true)) {
                $table->unique(['addressbookid', 'uid'], self::UID_INDEX);
            }
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('cards')) {
            return;
        }

        $indexes = $this->indexNames();
        $this->wgw()->table('cards', function (Blueprint $table) use ($indexes): void {
            foreach ([self::UID_INDEX, self::URI_INDEX] as $index) {
                if (in_array($index, $indexes, true)) {
                    $table->dropUnique($index);
                }
            }
        });
        if ($this->wgwHasColumn('cards', 'uid')) {
            $this->wgw()->table('cards', function (Blueprint $table): void {
                $table->dropColumn('uid');
            });
        }
    }

    /**
     * @return list<string>
     */
    private function indexNames(): array
    {
        return array_map(
            static fn (array $index): string => (string) $index['name'],
            $this->wgw()->getIndexes('cards'),
        );
    }
};
