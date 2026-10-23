<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliverySmtpTransport;
use PHPUnit\Framework\TestCase;

final class MailDeliverySmtpTransportTest extends TestCase
{
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
}
