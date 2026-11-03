<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Tests\Support\DocsTestFixtures;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

final class DocsCollabDriveTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;
    use SendsFramedCollaboration;

    private const GROUP_PLAN = '/groups/team/plan.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_group_member_reads_default_markdown_when_file_missing(): void
    {
        $token = $this->userBearerToken();

        $response = $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN))
            ->assertOk()
            ->assertHeader('Content-Type', 'text/markdown; charset=utf-8');

        $this->assertSame('', $response->getContent());
    }

    public function test_group_member_persists_collaboration_markdown(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                "# Plan\n\nShip docs tests.",
            )
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN))
            ->assertOk()
            ->assertSeeText('Ship docs tests.');

        $stored = (string) app(WgwStorage::class)->files()->get('groups/team/plan.md');
        $this->assertStringContainsString('# Plan', $stored);
    }

    public function test_yjs_sidecar_round_trips_with_collaboration_put(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                "# Plan\n\nWith Yjs.\n",
                "\x01\x02\x03\xff",
            )
            ->assertOk()
            ->assertJsonPath('ok', true);

        $storage = app(WgwStorage::class)->files();
        $this->assertSame(
            "\x01\x02\x03\xff",
            $storage->get('groups/team/.plan.md.yjs')
        );

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN).'&format=yjs')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertContent("\x01\x02\x03\xff");
    }

    public function test_non_member_cannot_read_or_write_group_collaboration(): void
    {
        $carolToken = $this->carolBearerToken();

        $this->withBearer($carolToken)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN))
            ->assertNotFound()
            ->assertJsonPath('error', 'not_found');

        $this->withBearer($carolToken)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                'blocked',
            )
            ->assertNotFound()
            ->assertJsonPath('error', 'not_found');
    }

    public function test_admin_with_group_membership_can_collaborate_on_team_drive(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                "# Admin plan\n",
            )
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN))
            ->assertOk()
            ->assertSeeText('# Admin plan');
    }

    public function test_oversized_collaboration_markdown_returns_payload_too_large(): void
    {
        $token = $this->userBearerToken();
        $oversized = str_repeat('x', 2_097_153);

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                $oversized,
            )
            ->assertStatus(413)
            ->assertJsonPath('error', 'markdown_too_large');
    }

    public function test_collaboration_save_indexes_mixed_unicode_tokens_without_duplicate_error(): void
    {
        if (! class_exists(\Normalizer::class)) {
            $this->markTestSkipped('intl Normalizer extension is required for Unicode search token normalization.');
        }

        $token = $this->userBearerToken();
        $precomposed = 'één';
        $decomposed = "e\u{0301}én";
        $markdown = "# Roadmap\n\nMulti-tenancy voor {$precomposed} en ook {$decomposed} providers.\n";

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::GROUP_PLAN),
                $markdown,
            )
            ->assertOk()
            ->assertJsonPath('ok', true);

        $documentId = DB::connection('wgw')->table('search_documents')
            ->where('source_key', 'groups/team/plan.md')
            ->value('id');
        $this->assertNotNull($documentId);

        $termCount = DB::connection('wgw')->table('search_terms')
            ->where('document_id', $documentId)
            ->where('field', 'body')
            ->where('token', 'één')
            ->count();
        $this->assertSame(1, $termCount);
    }
}
