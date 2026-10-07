<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Auth;

use App\Models\ApiRefreshToken;
use App\Models\PushSubscription;
use App\Services\Auth\RefreshTokenRepository;
use App\Services\Auth\UserSessionRevoker;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class UserSessionRevokerTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    public function test_revoke_all_clears_refresh_passport_and_push_rows(): void
    {
        $alice = $this->seedWgwUser('alice', displayName: 'Alice');
        $bob = $this->seedWgwUser('bob', displayName: 'Bob');

        $aliceRefresh = app(RefreshTokenRepository::class)->issue('alice', 'user');
        $bobRefresh = app(RefreshTokenRepository::class)->issue('bob', 'user');

        $client = $this->mcpClient();
        $aliceAccess = $this->issueMcpGrant($alice, $client);
        $bobAccess = $this->issueMcpGrant($bob, $client);
        Passport::refreshToken()->newQuery()->create([
            'id' => bin2hex(random_bytes(40)),
            'access_token_id' => $aliceAccess,
            'revoked' => false,
            'expires_at' => now()->addDays(30),
        ]);
        Passport::refreshToken()->newQuery()->create([
            'id' => bin2hex(random_bytes(40)),
            'access_token_id' => $bobAccess,
            'revoked' => false,
            'expires_at' => now()->addDays(30),
        ]);

        $this->seedPush('alice');
        $this->seedPush('bob');

        app(UserSessionRevoker::class)->revokeAll('alice');

        $aliceHash = hash('sha256', $aliceRefresh);
        $bobHash = hash('sha256', $bobRefresh);
        $this->assertSame(1, (int) ApiRefreshToken::query()->where('token_hash', $aliceHash)->value('revoked'));
        $this->assertSame(0, (int) ApiRefreshToken::query()->where('token_hash', $bobHash)->value('revoked'));
        $this->assertTrue((bool) Passport::token()->newQuery()->find($aliceAccess)?->revoked);
        $this->assertFalse((bool) Passport::token()->newQuery()->find($bobAccess)?->revoked);
        $this->assertTrue((bool) Passport::refreshToken()->newQuery()->where('access_token_id', $aliceAccess)->value('revoked'));
        $this->assertFalse((bool) Passport::refreshToken()->newQuery()->where('access_token_id', $bobAccess)->value('revoked'));
        $this->assertSame(0, PushSubscription::query()->where('principal', 'alice')->count());
        $this->assertSame(1, PushSubscription::query()->where('principal', 'bob')->count());
    }

    private function seedPush(string $username): void
    {
        $endpoint = 'https://push.example.test/'.$username;
        PushSubscription::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => $username,
            'endpoint' => $endpoint,
            'endpoint_hash' => hash('sha256', $endpoint),
            'p256dh' => 'pub',
            'auth' => 'secret',
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ]);
    }
}
