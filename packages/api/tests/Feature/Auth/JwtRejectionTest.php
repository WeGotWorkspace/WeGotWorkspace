<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Services\Auth\JwtCodec;
use Lcobucci\JWT\Configuration;
use Lcobucci\JWT\Signer\Key\InMemory;
use Lcobucci\JWT\Signer\Rsa\Sha256;
use Tests\Support\AuthTestKeys;
use Tests\Support\WgwDatabaseTestCase;

final class JwtRejectionTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_valid_access_token_reaches_me(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], $this->signingConfig());

        $this->withBearer($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJson([
                'username' => 'alice',
                'role' => 'user',
            ]);
    }

    public function test_rejects_access_token_with_wrong_kid(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], $this->signingConfig(['kid' => 'other-kid']));

        $this->assertBearerRejected($token);
    }

    public function test_rejects_expired_access_token(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'iat' => time() - 7200,
            'exp' => time() - 3600,
        ], $this->signingConfig());

        $this->assertBearerRejected($token);
    }

    public function test_rejects_access_token_with_wrong_issuer(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], $this->signingConfig(['issuer' => 'other-issuer']));

        $this->assertBearerRejected($token);
    }

    public function test_rejects_access_token_with_wrong_audience(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], $this->signingConfig(['audience' => 'other-audience']));

        $this->assertBearerRejected($token);
    }

    public function test_rejects_access_token_with_bad_signature(): void
    {
        $other = AuthTestKeys::rsaPair((string) config('wgw.jwt.kid'));
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], [
            'privateKey' => $other['private_key'],
            'publicKey' => $other['public_key'],
            'issuer' => (string) config('wgw.jwt.issuer'),
            'audience' => (string) config('wgw.jwt.audience'),
            'kid' => (string) config('wgw.jwt.kid'),
        ]);

        $this->assertBearerRejected($token);
    }

    public function test_rejects_access_token_without_jti(): void
    {
        $this->assertBearerRejected($this->issueWithoutJti());
    }

    public function test_rejects_access_token_with_disallowed_role(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'superuser',
            'exp' => time() + 3600,
        ], $this->signingConfig());

        $this->assertBearerRejected($token);
    }

    public function test_guest_role_cannot_reach_user_endpoints(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'guest',
            'role' => 'guest',
            'exp' => time() + 3600,
        ], $this->signingConfig());

        $this->withBearer($token)->getJson('/api/v1/me')
            ->assertForbidden()
            ->assertJson([
                'error' => 'Insufficient role.',
                'code' => 'forbidden',
            ]);
    }

    public function test_user_role_cannot_reach_admin_endpoints(): void
    {
        $token = JwtCodec::issue([
            'sub' => 'alice',
            'role' => 'user',
            'exp' => time() + 3600,
        ], $this->signingConfig());

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertForbidden()
            ->assertJson([
                'error' => 'Insufficient role.',
                'code' => 'forbidden',
            ]);
    }

    public function test_unauthenticated_callers_cannot_reach_user_or_admin_endpoints(): void
    {
        $this->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthorized');

        $this->getJson('/api/v1/admin/state')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthorized');
    }

    private function assertBearerRejected(string $token): void
    {
        $this->withBearer($token)->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Missing or invalid bearer token.',
                'code' => 'unauthorized',
            ]);
    }

    /**
     * @param  array<string, string>  $overrides
     * @return array{
     *   privateKey: string,
     *   publicKey: string,
     *   issuer: string,
     *   audience: string,
     *   kid: string
     * }
     */
    private function signingConfig(array $overrides = []): array
    {
        return array_merge([
            'privateKey' => (string) config('wgw.jwt.private_key'),
            'publicKey' => (string) config('wgw.jwt.public_key'),
            'issuer' => (string) config('wgw.jwt.issuer'),
            'audience' => (string) config('wgw.jwt.audience'),
            'kid' => (string) config('wgw.jwt.kid'),
        ], $overrides);
    }

    private function issueWithoutJti(): string
    {
        $cfg = $this->signingConfig();
        $config = Configuration::forAsymmetricSigner(
            new Sha256,
            InMemory::plainText($cfg['privateKey']),
            InMemory::plainText($cfg['publicKey']),
        );
        $now = new \DateTimeImmutable;

        return $config->builder()
            ->withHeader('kid', $cfg['kid'])
            ->issuedBy($cfg['issuer'])
            ->permittedFor($cfg['audience'])
            ->issuedAt($now)
            ->canOnlyBeUsedAfter($now)
            ->expiresAt($now->modify('+1 hour'))
            ->relatedTo('alice')
            ->withClaim('role', 'user')
            ->getToken($config->signer(), $config->signingKey())
            ->toString();
    }
}
