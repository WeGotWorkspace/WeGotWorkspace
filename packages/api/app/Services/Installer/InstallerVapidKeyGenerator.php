<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;
use Minishlink\WebPush\VAPID;

final class InstallerVapidKeyGenerator
{
    public function __construct(private AppPaths $paths) {}

    public function publicKeyPath(): string
    {
        return rtrim($this->paths->dataDir(), '/').'/keys/vapid-public.txt';
    }

    public function privateKeyPath(): string
    {
        return rtrim($this->paths->dataDir(), '/').'/keys/vapid-private.txt';
    }

    public function ensureKeys(): void
    {
        $publicPath = $this->publicKeyPath();
        $privatePath = $this->privateKeyPath();
        if (is_readable($publicPath) && is_readable($privatePath)) {
            return;
        }

        $keysDir = rtrim($this->paths->dataDir(), '/').'/keys';
        if (! is_dir($keysDir) && ! @mkdir($keysDir, 0700, true) && ! is_dir($keysDir)) {
            throw new \RuntimeException('Could not create VAPID keys directory.');
        }

        $pair = $this->generateP256Pair();
        if (@file_put_contents($privatePath, $pair['private']."\n", LOCK_EX) === false) {
            throw new \RuntimeException('Could not write VAPID private key.');
        }
        if (@file_put_contents($publicPath, $pair['public']."\n", LOCK_EX) === false) {
            throw new \RuntimeException('Could not write VAPID public key.');
        }
        @chmod($privatePath, 0600);
        @chmod($publicPath, 0644);
    }

    public function publicKey(): string
    {
        $this->ensureKeys();
        $fromConfig = trim((string) config('wgw.vapid.public_key', ''));
        if ($fromConfig !== '') {
            return $fromConfig;
        }

        return $this->readKeyFile($this->publicKeyPath());
    }

    public function privateKey(): string
    {
        $this->ensureKeys();
        $fromConfig = trim((string) config('wgw.vapid.private_key', ''));
        if ($fromConfig !== '') {
            return $fromConfig;
        }

        return $this->readKeyFile($this->privateKeyPath());
    }

    private function readKeyFile(string $path): string
    {
        if (! is_readable($path)) {
            return '';
        }

        return trim((string) file_get_contents($path));
    }

    /**
     * @return array{public: string, private: string}
     */
    private function generateP256Pair(): array
    {
        if (class_exists(VAPID::class)) {
            /** @var array{publicKey: string, privateKey: string} $keys */
            $keys = VAPID::createVapidKeys();

            return [
                'public' => $keys['publicKey'],
                'private' => $keys['privateKey'],
            ];
        }

        $resource = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        if ($resource === false) {
            throw new \RuntimeException('Could not generate VAPID keys (OpenSSL).');
        }
        $details = openssl_pkey_get_details($resource);
        if ($details === false || ! isset($details['ec']['x'], $details['ec']['y'], $details['ec']['d'])) {
            throw new \RuntimeException('Could not export VAPID key details.');
        }
        $x = $this->pad32((string) $details['ec']['x']);
        $y = $this->pad32((string) $details['ec']['y']);
        $d = $this->pad32((string) $details['ec']['d']);
        $public = $this->base64Url("\x04".$x.$y);
        $private = $this->base64Url($d);

        return ['public' => $public, 'private' => $private];
    }

    private function pad32(string $bin): string
    {
        return str_pad($bin, 32, "\0", STR_PAD_LEFT);
    }

    private function base64Url(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }
}
