<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;

final class InstallerJwtKeyGenerator
{
    public function __construct(private AppPaths $paths) {}

    public function ensureKeys(): void
    {
        $keysDir = rtrim($this->paths->dataDir(), '/').'/keys';
        $privatePath = $this->paths->jwtPrivateKeyPath();
        $publicPath = $this->paths->jwtPublicKeyPath();

        if (is_readable($privatePath) && is_readable($publicPath)) {
            return;
        }

        if (! is_dir($keysDir) && ! @mkdir($keysDir, 0700, true) && ! is_dir($keysDir)) {
            throw new \RuntimeException('Could not create JWT keys directory.');
        }

        $resource = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        if ($resource === false) {
            throw new \RuntimeException('Could not generate JWT signing keys (OpenSSL).');
        }

        $privatePem = '';
        if (! openssl_pkey_export($resource, $privatePem)) {
            throw new \RuntimeException('Could not export JWT private key.');
        }
        $details = openssl_pkey_get_details($resource);
        if (! is_array($details) || ! is_string($details['key'] ?? null)) {
            throw new \RuntimeException('Could not read JWT public key.');
        }
        $publicPem = $details['key'];

        if (file_put_contents($privatePath, $privatePem, LOCK_EX) === false) {
            throw new \RuntimeException('Could not write JWT private key.');
        }
        if (file_put_contents($publicPath, $publicPem, LOCK_EX) === false) {
            @unlink($privatePath);
            throw new \RuntimeException('Could not write JWT public key.');
        }

        @chmod($privatePath, 0600);
        @chmod($publicPath, 0644);
    }
}
