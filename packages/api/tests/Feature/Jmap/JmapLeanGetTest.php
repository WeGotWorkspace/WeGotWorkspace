<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\GetProjection;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Notes\NoteRepository;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Lean list reads (#2359): the shared per-record projection, and the /get loops
 * that read their lookups once per request instead of once per record.
 */
final class JmapLeanGetTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures, DriveTestFixtures {
        ContactsTestFixtures::carolBearerToken insteadof DriveTestFixtures;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->setUpContactsFixtures();
        $this->seedDefaultAddressBookFor('bob');
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_projection_keeps_id_and_the_named_properties_and_says_what_it_wants(): void
    {
        $projection = GetProjection::fromArgs(['properties' => ['name', 'etag']]);
        $this->assertSame(['id' => '1', 'name' => 'n'], $projection->apply(['id' => '1', 'name' => 'n', 'body' => 'x']));
        $this->assertTrue($projection->wants('name'));
        $this->assertFalse($projection->wants('type'));

        $all = GetProjection::fromArgs([]);
        $this->assertTrue($all->wants('type'));
        $this->assertSame(['a' => 1], $all->apply(['a' => 1]));
    }

    public function test_projection_rejects_malformed_properties_before_anything_is_loaded(): void
    {
        $this->expectException(JmapMethodException::class);
        GetProjection::fromArgs(['properties' => ['ok', 3]]);
    }

    public function test_contact_get_runs_a_constant_number_of_queries_however_many_cards(): void
    {
        $ids = [];
        for ($i = 0; $i < 30; $i++) {
            $ids[] = $this->seedCardViaPdo('bob', "q{$i}.vcf", $this->sampleVcard("Person {$i}"));
        }
        $get = fn (array $slice) => $this->jmapContacts([['ContactCard/get', ['accountId' => 'bob', 'ids' => [...$slice, 'missing-card']], 'c']])
            ->assertOk()->json('methodResponses.0.1');
        $get(array_slice($ids, 0, 2)); // warm: creates the state rows

        $count = function (array $slice) use ($get): int {
            DB::connection('wgw')->enableQueryLog();
            DB::connection('wgw')->flushQueryLog();
            $get($slice);
            $n = count(DB::connection('wgw')->getQueryLog());
            DB::connection('wgw')->disableQueryLog();

            return $n;
        };
        $get($ids); // creates the rest of the state rows
        $few = $count(array_slice($ids, 0, 2));
        $many = $count($ids);
        $this->assertLessThanOrEqual($few + 3, $many, "queries grew with the cards: {$few} for 2, {$many} for 30");

        $result = $get($ids);
        $this->assertCount(30, $result['list']);
        $this->assertSame(['missing-card'], $result['notFound']);
        $this->assertNotEmpty($result['list'][0]['state']);
    }

    public function test_note_get_matches_single_note_reads_and_batches_state_writes(): void
    {
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        $repo = app(NoteRepository::class);
        $ids = [];
        for ($i = 0; $i < 12; $i++) {
            $ids[] = $repo->create('bob', ['notebookId' => CalendarCollectionUris::NOTE_GENERAL, 'title' => "N{$i}", 'body' => "body {$i}", 'categories' => ['a']])['id'];
        }
        $call = fn (array $args) => $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => [['Note/get', ['accountId' => 'bob'] + $args, 'c']],
        ])->assertOk()->json('methodResponses.0.1');

        $result = $call(['ids' => [...$ids, 'no-such-note']]);
        $this->assertSame(['no-such-note'], $result['notFound']);
        $this->assertCount(12, $result['list']);
        foreach ($result['list'] as $note) {
            $single = $repo->show('bob', $note['id']);
            $this->assertSame($single, $note, 'a batched read must equal the single-note read, contentEtag included');
        }

        $lean = $call(['ids' => $ids, 'properties' => ['title', 'etag']]);
        $this->assertSame(['etag', 'id', 'title'], array_keys($this->sorted($lean['list'][0])));

        DB::connection('wgw')->enableQueryLog();
        DB::connection('wgw')->flushQueryLog();
        $call(['ids' => $ids]);
        $writes = array_filter(DB::connection('wgw')->getQueryLog(), static fn (array $q): bool => preg_match('/^\s*(insert|update)\s+(into\s+)?"?(jmap_note_states|note_stars|calendarobjects)/i', $q['query']) === 1);
        $this->assertSame([], array_values($writes), 'a read of unchanged notes writes nothing');
    }

    public function test_file_node_get_without_type_skips_the_type_and_with_type_keeps_it(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/lean/a.md', '# hi');
        // Written past the app: get-all picks it up (an unfiltered query reads the index alone, #2063).
        $nodes = array_column($this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null, 'properties' => ['id']], 'g']],
        ])->assertOk()->json('methodResponses.0.1.list'), 'id');
        $get = fn (?array $props) => $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => $nodes] + ($props === null ? [] : ['properties' => $props]), 'c']],
        ])->assertOk()->json('methodResponses.0.1.list');

        $full = $get(null);
        $file = collect($full)->firstWhere('name', 'a.md');
        $this->assertNotEmpty($file['type']);
        $lean = collect($get(['name', 'size']))->firstWhere('name', 'a.md');
        $this->assertSame(['id', 'name', 'size'], array_keys($this->sorted($lean)));
        $typed = collect($get(['name', 'type']))->firstWhere('name', 'a.md');
        $this->assertSame($file['type'], $typed['type']);
    }

    /** @param array<string, mixed> $a @return array<string, mixed> */
    private function sorted(array $a): array
    {
        ksort($a);

        return $a;
    }
}
