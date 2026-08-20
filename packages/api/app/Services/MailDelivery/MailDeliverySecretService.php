<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use App\Exceptions\ApiHttpException;
use App\Services\Mail\MailSecretService;

final class MailDeliverySecretService
{
    public function __construct(private MailSecretService $secrets) {}

    public function encrypt(string $plain): string
    {
        if ($plain === '') {
            return '';
        }
        $this->secrets->ensureSecretFile();
        $secret = $this->secrets->readBinary();
        if ($secret === null) {
            throw new ApiHttpException(500, 'Could not initialize mail delivery encryption secret.', 'server_error');
        }
        if (! function_exists('openssl_encrypt')) {
            throw new ApiHttpException(500, 'openssl extension required to store mail delivery passwords.', 'server_error');
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->key($secret), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($cipher === false) {
            throw new ApiHttpException(500, 'Could not encrypt mail delivery password.', 'server_error');
        }

        return base64_encode($iv.$tag.$cipher);
    }

    public function decrypt(string $blob): string
    {
        if ($blob === '' || ! function_exists('openssl_decrypt')) {
            return '';
        }
        $secret = $this->secrets->readBinary();
        if ($secret === null) {
            return '';
        }
        $raw = base64_decode($blob, true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ct = substr($raw, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', $this->key($secret), OPENSSL_RAW_DATA, $iv, $tag);

        return is_string($pt) ? $pt : '';
    }

    private function key(string $secret): string
    {
        return substr(hash('sha256', $secret.'|mail-delivery|smtp', true), 0, 32);
    }
}
