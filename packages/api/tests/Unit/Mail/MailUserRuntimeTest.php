<?php

declare(strict_types=1);

namespace Tests\Unit\Mail;

use App\Services\Mail\MailCredentialService;
use App\Services\Mail\MailSecretService;
use App\Services\Mail\MailUserRuntime;
use App\Support\WgwInstallConfig;
use App\Support\WgwSettings;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailUserRuntimeTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownMailFixtures();
        parent::tearDown();
    }

    public function test_resolve_is_isolated_per_user_smtp(): void
    {
        $this->setAppSettings([
            WgwSettings::MAIL_SMTP_HOST => 'smtp.instance.test',
        ]);
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'bob-secret', [
            'smtpHost' => 'smtp.bob.test',
            'smtpPort' => 2525,
        ]);
        $this->seedMailCredentials('alice', 'alice.mail@example.test', 'alice-secret', [
            'smtpHost' => 'smtp.alice.test',
            'smtpPort' => 587,
        ]);

        $credentials = new MailCredentialService(new MailSecretService(
            $this->app->make(WgwInstallConfig::class)
        ));

        $bob = MailUserRuntime::resolve('bob', $credentials);
        $alice = MailUserRuntime::resolve('alice', $credentials);
        $carol = MailUserRuntime::resolve('carol', $credentials);

        $this->assertNotNull($bob);
        $this->assertNotNull($alice);
        $this->assertNull($carol);
        $this->assertSame('smtp.bob.test', $bob['smtp']['host']);
        $this->assertSame(2525, $bob['smtp']['port']);
        $this->assertSame('smtp.alice.test', $alice['smtp']['host']);
        $this->assertSame(587, $alice['smtp']['port']);
        $this->assertNotSame($bob['smtp']['host'], $alice['smtp']['host']);
    }

    public function test_status_error_splits_missing_extension_from_user_empty(): void
    {
        $this->assertSame(
            MailUserRuntime::ERROR_SETTINGS_MISSING,
            MailUserRuntime::statusError(null, true),
        );
        $this->assertSame(
            MailUserRuntime::ERROR_IMAP_EXTENSION,
            MailUserRuntime::statusError(['imapUsername' => 'x'], false),
        );
    }
}
