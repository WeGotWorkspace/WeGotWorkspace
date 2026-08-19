<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryMailerFactory;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use Tests\TestCase;

final class MailDeliveryMailerFactoryTest extends TestCase
{
    public function test_config_file_default_mailer_stays_log(): void
    {
        $source = (string) file_get_contents(dirname(__DIR__, 3).'/config/mail.php');
        $this->assertStringContainsString("env('MAIL_MAILER', 'log')", $source);
        $this->assertStringNotContainsString("'default' => env('MAIL_MAILER', 'wgw')", $source);
        $this->assertStringNotContainsString("'default' => 'wgw'", $source);
    }

    public function test_smtp_and_sendmail_timeout_is_ten_seconds(): void
    {
        $factory = new MailDeliveryMailerFactory(new MailDeliveryTransportResolver);
        $config = new MailDeliveryConfig(
            from: 'ops@example.test',
            transport: MailDeliveryConfig::TRANSPORT_SMTP,
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpSecurity: 'starttls',
            smtpUsername: 'relay',
            smtpPassword: 'secret',
            smtpPasswordSet: true,
        );

        $smtp = $factory->mailerConfig(MailDeliveryConfig::TRANSPORT_SMTP, $config);
        $this->assertSame('smtp', $smtp['transport']);
        $this->assertSame(10, $smtp['timeout']);

        $sendmail = $factory->mailerConfig(MailDeliveryConfig::TRANSPORT_SENDMAIL, $config);
        $this->assertSame('wgw_sendmail', $sendmail['transport']);
        $this->assertSame(10, $sendmail['timeout']);
    }

    public function test_php_mailer_has_no_socket_timeout(): void
    {
        $factory = new MailDeliveryMailerFactory(new MailDeliveryTransportResolver);
        $config = new MailDeliveryConfig(
            from: 'ops@example.test',
            transport: MailDeliveryConfig::TRANSPORT_PHP,
            smtpHost: '',
            smtpPort: 587,
            smtpSecurity: 'starttls',
            smtpUsername: '',
            smtpPassword: '',
            smtpPasswordSet: false,
        );

        $php = $factory->mailerConfig(MailDeliveryConfig::TRANSPORT_PHP, $config);
        $this->assertSame('mail', $php['transport']);
        $this->assertArrayNotHasKey('timeout', $php);
    }
}
