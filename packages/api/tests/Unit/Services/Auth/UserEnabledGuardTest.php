<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Auth;

use App\Services\Auth\UserEnabledGuard;
use Tests\Support\WgwDatabaseTestCase;

final class UserEnabledGuardTest extends WgwDatabaseTestCase
{
    public function test_empty_username_is_not_enabled(): void
    {
        $this->assertFalse(app(UserEnabledGuard::class)->isEnabled(''));
    }

    public function test_missing_user_is_disabled(): void
    {
        $this->assertFalse(app(UserEnabledGuard::class)->isEnabled('nobody'));
    }

    public function test_share_guest_without_a_user_row_stays_enabled(): void
    {
        $this->assertTrue(app(UserEnabledGuard::class)->isEnabled('share:guest-token'));
    }

    public function test_new_user_defaults_enabled(): void
    {
        $this->seedWgwUser('alice', displayName: 'Alice');

        $this->assertTrue(app(UserEnabledGuard::class)->isEnabled('alice'));
        $this->assertTrue(app(UserEnabledGuard::class)->isEnabled('Alice'));
    }

    public function test_disabled_user_is_not_enabled(): void
    {
        $user = $this->seedWgwUser('alice', displayName: 'Alice');
        $user->update(['enabled' => false]);

        $this->assertFalse(app(UserEnabledGuard::class)->isEnabled('alice'));
    }
}
