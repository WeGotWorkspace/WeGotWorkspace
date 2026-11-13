<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use App\Support\DataDirSecretBox;

final class MailDeliverySecretService
{
    /** Key label of the SMTP delivery password; stored passwords depend on it. */
    public const LABEL = 'mail-delivery|smtp';

    public function __construct(private DataDirSecretBox $box) {}

    public function encrypt(string $plain): string
    {
        return $this->box->encrypt($plain, self::LABEL);
    }

    public function decrypt(string $blob): string
    {
        return $this->box->decrypt($blob, self::LABEL);
    }
}
