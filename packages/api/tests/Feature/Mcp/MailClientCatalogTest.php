<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Tools\MailSendTool;
use App\Mcp\Tools\MailStatusTool;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WithMailClientEnabled;

final class MailClientCatalogTest extends WgwDatabaseTestCase
{
    use WithMailClientEnabled;

    public function test_catalog_registers_mail_tools_when_client_flag_is_on(): void
    {
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertContains(MailStatusTool::class, $tools);
        $this->assertContains(MailSendTool::class, $tools);
    }
}
