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

    public function test_mail_save_does_not_change_the_profile_email(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.sync@example.test',
            'imapPassword' => 'mail-secret',
        ])
            ->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test')
            ->assertJsonPath('mail.imapUsername', 'bob.sync@example.test');
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

    public function test_mail_servers_are_readable_from_settings_state(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mailServer.imapHost', 'imap.example.test')
            ->assertJsonPath('mailServer.imapPort', 993)
            ->assertJsonPath('mailServer.imapSecurity', 'ssl')
            ->assertJsonPath('mailServer.smtpHost', 'smtp.example.test')
            ->assertJsonPath('mailServer.smtpPort', 587)
            ->assertJsonPath('mailServer.smtpSecurity', 'starttls');
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
