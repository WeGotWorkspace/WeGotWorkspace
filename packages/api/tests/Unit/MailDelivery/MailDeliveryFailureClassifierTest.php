<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\DeliveryResult;
use App\Services\MailDelivery\MailDeliveryFailureClassifier;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\Exception\UnexpectedResponseException;

final class MailDeliveryFailureClassifierTest extends TestCase
{
    private MailDeliveryFailureClassifier $classifier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->classifier = new MailDeliveryFailureClassifier;
    }

    public function test_smtp_auth_code_on_transport_exception_is_auth(): void
    {
        $e = new TransportException('Failed to authenticate on SMTP server', 535);
        $this->assertSame(DeliveryResult::AUTH, $this->classifier->classify($e));
    }

    public function test_unexpected_response_with_auth_code_is_auth(): void
    {
        $e = new UnexpectedResponseException('Expected response code "235" but got "535"', 535);
        $this->assertSame(DeliveryResult::AUTH, $this->classifier->classify($e));
    }

    public function test_transport_timeout_message_is_timeout(): void
    {
        $e = new TransportException('Connection to "smtp.example.test:587" timed out.');
        $this->assertSame(DeliveryResult::TIMEOUT, $this->classifier->classify($e));
    }

    public function test_transport_connect_message_is_connect(): void
    {
        $e = new TransportException('Connection could not be established with host "smtp.example.test": Connection refused');
        $this->assertSame(DeliveryResult::CONNECT, $this->classifier->classify($e));
    }

    public function test_non_transport_exception_falls_back_to_message_match(): void
    {
        $this->assertSame(DeliveryResult::TIMEOUT, $this->classifier->classify(new RuntimeException('operation timed out')));
        $this->assertSame(DeliveryResult::AUTH, $this->classifier->classify(new RuntimeException('535 authentication failed')));
        $this->assertSame(DeliveryResult::CONNECT, $this->classifier->classify(new RuntimeException('could not connect')));
        $this->assertSame(DeliveryResult::UNAVAILABLE, $this->classifier->classify(new RuntimeException('disk full')));
    }
}
