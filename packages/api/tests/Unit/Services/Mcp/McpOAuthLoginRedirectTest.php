<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Mcp;

use App\Services\Mcp\McpOAuthLoginRedirect;
use Illuminate\Http\Request;
use Tests\TestCase;

final class McpOAuthLoginRedirectTest extends TestCase
{
    public function test_sanitizes_same_host_authorize_url(): void
    {
        $request = $this->requestWithIntended(url('/oauth/authorize?client_id=a&state=1'));

        $this->assertSame(
            '/oauth/authorize?client_id=a&state=1',
            McpOAuthLoginRedirect::relativeAuthorize($request),
        );
    }

    public function test_rejects_external_intended_host(): void
    {
        $request = $this->requestWithIntended('https://evil.example/oauth/authorize?x=1');

        $this->assertSame(
            McpOAuthLoginRedirect::AUTHORIZE_PATH,
            McpOAuthLoginRedirect::relativeAuthorize($request),
        );
    }

    public function test_rejects_non_authorize_paths(): void
    {
        $request = $this->requestWithIntended('/login?return=%2Fadmin');

        $this->assertSame(
            McpOAuthLoginRedirect::AUTHORIZE_PATH,
            McpOAuthLoginRedirect::relativeAuthorize($request),
        );
    }

    public function test_spa_login_url_includes_return_and_intent(): void
    {
        $request = $this->requestWithIntended('/oauth/authorize?client_id=abc');
        $url = McpOAuthLoginRedirect::spaLoginUrl($request, 'intent-token', 'invalid');
        $query = [];
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        $this->assertSame('/login', parse_url($url, PHP_URL_PATH));
        $this->assertSame('/oauth/authorize?client_id=abc', $query['return'] ?? null);
        $this->assertSame('intent-token', $query['intent'] ?? null);
        $this->assertSame('invalid', $query['error'] ?? null);
    }

    private function requestWithIntended(string $intended): Request
    {
        $request = Request::create(url('/oauth/session'));
        $request->setLaravelSession($this->app->make('session.store'));
        $request->session()->put('url.intended', $intended);

        return $request;
    }
}
