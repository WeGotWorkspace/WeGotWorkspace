<?php

declare(strict_types=1);

namespace Tests\Feature\MailDelivery;

use App\Models\AppSetting;
use App\Services\MailDelivery\DeliveryResult;
use App\Services\MailDelivery\InvalidOutboundMessageException;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\MailDelivery\OutboundMessage;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Mail;
use Tests\Support\WgwDatabaseTestCase;

final class MailDeliveryServiceTest extends WgwDatabaseTestCase
{
    public function test_empty_from_uses_placeholder_and_can_submit(): void
    {
        Mail::fake();
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => '',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $config = $this->delivery()->loadConfig();
        $this->assertSame('', $config->from);
        $this->assertFalse($config->fromConfigured());
        $this->assertSame(MailDeliveryConfig::PLACEHOLDER_FROM, $config->effectiveFrom());

        $capability = $this->delivery()->adminState()['capability'];
        $this->assertFalse($capability['probes']['fromConfigured']);
        $this->assertTrue($capability['canSubmit']);

        $result = $this->delivery()->send(new OutboundMessage(
            from: $config->from,
            to: ['alice@example.test'],
            subject: 'Test',
            textBody: 'Body',
        ));

        $this->assertTrue($result->accepted);
        $this->assertSame(DeliveryResult::ACCEPTED_BY_TRANSPORT, $result->status);
        $this->assertSame(MailDeliveryConfig::PLACEHOLDER_FROM, $config->resolveFrom(''));
    }

    public function test_invalid_from_uses_placeholder(): void
    {
        Mail::fake();
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $result = $this->delivery()->send(new OutboundMessage(
            from: 'not-an-email',
            to: ['alice@example.test'],
            subject: 'Test',
            textBody: 'Body',
        ));

        $this->assertTrue($result->accepted);
        $this->assertSame(
            MailDeliveryConfig::PLACEHOLDER_FROM,
            $this->delivery()->loadConfig()->resolveFrom('not-an-email'),
        );
    }

    public function test_missing_recipients_throw(): void
    {
        $this->setAppSetting(SettingKeys::MAIL_DELIVERY_FROM, 'ops@example.test');
        $this->expectException(InvalidOutboundMessageException::class);
        $this->delivery()->send(new OutboundMessage(
            from: 'ops@example.test',
            to: [],
            subject: 'Test',
            textBody: 'Body',
        ));
    }

    public function test_forced_smtp_without_auth_returns_delivery_result(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_SMTP,
            SettingKeys::MAIL_DELIVERY_SMTP_HOST => 'smtp.example.test',
            SettingKeys::MAIL_DELIVERY_SMTP_PORT => 587,
            SettingKeys::MAIL_DELIVERY_SMTP_SECURITY => 'starttls',
        ]);

        $result = $this->delivery()->send(new OutboundMessage(
            from: 'ops@example.test',
            to: ['alice@example.test'],
            subject: 'Test',
            textBody: 'Body',
        ));

        $this->assertFalse($result->accepted);
        $this->assertSame(DeliveryResult::SMTP_AUTH_REQUIRED, $result->status);
        $this->assertSame('smtp', $result->transport);
    }

    public function test_send_uses_runtime_wgw_mailer(): void
    {
        Mail::fake();
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $result = $this->delivery()->send(new OutboundMessage(
            from: 'ops@example.test',
            to: ['alice@example.test'],
            subject: 'Test',
            textBody: 'Body',
        ));

        $this->assertTrue($result->accepted);
        $this->assertSame(DeliveryResult::ACCEPTED_BY_TRANSPORT, $result->status);
        $this->assertSame('php', $result->transport);
        $this->assertIsArray(config('mail.mailers.wgw'));
        $this->assertSame('mail', config('mail.mailers.wgw.transport'));
        $this->assertStringContainsString("env('MAIL_MAILER', 'log')", (string) file_get_contents(dirname(__DIR__, 3).'/config/mail.php'));
    }

    public function test_last_test_send_is_persisted_without_available_field(): void
    {
        Mail::fake();
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $payload = $this->delivery()->recordTestSend(new OutboundMessage(
            from: 'ops@example.test',
            to: ['alice@example.test'],
            subject: 'Test',
            textBody: 'Body',
        ));

        $this->assertArrayNotHasKey('available', $payload);
        $this->assertSame(DeliveryResult::ACCEPTED_BY_TRANSPORT, $payload['status']);
        $stored = AppSetting::getValue(SettingKeys::MAIL_DELIVERY_LAST_TEST_SEND);
        $this->assertIsArray($stored);
        $this->assertArrayNotHasKey('available', $stored);
    }

    private function delivery(): MailDeliveryService
    {
        return $this->app->make(MailDeliveryService::class);
    }
}
