<?php

declare(strict_types=1);

namespace Tests\Unit\Auth;

use App\Auth\SabreUserProvider;
use App\Models\User;
use App\Services\Auth\SabreCredentialValidator;
use Tests\Support\WgwDatabaseTestCase;

final class SabreUserProviderTest extends WgwDatabaseTestCase
{
    public function test_validates_sabre_digest_password(): void
    {
        $user = User::factory()->named('alice')->withPassword('secret')->create();
        $provider = new SabreUserProvider(app(SabreCredentialValidator::class));

        $this->assertTrue($provider->validateCredentials($user, ['password' => 'secret']));
        $this->assertFalse($provider->validateCredentials($user, ['password' => 'wrong']));
    }

    public function test_retrieves_user_by_username_credentials(): void
    {
        User::factory()->named('alice')->withPassword('secret')->create();
        $provider = new SabreUserProvider(app(SabreCredentialValidator::class));

        $found = $provider->retrieveByCredentials(['username' => 'Alice']);
        $this->assertInstanceOf(User::class, $found);
        $this->assertSame('alice', $found->username);
    }
}
