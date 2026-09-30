<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

final class ErrorLeakTest extends TestCase
{
    public function test_500_with_debug_disabled_does_not_leak_stack_or_exception_details(): void
    {
        config(['app.debug' => false]);

        $marker = 'wgw-secret-leak-marker';
        Route::get('/api/v1/security-probe/trigger-error', function () use ($marker): void {
            throw new RuntimeException($marker.' at /var/www/html/app/Services/SecretStore.php:42');
        });

        $response = $this->getJson('/api/v1/security-probe/trigger-error');

        $response->assertStatus(500);
        $response->assertHeader('content-type', 'application/json');

        $json = $response->json();
        $this->assertIsArray($json);
        $this->assertArrayNotHasKey('trace', $json);
        $this->assertArrayNotHasKey('file', $json);
        $this->assertArrayNotHasKey('line', $json);
        $this->assertArrayNotHasKey('exception', $json);
        $this->assertSame([
            'error' => 'Internal server error.',
            'code' => 'server_error',
        ], $json);

        $body = (string) $response->getContent();
        $this->assertStringNotContainsString($marker, $body);
        $this->assertStringNotContainsString('SecretStore.php', $body);
        $this->assertStringNotContainsString('RuntimeException', $body);
        $this->assertStringNotContainsString('ErrorLeakTest.php', $body);
        $this->assertStringNotContainsString('Stack trace', $body);
        $this->assertStringNotContainsString('<html', strtolower($body));
    }

    public function test_http_exception_with_debug_disabled_uses_generic_message(): void
    {
        config(['app.debug' => false]);

        $marker = 'wgw-secret-leak-marker';
        Route::get('/api/v1/security-probe/trigger-http-error', function () use ($marker): void {
            abort(404, $marker);
        });

        $this->getJson('/api/v1/security-probe/trigger-http-error')
            ->assertNotFound()
            ->assertExactJson([
                'error' => 'Not found.',
                'code' => 'not_found',
            ]);
    }
}
