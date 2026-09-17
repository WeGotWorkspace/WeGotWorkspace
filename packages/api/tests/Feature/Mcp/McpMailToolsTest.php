<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\MailSendTool;
use App\Mcp\Tools\MailStatusTool;
use App\Services\Mcp\McpScopes;
use App\Support\WgwSettings;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpMailToolsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
        $this->enableMcp();
    }

    protected function tearDown(): void
    {
        $this->tearDownMailFixtures();
        parent::tearDown();
    }

    public function test_catalog_hides_mail_tools_when_instance_kill_switch_is_off(): void
    {
        $this->setAppSettings([WgwSettings::MAIL_ENABLED => false]);
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertNotContains(MailStatusTool::class, $tools);
        $this->assertNotContains(MailSendTool::class, $tools);
    }

    public function test_mail_status_reports_this_users_smtp_not_instance_host(): void
    {
        $this->setAppSettings([
            WgwSettings::MAIL_SMTP_HOST => 'smtp.instance.test',
            WgwSettings::MAIL_SMTP_PORT => 25,
        ]);
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret', [
            'smtpHost' => 'smtp.user-a.test',
            'smtpPort' => 2525,
            'smtpSecurity' => 'none',
        ]);

        $user = $this->mcpUser('bob');
        Passport::actingAs($user, [McpScopes::MAIL_READ], 'api', $this->mcpClient());

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MailStatusTool::class)
            ->assertOk()
            ->assertSee('smtp.user-a.test')
            ->assertSee('2525');
    }

    public function test_mail_send_uses_this_users_smtp_not_instance_host(): void
    {
        $this->setAppSettings([
            WgwSettings::MAIL_SMTP_HOST => 'smtp.instance.test',
            WgwSettings::MAIL_SMTP_PORT => 25,
        ]);
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret', [
            'smtpHost' => '127.0.0.1',
            'smtpPort' => 9,
            'smtpSecurity' => 'none',
        ]);

        $user = $this->mcpUser('bob');
        Passport::actingAs($user, [McpScopes::MAIL_SEND], 'api', $this->mcpClient());

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MailSendTool::class, [
                'to' => 'recipient@example.test',
                'subject' => 'Hello',
                'body' => 'Body',
            ])
            ->assertHasErrors(['smtp_connect']);
    }
}
