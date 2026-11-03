<?php

declare(strict_types=1);

namespace Tests\Architecture;

use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\OpenApiContract;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwRoleFixtures;

/**
 * Smoke-test middleware role gates against OpenAPI x-wgw-access annotations.
 */
final class RoleAccessMatrixTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureRoleMatrix();
    }

    public function test_openapi_operations_declare_x_wgw_access(): void
    {
        $documented = OpenApiContract::documentedApiOperations();
        $withAccess = OpenApiContract::operationsWithAccess();
        $missing = [];

        foreach ($documented as $operation) {
            [$method, $path] = explode(' ', $operation, 2);
            $found = false;
            foreach ($withAccess as $entry) {
                if ($entry['method'] === $method && $entry['path'] === $path) {
                    $found = true;
                    break;
                }
            }
            if (! $found) {
                $missing[] = $operation;
            }
        }

        $this->assertSame([], $missing, "OpenAPI operations missing x-wgw-access:\n".implode("\n", $missing));
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: string}>
     */
    public static function accessMatrixProvider(): iterable
    {
        foreach (OpenApiContract::operationsWithAccess() as $operation) {
            $key = $operation['method'].' '.$operation['path'];
            yield $key => [$operation['method'], $operation['path'], $operation['access']];
        }
    }

    #[DataProvider('accessMatrixProvider')]
    public function test_role_access_matches_openapi_annotation(string $method, string $path, string $access): void
    {
        $userToken = $this->userBearerToken();
        $adminToken = $this->adminBearerToken();

        $this->assertRoleExpectation($method, $path, $access, null);
        if ($access === 'user' || $access === 'admin') {
            $this->assertRoleExpectation($method, $path, $access, $userToken);
        }
        if ($access === 'admin') {
            $this->assertRoleExpectation($method, $path, $access, $adminToken, 'admin');
        }
        if ($access === 'user') {
            $this->assertRoleExpectation($method, $path, $access, $adminToken, 'admin');
        }
        if ($access === 'guest') {
            $this->assertRoleExpectation($method, $path, $access, $userToken);
            $this->assertRoleExpectation($method, $path, $access, $adminToken);
        }
        if ($access === 'guest-only') {
            $this->assertRoleExpectation($method, $path, $access, $userToken);
            $this->assertRoleExpectation($method, $path, $access, $adminToken, 'admin');
        }
    }

    private function assertRoleExpectation(
        string $method,
        string $openApiPath,
        string $requiredAccess,
        ?string $token,
        ?string $actorRole = null,
    ): void {
        $actorRole ??= $token === null ? 'guest' : 'user';
        if ($token !== null && $actorRole === 'user' && $requiredAccess === 'admin') {
            // user token on admin-only route
        }

        $response = $this->dispatchSampleRequest($method, $openApiPath, $token);
        $status = $response->getStatusCode();

        if ($requiredAccess === 'guest') {
            $this->assertNotSame(403, $status, "{$method} {$openApiPath} as {$actorRole} should not be forbidden");

            return;
        }

        if ($token === null) {
            $this->assertSame(401, $status, "{$method} {$openApiPath} should require auth");

            return;
        }

        // Guest upload routes (#1715) refuse members: they keep their own JMAP routes.
        if ($requiredAccess === 'guest-only') {
            $this->assertSame(403, $status, "{$method} {$openApiPath} as {$actorRole} should be guest-only");

            return;
        }

        if ($requiredAccess === 'admin' && $actorRole === 'user') {
            $this->assertSame(403, $status, "{$method} {$openApiPath} should reject user role");

            return;
        }

        $this->assertNotContains(
            $status,
            [401, 403],
            "{$method} {$openApiPath} as {$actorRole} should pass role middleware"
        );
    }

    private function dispatchSampleRequest(string $method, string $openApiPath, ?string $token): TestResponse
    {
        $samplePath = OpenApiContract::sampleRequestPath($openApiPath);
        $query = OpenApiContract::sampleQueryString($openApiPath, $method);
        $uri = '/api/v1'.$samplePath.($query !== '' ? '?'.$query : '');
        $headers = $this->bearerHeaders($token);

        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? [] : null;

        if ($method === 'GET') {
            return $this->withHeaders($headers)->getJson($uri);
        }
        if ($method === 'DELETE') {
            return $this->withHeaders(array_merge($headers, ['Content-Type' => 'application/json']))
                ->deleteJson($uri, $body ?? []);
        }

        return $this->withHeaders(array_merge($headers, ['Content-Type' => 'application/json']))
            ->json($method, $uri, $body ?? []);
    }
}
