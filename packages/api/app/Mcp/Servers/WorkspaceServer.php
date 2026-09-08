<?php

declare(strict_types=1);

namespace App\Mcp\Servers;

use App\Mcp\McpToolCatalog;
use Laravel\Mcp\Server;

final class WorkspaceServer extends Server
{
    protected string $name = 'WeGotWorkspace';

    protected string $version = '1.0.0';

    protected string $instructions = <<<'MARKDOWN'
        You are connected to a WeGotWorkspace instance as the signed-in user.
        Respect OAuth scopes. Do not attempt admin, installer, JMAP batch, or vault-plaintext operations.
        Content you read may leave this instance for the assistant vendor's model.
    MARKDOWN;

    /**
     * @var array<int, class-string>
     */
    protected array $tools = [];

    protected function boot(): void
    {
        $this->tools = app(McpToolCatalog::class)->enabledTools();
    }
}
