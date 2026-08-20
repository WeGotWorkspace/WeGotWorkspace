<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

final class MailDeliveryFailureClassifier
{
    /**
     * @return DeliveryResult::TIMEOUT|DeliveryResult::AUTH|DeliveryResult::CONNECT|DeliveryResult::UNAVAILABLE
     */
    public function classify(\Throwable $e): string
    {
        if ($e instanceof TransportExceptionInterface && in_array($e->getCode(), [534, 535], true)) {
            return DeliveryResult::AUTH;
        }

        $message = $e->getMessage();
        if ($e instanceof TransportExceptionInterface) {
            $debug = $e->getDebug();
            if ($debug !== '') {
                $message .= ' '.$debug;
            }
        }

        return $this->classifyFromMessage($message);
    }

    /**
     * @return DeliveryResult::TIMEOUT|DeliveryResult::AUTH|DeliveryResult::CONNECT|DeliveryResult::UNAVAILABLE
     */
    private function classifyFromMessage(string $message): string
    {
        $msg = strtolower($message);
        if (str_contains($msg, 'timed out') || str_contains($msg, 'timeout')) {
            return DeliveryResult::TIMEOUT;
        }
        if (str_contains($msg, 'auth') || str_contains($msg, '535') || str_contains($msg, '534')) {
            return DeliveryResult::AUTH;
        }
        if (
            str_contains($msg, 'connect')
            || str_contains($msg, 'connection')
            || str_contains($msg, 'refused')
            || str_contains($msg, 'resolv')
        ) {
            return DeliveryResult::CONNECT;
        }

        return DeliveryResult::UNAVAILABLE;
    }
}
