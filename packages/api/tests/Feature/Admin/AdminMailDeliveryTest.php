<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\AppSetting;
use App\Services\MailDelivery\DeliveryResult;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Mail;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminMailDeliveryTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_state_exposes_mail_delivery_without_password_or_available(): void
    {
        $token = $this->adminBearerToken();
        $response = $this->withBearer($token)->getJson('/api/v1/admin/state');
        $response->assertOk()
            ->assertJsonPath('mailDelivery.config.transport', 'auto')
            ->assertJsonPath('mailDelivery.config.smtpPasswordSet', false)
            ->assertJsonPath('mailDelivery.lastTestSend', null)
            ->assertJsonPath('mailDelivery.capability.canSubmit', false);

        $json = $response->json('mailDelivery');
        $this->assertIsArray($json);
        $this->assertArrayNotHasKey('available', $json);
        $this->assertArrayNotHasKey('smtpPassword', $json['config']);
        $encoded = (string) $response->getContent();
        $this->assertStringNotContainsString('smtpPassword":', $encoded);
    }

    public function test_put_persists_delivery_settings_and_omitted_password_keeps_secret(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
                    SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
                    SettingKeys::MAIL_DELIVERY_SMTP_HOST => 'smtp.example.test',
                    SettingKeys::MAIL_DELIVERY_SMTP_PORT => 587,
                    SettingKeys::MAIL_DELIVERY_SMTP_SECURITY => 'starttls',
                    SettingKeys::MAIL_DELIVERY_SMTP_USERNAME => 'relay',
                    SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD => 'super-secret',
                ],
            ])
            ->assertOk();

        $state = $this->withBearer($token)->getJson('/api/v1/admin/state');
        $state->assertOk()
            ->assertJsonPath('mailDelivery.config.from', 'ops@example.test')
            ->assertJsonPath('mailDelivery.config.smtpUsername', 'relay')
            ->assertJsonPath('mailDelivery.config.smtpPasswordSet', true)
            ->assertJsonPath('mailDelivery.capability.canSubmit', true);
        $this->assertStringNotContainsString('super-secret', (string) $state->getContent());
        $stored = (string) AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, '');
        $this->assertNotSame('', $stored);
        $this->assertNotSame('super-secret', $stored);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_FROM => 'noreply@example.test',
                    SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD => '',
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mailDelivery.config.from', 'noreply@example.test')
            ->assertJsonPath('mailDelivery.config.smtpPasswordSet', true);
    }

    public function test_clear_smtp_password_and_conflict(): void
    {
        $token = $this->adminBearerToken();
        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
                    SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD => 'keep-me',
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD => 'new-secret',
                ],
                'clearSmtpPassword' => true,
            ])
            ->assertStatus(400);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
                ],
                'clearSmtpPassword' => true,
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mailDelivery.config.smtpPasswordSet', false);
    }

    public function test_test_send_uses_same_send_path(): void
    {
        Mail::fake();
        $token = $this->adminBearerToken();
        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
                    SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/mail-delivery/test', ['to' => 'alice@example.test'])
            ->assertOk()
            ->assertJsonPath('accepted', true)
            ->assertJsonPath('status', DeliveryResult::ACCEPTED_BY_TRANSPORT);

        $testJson = $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->json('mailDelivery.lastTestSend');
        $this->assertIsArray($testJson);
        $this->assertArrayNotHasKey('available', $testJson);

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mailDelivery.lastTestSend.status', DeliveryResult::ACCEPTED_BY_TRANSPORT)
            ->assertJsonPath('mailDelivery.lastTestSend.accepted', true);
    }

    public function test_test_send_without_from_returns_400_not_500(): void
    {
        $token = $this->adminBearerToken();
        $this->withBearer($token)
            ->postJson('/api/v1/admin/mail-delivery/test')
            ->assertStatus(400);
    }
}
