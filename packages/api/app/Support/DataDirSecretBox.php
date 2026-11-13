<?php

declare(strict_types=1);

namespace App\Support;

use App\Exceptions\ApiHttpException;
use App\Services\MailDelivery\MailDeliverySecretFile;

/**
 * AES-256-GCM for secrets the server must read back (mail passwords), keyed
 * from the data-dir secret file. Each use passes its own label, so a blob for
 * one purpose never decrypts under another. Decrypt fails closed to ''.
 */
final class DataDirSecretBox
{
    public function __construct(private MailDeliverySecretFile $secrets) {}

    public function encrypt(string $plain, string $label): string
    {
        if ($plain === '') {
            return '';
        }
        $this->secrets->ensureSecretFile();
        $secret = $this->secrets->readBinary();
        if ($secret === null) {
            throw new ApiHttpException(500, 'Could not initialize the encryption secret.', 'server_error');
        }
        if (! function_exists('openssl_encrypt')) {
            throw new ApiHttpException(500, 'The openssl extension is required to store passwords.', 'server_error');
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->key($secret, $label), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($cipher === false) {
            throw new ApiHttpException(500, 'Could not encrypt the password.', 'server_error');
        }

        return base64_encode($iv.$tag.$cipher);
    }

    public function decrypt(string $blob, string $label): string
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
        $pt = openssl_decrypt($ct, 'aes-256-gcm', $this->key($secret, $label), OPENSSL_RAW_DATA, $iv, $tag);

        return is_string($pt) ? $pt : '';
    }

    private function key(string $secret, string $label): string
    {
        return substr(hash('sha256', $secret.'|'.$label, true), 0, 32);
    }
}
