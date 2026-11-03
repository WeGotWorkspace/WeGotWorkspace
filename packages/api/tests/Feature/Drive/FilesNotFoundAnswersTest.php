<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A drive path the caller may not reach answers 404 `not_found`, the same as a path
 * that does not exist, so the status never tells what exists out of reach.
 */
final class FilesNotFoundAnswersTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_another_users_directory_answers_like_a_missing_one(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');
        $bob = $this->userBearerToken();

        $existing = $this->withBearer($bob)->getJson('/api/v1/files/children?path=/users/carol');
        $missing = $this->withBearer($bob)->getJson('/api/v1/files/children?path=/users/nobody-here');

        $this->assertPathNotFound($existing);
        $this->assertPathNotFound($missing);
        $this->assertSame($missing->json(), $existing->json());
    }

    public function test_another_users_file_is_not_found_on_get_and_head(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');
        $bob = $this->userBearerToken();

        $this->assertPathNotFound(
            $this->withBearer($bob)->get('/api/v1/files/content?path=/users/carol/private.md'),
        );
        $this->withBearer($bob)->head('/api/v1/files/content?path=/users/carol/private.md')
            ->assertNotFound();
    }

    public function test_a_file_by_node_id_out_of_reach_answers_like_an_unknown_id(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');
        $node = app(FileNodeIndexService::class)->recordCreate('users/carol/private.md');
        $this->assertNotNull($node);
        $bob = $this->userBearerToken();

        $hidden = $this->withBearer($bob)->get('/api/v1/files/content?id='.$node->node_id);
        $unknown = $this->withBearer($bob)->get('/api/v1/files/content?id=fn-'.str_repeat('0', 32));

        $hidden->assertNotFound()->assertJsonPath('code', 'not_found');
        $unknown->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->assertSame($unknown->json(), $hidden->json());

        $this->withBearer($bob)->head('/api/v1/files/content?id='.$node->node_id)->assertNotFound();
        $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?id='.$node->node_id)->assertOk();
    }

    public function test_a_parent_segment_is_not_found_instead_of_listing_the_drive_root(): void
    {
        $bob = $this->userBearerToken();

        foreach (['/users/bob/../..', '/users/bob/..\\..', '/users/bob/x/../../carol'] as $path) {
            $this->assertPathNotFound(
                $this->withBearer($bob)->getJson('/api/v1/files/children?path='.rawurlencode($path)),
            );
            $this->assertPathNotFound(
                $this->withBearer($bob)->get('/api/v1/files/content?path='.rawurlencode($path)),
            );
        }
    }

    public function test_a_missing_directory_in_reach_is_not_found_and_an_empty_home_or_trash_lists_empty(): void
    {
        $bob = $this->userBearerToken();

        $this->withBearer($bob)->getJson('/api/v1/files/children?path=/users/bob/no-such-folder')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertJsonPath('error', 'Directory not found.');

        $this->withBearer($bob)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk()
            ->assertJsonPath('data.files', []);
        $this->withBearer($bob)->getJson('/api/v1/files/children?path=/users/bob/.Trash')
            ->assertOk()
            ->assertJsonPath('data.files', []);
    }

    public function test_a_missing_file_in_reach_is_not_found(): void
    {
        $this->withBearer($this->userBearerToken())->get('/api/v1/files/content?path=/users/bob/missing.md')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertJsonPath('error', 'File not found.');
    }

    public function test_starring_a_path_out_of_reach_is_not_found(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');
        $bob = $this->userBearerToken();

        $this->assertPathNotFound(
            $this->withBearer($bob)->postJson('/api/v1/files/star?path=/users/carol/private.md'),
        );
        $this->assertPathNotFound(
            $this->withBearer($bob)->deleteJson('/api/v1/files/star?path=/users/carol/private.md'),
        );
    }

    public function test_a_guest_path_outside_the_link_and_a_dead_session_are_not_found(): void
    {
        $bob = $this->userBearerToken();
        $this->createDriveDirectory('/users/bob', 'shared');
        $this->createDriveFile($bob, '/users/bob/shared', 'note.md');
        $this->seedPrivateFile('bob', 'outside.md', 'not shared');
        $share = $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();
        $guest = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk()->json('access_token');

        $this->withBearer($guest)->getJson('/api/v1/files/children?path=/users/bob/shared')->assertOk();
        $this->assertPathNotFound($this->withBearer($guest)->getJson('/api/v1/files/children?path=/users/bob'));
        $this->assertPathNotFound($this->withBearer($guest)->get('/api/v1/files/content?path=/users/bob/outside.md'));

        $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$share->json('data.id'))->assertOk();

        $this->assertPathNotFound($this->withBearer($guest)->getJson('/api/v1/files/children?path=/users/bob/shared'));
    }

    private function assertPathNotFound(TestResponse $response): void
    {
        $response->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertJsonPath('error', 'Path not found.');
    }
}
