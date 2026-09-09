<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Support\WgwInstallConfig;
use Illuminate\Support\Facades\File;
use Laravel\Passport\Passport;

final class PassportKeyStore
{
    public function __construct(private WgwInstallConfig $install) {}

    public function ensure(): void
    {
        // CryptKey emits E_USER_NOTICE unless the key file is 600/640/660.
        // New keys are written 0640; existing 0644 public keys are tightened below.
        // The flag stays off so a chmod failure on a bind mount cannot 500 /mcp.
        Passport::$validateKeyPermissions = false;

        $private = config('passport.private_key');
        $public = config('passport.public_key');
        if (is_string($private) && $private !== '' && is_string($public) && $public !== '') {
            return;
        }

        if (app()->environment('testing')) {
            $this->ensureTestingKeys();

            return;
        }

        $dir = rtrim($this->install->dataDir(), '/').'/keys';
        File::ensureDirectoryExists($dir, 0700);
        $privatePath = $dir.'/oauth-private.key';
        $publicPath = $dir.'/oauth-public.key';
        if (! File::exists($privatePath) || ! File::exists($publicPath)) {
            $this->generatePemPair($privatePath, $publicPath);
        }
        $this->tightenWorldReadablePublicKey($publicPath);
        Passport::loadKeysFrom($dir);
    }

    private function ensureTestingKeys(): void
    {
        static $pair = null;
        if ($pair === null) {
            $resource = openssl_pkey_new([
                'private_key_bits' => 2048,
                'private_key_type' => OPENSSL_KEYTYPE_RSA,
            ]);
            if ($resource === false) {
                throw new \RuntimeException('Could not generate Passport test keys.');
            }
            $privatePem = '';
            openssl_pkey_export($resource, $privatePem);
            $details = openssl_pkey_get_details($resource);
            $pair = [
                'private' => $privatePem,
                'public' => is_array($details) ? (string) ($details['key'] ?? '') : '',
            ];
        }
        config([
            'passport.private_key' => $pair['private'],
            'passport.public_key' => $pair['public'],
        ]);
    }

    private function generatePemPair(string $privatePath, string $publicPath): void
    {
        $resource = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        if ($resource === false) {
            throw new \RuntimeException('Could not generate Passport keys.');
        }
        $privatePem = '';
        if (! openssl_pkey_export($resource, $privatePem)) {
            throw new \RuntimeException('Could not export Passport private key.');
        }
        $details = openssl_pkey_get_details($resource);
        if (! is_array($details) || ! is_string($details['key'] ?? null)) {
            throw new \RuntimeException('Could not export Passport public key.');
        }
        File::put($privatePath, $privatePem);
        File::put($publicPath, $details['key']);
        @chmod($privatePath, 0600);
        @chmod($publicPath, 0640);
    }

    private function tightenWorldReadablePublicKey(string $publicPath): void
    {
        $perms = @fileperms($publicPath);
        if ($perms === false) {
            return;
        }
        if (($perms & 0777) === 0644) {
            @chmod($publicPath, 0640);
        }
    }
}
