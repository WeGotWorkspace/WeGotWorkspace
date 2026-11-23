<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use Tests\Support\WgwDatabaseTestCase;

/**
 * The REST API is same-origin only. Another site must not read a response or
 * send a bearer token it holds (pentest E-01, wildcard CORS).
 */
final class ApiCrossOriginTest extends WgwDatabaseTestCase
{
    private const string OTHER_ORIGIN = 'https://evil.example.com';

    public function test_a_preflight_from_another_origin_gets_no_allow_headers(): void
    {
        $response = $this->call('OPTIONS', '/api/v1/auth/token', server: [
            'HTTP_ORIGIN' => self::OTHER_ORIGIN,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
        ]);

        $response->assertHeaderMissing('Access-Control-Allow-Origin');
        $this->assertStringNotContainsStringIgnoringCase(
            'authorization',
            (string) $response->headers->get('Access-Control-Allow-Headers'),
        );
    }

    public function test_a_read_from_another_origin_is_not_shared(): void
    {
        $this->getJson('/api/v1/health', ['Origin' => self::OTHER_ORIGIN])
            ->assertHeaderMissing('Access-Control-Allow-Origin');
        $this->getJson('/api/openapi.json', ['Origin' => self::OTHER_ORIGIN])
            ->assertHeaderMissing('Access-Control-Allow-Origin');
    }

    public function test_mcp_keeps_its_open_cors_for_browser_clients(): void
    {
        $this->call('OPTIONS', '/mcp', server: ['HTTP_ORIGIN' => self::OTHER_ORIGIN])
            ->assertHeader('Access-Control-Allow-Origin', '*');
    }
}
