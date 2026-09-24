<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\InstallerAdminEmail;
use PHPUnit\Framework\TestCase;

final class InstallerAdminEmailTest extends TestCase
{
    public function test_accepts_a_normal_address_and_rejects_the_loose_frontend_misses(): void
    {
        $this->assertTrue(InstallerAdminEmail::isValid(' jane@example.com '));
        $this->assertTrue(InstallerAdminEmail::isValid('user.name+tag@example.com'));
        $this->assertFalse(InstallerAdminEmail::isValid(''));
        $this->assertFalse(InstallerAdminEmail::isValid('not-an-email'));
        $this->assertFalse(InstallerAdminEmail::isValid('jane@localhost'));
        $this->assertFalse(InstallerAdminEmail::isValid('user@domain..com'));
        $this->assertFalse(InstallerAdminEmail::isValid('user@example.com.'));
        $this->assertFalse(InstallerAdminEmail::isValid('user@exam_ple.com'));
        $this->assertFalse(InstallerAdminEmail::isValid('user@example.123'));
        $this->assertFalse(InstallerAdminEmail::isValid(str_repeat('a', 310).'@example.com'));
    }
}
