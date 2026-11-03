<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Dav\Server\WgwCardBackend;
use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\CardUid;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1609 migration: fill `cards.uid` and resolve duplicate UIDs without losing
 * data. Rows are seeded past the backend with an empty column, the way cards
 * written before the migration look.
 */
final class CardUidBackfillTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private const UUID = 'aaaaaaaa-1111-4111-8111-111111111111';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        WgwCardBackend::fromConnection()->createAddressBook('principals/bob', 'work', ['{DAV:}displayname' => 'Work']);
    }

    public function test_migration_re_uids_seeded_duplicates_and_keeps_all_their_data(): void
    {
        $home = $this->bookId('default');
        $work = $this->bookId('work');
        $keeper = $this->seedRaw($home, 'keeper.vcf', $this->vcard('urn:uuid:'.strtoupper(self::UUID), 'Keeper'));
        $bare = $this->seedRaw($home, 'bare.vcf', $this->vcard(self::UUID, 'Bare Form', "NOTE:keep me\r\n"));
        $upper = $this->seedRaw($home, 'upper.vcf', $this->vcard('URN:UUID:'.self::UUID, 'Upper Form', "EMAIL:upper@example.com\r\n"));
        $noUid = $this->seedRaw($home, 'no-uid.vcf', "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:No Uid\r\nEND:VCARD\r\n");
        $unique = $this->seedRaw($home, 'unique.vcf', $this->vcard('urn:uuid:bbbbbbbb-2222-4222-8222-222222222222', 'Unique'));
        $otherBook = $this->seedRaw($work, 'work.vcf', $this->vcard('urn:uuid:'.self::UUID, 'Work Copy'));
        $before = Card::query()->get()->keyBy('id');
        $syncBefore = (int) Addressbook::query()->whereKey($home)->value('synctoken');
        $logged = [];
        Log::listen(static function (MessageLogged $event) use (&$logged): void {
            if ($event->message === 'contacts.card_uid_backfill') {
                $logged[] = $event->context;
            }
        });

        $this->runMigration();

        $after = Card::query()->get()->keyBy('id');
        $this->assertSame($before->keys()->all(), $after->keys()->all(), 'Nothing is deleted.');

        foreach ([$keeper, $unique, $otherBook] as $id) {
            $this->assertSame($before[$id]->carddata, $after[$id]->carddata);
            $this->assertSame($before[$id]->etag, $after[$id]->etag);
        }
        $this->assertSame(self::UUID, $after[$keeper]->uid, 'Lowest id keeps the UID.');
        $this->assertSame(self::UUID, $after[$otherBook]->uid, 'Another book may hold the same UID.');

        $newUids = [];
        foreach ([$bare, $upper, $noUid] as $id) {
            $raw = (string) $after[$id]->carddata;
            $uid = CardUid::rawFromCardData($raw);
            $this->assertNotNull($uid);
            $this->assertMatchesRegularExpression('/^urn:uuid:[0-9a-f-]{36}$/', $uid);
            $this->assertSame(CardUid::normalize($uid), $after[$id]->uid);
            $this->assertSame(md5($raw), $after[$id]->etag, 'Written through the backend.');
            $this->assertSame($this->withoutUidLine((string) $before[$id]->carddata), $this->withoutUidLine($raw), 'Only the UID changes.');
            $newUids[] = $uid;
        }
        $this->assertCount(3, array_unique($newUids));

        $changes = DB::connection('wgw')->table('addressbookchanges')
            ->where('addressbookid', $home)
            ->where('synctoken', '>=', $syncBefore)
            ->pluck('operation', 'uri')
            ->all();
        $this->assertEquals(['bare.vcf' => 2, 'upper.vcf' => 2, 'no-uid.vcf' => 2], $changes);
        $this->assertSame($syncBefore + 3, (int) Addressbook::query()->whereKey($home)->value('synctoken'));

        $this->assertCount(1, $logged, 'The re-UID count is logged.');
        $this->assertSame(2, $logged[0]['reUided']);
        $this->assertSame(1, $logged[0]['generated']);
        $this->assertSame(3, $logged[0]['filled']);
    }

    public function test_migration_is_a_no_op_on_a_clean_table(): void
    {
        $this->seedCardViaPdo('bob', 'clean.vcf', $this->sampleVcard('Clean'));
        $before = Card::query()->sole();

        $this->runMigration();

        $after = Card::query()->sole();
        $this->assertSame($before->etag, $after->etag);
        $this->assertSame($before->uid, $after->uid);
    }

    public function test_duplicate_uri_row_gets_a_new_uri_and_both_uris_enter_the_sync_log(): void
    {
        $home = $this->bookId('default');
        $id = $this->seedRaw($home, 'twin.vcf', $this->sampleVcard('Twin'));
        $syncBefore = (int) Addressbook::query()->whereKey($home)->value('synctoken');

        WgwCardBackend::fromConnection()->moveDuplicateUriRow($id, 'twin-2.vcf');

        $this->assertSame('twin-2.vcf', Card::query()->whereKey($id)->value('uri'));
        $this->assertEquals(
            ['twin-2.vcf' => 1, 'twin.vcf' => 2],
            DB::connection('wgw')->table('addressbookchanges')
                ->where('addressbookid', $home)
                ->where('synctoken', '>=', $syncBefore)
                ->pluck('operation', 'uri')
                ->all(),
        );
    }

    private function runMigration(): void
    {
        $migration = require database_path('migrations/wgw/2026_10_26_000730_wgw_cards_uid_unique.php');
        $migration->up();
    }

    private function seedRaw(int $bookId, string $uri, string $carddata): int
    {
        return (int) Card::query()->create([
            'addressbookid' => $bookId,
            'carddata' => $carddata,
            'uri' => $uri,
            'lastmodified' => 1,
            'etag' => md5($carddata),
            'size' => strlen($carddata),
        ])->id;
    }

    private function vcard(string $uid, string $name, string $extra = ''): string
    {
        return "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:{$name}\r\n{$extra}END:VCARD\r\n";
    }

    private function withoutUidLine(string $vcard): string
    {
        return (string) preg_replace('/^UID:[^\r\n]*\r\n/m', '', $vcard);
    }

    private function bookId(string $uri): int
    {
        return (int) Addressbook::query()->where('principaluri', 'principals/bob')->where('uri', $uri)->value('id');
    }
}
