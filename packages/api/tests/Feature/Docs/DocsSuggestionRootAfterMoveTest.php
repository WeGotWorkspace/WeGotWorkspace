<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * A suggestion has one thread root per document. The client derives the root
 * id from the document path, so after a move it asks for another id for a
 * change whose root moved along; the server must hand back that root (#1610).
 */
final class DocsSuggestionRootAfterMoveTest extends WgwDatabaseTestCase
{
    private const FROM = '/users/bob/docs/plan.md';

    private const TO = '/groups/team/plan.md';

    /** Root id the client derived from FROM. */
    private const ROOT_AT_FROM = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    /** Root id the client derives from TO for the same change. */
    private const ROOT_AT_TO = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB';

    private const SECOND_ROOT = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAC';

    private const CHANGE = 'ch_1793029096749_1_fbs06o';

    private const SECOND_CHANGE = 'ch_1793029099001_2_k3m9qa';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-suggestion-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob/docs', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->configureWgwJwtKeys();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);

        Storage::disk('wgw_files')->put(ltrim(self::FROM, '/'), "# Plan\n\nHello old world");
        $this->seedTeamWithBobAndAlice();
    }

    public function test_a_member_sees_the_author_after_a_move_and_the_change_keeps_one_root(): void
    {
        $this->createSuggestionRoot('bob', self::FROM, self::ROOT_AT_FROM, self::CHANGE);

        app(DriveService::class)->renameItem(['username' => 'bob', 'role' => 'user'], '/groups/team', self::FROM, 'plan.md');

        $seenByAlice = $this->suggestionRoots('alice', self::TO);
        $this->assertSame([self::CHANGE => self::ROOT_AT_FROM], $this->rootIdsByChange($seenByAlice));
        $this->assertSame('bob', $seenByAlice[0]['createdBy']['id']);

        // Bob's client, now on TO, makes another suggestion and asks for a root
        // for the old change too, under the id it derives from TO.
        $replayed = $this->createSuggestionRoot('bob', self::TO, self::ROOT_AT_TO, self::CHANGE);
        $this->assertSame(self::ROOT_AT_FROM, $replayed['id']);
        $this->assertSame('bob', $replayed['createdBy']['id']);
        $this->createSuggestionRoot('bob', self::TO, self::SECOND_ROOT, self::SECOND_CHANGE);

        $this->assertSame(
            [self::CHANGE => self::ROOT_AT_FROM, self::SECOND_CHANGE => self::SECOND_ROOT],
            $this->rootIdsByChange($this->suggestionRoots('alice', self::TO)),
        );
        $this->assertSame(0, CalendarObject::query()->where('uid', self::ROOT_AT_TO)->count());
    }

    public function test_a_second_id_for_the_same_change_on_one_document_gets_the_first_root(): void
    {
        Storage::disk('wgw_files')->put(ltrim(self::TO, '/'), "# Plan\n\nHello old world");
        $this->createSuggestionRoot('bob', self::TO, self::ROOT_AT_FROM, self::CHANGE);
        $replayed = $this->createSuggestionRoot('alice', self::TO, self::ROOT_AT_TO, self::CHANGE);

        $this->assertSame(self::ROOT_AT_FROM, $replayed['id']);
        $this->assertSame([self::CHANGE => self::ROOT_AT_FROM], $this->rootIdsByChange($this->suggestionRoots('alice', self::TO)));
    }

    public function test_an_archived_root_still_counts_as_the_root_of_its_change(): void
    {
        $this->createSuggestionRoot('bob', self::FROM, self::ROOT_AT_FROM, self::CHANGE);
        $this->as('bob')
            ->patchJson('/api/v1/files/threads/'.self::ROOT_AT_FROM.'?path='.urlencode(self::FROM), [
                'archived' => true,
                'changeId' => self::CHANGE,
            ])
            ->assertOk();

        $replayed = $this->createSuggestionRoot('bob', self::FROM, self::ROOT_AT_TO, self::CHANGE);

        $this->assertSame(self::ROOT_AT_FROM, $replayed['id']);
        $this->assertTrue($replayed['archived']);
    }

    private function seedTeamWithBobAndAlice(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['displayname' => 'Groups', 'email' => null],
        );
        $this->seedWgwUser('alice');
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        foreach (['bob', 'alice'] as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
        mkdir($this->dataDir.'/files/groups/team', 0775, true);
    }

    /** @return array<string, mixed> */
    private function createSuggestionRoot(
        string $username,
        string $path,
        string $id,
        string $changeId,
    ): array {
        $thread = $this->as($username)
            ->postJson('/api/v1/files/threads?path='.urlencode($path), [
                'id' => $id,
                'kind' => 'suggestion',
                'changeId' => $changeId,
                'body' => '',
            ])
            ->assertCreated()
            ->json();
        $this->assertSame($changeId, $thread['changeId']);
        // Every root here was first made by Bob.
        $this->assertSame('bob', $thread['createdBy']['id']);

        return $thread;
    }

    /** @return list<array<string, mixed>> */
    private function suggestionRoots(string $username, string $path): array
    {
        /** @var list<array<string, mixed>> $list */
        $list = $this->as($username)
            ->getJson('/api/v1/files/threads?path='.urlencode($path))
            ->assertOk()
            ->json('list');

        return array_values(array_filter($list, static fn (array $thread): bool => $thread['kind'] === 'suggestion'));
    }

    /**
     * @param  list<array<string, mixed>>  $threads
     * @return array<string, string>
     */
    private function rootIdsByChange(array $threads): array
    {
        $byChange = [];
        foreach ($threads as $thread) {
            $this->assertArrayNotHasKey($thread['changeId'], $byChange, 'one root per change id');
            $byChange[$thread['changeId']] = $thread['id'];
        }
        ksort($byChange);

        return $byChange;
    }

    private function as(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
