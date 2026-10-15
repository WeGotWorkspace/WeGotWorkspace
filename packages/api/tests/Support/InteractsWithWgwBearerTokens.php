<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Auth\RefreshCookie;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

trait InteractsWithWgwBearerTokens
{
    protected function issueBearerTokenFor(string $username, string $password = 'secret'): string
    {
        /** @var TestCase $this */
        $response = $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => $password,
        ]);
        $response->assertOk();

        return (string) $response->json('access_token');
    }

    protected function issueBearerToken(string $username = 'alice', string $password = 'secret'): string
    {
        return $this->issueBearerTokenFor($username, $password);
    }

    protected function withBearer(string $token): static
    {
        return $this->withHeader('Authorization', 'Bearer '.$token);
    }

    /**
     * @return array<string, string>
     */
    protected function bearerHeaders(?string $token): array
    {
        if ($token === null || $token === '') {
            return [];
        }

        return ['Authorization' => 'Bearer '.$token];
    }

    protected function refreshCookieValue(TestResponse $response): string
    {
        $cookie = $response->getCookie(RefreshCookie::NAME, false);
        $this->assertNotNull($cookie, 'Expected a refresh cookie on the response.');

        return (string) $cookie->getValue();
    }

    protected function postRefresh(string $refreshToken): TestResponse
    {
        // postJson sends cookies only after the test client opts into credentials.
        return $this->withUnencryptedCookie(RefreshCookie::NAME, $refreshToken)
            ->withCredentials()
            ->postJson('/api/v1/auth/refresh');
    }
}
