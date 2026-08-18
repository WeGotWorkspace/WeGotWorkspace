<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\DeliveryResult;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MailDeliveryTransportResolverTest extends TestCase
{
    private MailDeliveryTransportResolver $resolver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->resolver = new MailDeliveryTransportResolver;
    }

    /**
     * @return iterable<string, array{0: MailDeliveryConfig, 1: bool}>
     */
    public static function smtpEligibleProvider(): iterable
    {
        yield 'host and username' => [
            self::config(smtpHost: 'smtp.example.test', smtpUsername: 'relay'),
            true,
        ];
        yield 'local postfix host-only none' => [
            self::config(smtpHost: 'localhost', smtpPort: 25, smtpSecurity: 'none'),
            true,
        ];
        yield 'host-only auth required' => [
            self::config(smtpHost: 'smtp.example.test', smtpPort: 587, smtpSecurity: 'starttls'),
            false,
        ];
        yield 'empty host' => [
            self::config(),
            false,
        ];
    }

    #[DataProvider('smtpEligibleProvider')]
    public function test_smtp_eligible_matrix(MailDeliveryConfig $config, bool $expected): void
    {
        $this->assertSame($expected, $this->resolver->isSmtpEligible($config));
    }

    public function test_auto_selects_smtp_only_when_eligible(): void
    {
        $eligible = self::config(from: 'ops@example.test', smtpHost: 'smtp.example.test', smtpUsername: 'relay');
        $resolved = $this->resolver->resolve($eligible);
        $this->assertSame('smtp', $resolved->name);
        $this->assertTrue($resolved->canAttempt());

        $hostOnly = self::config(from: 'ops@example.test', smtpHost: 'smtp.example.test');
        $resolvedHostOnly = $this->resolver->resolve($hostOnly);
        $this->assertNotSame('smtp', $resolvedHostOnly->name);
    }

    public function test_forced_smtp_without_username_while_auth_required(): void
    {
        $config = self::config(
            transport: MailDeliveryConfig::TRANSPORT_SMTP,
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpSecurity: 'starttls',
        );
        $resolved = $this->resolver->resolve($config);
        $this->assertSame('smtp', $resolved->name);
        $this->assertSame(DeliveryResult::SMTP_AUTH_REQUIRED, $resolved->blockStatus);
        $this->assertFalse($this->resolver->capability($config)['canSubmit']);
    }

    public function test_capability_requires_valid_from(): void
    {
        $config = self::config(
            from: '',
            transport: MailDeliveryConfig::TRANSPORT_PHP,
        );
        $capability = $this->resolver->capability($config);
        $this->assertFalse($capability['canSubmit']);
        $this->assertFalse($capability['probes']['fromConfigured']);
        $this->assertSame('php', $capability['selectedTransport']);
    }

    private static function config(
        string $from = '',
        string $transport = MailDeliveryConfig::TRANSPORT_AUTO,
        string $smtpHost = '',
        int $smtpPort = 587,
        string $smtpSecurity = 'starttls',
        string $smtpUsername = '',
        string $smtpPassword = '',
        bool $smtpPasswordSet = false,
    ): MailDeliveryConfig {
        return new MailDeliveryConfig(
            from: $from,
            transport: $transport,
            smtpHost: $smtpHost,
            smtpPort: $smtpPort,
            smtpSecurity: $smtpSecurity,
            smtpUsername: $smtpUsername,
            smtpPassword: $smtpPassword,
            smtpPasswordSet: $smtpPasswordSet,
        );
    }
}
