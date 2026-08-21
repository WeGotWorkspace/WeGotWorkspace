<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliveryConfig;
use PHPUnit\Framework\TestCase;

final class MailDeliveryConfigTest extends TestCase
{
    public function test_empty_from_is_not_configured_and_uses_placeholder(): void
    {
        $config = $this->config(from: '');

        $this->assertFalse($config->fromConfigured());
        $this->assertSame('noreply@localhost', MailDeliveryConfig::PLACEHOLDER_FROM);
        $this->assertSame(MailDeliveryConfig::PLACEHOLDER_FROM, $config->effectiveFrom());
        $this->assertTrue(MailDeliveryConfig::isUsableFrom(MailDeliveryConfig::PLACEHOLDER_FROM));
        $this->assertFalse((bool) filter_var(MailDeliveryConfig::PLACEHOLDER_FROM, FILTER_VALIDATE_EMAIL));
    }

    public function test_invalid_from_uses_placeholder(): void
    {
        $config = $this->config(from: 'not-an-email');

        $this->assertFalse($config->fromConfigured());
        $this->assertSame(MailDeliveryConfig::PLACEHOLDER_FROM, $config->effectiveFrom());
        $this->assertSame(MailDeliveryConfig::PLACEHOLDER_FROM, $config->resolveFrom('also-bad'));
    }

    public function test_configured_from_wins_over_placeholder(): void
    {
        $config = $this->config(from: 'ops@example.test');

        $this->assertTrue($config->fromConfigured());
        $this->assertSame('ops@example.test', $config->effectiveFrom());
        $this->assertSame('alice@example.test', $config->resolveFrom('alice@example.test'));
        $this->assertSame('ops@example.test', $config->resolveFrom(''));
    }

    private function config(string $from): MailDeliveryConfig
    {
        return new MailDeliveryConfig(
            from: $from,
            transport: MailDeliveryConfig::TRANSPORT_AUTO,
            smtpHost: '',
            smtpPort: 587,
            smtpSecurity: 'starttls',
            smtpUsername: '',
            smtpPassword: '',
            smtpPasswordSet: false,
        );
    }
}
