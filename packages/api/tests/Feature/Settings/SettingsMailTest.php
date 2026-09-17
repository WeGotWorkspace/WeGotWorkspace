<?php

declare(strict_types=1);

namespace Tests\Feature\Settings;

use App\Models\MailUserCredential;
use App\Models\Principal;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class SettingsMailTest extends WgwDatabaseTestCase
{
    use SettingsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSettingsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownSettingsFixtures();
        parent::tearDown();
    }

    public function test_mail_username_and_has_password_flag_are_readable(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mail.imapUsername', 'bob@example.test')
            ->assertJsonPath('mail.imapHasPassword', false);
    }

    public function test_mail_username_can_be_read_and_changed(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'mail-secret',
        ])
            ->assertOk()
            ->assertJsonPath('mail.imapUsername', 'bob.mail@example.test')
            ->assertJsonPath('mail.imapHasPassword', true);

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mail.imapUsername', 'bob.mail@example.test')
            ->assertJsonPath('mail.imapHasPassword', true);
    }

    public function test_mail_password_can_be_changed_without_changing_username(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'mail-secret',
        ])->assertOk();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapPassword' => 'new-mail-secret',
        ])
            ->assertOk()
            ->assertJsonPath('mail.imapUsername', 'bob.mail@example.test')
            ->assertJsonPath('mail.imapHasPassword', true);
    }

    public function test_mail_save_syncs_profile_email_when_username_is_email_shaped(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.sync@example.test',
            'imapPassword' => 'mail-secret',
        ])
            ->assertOk()
            ->assertJsonPath('user.email', 'bob.sync@example.test');
    }

    public function test_mail_save_requires_username_when_no_profile_email_fallback(): void
    {
        $principal = Principal::forUsername('bob');
        $this->assertNotNull($principal);
        $principal->email = null;
        $principal->save();

        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapPassword' => 'mail-secret',
        ])->assertStatus(400)
            ->assertJsonPath('error', 'Mail username is required.');
    }

    public function test_mail_save_requires_password_when_no_existing_credentials(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
        ])->assertStatus(400)
            ->assertJsonPath('error', 'Mail password is required.');
    }

    public function test_mail_servers_are_empty_until_the_user_saves_them(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mailServer.imapHost', '')
            ->assertJsonPath('mailServer.smtpHost', '')
            ->assertJsonPath('mail.smtpPasswordSet', false);
    }

    public function test_mail_put_saves_per_user_endpoints_and_omitted_password_keeps_secret(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'mail-secret',
            'imapHost' => 'imap.user.test',
            'imapPort' => 993,
            'imapSecurity' => 'ssl',
            'smtpHost' => 'smtp.user.test',
            'smtpPort' => 587,
            'smtpSecurity' => 'starttls',
        ])
            ->assertOk()
            ->assertJsonPath('mailServer.imapHost', 'imap.user.test')
            ->assertJsonPath('mailServer.smtpHost', 'smtp.user.test')
            ->assertJsonPath('mail.imapHasPassword', true);

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'smtpPort' => 2525,
        ])
            ->assertOk()
            ->assertJsonPath('mailServer.smtpPort', 2525)
            ->assertJsonPath('mailServer.imapHost', 'imap.user.test')
            ->assertJsonPath('mail.imapHasPassword', true);

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapPassword' => '',
            'smtpHost' => 'smtp.other.test',
        ])
            ->assertOk()
            ->assertJsonPath('mailServer.smtpHost', 'smtp.other.test')
            ->assertJsonPath('mail.imapHasPassword', true);
    }

    public function test_mail_clear_password_flags_remove_stored_secrets(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'mail-secret',
            'smtpUsername' => 'smtp-bob',
            'smtpPassword' => 'smtp-secret',
            'imapHost' => 'imap.user.test',
            'smtpHost' => 'smtp.user.test',
        ])->assertOk()
            ->assertJsonPath('mail.smtpPasswordSet', true)
            ->assertJsonPath('mail.smtpUsername', 'smtp-bob');

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'clearSmtpPassword' => true,
        ])
            ->assertOk()
            ->assertJsonPath('mail.smtpPasswordSet', false)
            ->assertJsonPath('mail.imapHasPassword', true);

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'clearImapPassword' => true,
            'imapPassword' => 'will-be-ignored',
        ])->assertStatus(400)
            ->assertJsonPath('error', 'Mail password is required.');
    }

    public function test_mail_accounts_are_isolated_per_user(): void
    {
        $bob = $this->userBearerToken();
        $alice = $this->adminBearerToken();

        $this->withBearer($bob)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'bob-secret',
            'imapHost' => 'imap.bob.test',
            'smtpHost' => 'smtp.bob.test',
            'smtpPort' => 2525,
        ])->assertOk();

        $this->withBearer($alice)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'alice.mail@example.test',
            'imapPassword' => 'alice-secret',
            'imapHost' => 'imap.alice.test',
            'smtpHost' => 'smtp.alice.test',
            'smtpPort' => 587,
        ])->assertOk();

        $this->withBearer($bob)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mailServer.smtpHost', 'smtp.bob.test')
            ->assertJsonPath('mailServer.smtpPort', 2525);

        $this->withBearer($alice)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mailServer.smtpHost', 'smtp.alice.test')
            ->assertJsonPath('mailServer.smtpPort', 587);
    }

    public function test_mail_accepts_post_with_method_override(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->withHeader('X-HTTP-Method-Override', 'PUT')
            ->postJson('/api/v1/settings/mail', [
                'imapUsername' => 'bob.override@example.test',
                'imapPassword' => 'mail-secret',
            ])
            ->assertOk()
            ->assertJsonPath('mail.imapUsername', 'bob.override@example.test')
            ->assertJsonPath('mail.imapHasPassword', true);
    }

    public function test_mail_save_stores_updated_at_as_datetime(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.mail@example.test',
            'imapPassword' => 'mail-secret',
        ])->assertOk();

        $updatedAt = MailUserCredential::query()
            ->where('username', 'bob')
            ->value('updated_at');

        $this->assertIsString($updatedAt);
        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/',
            $updatedAt,
            'mail_user_credentials.updated_at must be a MySQL-compatible datetime string',
        );
    }
}
