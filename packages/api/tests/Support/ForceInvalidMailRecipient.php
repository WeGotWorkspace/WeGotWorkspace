<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

if (! function_exists(__NAMESPACE__.'\\filter_var')) {
    /**
     * PasswordRecoveryService and MailDeliveryService are final, and this suite
     * does not load Mockery. While $GLOBALS['wgw_force_invalid_mail_recipient']
     * is true, only alice@example.test fails FILTER_VALIDATE_EMAIL here, so
     * send() throws InvalidOutboundMessageException after recovery accepted the
     * address. Every other call uses the real filter_var.
     */
    function filter_var(mixed $value, int $filter = FILTER_DEFAULT, array|int $options = 0): mixed
    {
        if (
            ($GLOBALS['wgw_force_invalid_mail_recipient'] ?? false) === true
            && $filter === \FILTER_VALIDATE_EMAIL
            && $value === 'alice@example.test'
        ) {
            return false;
        }

        return \filter_var($value, $filter, $options);
    }
}
