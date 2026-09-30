<?php

declare(strict_types=1);

namespace Tests\Support\Update;

final class UpdateReleaseFixture
{
    private function __construct(
        public readonly string $publicKeyPath,
        private readonly \OpenSSLAsymmetricKey $privateKey,
    ) {}

    public static function generate(string $directory): self
    {
        if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw new \RuntimeException('Could not create update fixture directory.');
        }
        $key = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        if ($key === false) {
            throw new \RuntimeException('Could not generate update test key.');
        }
        $details = openssl_pkey_get_details($key);
        if (! is_array($details) || ! isset($details['key']) || ! is_string($details['key'])) {
            throw new \RuntimeException('Could not export update test public key.');
        }
        $path = $directory.'/update-public.pem';
        if (file_put_contents($path, $details['key']) === false) {
            throw new \RuntimeException('Could not write update test public key.');
        }

        return new self($path, $key);
    }

    public function sign(string $payload): string
    {
        $signature = '';
        $ok = openssl_sign($payload, $signature, $this->privateKey, OPENSSL_ALGO_SHA256);
        if ($ok !== true) {
            throw new \RuntimeException('Could not sign update test payload.');
        }

        return base64_encode($signature);
    }

    /**
     * @param  array<string, string>  $files
     */
    public function zip(array $files, string $root = 'release'): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'wgw-rel-');
        if ($tmp === false) {
            throw new \RuntimeException('Could not create release zip temp file.');
        }
        $zip = new \ZipArchive;
        if ($zip->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException('Could not create release zip.');
        }
        foreach ($files as $name => $contents) {
            $zip->addFromString($root.'/'.$name, $contents);
        }
        $zip->close();
        $bytes = file_get_contents($tmp);
        @unlink($tmp);
        if (! is_string($bytes) || $bytes === '') {
            throw new \RuntimeException('Could not read release zip.');
        }

        return $bytes;
    }
}
