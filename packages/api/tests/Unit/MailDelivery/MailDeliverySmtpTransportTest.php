<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliverySmtpTransport;
use PHPUnit\Framework\TestCase;

final class MailDeliverySmtpTransportTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('WGW_MAIL_SMTP_HOST_OVERRIDE');

        parent::tearDown();
    }

    public function test_normalizes_submission_port_security_mismatch(): void
    {
        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'mail.example.test',
            'port' => 587,
            'security' => 'ssl',
        ]);

        $this->assertSame('starttls', $transport['security']);
        $this->assertSame(587, $transport['port']);
    }

    public function test_normalizes_implicit_tls_port(): void
    {
        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'mail.example.test',
            'port' => 465,
            'security' => 'starttls',
        ]);

        $this->assertSame('ssl', $transport['security']);
    }

    public function test_out_of_range_port_falls_back_to_submission(): void
    {
        foreach ([0, -1, 65536, 'not a port'] as $port) {
            $transport = MailDeliverySmtpTransport::normalize([
                'host' => 'mail.example.test',
                'port' => $port,
                'security' => 'starttls',
            ]);

            $this->assertSame(587, $transport['port'], 'port '.var_export($port, true));
        }
    }

    public function test_unknown_security_falls_back_to_tls(): void
    {
        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'mail.example.test',
            'port' => 2525,
            'security' => 'tls-please',
        ]);

        $this->assertSame('ssl', $transport['security']);
        $this->assertTrue($transport['smtpAuth']);
    }

    public function test_port_25_with_ssl_becomes_plain(): void
    {
        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'mail.example.test',
            'port' => 25,
            'security' => 'ssl',
        ]);

        $this->assertSame('none', $transport['security']);
    }

    public function test_plain_relay_on_localhost_skips_auth(): void
    {
        foreach (['localhost', '127.0.0.1', '::1', ' LOCALHOST '] as $host) {
            $transport = MailDeliverySmtpTransport::normalize([
                'host' => $host,
                'port' => 25,
                'security' => 'none',
            ]);

            $this->assertFalse($transport['smtpAuth'], $host);
        }
    }

    public function test_plain_relay_on_a_remote_host_keeps_auth(): void
    {
        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'relay.example.test',
            'port' => 25,
            'security' => 'none',
        ]);

        $this->assertTrue($transport['smtpAuth']);
    }

    public function test_host_override_replaces_the_configured_host(): void
    {
        putenv('WGW_MAIL_SMTP_HOST_OVERRIDE= mailpit ');

        $transport = MailDeliverySmtpTransport::normalize([
            'host' => 'mail.example.test',
            'port' => 587,
            'security' => 'starttls',
        ]);

        $this->assertSame('mailpit', $transport['host']);
    }

    public function test_blank_host_override_is_ignored(): void
    {
        putenv('WGW_MAIL_SMTP_HOST_OVERRIDE=   ');

        $transport = MailDeliverySmtpTransport::normalize([
            'host' => ' mail.example.test ',
            'port' => 587,
            'security' => 'starttls',
        ]);

        $this->assertSame('mail.example.test', $transport['host']);
    }
}
