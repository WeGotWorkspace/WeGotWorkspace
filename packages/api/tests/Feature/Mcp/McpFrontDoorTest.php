<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Ui\UiStaticServer;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class McpFrontDoorTest extends TestCase
{
    private ?string $repoRoot = null;

    protected function tearDown(): void
    {
        if ($this->repoRoot !== null) {
            UiDistFixture::removeTree($this->repoRoot);
            $this->repoRoot = null;
        }

        parent::tearDown();
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function reservedPathProvider(): array
    {
        return [
            'mcp get' => ['GET', '/mcp'],
            'mcp propfind' => ['PROPFIND', '/mcp'],
            'oauth authorize' => ['GET', '/oauth/authorize'],
            'oauth token' => ['POST', '/oauth/token'],
            'well known as' => ['GET', '/.well-known/oauth-authorization-server'],
            'well known prm' => ['GET', '/.well-known/oauth-protected-resource'],
            'well known prm suffix' => ['GET', '/.well-known/oauth-protected-resource/mcp'],
        ];
    }

    #[DataProvider('reservedPathProvider')]
    public function test_mcp_and_oauth_paths_do_not_fall_through_to_sabredav(string $method, string $path): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $response = $this->call($method, $path, [], [], [], ['HTTP_ACCEPT' => '*/*']);
        $body = (string) $response->getContent();

        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', $body);
        $this->assertStringNotContainsString('File not found:', $body);
        $this->assertStringNotContainsString('<d:error', $body);
        $this->assertNotSame(207, $response->getStatusCode());
    }

    public function test_mcp_is_not_on_the_spa_shell_allowlist(): void
    {
        $this->assertNotContains('/mcp', UiStaticServer::spaRoutePrefixes());
        $this->assertNotContains('/oauth', UiStaticServer::spaRoutePrefixes());
    }
}
