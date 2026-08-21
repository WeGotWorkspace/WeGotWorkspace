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

    public function test_capability_can_submit_with_empty_from_when_transport_available(): void
    {
        $resolver = new MailDeliveryTransportResolver(phpMailProbe: static fn (): bool => true);
        $config = self::config(
            from: '',
            transport: MailDeliveryConfig::TRANSPORT_PHP,
        );
        $capability = $resolver->capability($config);
        $this->assertTrue($capability['canSubmit']);
        $this->assertFalse($capability['probes']['fromConfigured']);
        $this->assertSame('php', $capability['selectedTransport']);
    }

    public function test_capability_cannot_submit_without_transport_even_with_fallback_from(): void
    {
        $resolver = new MailDeliveryTransportResolver(
            phpMailProbe: static fn (): bool => false,
            sendmailProbe: static fn (): bool => false,
        );
        $config = self::config(from: '', transport: MailDeliveryConfig::TRANSPORT_AUTO);
        $capability = $resolver->capability($config);
        $this->assertFalse($capability['canSubmit']);
        $this->assertFalse($capability['probes']['fromConfigured']);
        $this->assertNull($capability['selectedTransport']);
    }

    public function test_forced_php_when_probe_false_is_unavailable(): void
    {
        $resolver = new MailDeliveryTransportResolver(phpMailProbe: static fn (): bool => false);
        $config = self::config(from: 'ops@example.test', transport: MailDeliveryConfig::TRANSPORT_PHP);
        $resolved = $resolver->resolve($config);

        $this->assertSame('php', $resolved->name);
        $this->assertSame(DeliveryResult::UNAVAILABLE, $resolved->blockStatus);
        $this->assertFalse($resolved->canAttempt());
        $this->assertFalse($resolver->capability($config)['canSubmit']);
    }

    public function test_forced_sendmail_when_probe_false_is_unavailable(): void
    {
        $resolver = new MailDeliveryTransportResolver(sendmailProbe: static fn (): bool => false);
        $config = self::config(from: 'ops@example.test', transport: MailDeliveryConfig::TRANSPORT_SENDMAIL);
        $resolved = $resolver->resolve($config);

        $this->assertSame('sendmail', $resolved->name);
        $this->assertSame(DeliveryResult::UNAVAILABLE, $resolved->blockStatus);
        $this->assertFalse($resolved->canAttempt());
        $this->assertFalse($resolver->capability($config)['canSubmit']);
    }

    public function test_forced_php_when_available_can_submit(): void
    {
        $resolver = new MailDeliveryTransportResolver(phpMailProbe: static fn (): bool => true);
        $config = self::config(from: 'ops@example.test', transport: MailDeliveryConfig::TRANSPORT_PHP);
        $resolved = $resolver->resolve($config);

        $this->assertSame('php', $resolved->name);
        $this->assertNull($resolved->blockStatus);
        $this->assertTrue($resolved->canAttempt());
        $this->assertTrue($resolver->capability($config)['canSubmit']);
    }

    public function test_forced_smtp_with_empty_host_is_unavailable_not_auth_required(): void
    {
        $config = self::config(
            from: 'ops@example.test',
            transport: MailDeliveryConfig::TRANSPORT_SMTP,
            smtpHost: '',
        );
        $resolved = $this->resolver->resolve($config);

        $this->assertSame('smtp', $resolved->name);
        $this->assertSame(DeliveryResult::UNAVAILABLE, $resolved->blockStatus);
        $this->assertNotSame(DeliveryResult::SMTP_AUTH_REQUIRED, $resolved->blockStatus);
        $this->assertFalse($resolved->canAttempt());
        $this->assertFalse($this->resolver->capability($config)['canSubmit']);
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
