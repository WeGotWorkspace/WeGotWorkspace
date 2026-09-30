<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Update;

use App\Services\Update\ReleaseFeedClient;
use PHPUnit\Framework\TestCase;
use Tests\Support\Update\FakeHttps;

final class ReleaseFeedClientTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        FakeHttps::install();
    }

    protected function tearDown(): void
    {
        FakeHttps::remove();
        parent::tearDown();
    }

    public function test_parses_version_feed(): void
    {
        $url = 'https://github.com/acme/wgw/releases/download/v0.2.0/manifest.json';
        FakeHttps::$bodies[$url] = (string) json_encode([
            'version' => '0.2.0',
            'checksum_sha256' => 'abc',
        ]);

        $manifest = (new ReleaseFeedClient)->fetchLatest($url);

        $this->assertIsArray($manifest);
        $this->assertSame('0.2.0', $manifest['version']);
        $this->assertSame(
            'https://github.com/acme/wgw/releases/download/v0.2.0/wegotworkspace-deploy-0.2.0.zip',
            $manifest['package_url'],
        );
        $this->assertSame('https://github.com/acme/wgw/releases/tag/v0.2.0', $manifest['notes_url']);
        $this->assertSame('abc', $manifest['checksum_sha256']);
    }

    public function test_parses_github_release_when_manifest_url_is_not_json(): void
    {
        $feed = 'https://github.com/acme/wgw/releases/latest/download/manifest.json';
        $api = 'https://api.github.com/repos/acme/wgw/releases/latest';
        $manifestUrl = 'https://github.com/acme/wgw/releases/download/v0.3.0/manifest.json';
        FakeHttps::$bodies[$feed] = '<html>not json</html>';
        FakeHttps::$bodies[$api] = (string) json_encode([
            'tag_name' => 'v0.3.0',
            'html_url' => 'https://github.com/acme/wgw/releases/tag/v0.3.0',
            'assets' => [
                [
                    'name' => 'manifest.json',
                    'browser_download_url' => $manifestUrl,
                ],
                [
                    'name' => 'wegotworkspace-deploy-0.3.0.zip',
                    'browser_download_url' => 'https://github.com/acme/wgw/releases/download/v0.3.0/wegotworkspace-deploy-0.3.0.zip',
                ],
            ],
        ]);
        FakeHttps::$bodies[$manifestUrl] = (string) json_encode([
            'version' => '0.3.0',
            'checksum_sha256' => 'def',
        ]);

        $manifest = (new ReleaseFeedClient)->fetchLatest($feed);

        $this->assertIsArray($manifest);
        $this->assertSame('0.3.0', $manifest['version']);
        $this->assertSame(
            'https://github.com/acme/wgw/releases/download/v0.3.0/wegotworkspace-deploy-0.3.0.zip',
            $manifest['package_url'],
        );
        $this->assertSame('https://github.com/acme/wgw/releases/tag/v0.3.0', $manifest['notes_url']);
    }

    public function test_handles_unavailable_feed(): void
    {
        $client = new ReleaseFeedClient;

        $this->assertNull($client->fetchLatest(''));
        $this->assertNull($client->fetchLatest('   '));
        $this->assertNull($client->fetchLatest('https://updates.test/missing.json'));
    }

    public function test_handles_invalid_response(): void
    {
        $client = new ReleaseFeedClient;
        FakeHttps::$bodies['https://updates.test/bad.json'] = '{not-json';
        FakeHttps::$bodies['https://updates.test/empty-object.json'] = '{}';
        FakeHttps::$bodies['https://updates.test/no-manifest.json'] = (string) json_encode([
            'tag_name' => 'v1.0.0',
            'assets' => [
                ['name' => 'notes.txt', 'browser_download_url' => 'https://updates.test/notes.txt'],
            ],
        ]);

        $this->assertNull($client->fetchLatest('https://updates.test/bad.json'));
        $this->assertNull($client->fetchLatest('https://updates.test/empty-object.json'));
        $this->assertNull($client->fetchLatest('https://updates.test/no-manifest.json'));
    }
}
